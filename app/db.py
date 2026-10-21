import contextvars
import json
import os
import re
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

import catalog

DATA_DIR = Path(os.environ.get("DATA_DIR", "/data"))
DB_PATH = DATA_DIR / "workout.db"
MEDIA_DIR = DATA_DIR / "media"
SCHEMA_VERSION = 3
DEFAULT_USER_NAME = os.environ.get("DEFAULT_USER_NAME", "User")
USER_COLORS = ["#f2c14e", "#4c86f9", "#e5484d", "#3dbe7a", "#c38df0", "#5fd1d9", "#f28f4e", "#edebe6"]

_current_user = contextvars.ContextVar("current_user", default=None)


class NoUser(Exception):
    pass


def uid():
    value = _current_user.get()
    if value is None:
        raise NoUser()
    return value


def current_user_id():
    return _current_user.get()


def set_current_user(user_id):
    return _current_user.set(user_id)


def reset_current_user(token):
    _current_user.reset(token)


@contextmanager
def as_user(user_id):
    token = _current_user.set(user_id)
    try:
        yield
    finally:
        _current_user.reset(token)

_lock = threading.RLock()
_connection = None


def now_iso():
    return datetime.now().isoformat(timespec="seconds")


def get_connection():
    global _connection
    if _connection is None:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        MEDIA_DIR.mkdir(parents=True, exist_ok=True)
        _connection = sqlite3.connect(DB_PATH, check_same_thread=False)
        _connection.row_factory = sqlite3.Row
        _connection.execute("PRAGMA foreign_keys = ON")
        _connection.execute("PRAGMA journal_mode = WAL")
    return _connection


@contextmanager
def transaction():
    with _lock:
        conn = get_connection()
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise


def query_all(sql, params=()):
    with _lock:
        return [dict(row) for row in get_connection().execute(sql, params).fetchall()]


def query_one(sql, params=()):
    with _lock:
        row = get_connection().execute(sql, params).fetchone()
        return dict(row) if row else None


def get_setting(key, default=None):
    row = query_one("SELECT value FROM settings WHERE key = ?", (key,))
    return row["value"] if row else default


def set_setting(conn, key, value):
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, str(value)),
    )


def get_json_setting(key, default):
    raw = get_setting(key)
    if raw is None:
        return default
    try:
        return json.loads(raw)
    except ValueError:
        return default


USER_SETTING_DEFAULTS = {
    "priority_muscles": json.dumps(catalog.DEFAULT_PRIORITY_MUSCLES),
    "goal_fat_loss": "0",
    "block_weeks": "5",
    "cardio_target_min": "150",
}


def get_user_setting(key, default=None, user_id=None):
    user_id = user_id or uid()
    row = query_one("SELECT value FROM user_settings WHERE user_id = ? AND key = ?", (user_id, key))
    if row:
        return row["value"]
    return USER_SETTING_DEFAULTS.get(key, default) if default is None else default


def get_user_json_setting(key, default, user_id=None):
    raw = get_user_setting(key, None, user_id)
    if raw is None:
        return default
    try:
        return json.loads(raw)
    except ValueError:
        return default


def set_user_setting(conn, key, value, user_id=None):
    conn.execute(
        "INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value",
        (user_id or uid(), key, str(value)),
    )


