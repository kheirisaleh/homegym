from typing import List, Optional

from pydantic import BaseModel, Field


class ExerciseIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    measure: str = "reps"
    track_weight: bool = True
    video: Optional[str] = None
    video_start: Optional[int] = None
    video_end: Optional[int] = None
    video_title: Optional[str] = None
    notes: str = ""
    cues: str = ""
    primary_muscle: Optional[str] = None
    secondary_muscles: List[str] = []
    pattern: Optional[str] = None
    equipment: List[str] = []
    load_equipment: Optional[str] = None
    difficulty: int = Field(default=1, ge=1, le=3)


class ProgramItemIn(BaseModel):
    exercise_id: int
    sets: int = Field(ge=1, le=50)
    target: str = ""
    rep_min: Optional[float] = Field(default=None, ge=0, le=600)
    rep_max: Optional[float] = Field(default=None, ge=0, le=600)
    target_weight: Optional[float] = Field(default=None, ge=0, le=1000)
    rest_seconds: int = Field(default=90, ge=0, le=900)


class ProgramIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    weekday: Optional[int] = Field(default=None, ge=0, le=6)
    description: str = ""
    items: List[ProgramItemIn] = []


class SessionIn(BaseModel):
    day: str
    program_id: Optional[int] = None


class SetIn(BaseModel):
    session_exercise_id: int
    value: Optional[float] = None
    weight: Optional[float] = None
    effort: Optional[int] = Field(default=None, ge=1, le=3)


class SetUpdate(BaseModel):
    value: Optional[float] = None
    weight: Optional[float] = None
    effort: Optional[int] = Field(default=None, ge=1, le=3)


class SessionExerciseIn(BaseModel):
    exercise_id: int
    sets: int = Field(default=3, ge=1, le=50)
    target: str = ""
    rest_seconds: int = Field(default=90, ge=0, le=900)


class SessionStateIn(BaseModel):
    current_index: int = Field(ge=0)


class FinishIn(BaseModel):
    notes: str = ""


class PlannedIn(BaseModel):
    sets: int = Field(ge=1, le=50)


class EquipmentIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    key: Optional[str] = Field(default=None, max_length=40)
    category: str = "accessory"
    available: bool = True
    weights: Optional[List[float]] = None
    notes: str = ""


class SettingsIn(BaseModel):
    priority_muscles: Optional[List[str]] = None
    goal_fat_loss: Optional[bool] = None
    block_weeks: Optional[int] = Field(default=None, ge=4, le=6)
    cardio_target_min: Optional[int] = Field(default=None, ge=0, le=1000)


class BodyIn(BaseModel):
    day: str
    weight_kg: Optional[float] = Field(default=None, gt=0, lt=400)
    waist_cm: Optional[float] = Field(default=None, gt=0, lt=300)


class RedesignIn(BaseModel):
    instruction: str = ""


class OnboardingIn(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    sex: str = Field(pattern="^(male|female)$")
    age: Optional[int] = Field(default=None, ge=12, le=100)
    height_cm: Optional[float] = Field(default=None, ge=120, le=230)
    weight_kg: Optional[float] = Field(default=None, ge=30, le=300)
    experience: str = Field(pattern="^(none|under_6_months|6_to_24_months|over_2_years)$")
    trained_recently: bool = False
    goal: str = Field(pattern="^(health|fat_loss|muscle|strength|tone)$")
    days_per_week: int = Field(ge=1, le=7)
    session_minutes: int = Field(default=60, ge=20, le=120)
    priority_muscles: List[str] = []
    limitations: str = Field(default="", max_length=600)
    coach: Optional[str] = Field(default=None, pattern="^(max|lena)$")


class ProfileIn(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=40)
    age: Optional[int] = Field(default=None, ge=12, le=100)
    height_cm: Optional[float] = Field(default=None, ge=120, le=230)
    weight_kg: Optional[float] = Field(default=None, ge=30, le=300)
    color: Optional[str] = Field(default=None, pattern="^#[0-9a-fA-F]{6}$")
    coach: Optional[str] = Field(default=None, pattern="^(max|lena)$")
