import base64
import difflib
import json
import logging
import os
import threading
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone

from cryptography import x509
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding
from fastapi import Request
from fastapi.responses import JSONResponse

import ai
import config
import db

log = logging.getLogger("workout.alexa")
MAX_SKEW_SECONDS = 150
TRANSLATE_INTERVAL = 600
_cert_cache = {}
_cache_lock = threading.Lock()


class AlexaRejected(Exception):
    pass


def _skill_id():
    return config.get("alexa_skill_id").strip()


def _valid_cert_url(url):
    parsed = urllib.parse.urlparse(url or "")
    if parsed.scheme.lower() != "https" or (parsed.hostname or "").lower() != "s3.amazonaws.com":
        return False
    if parsed.port not in (None, 443):
        return False
    return os.path.normpath(parsed.path).startswith("/echo.api/")


def _roots():
    import certifi

    with open(certifi.where(), "rb") as handle:
        return x509.load_pem_x509_certificates(handle.read())


def _load_chain(url):
    with _cache_lock:
        cached = _cert_cache.get(url)
        if cached and cached[0] > time.time():
            return cached[1]
    with urllib.request.urlopen(url, timeout=5) as response:
        pem = response.read()
    chain = x509.load_pem_x509_certificates(pem)
    if not chain:
        raise AlexaRejected("empty certificate chain")
    from cryptography.x509 import DNSName
    from cryptography.x509.verification import PolicyBuilder, Store

    verifier = PolicyBuilder().store(Store(_roots())).time(datetime.now(timezone.utc)).build_server_verifier(DNSName("echo-api.amazon.com"))
    verifier.verify(chain[0], chain[1:])
    with _cache_lock:
        _cert_cache[url] = (time.time() + 3600, chain[0])
    return chain[0]


def verify(headers, body, payload):
    if not _skill_id():
        raise AlexaRejected("ALEXA_SKILL_ID is not configured")
    url = headers.get("signaturecertchainurl")
    signature = headers.get("signature-256")
    if not url or not signature or not _valid_cert_url(url):
        raise AlexaRejected("missing or invalid signature headers")
    try:
        leaf = _load_chain(url)
    except AlexaRejected:
        raise
    except Exception as error:
        raise AlexaRejected("certificate check failed: " + str(error)) from error
    try:
        leaf.public_key().verify(base64.b64decode(signature), body, padding.PKCS1v15(), hashes.SHA256())
    except Exception as error:
        raise AlexaRejected("signature mismatch") from error
    stamp = (payload.get("request") or {}).get("timestamp") or ""
    try:
        moment = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    except ValueError as error:
        raise AlexaRejected("bad timestamp") from error
    if abs((datetime.now(timezone.utc) - moment).total_seconds()) > MAX_SKEW_SECONDS:
        raise AlexaRejected("stale request")
    system = (payload.get("context") or {}).get("System") or {}
    application = (system.get("application") or {}).get("applicationId") \
        or ((payload.get("session") or {}).get("application") or {}).get("applicationId")
    if application != _skill_id():
        raise AlexaRejected("unknown skill")