BASE_SCHEMA = """
CREATE TABLE IF NOT EXISTS exercises (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    measure TEXT NOT NULL DEFAULT 'reps',
    track_weight INTEGER NOT NULL DEFAULT 1,
    video_id TEXT,
    video_start INTEGER,
    video_end INTEGER,
    video_title TEXT,
    video_source TEXT,
    video_auto_tried INTEGER NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS programs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    weekday INTEGER,
    description TEXT NOT NULL DEFAULT '',
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS program_exercises (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    program_id INTEGER NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
    exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    sets INTEGER NOT NULL DEFAULT 3,
    target TEXT NOT NULL DEFAULT '',
    rest_seconds INTEGER NOT NULL DEFAULT 90
);
CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    day TEXT NOT NULL,
    program_id INTEGER REFERENCES programs(id) ON DELETE SET NULL,
    program_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    current_index INTEGER NOT NULL DEFAULT 0,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    notes TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS session_exercises (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    exercise_id INTEGER REFERENCES exercises(id) ON DELETE SET NULL,
    exercise_name TEXT NOT NULL,
    measure TEXT NOT NULL,
    track_weight INTEGER NOT NULL,
    position INTEGER NOT NULL,
    planned_sets INTEGER NOT NULL,
    target TEXT NOT NULL DEFAULT '',
    rest_seconds INTEGER NOT NULL DEFAULT 90
);
CREATE TABLE IF NOT EXISTS session_sets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_exercise_id INTEGER NOT NULL REFERENCES session_exercises(id) ON DELETE CASCADE,
    set_number INTEGER NOT NULL,
    value REAL,
    weight REAL,
    done_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS equipment (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'accessory',
    available INTEGER NOT NULL DEFAULT 1,
    weights TEXT,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS blocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number INTEGER NOT NULL,
    start_day TEXT NOT NULL,
    weeks INTEGER NOT NULL,
    deload_from TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    summary TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    ended_at TEXT
);
CREATE TABLE IF NOT EXISTS program_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    program_id INTEGER NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    snapshot TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS coach_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    level TEXT NOT NULL,
    kind TEXT NOT NULL,
    program_id INTEGER REFERENCES programs(id) ON DELETE SET NULL,
    exercise_id INTEGER REFERENCES exercises(id) ON DELETE SET NULL,
    block_id INTEGER REFERENCES blocks(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'rule',
    version_id INTEGER REFERENCES program_versions(id) ON DELETE SET NULL,
    undone INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    sex TEXT NOT NULL DEFAULT 'male',
    age INTEGER,
    height_cm REAL,
    weight_kg REAL,
    experience TEXT NOT NULL DEFAULT 'none',
    trained_recently INTEGER NOT NULL DEFAULT 0,
    goal TEXT NOT NULL DEFAULT 'health',
    days_per_week INTEGER NOT NULL DEFAULT 3,
    session_minutes INTEGER NOT NULL DEFAULT 60,
    priority_muscles TEXT NOT NULL DEFAULT '[]',
    limitations TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '#f2c14e',
    status TEXT NOT NULL DEFAULT 'ready',
    status_message TEXT NOT NULL DEFAULT '',
    report TEXT NOT NULL DEFAULT '',
    plan_summary TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    last_seen TEXT
);
CREATE TABLE IF NOT EXISTS user_settings (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (user_id, key)
);
CREATE TABLE IF NOT EXISTS body_metrics (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day TEXT NOT NULL,
    weight_kg REAL,
    waist_cm REAL,
    PRIMARY KEY (user_id, day)
);
CREATE INDEX IF NOT EXISTS idx_sessions_day ON sessions(day);
CREATE INDEX IF NOT EXISTS idx_session_exercises_session ON session_exercises(session_id);
CREATE INDEX IF NOT EXISTS idx_session_exercises_exercise ON session_exercises(exercise_id);
CREATE INDEX IF NOT EXISTS idx_session_sets_exercise ON session_sets(session_exercise_id);
CREATE INDEX IF NOT EXISTS idx_coach_log_created ON coach_log(created_at);

CREATE TABLE IF NOT EXISTS exercise_feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    session_id INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
    session_exercise_id INTEGER REFERENCES session_exercises(id) ON DELETE CASCADE,
    exercise_id INTEGER REFERENCES exercises(id) ON DELETE SET NULL,
    rating TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    UNIQUE (session_exercise_id)
);
CREATE INDEX IF NOT EXISTS idx_feedback_user ON exercise_feedback(user_id, exercise_id);

CREATE TABLE IF NOT EXISTS coach_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    ref TEXT NOT NULL,
    coach TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    message TEXT NOT NULL DEFAULT '',
    points TEXT NOT NULL DEFAULT '[]',
    source TEXT NOT NULL DEFAULT 'ai',
    created_at TEXT NOT NULL,
    UNIQUE (user_id, kind, ref)
);

CREATE TABLE IF NOT EXISTS ai_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    created_at TEXT NOT NULL,
    score REAL,
    attempts INTEGER NOT NULL DEFAULT 0,
    problems TEXT NOT NULL DEFAULT '[]',
    detail TEXT NOT NULL DEFAULT ''
);
"""

