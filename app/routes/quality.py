
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

import ai

router = APIRouter()
QUALITY_PAGE = Path(__file__).resolve().parent.parent / "static" / "quality.html"


@router.get("/quality", include_in_schema=False)
def quality_page():
    return FileResponse(QUALITY_PAGE, headers={"Cache-Control": "no-cache"})


@router.get("/api/quality")
def quality_latest():
    import quality
    return quality.latest()


@router.post("/api/quality/run")
def quality_run(judge: bool = True):
    import quality
    if not ai.available():
        raise HTTPException(503, "AI is not ready: " + ai.describe(ai.status(max_age=0)))
    started = quality.start_async(judge=judge)
    return {"started": started, **quality.latest()}
