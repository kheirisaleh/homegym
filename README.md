# Home Gym, workout tracker with a local AI coach

Self hosted training log for a home gym. An AI coach (Google Gemini) adapts the program over time.
The logic behind the coach, with sources, is in `docs/COACH_LOGIC.md`.

## AI

The coach uses the Gemini API. Put the key in `.env` next to `docker-compose.yml` (never commit it):

    GEMINI_API_KEY=...

Model: `GEMINI_MODEL` in `docker-compose.yml` (default `gemini-flash-latest`, fallbacks in `GEMINI_FALLBACK_MODELS`).
Set `AI_PROVIDER=ollama` and `OLLAMA_URL` to use a local Ollama instead.
Logging workouts and weight progression work without AI.

## Program quality tests

Open `/quality` and press "Run tests", or run `docker exec workout-tracker python quality.py`.
Five test personas get a program from the AI. Each program is checked against the rules (volume per muscle,
priority muscles, equipment, difficulty, time, cardio, balance) and reviewed by the AI as a second opinion.
Reports are saved in `data/quality/`.

## Start

    docker compose up -d --build

Desktop: http://<server>:8090, mobile: http://<server>:8090/m

The image is built in two stages: Node builds the React app from `frontend/`, then the Python image serves it
together with the API. Phones are sent to `/m` automatically; "Desktop version" in the More tab switches back.

## Mobile app

All URLs are relative, so the app works on every address of the server (LAN and Tailscale).
Install it on the phone from the Tailscale address so the same icon works at home and away.

## Data

* `data/workout.db` SQLite database
* `data/media/` uploaded GIFs, videos, muscle images and equipment photos
* `data/quality/` program quality reports

## Keyboard

* `1` to `9` switch sections (`0` settings, `H` health), `P` projector mode
* During a workout: `Enter` saves the set, `↑ ↓` reps, `Shift ↑ ↓` weight, `← →` switch exercise

## Development

Backend (FastAPI, SQLite):

    pip install -r requirements.txt -r requirements-dev.txt
    ruff check .
    pytest

Frontend (React 19, TypeScript, Vite) in `frontend/`:

    npm ci
    npm run dev          # http://localhost:5173, proxies /api to http://127.0.0.1:8000
    npm run typecheck
    npm run lint
    npm test             # Vitest unit and component tests
    npm run build        # writes app/web, which the backend serves
    npx playwright test  # end to end tests against a throw away database

Start the API for `npm run dev` with `cd app && BACKGROUND_WORKERS=0 uvicorn main:app --reload`.
`frontend/lab/coach.html` (open it through `npm run dev`) shows the 3D coach on its own for tuning moves.
How the frontend is organised is described in `docs/FRONTEND.md`. GitHub Actions runs all of the above on every pull request.
