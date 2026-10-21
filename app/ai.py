import json
import os
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

import config as app_config
import db

KNOWLEDGE_DIR = Path(__file__).parent / "knowledge"

SYSTEM_PROMPT = (
    "You are an experienced, evidence based strength coach for a home gym. "
    "You answer only with JSON that follows the given schema. "
    "You only pick exercises from the candidate list you are given and never invent exercises or ids. "
    "Explanations are short, concrete and in English. You never calculate weights; the app does that."
)

_guide_cache = {"text": None}


def coaching_guide():
    if _guide_cache["text"] is None:
        try:
            _guide_cache["text"] = (KNOWLEDGE_DIR / "coaching_guide.md").read_text(encoding="utf-8")
        except OSError:
            _guide_cache["text"] = ""
    return _guide_cache["text"]


def expert_system_prompt(extra=""):
    parts = [
        "You are the head coach of this home gym app: an expert strength and conditioning coach with deep knowledge of exercise science, "
        "hypertrophy research, sports medicine basics and program design for men and women of all ages.",
        "You answer only with JSON that follows the given schema.",
        "You only use exercise ids that are given to you and never invent exercises, ids, equipment or loads.",
        "You follow the coaching guide below strictly. It is your professional standard.",
        "Write all text for the person in clear, simple English.",
    ]
    if extra:
        parts.append(extra)
    return "\n".join(parts) + "\n\n=== COACHING GUIDE ===\n" + coaching_guide()


_status_cache = {"time": 0.0, "value": None}
_status_lock = threading.Lock()

GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta"


def provider():
    return app_config.get("ai_provider").strip().lower()


def config():
    if provider() == "gemini":
        return {
            "provider": "gemini",
            "url": GEMINI_BASE,
            "model": app_config.get("gemini_model"),
        }
    return {
        "provider": "ollama",
        "url": app_config.get("ollama_url").rstrip("/"),
        "model": app_config.get("ollama_model"),
    }


class OllamaError(RuntimeError):
    pass


AIError = OllamaError


def _http_json(url, payload=None, timeout=10, headers=None):
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    all_headers = {"Content-Type": "application/json"}
    all_headers.update(headers or {})
    request = urllib.request.Request(url, data=data, headers=all_headers)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = ""
        try:
            body = error.read().decode("utf-8", "replace")
            if body.strip().startswith("{"):
                parsed = json.loads(body)
                inner = parsed.get("error", body)
                detail = inner.get("message", str(inner)) if isinstance(inner, dict) else str(inner)
            else:
                detail = body
        except Exception:
            pass
        name = "Gemini" if provider() == "gemini" else "Ollama"
        message = name + " answered " + str(error.code) + (": " + detail.strip()[:300] if detail else "")
        if error.code == 429:
            message += ". The free quota is used up for now, the coach retries later."
        raise AIError(message) from error


def _gemini_key():
    return app_config.get("gemini_api_key").strip()


def _gemini_headers():
    return {"x-goog-api-key": _gemini_key()}


def _request(path, payload=None, timeout=10):
    return _http_json(config()["url"] + path, payload, timeout)


def _model_matches(name, wanted):
    return name == wanted or name == wanted + ":latest" or (":" not in wanted and name.split(":")[0] == wanted)


def status(max_age=15):
    if provider() == "gemini":
        max_age = max(max_age, 300) if max_age else 0
    with _status_lock:
        if _status_cache["value"] is not None and time.time() - _status_cache["time"] < max_age:
            return dict(_status_cache["value"])
    settings = config()
    result = {
        "provider": settings["provider"], "url": settings["url"], "model": settings["model"],
        "reachable": False, "model_installed": False, "models": [], "pulling": False, "key_set": True, "error": "",
    }
    if settings["provider"] == "gemini":
        result["key_set"] = bool(_gemini_key())
        if result["key_set"]:
            try:
                _http_json(GEMINI_BASE + "/models/" + settings["model"], timeout=8, headers=_gemini_headers())
                result["reachable"] = True
                result["model_installed"] = True
                result["models"] = [settings["model"]]
            except AIError as error:
                result["reachable"] = True
                result["error"] = str(error)
            except (urllib.error.URLError, OSError, ValueError) as error:
                result["error"] = str(error)
    else:
        try:
            tags = _request("/api/tags", timeout=4)
            result["reachable"] = True
            result["models"] = [model.get("name", "") for model in tags.get("models", [])]
            result["model_installed"] = any(_model_matches(name, settings["model"]) for name in result["models"])
        except (urllib.error.URLError, OSError, ValueError):
            pass
    result["ready"] = result["reachable"] and result["model_installed"]
    with _status_lock:
        _status_cache["time"] = time.time()
        _status_cache["value"] = dict(result)
    return result


