
from fastapi import APIRouter, HTTPException

import ai

router = APIRouter()


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