ADDED_COLUMNS = {
    "exercises": [
        ("primary_muscle", "TEXT"),
        ("secondary_muscles", "TEXT NOT NULL DEFAULT '[]'"),
        ("pattern", "TEXT"),
        ("equipment", "TEXT NOT NULL DEFAULT '[]'"),
        ("load_equipment", "TEXT"),
        ("difficulty", "INTEGER NOT NULL DEFAULT 1"),
        ("cues", "TEXT NOT NULL DEFAULT ''"),
        ("media_loop", "TEXT"),
        ("media_muscles", "TEXT"),
        ("in_library", "INTEGER NOT NULL DEFAULT 0"),
    ],
    "program_exercises": [
        ("rep_min", "REAL"),
        ("rep_max", "REAL"),
        ("target_weight", "REAL"),
        ("miss_count", "INTEGER NOT NULL DEFAULT 0"),
        ("hit_count", "INTEGER NOT NULL DEFAULT 0"),
        ("added_block", "INTEGER NOT NULL DEFAULT 0"),
        ("cue", "TEXT NOT NULL DEFAULT ''"),
    ],
    "session_exercises": [
        ("program_exercise_id", "INTEGER"),
        ("rep_min", "REAL"),
        ("rep_max", "REAL"),
        ("target_weight", "REAL"),
    ],
    "session_sets": [
        ("effort", "INTEGER"),
    ],
    "equipment": [
        ("photo", "TEXT"),
    ],
    "programs": [
        ("user_id", "INTEGER REFERENCES users(id) ON DELETE CASCADE"),
    ],
    "sessions": [
        ("block_id", "INTEGER"),
        ("block_week", "INTEGER"),
        ("deload", "INTEGER NOT NULL DEFAULT 0"),
        ("cycle_adjusted", "INTEGER NOT NULL DEFAULT 0"),
        ("adapted", "INTEGER NOT NULL DEFAULT 0"),
        ("fatigue", "INTEGER NOT NULL DEFAULT 0"),
        ("user_id", "INTEGER REFERENCES users(id) ON DELETE CASCADE"),
    ],
    "blocks": [
        ("user_id", "INTEGER REFERENCES users(id) ON DELETE CASCADE"),
    ],
    "coach_log": [
        ("user_id", "INTEGER REFERENCES users(id) ON DELETE CASCADE"),
    ],
    "users": [
        ("coach", "TEXT"),
        ("rebuild_request", "TEXT NOT NULL DEFAULT ''"),
        ("is_superuser", "INTEGER NOT NULL DEFAULT 0"),
    ],
}


def parse_target(text):
    numbers = [float(value) for value in re.findall(r"\d+(?:\.\d+)?", text or "")]
    if not numbers:
        return None, None
    if len(numbers) == 1:
        return numbers[0], numbers[0]
    return min(numbers[0], numbers[1]), max(numbers[0], numbers[1])


def format_number(value):
    if value is None:
        return ""
    return str(int(value)) if float(value).is_integer() else str(round(value, 1))


def build_target(rep_min, rep_max, measure, fallback=""):
    unit = {"sec": " s", "min": " min"}.get(measure, "")
    if rep_min is None and rep_max is None:
        return fallback
    if rep_min == rep_max or rep_max is None:
        return format_number(rep_min) + unit
    return format_number(rep_min) + "–" + format_number(rep_max) + unit


def _columns(conn, table):
    return {row["name"] for row in conn.execute("PRAGMA table_info(" + table + ")").fetchall()}