def describe(state):
    if state.get("provider") == "gemini":
        if not state.get("key_set"):
            return "No Gemini API key yet. The main account can add it in Settings"
        if not state["reachable"]:
            return "Gemini is not reachable: " + (state.get("error") or "no network")
        if not state["model_installed"]:
            return "Gemini refused the request: " + (state.get("error") or "unknown error")
        return "ready"
    if not state["reachable"]:
        return "Ollama is not reachable at " + state["url"]
    if not state["model_installed"]:
        return "model " + state["model"] + " is not downloaded yet"
    return "ready"


def available():
    return status()["ready"]


def _gemini_schema(node):
    if isinstance(node, dict):
        converted = {}
        for key, value in node.items():
            if key == "type" and isinstance(value, str):
                converted[key] = value.upper()
            elif key == "properties" and isinstance(value, dict):
                converted[key] = {name: _gemini_schema(child) for name, child in value.items()}
            else:
                converted[key] = _gemini_schema(value)
        if converted.get("type") == "OBJECT" and "properties" in converted:
            converted["propertyOrdering"] = list(converted["properties"].keys())
        return converted
    if isinstance(node, list):
        return [_gemini_schema(item) for item in node]
    return node


def _gemini_text(response):
    candidates = response.get("candidates") or []
    if not candidates:
        reason = (response.get("promptFeedback") or {}).get("blockReason", "no answer")
        raise AIError("Gemini returned no answer: " + str(reason))
    parts = (candidates[0].get("content") or {}).get("parts") or []
    text = "".join(part.get("text", "") for part in parts)
    if not text.strip():
        raise AIError("Gemini returned an empty answer: " + str(candidates[0].get("finishReason", "")))
    return text


def chat_json(user_prompt, schema, timeout=300, system=None, temperature=0.2, thinking=None, model=None):
    system = system or SYSTEM_PROMPT
    settings = config()
    if settings["provider"] == "gemini":
        if not _gemini_key():
            raise AIError("GEMINI_API_KEY is not set on the server")
        payload = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": user_prompt}]}],
            "generationConfig": {
                "temperature": temperature,
                "responseMimeType": "application/json",
                "responseSchema": _gemini_schema(schema),
            },
        }
        fallbacks = app_config.get_list("gemini_fallback_models")
        first = model or settings["model"]
        models = [first] + [name for name in [settings["model"]] + fallbacks if name != first]
        last_error = None
        rounds = 3 if timeout > 60 else 1
        for round_index in range(rounds):
            for model in models:
                attempt_payload = payload
                if thinking:
                    attempt_payload = dict(payload, generationConfig=dict(payload["generationConfig"], thinkingConfig={"thinkingLevel": thinking}))
                try:
                    try:
                        response = _http_json(
                            GEMINI_BASE + "/models/" + model + ":generateContent",
                            attempt_payload, timeout=min(timeout, 180), headers=_gemini_headers(),
                        )
                    except AIError as error:
                        if thinking and " 400" in str(error) and "hinking" in str(error):
                            response = _http_json(
                                GEMINI_BASE + "/models/" + model + ":generateContent",
                                payload, timeout=min(timeout, 180), headers=_gemini_headers(),
                            )
                        else:
                            raise
                    return json.loads(_gemini_text(response))
                except AIError as error:
                    last_error = error
                    if not any(code in str(error) for code in (" 404", " 429", " 500", " 503")):
                        raise
                except (urllib.error.URLError, OSError) as error:
                    last_error = AIError("Gemini is not reachable: " + str(error))
            if round_index + 1 < rounds:
                time.sleep(15 * (round_index + 1))
        raise last_error
    payload = {
        "model": settings["model"],
        "stream": False,
        "format": schema,
        "options": {"temperature": temperature, "num_ctx": app_config.get_int("ollama_num_ctx")},
        "keep_alive": "10m",
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user_prompt},
        ],
    }
    response = _request("/api/chat", payload, timeout=timeout)
    content = response.get("message", {}).get("content", "")
    return json.loads(content)


