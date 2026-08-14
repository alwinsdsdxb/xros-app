# XR Operating System — app_v2

Angular 18 dashboard for XpandRetail analytics. It talks directly to the real
production API at `https://xpandanalytics.com/api` — there is no mock backend
and no hardcoded IDs or payloads. Every dashboard, group, widget, KPI, store
and event is discovered at runtime; every `/kpi/data` request is assembled
from the real widget/group documents the API returns.

**→ See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full
architecture writeup, including a field-by-field breakdown of how a KPI
payload is built, the Dashboard → Group → Widget discovery chain, a
feature-to-backend map for every panel, and known backend quirks/dead code.**

**→ See [`docs/CHANGELOG.md`](docs/CHANGELOG.md) for a running log of what's
been built and fixed so far, including data-accuracy bugs found in the real
backend and how each was resolved.**

## Development server

Run `ng serve` for a dev server. Navigate to `http://localhost:4200/`. The application will automatically reload if you change any of the source files.

## Build

Run `ng build` to build the project. The build artifacts will be stored in the `dist/` directory.

## Deploy (Docker)

```bash
npx tsc --noEmit
npx ng build --configuration development
docker compose build frontend
docker compose up -d frontend --force-recreate
```

## Running unit tests

Run `ng test` to execute the unit tests via [Karma](https://karma-runner.github.io).