TEXT = {
    "en": {
        "welcome": "Home coach here. Who is asking?",
        "who": "Who is asking?",
        "who_again": "I did not catch the name. Who is asking?",
        "unknown_user": "I do not know {name} yet. Who is asking?",
        "help": "Ask how your workout is going, and tell me your name. You can also ask for the daily report.",
        "bye": "Bye, keep moving.",
        "fallback": "Sorry, I did not get that. Ask how your workout is going, or ask for the daily report.",
        "week": "{name}, this week you finished {done} of {planned} planned workouts and you have {score} points.",
        "today_done": "Today's workout is done.",
        "today_open": "No workout is logged for today yet.",
        "coach": "Here is the last message from coach {coach}: {message}",
        "no_coach": "There is no message from your coach yet.",
        "daily_good": "Well done, team! You made great progress today.",
        "daily_points": "{name} has {score} points today",
        "daily_skipped": "{name} did not train today",
        "daily_lazy": "Today was a lazy day, but you will make up for it tomorrow.",
        "and": "and",
    },
    "de": {
        "welcome": "Hier ist dein Haustrainer. Wer fragt?",
        "who": "Wer fragt?",
        "who_again": "Den Namen habe ich nicht verstanden. Wer fragt?",
        "unknown_user": "{name} kenne ich noch nicht. Wer fragt?",
        "help": "Frag, wie dein Training läuft, und sag mir deinen Namen. Du kannst auch nach dem Tagesbericht fragen.",
        "bye": "Tschüss, bleib in Bewegung.",
        "fallback": "Das habe ich nicht verstanden. Frag, wie dein Training läuft, oder frag nach dem Tagesbericht.",
        "week": "{name}, diese Woche hast du {done} von {planned} geplanten Trainings geschafft und hast {score} Punkte.",
        "today_done": "Das heutige Training ist erledigt.",
        "today_open": "Für heute ist noch kein Training eingetragen.",
        "coach": "Hier ist die letzte Nachricht von Coach {coach}: {message}",
        "no_coach": "Von deinem Coach gibt es noch keine Nachricht.",
        "daily_good": "Super gemacht, Leute! Ihr habt heute richtig gute Fortschritte gemacht.",
        "daily_points": "{name} hat heute {score} Punkte",
        "daily_skipped": "{name} hat heute nicht trainiert",
        "daily_lazy": "Heute war ein fauler Tag, aber morgen holt ihr das nach.",
        "and": "und",
    },
}

