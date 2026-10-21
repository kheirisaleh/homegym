import hashlib
import hmac
import os
import secrets
import threading
import time

import db

FIELDS = [
    {"key": "ai_provider", "group": "ai", "label": "AI provider", "kind": "select", "options": ["gemini", "ollama"], "env": "AI_PROVIDER", "default": "gemini"},
    {"key": "gemini_api_key", "group": "ai", "label": "Gemini API key", "kind": "secret", "env": "GEMINI_API_KEY", "default": ""},
    {"key": "gemini_model", "group": "ai", "label": "Gemini model", "kind": "text", "env": "GEMINI_MODEL", "default": "gemini-flash-latest"},
    {"key": "gemini_fallback_models", "group": "ai", "label": "Fallback models", "kind": "list", "env": "GEMINI_FALLBACK_MODELS", "default": "gemini-3.5-flash,gemini-flash-lite-latest"},
    {"key": "ollama_url", "group": "ai", "label": "Ollama address", "kind": "text", "env": "OLLAMA_URL", "default": "http://ollama:11434"},
    {"key": "ollama_model", "group": "ai", "label": "Ollama model", "kind": "text", "env": "OLLAMA_MODEL", "default": "qwen2.5:7b-instruct", "legacy": "ai_model"},
    {"key": "ollama_num_ctx", "group": "ai", "label": "Ollama context size", "kind": "int", "env": "OLLAMA_NUM_CTX", "default": "8192", "min": 1024, "max": 131072},
    {"key": "alexa_skill_id", "group": "alexa", "label": "Alexa skill id", "kind": "text", "env": "ALEXA_SKILL_ID", "default": ""},
    {"key": "alexa_users", "group": "alexa", "label": "Users Alexa knows", "kind": "list", "env": "ALEXA_USERS", "default": ""},
    {"key": "pantry_enabled", "group": "pantry", "label": "Use nutrition from the pantry", "kind": "bool", "env": "PANTRY_ENABLED", "default": "0"},
    {"key": "pantry_url", "group": "pantry", "label": "Pantry address", "kind": "text", "env": "PANTRY_URL", "default": ""},
    {"key": "pantry_token", "group": "pantry", "label": "Pantry API key", "kind": "secret", "env": "PANTRY_TOKEN", "default": ""},
    {"key": "pantry_webhook_secret", "group": "pantry", "label": "Pantry webhook secret", "kind": "secret", "env": "PANTRY_WEBHOOK_SECRET", "default": ""},
    {"key": "auto_video", "group": "app", "label": "Find exercise videos automatically", "kind": "bool", "env": "AUTO_VIDEO", "default": "1"},
    {"key": "auto_review", "group": "app", "label": "Nightly coach review", "kind": "bool", "env": "AUTO_REVIEW", "default": "1"},
]

GROUPS = {"ai": "AI coach", "alexa": "Alexa", "pantry": "Pantry link", "app": "App behaviour"}

_FIELD_MAP = {field["key"]: field for field in FIELDS}
_PREFIX = "cfg."
_listeners = []


def on_change(callback):
    _listeners.append(callback)


def _stored(key):
    return db.get_setting(_PREFIX + key)


def source(key):
    field = _FIELD_MAP[key]
    if _stored(key) is not None:
        return "app"
    if (os.environ.get(field["env"]) or "").strip():
        return "environment"
    if field.get("legacy") and db.get_setting(field["legacy"]):
        return "app"
    return "default"


def get(key):
    field = _FIELD_MAP[key]
    value = _stored(key)
    if value is not None:
        return value
    value = (os.environ.get(field["env"]) or "").strip()
    if value:
        return value
    if field.get("legacy"):
        value = db.get_setting(field["legacy"])
        if value:
            return value
    return field["default"]


def get_bool(key):
    return str(get(key)).strip().lower() in ("1", "true", "yes", "on")


def get_int(key):
    try:
        return int(get(key))
    except (TypeError, ValueError):
        return int(_FIELD_MAP[key]["default"])


def get_list(key):
    return [item.strip() for item in str(get(key) or "").split(",") if item.strip()]


def _mask(value):
    if not value:
        return ""
    return "•" * 8 + value[-4:] if len(value) > 8 else "•" * len(value)


