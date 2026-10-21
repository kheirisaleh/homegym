# Contributing

Thanks for helping. Issues and pull requests in English or German are welcome.

## Before you start

* For larger changes open an issue first so we can agree on the approach.
* Changes to the coaching rules need a source (study, review or textbook) in `docs/COACH_LOGIC.md`.

## Workflow

1. Fork and create a branch from `main`.
2. Backend: `pip install -r requirements.txt -r requirements-dev.txt`, then `ruff check .` and `pytest`.
3. Frontend: `cd frontend && npm ci`, then `npm run typecheck`, `npm run lint`, `npm test`.
4. For user facing changes run `npm run build && npx playwright test` and add a test for the new behaviour.
5. Open a pull request. CI runs all of the above plus the Docker build.

## Style

* Python: ruff settings in `pyproject.toml`.
* TypeScript: strict mode, ESLint with type checked rules, no `any`.
* Keep pure logic in `frontend/src/lib` and cover it with Vitest; pages only compose.
* UI text is English; keep the tone short and friendly.