def _apply_catalog(conn, exercise_id, data):
    conn.execute(
        """
        UPDATE exercises SET primary_muscle = COALESCE(primary_muscle, ?), secondary_muscles = CASE WHEN secondary_muscles = '[]' THEN ? ELSE secondary_muscles END,
        pattern = COALESCE(pattern, ?), equipment = CASE WHEN equipment = '[]' THEN ? ELSE equipment END,
        load_equipment = COALESCE(load_equipment, ?), difficulty = ?, cues = CASE WHEN cues = '' THEN ? ELSE cues END, in_library = 1
        WHERE id = ?
        """,
        (
            data["primary"], json.dumps(data["secondary"]), data["pattern"], json.dumps(data["equipment"]),
            data["load"], data["difficulty"], data["cues"], exercise_id,
        ),
    )


def _migrate_body_metrics(conn):
    columns = _columns(conn, "body_metrics")
    if columns and "user_id" not in columns:
        conn.execute("ALTER TABLE body_metrics RENAME TO body_metrics_legacy")


def _assign_legacy_data(conn, created):
    orphaned = any(
        conn.execute("SELECT 1 FROM " + table + " WHERE user_id IS NULL LIMIT 1").fetchone()
        for table in ("programs", "sessions", "blocks", "coach_log")
    )
    legacy_body = conn.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'body_metrics_legacy'").fetchone()
    if not orphaned and not legacy_body:
        return
    row = conn.execute("SELECT id FROM users ORDER BY id LIMIT 1").fetchone()
    if row:
        user_id = row["id"]
    else:
        user_id = conn.execute(
            "INSERT INTO users (name, sex, experience, trained_recently, goal, days_per_week, priority_muscles, color, status, created_at) VALUES (?, 'male', 'intermediate', 1, 'muscle', 6, ?, ?, 'ready', ?)",
            (DEFAULT_USER_NAME, get_setting("priority_muscles") or json.dumps(catalog.DEFAULT_PRIORITY_MUSCLES), USER_COLORS[0], created),
        ).lastrowid
        for key in USER_SETTING_DEFAULTS:
            value = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
            if value:
                conn.execute("INSERT OR IGNORE INTO user_settings (user_id, key, value) VALUES (?, ?, ?)", (user_id, key, value["value"]))
    for table in ("programs", "sessions", "blocks", "coach_log"):
        conn.execute("UPDATE " + table + " SET user_id = ? WHERE user_id IS NULL", (user_id,))
    if legacy_body:
        conn.execute("INSERT OR IGNORE INTO body_metrics (user_id, day, weight_kg, waist_cm) SELECT ?, day, weight_kg, waist_cm FROM body_metrics_legacy", (user_id,))
        conn.execute("DROP TABLE body_metrics_legacy")


