import time

import db
import engine
import onboarding
import youtube
from db import query_all, transaction


def auto_video_worker():
    time.sleep(3)
    while True:
        pending = query_all(
            "SELECT id, name FROM exercises WHERE (video_id IS NULL OR video_id = '') AND video_auto_tried = 0 ORDER BY id"
        )
        if not pending:
            time.sleep(60)
            continue
        network_failed = False
        for item in pending:
            try:
                best = youtube.pick_best(item["name"])
            except Exception:
                network_failed = True
                break
            with transaction() as conn:
                current = conn.execute("SELECT video_id FROM exercises WHERE id = ?", (item["id"],)).fetchone()
                if current is None:
                    continue
                if best and not current["video_id"]:
                    conn.execute(
                        "UPDATE exercises SET video_id = ?, video_title = ?, video_source = 'auto', video_auto_tried = 1 WHERE id = ?",
                        (best["video_id"], best["title"], item["id"]),
                    )
                else:
                    conn.execute("UPDATE exercises SET video_auto_tried = 1 WHERE id = ?", (item["id"],))
            time.sleep(1.5)
        if network_failed:
            time.sleep(300)


def for_each_user(callback):
    for user in query_all("SELECT id FROM users WHERE status = 'ready'"):
        with db.as_user(user["id"]):
            try:
                callback()
            except engine.AIUnavailable as error:
                print("user", user["id"], "waiting for AI:", error, flush=True)
            except Exception as error:
                print("user", user["id"], "worker error:", error, flush=True)


def maintenance():
    engine.ensure_block()
    engine.run_pending_progression()
    engine.fix_unavailable_items()


def block_worker():
    while True:
        try:
            onboarding.retry_waiting()
        except Exception as error:
            print("onboarding retry:", error, flush=True)
        for_each_user(maintenance)
        time.sleep(600)