def public_view():
    items = []
    for field in FIELDS:
        value = get(field["key"])
        item = {key: field[key] for key in ("key", "group", "label", "kind") if key in field}
        item["options"] = field.get("options")
        item["source"] = source(field["key"])
        if field["kind"] == "secret":
            item["value"] = ""
            item["preview"] = _mask(value)
            item["is_set"] = bool(value)
        elif field["kind"] == "bool":
            item["value"] = get_bool(field["key"])
        else:
            item["value"] = value
        items.append(item)
    return {"groups": GROUPS, "fields": items}


def _normalize(field, value):
    kind = field["kind"]
    if kind == "bool":
        return "1" if value in (True, 1, "1", "true", "on") else "0"
    text = str(value).strip()
    if kind == "select" and text not in field["options"]:
        raise ValueError(field["label"] + " must be one of " + ", ".join(field["options"]))
    if kind == "int":
        number = int(text)
        if number < field.get("min", number) or number > field.get("max", number):
            raise ValueError(field["label"] + " is out of range")
        return str(number)
    if kind == "list":
        return ",".join(item.strip() for item in text.split(",") if item.strip())
    if len(text) > 500:
        raise ValueError(field["label"] + " is too long")
    return text


def update(values, reset=()):
    prepared = {}
    for key, value in (values or {}).items():
        field = _FIELD_MAP.get(key)
        if not field:
            raise ValueError("Unknown setting " + key)
        if field["kind"] == "secret" and (value is None or str(value).strip() == ""):
            continue
        prepared[key] = _normalize(field, value)
    for key in reset:
        if key not in _FIELD_MAP:
            raise ValueError("Unknown setting " + key)
    with db.transaction() as conn:
        for key, value in prepared.items():
            db.set_setting(conn, _PREFIX + key, value)
        for key in reset:
            conn.execute("DELETE FROM settings WHERE key = ?", (_PREFIX + key,))
    changed = set(prepared) | set(reset)
    for callback in _listeners:
        try:
            callback(changed)
        except Exception as error:
            print("settings listener error:", error, flush=True)
    return public_view()


_PIN_KEY = "admin_pin_hash"
_SESSION_SECONDS = 1800
_sessions = {}
_failures = {"count": 0, "until": 0.0}
_auth_lock = threading.Lock()


def _hash_pin(pin, salt=None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", pin.encode("utf-8"), bytes.fromhex(salt), 200000).hex()
    return salt + "$" + digest


def pin_is_set():
    return bool(db.get_setting(_PIN_KEY))


def _valid_pin_format(pin):
    return isinstance(pin, str) and pin.isdigit() and 4 <= len(pin) <= 8


def _check_pin(pin):
    stored = db.get_setting(_PIN_KEY) or ""
    if "$" not in stored:
        return False
    salt, _ = stored.split("$", 1)
    return hmac.compare_digest(_hash_pin(pin, salt), stored)


def _new_session():
    token = secrets.token_urlsafe(32)
    _sessions[token] = time.time() + _SESSION_SECONDS
    return token


def set_pin(pin):
    if not _valid_pin_format(pin):
        raise ValueError("The PIN needs 4 to 8 digits")
    with db.transaction() as conn:
        db.set_setting(conn, _PIN_KEY, _hash_pin(pin))
    with _auth_lock:
        _sessions.clear()
        return _new_session()


def login(pin):
    with _auth_lock:
        now = time.time()
        if now < _failures["until"]:
            raise PermissionError("Too many wrong tries, wait " + str(int(_failures["until"] - now) + 1) + " seconds")
        if not _check_pin(str(pin or "")):
            _failures["count"] += 1
            if _failures["count"] >= 5:
                _failures["until"] = now + 300
                _failures["count"] = 0
            raise PermissionError("Wrong PIN")
        _failures["count"] = 0
        return _new_session()


def valid_session(token):
    with _auth_lock:
        now = time.time()
        for key in [key for key, expiry in _sessions.items() if expiry < now]:
            _sessions.pop(key, None)
        if token and token in _sessions:
            _sessions[token] = now + _SESSION_SECONDS
            return True
        return False


def logout(token):
    with _auth_lock:
        _sessions.pop(token, None)
