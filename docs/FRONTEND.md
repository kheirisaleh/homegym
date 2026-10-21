# Frontend

The web app lives in `frontend/` and is a single React 19 + TypeScript app built with Vite. `npm run build`
writes it to `app/web`; FastAPI serves those files and falls back to `index.html` for every other page path.

## Layout

| Folder | What lives there |
| --- | --- |
| `src/lib` | Framework free code: API client, types, formatting, workout maths, coaching texts, the store, `useResource`. Everything here has unit tests. |
| `src/ui` | Shared building blocks: modal and toast hosts, charts, icons, motion helpers, YouTube loop player. |
| `src/app` | Session and gate state, router, desktop and mobile shells, projector mode. |
| `src/gate` | Account picker, onboarding, the "your coach is writing" screen. |
| `src/features` | Pieces used by several pages: exercise and equipment editors, cycle and health, coach tools, admin settings. |
| `src/workout` | The workout controller shared by desktop and phone, rest timer, start and finish flows. |
| `src/coach`, `src/three` | The 3D coach (stage, overlay, picker) and the anatomy viewer. |
| `src/pages/desktop`, `src/pages/mobile` | One file per screen. Pages only compose; logic sits in `lib`, `features` and `workout`. |
| `e2e` | Playwright tests. `e2e/server.py` starts the real backend on a temporary database with the AI switched off. |

## Routing

Desktop pages live at `/`, phone pages under `/m`. Old links such as `/#/programs/3` or `/m/#/train` are rewritten
on load. Pages are code split; three.js and Chart.js load in their own chunks.

## Data

`useResource(fetcher, deps, tags)` loads data, cancels stale requests and keeps the last result while reloading.
After a write, call `invalidate("programs", ...)` and every page that listens to those tags reloads. There is no
global cache beyond that, which keeps screens consistent with the server after coach changes.

## Workout

`useWorkout` in `src/workout/controller.tsx` owns the session: suggested values, weight steps from the owned
equipment, logging, rest, feedback, adding exercises, finishing and discarding. The desktop and phone screens are
two views of the same controller, so both behave the same.

## Coach

`CoachStage` in `src/three/coachEngine.ts` drives the low poly coach. Besides the baked clips (idle, walk, clap,
punch, jump) it poses bones procedurally: gestures while talking, idle actions every few seconds, a walk in when the
overlay opens, and an exercise demo that matches the movement pattern of the next exercise. Demos turn the body to
a three quarter view so forward movements read clearly and keep the feet on the floor. The GLB loader strips dots
from bone names, so bones are addressed as `UpperArmR`, not `UpperArm.R`. Use `frontend/lab/coach.html` to check moves.

## Accessibility and motion

All interactive parts are buttons or links with labels, dialogs trap focus and close on Escape, touch targets are
at least 24 px and every animation respects `prefers-reduced-motion`.