def init_db():
    with transaction() as conn:
        exists = conn.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'body_metrics'").fetchone()
        if exists:
            _migrate_body_metrics(conn)
        conn.executescript(BASE_SCHEMA)
        for table, columns in ADDED_COLUMNS.items():
            existing = _columns(conn, table)
            for name, definition in columns:
                if name not in existing:
                    conn.execute("ALTER TABLE " + table + " ADD COLUMN " + name + " " + definition)
        if not conn.execute("SELECT 1 FROM users WHERE is_superuser = 1").fetchone():
            conn.execute("UPDATE users SET is_superuser = 1 WHERE id = (SELECT MIN(id) FROM users)")

        created = now_iso()
        for key, name, category, available, weights, notes in catalog.EQUIPMENT:
            conn.execute(
                "INSERT OR IGNORE INTO equipment (key, name, category, available, weights, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (key, name, category, 1 if available else 0, json.dumps(weights) if weights else None, notes, created),
            )

        for name, data in catalog.LIBRARY.items():
            row = conn.execute("SELECT id FROM exercises WHERE name = ?", (name,)).fetchone()
            if row is None:
                cursor = conn.execute(
                    "INSERT INTO exercises (name, measure, track_weight, created_at) VALUES (?, ?, ?, ?)",
                    (name, data["measure"], 1 if data["track_weight"] else 0, created),
                )
                exercise_id = cursor.lastrowid
            else:
                exercise_id = row["id"]
            _apply_catalog(conn, exercise_id, data)

        for old, new in catalog.LEGACY_TEXT.items():
            conn.execute("UPDATE equipment SET name = ? WHERE name = ?", (new, old))
            conn.execute("UPDATE equipment SET notes = ? WHERE notes = ?", (new, old))
            conn.execute("UPDATE exercises SET cues = ? WHERE cues = ?", (new, old))
            conn.execute("UPDATE sessions SET program_name = ? WHERE program_name = ?", (new, old))
        for row in conn.execute("SELECT id, target FROM program_exercises WHERE target LIKE '%,%'").fetchall():
            conn.execute("UPDATE program_exercises SET target = ? WHERE id = ?", (row["target"].replace(",", "."), row["id"]))

        set_setting(conn, "seeded", "1")
        _assign_legacy_data(conn, created)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, day)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_programs_user ON programs(user_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_coach_log_user ON coach_log(user_id, id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_blocks_user ON blocks(user_id, status)")

        for row in conn.execute(
            "SELECT pe.id, pe.target, e.measure FROM program_exercises pe JOIN exercises e ON e.id = pe.exercise_id WHERE pe.rep_min IS NULL AND pe.rep_max IS NULL"
        ).fetchall():
            if row["measure"] == "none":
                continue
            low, high = parse_target(row["target"])
            if low is None:
                continue
            conn.execute(
                "UPDATE program_exercises SET rep_min = ?, rep_max = ?, target = ? WHERE id = ?",
                (low, high, build_target(low, high, row["measure"], row["target"]), row["id"]),
            )

        set_setting(conn, "schema_version", SCHEMA_VERSION)


def exercise_row(row):
    if row is None:
        return None
    row = dict(row)
    row["track_weight"] = bool(row.get("track_weight"))
    for key in ("secondary_muscles", "equipment"):
        if key in row:
            try:
                row[key] = json.loads(row[key] or "[]")
            except ValueError:
                row[key] = []
    return row


def equipment_map():
    rows = query_all("SELECT * FROM equipment")
    result = {}
    for row in rows:
        row["available"] = bool(row["available"])
        row["weights"] = json.loads(row["weights"]) if row["weights"] else None
        result[row["key"]] = row
    return result


def snapshot_program(conn, program_id, reason):
    items = [
        dict(row) for row in conn.execute(
            "SELECT exercise_id, position, sets, target, rest_seconds, rep_min, rep_max, target_weight, miss_count, hit_count, added_block FROM program_exercises WHERE program_id = ? ORDER BY position",
            (program_id,),
        ).fetchall()
    ]
    program = dict(conn.execute("SELECT name, weekday, description FROM programs WHERE id = ?", (program_id,)).fetchone())
    cursor = conn.execute(
        "INSERT INTO program_versions (program_id, created_at, reason, snapshot) VALUES (?, ?, ?, ?)",
        (program_id, now_iso(), reason, json.dumps({"program": program, "items": items})),
    )
    return cursor.lastrowid


def restore_program(conn, version_id):
    version = conn.execute("SELECT * FROM program_versions WHERE id = ?", (version_id,)).fetchone()
    if version is None:
        return None
    data = json.loads(version["snapshot"])
    program_id = version["program_id"]
    conn.execute("DELETE FROM program_exercises WHERE program_id = ?", (program_id,))
    for item in data["items"]:
        exists = conn.execute("SELECT 1 FROM exercises WHERE id = ?", (item["exercise_id"],)).fetchone()
        if not exists:
            continue
        conn.execute(
            """
            INSERT INTO program_exercises (program_id, exercise_id, position, sets, target, rest_seconds, rep_min, rep_max, target_weight, miss_count, hit_count, added_block)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                program_id, item["exercise_id"], item["position"], item["sets"], item["target"], item["rest_seconds"],
                item["rep_min"], item["rep_max"], item["target_weight"], item["miss_count"], item["hit_count"], item["added_block"],
            ),
        )
    return program_id


def log_event(conn, level, kind, title, message="", program_id=None, exercise_id=None, block_id=None, source="rule", version_id=None):
    conn.execute(
        """
        INSERT INTO coach_log (user_id, created_at, level, kind, program_id, exercise_id, block_id, title, message, source, version_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (uid(), now_iso(), level, kind, program_id, exercise_id, block_id, title, message, source, version_id),
    )
