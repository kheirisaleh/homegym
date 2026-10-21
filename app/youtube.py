import json
import re
import urllib.parse
import urllib.request

HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
}

VIDEO_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{11}$")


def fetch(url, timeout=20):
    request = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read().decode("utf-8", "ignore")


def parse_length(text):
    if not text:
        return None
    try:
        total = 0
        for part in text.split(":"):
            total = total * 60 + int(part)
        return total
    except ValueError:
        return None


def collect_renderers(node, found):
    if isinstance(node, dict):
        if "videoRenderer" in node:
            found.append(node["videoRenderer"])
        for value in node.values():
            collect_renderers(value, found)
    elif isinstance(node, list):
        for value in node:
            collect_renderers(value, found)


def search(query, limit=10):
    url = "https://www.youtube.com/results?search_query=" + urllib.parse.quote_plus(query)
    html = fetch(url)
    match = re.search(r"var ytInitialData = (\{.*?\});</script>", html, re.S)
    if not match:
        return []
    data = json.loads(match.group(1))
    renderers = []
    collect_renderers(data, renderers)
    results = []
    seen = set()
    for renderer in renderers:
        video_id = renderer.get("videoId")
        if not video_id or video_id in seen:
            continue
        seen.add(video_id)
        title = "".join(run.get("text", "") for run in renderer.get("title", {}).get("runs", []))
        length_text = renderer.get("lengthText", {}).get("simpleText")
        channel = "".join(run.get("text", "") for run in renderer.get("ownerText", {}).get("runs", []))
        results.append({
            "video_id": video_id,
            "title": title,
            "length": parse_length(length_text),
            "channel": channel,
        })
        if len(results) >= limit:
            break
    return results


def is_embeddable(video_id):
    target = "https://www.youtube.com/watch?v=" + video_id
    url = "https://www.youtube.com/oembed?format=json&url=" + urllib.parse.quote_plus(target)
    try:
        fetch(url, timeout=10)
        return True
    except Exception:
        return False


def search_with_embed_check(query, limit=8):
    candidates = search(query, limit=limit)
    for candidate in candidates:
        candidate["embeddable"] = is_embeddable(candidate["video_id"])
    return candidates


def score_candidate(candidate):
    length = candidate.get("length")
    if length is None:
        return 4
    if 10 <= length <= 75:
        return 0
    if 75 < length <= 180:
        return 1
    if 180 < length <= 420:
        return 2
    return 3


def pick_best(exercise_name):
    query = exercise_name + " proper form short"
    candidates = search(query, limit=10)
    ranked = sorted(enumerate(candidates), key=lambda pair: (score_candidate(pair[1]), pair[0]))
    for _, candidate in ranked:
        if candidate.get("length") is None:
            continue
        if is_embeddable(candidate["video_id"]):
            return candidate
    return None


def extract_video_id(value):
    if not value:
        return None
    value = value.strip()
    if VIDEO_ID_PATTERN.match(value):
        return value
    parsed = urllib.parse.urlparse(value)
    host = (parsed.netloc or "").lower()
    if host.endswith("youtu.be"):
        candidate = parsed.path.strip("/").split("/")[0]
        return candidate if VIDEO_ID_PATTERN.match(candidate) else None
    if "youtube" in host:
        query = urllib.parse.parse_qs(parsed.query)
        if "v" in query and VIDEO_ID_PATTERN.match(query["v"][0]):
            return query["v"][0]
        parts = [part for part in parsed.path.split("/") if part]
        if len(parts) >= 2 and parts[0] in ("shorts", "embed", "live", "v"):
            return parts[1] if VIDEO_ID_PATTERN.match(parts[1]) else None
    return None