SWAP_SCHEMA = {
    "type": "object",
    "properties": {"exercise_id": {"type": "integer"}, "reason": {"type": "string"}},
    "required": ["exercise_id", "reason"],
}


def choose_swap(current, candidates, context):
    lines = [
        "Task: pick a replacement for an exercise in the user's program.",
        "Current exercise: " + current["name"] + " (target muscle " + str(current.get("primary_muscle")) + ", pattern " + str(current.get("pattern")) + ")",
        "Reason: " + context.get("reason", ""),
        "User priority muscles: " + ", ".join(context.get("priority", [])),
        "Candidates (only these ids are allowed):",
    ]
    for candidate in candidates:
        lines.append(
            "  id=" + str(candidate["id"]) + " | " + candidate["name"] + " | target " + str(candidate.get("primary_muscle")) +
            " | pattern " + str(candidate.get("pattern")) + " | difficulty " + str(candidate.get("difficulty"))
        )
    lines.append("Answer with exercise_id and a one sentence reason.")
    result = chat_json("\n".join(lines), SWAP_SCHEMA, timeout=180, system=expert_system_prompt())
    allowed = {candidate["id"] for candidate in candidates}
    if result.get("exercise_id") not in allowed:
        raise ValueError("AI picked an exercise outside the candidate list")
    return result


REDESIGN_SCHEMA = {
    "type": "object",
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "exercise_id": {"type": "integer"},
                    "sets": {"type": "integer"},
                    "rep_min": {"type": "integer"},
                    "rep_max": {"type": "integer"},
                    "rest_seconds": {"type": "integer"},
                },
                "required": ["exercise_id", "sets", "rep_min", "rep_max", "rest_seconds"],
            },
        },
        "rationale": {"type": "string"},
    },
    "required": ["items", "rationale"],
}


def redesign_program(prompt):
    return chat_json(prompt, REDESIGN_SCHEMA, timeout=400, system=expert_system_prompt())


NOTE_SCHEMA = {
    "type": "object",
    "properties": {"note": {"type": "string"}},
    "required": ["note"],
}


def block_note(context):
    prompt = (
        "A training block just ended. Write a short coach note for the user (3 to 5 sentences): what went well, what stalled, "
        "what the changes mean for the next block, and one concrete focus. Do not invent numbers that are not given.\n\n" + context
    )
    return chat_json(prompt, NOTE_SCHEMA, timeout=300, system=expert_system_prompt()).get("note", "")


def session_note(context):
    prompt = (
        "The user just finished a workout. Write a short coach note (2 to 3 sentences): one honest observation about today, "
        "and one concrete tip for the next session. Do not invent numbers that are not given.\n\n" + context
    )
    return chat_json(prompt, NOTE_SCHEMA, timeout=300, system=expert_system_prompt()).get("note", "")


PROGRAM_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "days": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "day_key": {"type": "string"},
                    "name": {"type": "string"},
                    "note": {"type": "string"},
                    "cardio_exercise_id": {"type": "integer"},
                    "choices": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {"slot": {"type": "string"}, "exercise_id": {"type": "integer"}},
                            "required": ["slot", "exercise_id"],
                        },
                    },
                },
                "required": ["day_key", "name", "choices"],
            },
        },
    },
    "required": ["summary", "days"],
}


def write_first_program(report, feedback=""):
    prompt = (
        "You are writing the first training program for a new member of a home gym. Read the brief below carefully.\n"
        "The skeleton (days, slots, sets, reps, rest) is already set by evidence based rules and must not change.\n"
        "For every day and every slot pick exactly one exercise id from that slot's candidate list. Prefer exercises that suit the "
        "person's level, age, goal and stated limits, avoid repeating the same exercise twice on one day, and vary exercises across days "
        "for the same muscle where it makes sense. For every day with a cardio block pick one cardio id from its list.\n"
        "Give each day a short, motivating name (at most 4 words) that says what the day trains, a one sentence note for the person, "
        "and a summary of 3 to 5 sentences that explains the plan in plain English and addresses the person by name.\n"
        + (("\nYour previous answer had problems: " + feedback + "\nFix them.\n") if feedback else "")
        + "\n" + report
    )
    return chat_json(prompt, PROGRAM_SCHEMA, timeout=600)
