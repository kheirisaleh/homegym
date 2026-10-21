import hashlib
import hmac
import time

import pytest

import config
import cycle
import db
import engine
import nutrition
import planner
import youtube
from routes.equipment import clean_weights


@pytest.mark.parametrize(("text", "expected"), [
    ("8-12", (8.0, 12.0)),
    ("12–8 reps", (8.0, 12.0)),
    ("30 s", (30.0, 30.0)),
    ("", (None, None)),
    ("2.5 to 5", (2.5, 5.0)),
])
def test_parse_target(text, expected):
    assert db.parse_target(text) == expected


@pytest.mark.parametrize(("low", "high", "measure", "expected"), [
    (8, 12, "reps", "8–12"),
    (30, 30, "sec", "30 s"),
    (20, None, "min", "20 min"),
    (None, None, "reps", "fallback"),
    (7.5, 10, "reps", "7.5–10"),
])
def test_build_target(low, high, measure, expected):
    assert db.build_target(low, high, measure, "fallback") == expected


def test_format_number():
    assert db.format_number(None) == ""
    assert db.format_number(5.0) == "5"
    assert db.format_number(5.25) == "5.2"


def test_e1rm_uses_epley_and_rejects_empty_values():
    assert engine.e1rm(100, 10) == pytest.approx(133.333, rel=1e-3)
    assert engine.e1rm(None, 10) is None
    assert engine.e1rm(100, 0) is None


def test_weight_steps_follow_owned_weights():
    weights = [10, 12.5, 15, 20]
    assert engine.next_step(weights, 12.5) == 15
    assert engine.next_step(weights, 20) is None
    assert engine.previous_step(weights, 12.5) == 10
    assert engine.previous_step(weights, 10) is None
    assert engine.next_step(None, 40) == 42.5
    assert engine.previous_step(None, 2) is None


def test_set_metric_prefers_estimated_one_rep_max():
    sets = [{"value": 10, "weight": 50}, {"value": 12, "weight": 40}, {"value": None, "weight": 60}]
    assert engine.set_metric("reps", True, sets) == pytest.approx(engine.e1rm(50, 10))
    assert engine.set_metric("sec", False, [{"value": 45, "weight": None}, {"value": 60, "weight": None}]) == 60
    assert engine.set_metric("reps", True, []) is None


@pytest.mark.parametrize(("value", "expected"), [
    ("dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10", "dQw4w9WgXcQ"),
    ("youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ("https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ("youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ("https://youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ("https://example.com/watch?v=dQw4w9WgXcQ", None),
    ("", None),
])
def test_extract_video_id(value, expected):
    assert youtube.extract_video_id(value) == expected


def test_parse_video_length():
    assert youtube.parse_length("1:02:03") == 3723
    assert youtube.parse_length("0:45") == 45
    assert youtube.parse_length("live") is None


def test_clean_weights_sorts_deduplicates_and_drops_invalid():
    assert clean_weights([5, 2.5, 5, 0, -1, 1200]) == "[2.5, 5.0]"
    assert clean_weights([]) is None
    assert clean_weights([0]) is None


@pytest.mark.parametrize(("experience", "recent", "level"), [
    ("none", False, "beginner"),
    ("6_to_24_months", True, "intermediate"),
    ("6_to_24_months", False, "beginner"),
    ("over_2_years", True, "advanced"),
    ("over_2_years", False, "intermediate"),
])
def test_derive_level(experience, recent, level):
    assert planner.derive_level(experience, recent) == level


def test_bmi_info():
    assert planner.bmi_info(180, 81) == (25.0, "overweight")
    assert planner.bmi_info(None, 80) == (None, "unknown")


@pytest.mark.parametrize(("checkin", "level"), [
    (None, "light"),
    ({"energy": 5}, "none"),
    ({"energy": 3}, "light"),
    ({"energy": 2}, "moderate"),
    ({"energy": 4, "cramps": 3}, "rest"),
    ({"energy": 1, "flow": 3}, "rest"),
    ({"energy": 4, "back_pain": 2}, "moderate"),
])
def test_cycle_level(checkin, level):
    assert cycle.level_for(checkin) == level


def test_cycle_prediction_uses_recent_lengths():
    periods = [{"start_day": day} for day in ("2026-01-01", "2026-01-29", "2026-02-26", "2026-03-26")]
    prediction = cycle.predict(periods, cycle.to_date("2026-04-01"))
    assert prediction["next_start"] == "2026-04-23"
    assert prediction["average_length"] == 28
    assert prediction["confidence"] == "fair"
    assert prediction["days_until"] == 22
    assert cycle.predict([]) is None


def test_cycle_regularity():
    assert cycle.regularity([28, 29]) == "not enough data yet"
    assert cycle.regularity([27, 28, 30]) == "regular"
    assert cycle.regularity([22, 30, 35]) == "somewhat variable"
    assert cycle.regularity([21, 45, 30]) == "irregular"


def test_step_down_uses_owned_weights():
    equipment = {"dumbbells": {"weights": [5, 7.5, 10, 12.5]}}
    assert cycle.step_down(12.5, 0.9, "dumbbells", equipment) == 10
    assert cycle.step_down(5, 0.5, "dumbbells", equipment) == 5
    assert cycle.step_down(41, 0.9, None, equipment) == 36.5


def test_config_normalize_validates_kinds():
    fields = {field["key"]: field for field in config.FIELDS}
    assert config._normalize(fields["auto_video"], True) == "1"
    assert config._normalize(fields["ollama_num_ctx"], "4096") == "4096"
    assert config._normalize(fields["gemini_fallback_models"], " a , ,b ") == "a,b"
    with pytest.raises(ValueError):
        config._normalize(fields["ai_provider"], "openai")
    with pytest.raises(ValueError):
        config._normalize(fields["ollama_num_ctx"], "10")


def test_admin_pin_lockout_after_five_wrong_tries():
    config.set_pin("1234")
    for _ in range(5):
        with pytest.raises(PermissionError):
            config.login("9999")
    with pytest.raises(PermissionError, match="Too many"):
        config.login("1234")


def test_admin_session_expires(monkeypatch):
    token = config.set_pin("4321")
    assert config.valid_session(token)
    later = time.time() + config._SESSION_SECONDS + 5
    monkeypatch.setattr(config.time, "time", lambda: later)
    assert not config.valid_session(token)


def test_pantry_signature_checks(monkeypatch):
    monkeypatch.setattr(config, "get", lambda key: "secret" if key == "pantry_webhook_secret" else "")
    body = b'{"type":"ping"}'
    stamp = str(int(time.time()))
    signature = "sha256=" + hmac.new(b"secret", (stamp + ".").encode() + body, hashlib.sha256).hexdigest()
    assert nutrition._verify(body, stamp, signature)
    assert not nutrition._verify(body, stamp, "sha256=wrong")
    assert not nutrition._verify(body, "not-a-number", signature)
    assert not nutrition._verify(body, str(int(time.time()) - 3600), signature)