TRANSLATE_SCHEMA = {"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]}


def _language(payload):
    locale = ((payload.get("request") or {}).get("locale") or "en").lower()
    return "de" if locale.startswith("de") else "en"


def _join(parts, language):
    if len(parts) <= 1:
        return "".join(parts)
    return ", ".join(parts[:-1]) + " " + TEXT[language]["and"] + " " + parts[-1]


def _users():
    allowed = [name.lower() for name in config.get_list("alexa_users")]
    rows = db.query_all("SELECT id, name, color, sex, days_per_week FROM users WHERE status = 'ready' ORDER BY id")
    if allowed:
        rows = [row for row in rows if row["name"].lower() in allowed]
    return rows


def _find_user(spoken):
    if not spoken:
        return None
    users = _users()
    by_name = {row["name"].lower(): row for row in users}
    wanted = spoken.strip().lower()
    if wanted in by_name:
        return by_name[wanted]
    match = difflib.get_close_matches(wanted, list(by_name), n=1, cutoff=0.6)
    return by_name[match[0]] if match else None


def _slot_name(request):
    slot = ((request.get("intent") or {}).get("slots") or {}).get("name") or {}
    for authority in ((slot.get("resolutions") or {}).get("resolutionsPerAuthority") or []):
        if (authority.get("status") or {}).get("code") == "ER_SUCCESS_MATCH":
            values = authority.get("values") or []
            if values:
                return values[0]["value"]["name"]
    return slot.get("value")


def _latest_coach_message(user_id):
    return db.query_one(
        "SELECT id, coach, message FROM coach_messages WHERE user_id = ? AND message != '' ORDER BY created_at DESC, id DESC LIMIT 1",
        (user_id,),
    )


def _translation_key(message_id):
    return "alexa_de_" + str(message_id)


def _translate(row, timeout):
    key = _translation_key(row["id"])
    cached = db.get_setting(key)
    if cached:
        return cached
    result = ai.chat_json(
        "Translate this message from a fitness coach into natural spoken German. Keep the friendly tone and use du.\n\n" + row["message"],
        TRANSLATE_SCHEMA,
        timeout=timeout,
        system="You are a precise translator. Reply only with JSON.",
        temperature=0.2,
    )
    text = str(result.get("text") or "").strip()
    if text:
        with db.transaction() as conn:
            db.set_setting(conn, key, text)
    return text


def translate_worker():
    while True:
        try:
            for user in _users():
                row = _latest_coach_message(user["id"])
                if row and not db.get_setting(_translation_key(row["id"])):
                    _translate(row, 60)
        except Exception as error:
            log.warning("Translation worker failed: %s", error)
        time.sleep(TRANSLATE_INTERVAL)


def _coach_text(user, language):
    text = TEXT[language]
    row = _latest_coach_message(user["id"])
    if not row:
        return text["no_coach"]
    message = row["message"]
    if language == "de":
        try:
            message = _translate(row, 5) or message
        except Exception as error:
            log.warning("Live translation failed: %s", error)
    return text["coach"].format(coach=(row["coach"] or "").capitalize(), message=message)


def user_report(user, language, stats_fn):
    text = TEXT[language]
    today = date.today()
    week = stats_fn(user, today - timedelta(days=today.weekday()), today)
    trained_today = db.query_one(
        "SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND status = 'done' AND day = ?",
        (user["id"], today.isoformat()),
    )["n"]
    parts = [
        text["week"].format(name=user["name"], done=week["workouts"], planned=week["planned"], score=week["score"]),
        text["today_done"] if trained_today else text["today_open"],
        _coach_text(user, language),
    ]
    return " ".join(parts)


def daily_report(language, stats_fn):
    text = TEXT[language]
    today = date.today()
    rows = [stats_fn(user, today, today) for user in _users()]
    if not any(row["workouts"] for row in rows):
        return text["daily_lazy"]
    parts = []
    for row in rows:
        if row["workouts"]:
            parts.append(text["daily_points"].format(name=row["name"], score=row["score"]))
        else:
            parts.append(text["daily_skipped"].format(name=row["name"]))
    return text["daily_good"] + " " + _join(parts, language) + "."


def _speak(speech, end=True, reprompt=None, attributes=None):
    response = {"outputSpeech": {"type": "PlainText", "text": speech}, "shouldEndSession": end}
    if reprompt:
        response["reprompt"] = {"outputSpeech": {"type": "PlainText", "text": reprompt}}
    return {"version": "1.0", "sessionAttributes": attributes or {}, "response": response}


def _ask_name(language, speech=None):
    text = TEXT[language]
    return _speak(speech or text["who"], end=False, reprompt=text["who"], attributes={"awaiting": "name"})


def handle(payload, stats_fn):
    language = _language(payload)
    text = TEXT[language]
    request = payload.get("request") or {}
    kind = request.get("type")
    if kind == "LaunchRequest":
        return _ask_name(language, text["welcome"])
    if kind == "SessionEndedRequest":
        return {"version": "1.0", "response": {}}
    if kind != "IntentRequest":
        return _speak(text["fallback"])
    intent = (request.get("intent") or {}).get("name")
    awaiting = ((payload.get("session") or {}).get("attributes") or {}).get("awaiting")
    if intent in ("StatusIntent", "NameIntent"):
        spoken = _slot_name(request)
        if not spoken:
            if intent == "NameIntent" and not awaiting:
                return _speak(text["fallback"], end=False, reprompt=text["who"])
            return _ask_name(language, text["who"] if intent == "StatusIntent" else text["who_again"])
        user = _find_user(spoken)
        if not user:
            return _ask_name(language, text["unknown_user"].format(name=spoken))
        return _speak(user_report(user, language, stats_fn))
    if intent == "DailyReportIntent":
        return _speak(daily_report(language, stats_fn))
    if intent == "AMAZON.HelpIntent":
        return _speak(text["help"], end=False, reprompt=text["help"])
    if intent in ("AMAZON.StopIntent", "AMAZON.CancelIntent", "AMAZON.NavigateHomeIntent"):
        return _speak(text["bye"])
    if awaiting == "name":
        return _ask_name(language, text["who_again"])
    return _speak(text["fallback"], end=False, reprompt=text["fallback"])


def start_worker():
    if _skill_id():
        threading.Thread(target=translate_worker, daemon=True).start()


def attach(app, stats_fn):
    @app.post("/alexa/workout")
    async def alexa_endpoint(request: Request):
        body = await request.body()
        try:
            payload = json.loads(body)
        except ValueError:
            return JSONResponse({"detail": "bad request"}, status_code=400)
        headers = {key.lower(): value for key, value in request.headers.items()}
        try:
            verify(headers, body, payload)
        except AlexaRejected as error:
            log.warning("Rejected Alexa request: %s", error)
            return JSONResponse({"detail": "rejected"}, status_code=400)
        try:
            return JSONResponse(handle(payload, stats_fn))
        except Exception:
            log.exception("Alexa handler failed")
            language = _language(payload)
            fail = "Sorry, something went wrong on the home server." if language == "en" else "Entschuldigung, auf dem Heimserver ist etwas schiefgelaufen."
            return JSONResponse(_speak(fail))

