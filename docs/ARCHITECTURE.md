# app_v2 — Architecture & Backend Integration Guide

This document explains how the Angular dashboard in `app_v2` is built, and — in
detail — how it talks to the real XpandRetail analytics backend
(`https://xpandanalytics.com/api`, referred to below as "the API"). There is
**no mock backend and no hardcoded IDs**: every dashboard, group, widget, KPI,
store and event is discovered at runtime by calling the real API, and every
payload sent to `/kpi/data` is assembled from the real widget/group documents
the API returns.

If you only read one section, read [§3 — How a KPI payload is built](#3-how-a-kpi-payload-is-built).

---

## 1. Tech stack

- **Angular 18**, classic `NgModule`-based app (not standalone components) — see `app.module.ts`.
- **Angular Material 18** (prebuilt `indigo-pink` theme, see `angular.json`), with a global font/typography override (Poppins — see §7).
- **Highcharts 13** via `highcharts-angular`, imported through a custom ES-module shim (see §6).
- **RxJS 7** for all async flow (`forkJoin`, `switchMap`, `map`, `finalize`).
- No NgRx/state library — each page component owns its own state and re-fetches on filter change.

## 2. Project structure

```
src/app/
  core/
    models/          Plain TS interfaces: one file per domain (widget, kpi, dashboard, calendar, ...)
    services/        HTTP services. widget.service.ts + kpi.service.ts are the important ones.
    interceptors/     auth.interceptor.ts — attaches the JWT, handles 401 → logout
    guards/           auth.guard.ts — route guard
    highcharts-setup.ts   Highcharts import shim (see §6)
  layout/shell/       Sidebar + top bar shell that wraps every authenticated route
  pages/
    login/
    dashboard/        The main "Dashboard" tab + all its sub-panels (see §4)
      kpi-card/, flow-funnel-chart/, trend-chart/, demographics-panel/,
      dwell-panel/, operations-panel/, active-campaigns-panel/, calendar-panel/,
      forecast-panel/, instore-analytics/ (peak-hours-panel/, zone-correlation-panel/, ...)
    my-roster/
    coming-soon/       Placeholder for nav items with no real feature yet
```

Each dashboard "tab" (Dashboard / Instore Analytics / Calendar / Forecast) is
its own top-level component with its own widget-resolution + fetch logic. They
do **not** share a store or a common data service — each duplicates the same
resolve→fetch pattern described below, because each tab pulls from a
different Group (see §3).

## 3. How a KPI payload is built

This is the core of the whole app. Everything on every tab ultimately reduces
to: **resolve a `Widget` + the `DashboardGroup` it lives in → build a payload
→ `POST /kpi/data` → parse the response into a view model.**

### 3.1 The four-level discovery chain

The API doesn't have per-feature endpoints ("get total footfall", "get dwell
time"). Instead it has a generic dashboard-builder data model:

```
Dashboard  →  Group  →  Widget  →  KPI data
```

| Level | Endpoint | Notes |
|---|---|---|
| Dashboard | `GET /dashboard/list` | Usually skipped — the logged-in user's JWT carries `defaultDashboard` (decoded in `auth.service.ts`), so we go straight to step 2. |
| Group | `GET /group/list/:dashboardId` | A dashboard has several Groups (e.g. "Overview", "Conversion", "My Reports", "Calendar", "Instore Analytics", "Zone Visualizations"). A Group is a **filter/scope bundle**: it holds the selected store(s), the date range, and the granularity (`groupByTimeFrame`, `dateByFilter`) that all of its widgets inherit by default. |
| Widget | `GET /widget/list/:groupId` | A Group contains several Widgets (KPI cards, charts, tables). Each Widget has a `title`, a `widgetType`/`fetchDataFor` (what kind of chart it renders as), and a `dataFilter[]` array of KPI bindings. |
| KPI data | `POST /kpi/data` | The actual data fetch. Body = a payload built from one Widget + the Group it belongs to + an explicit date range. |

**Every page component repeats the same resolution steps in `ngOnInit`:**

1. Get `dashboardId` — from `authService.currentUser.defaultDashboard`, falling back to `GET /dashboard/list` and taking `[0]._id`.
2. `GET /group/list/:dashboardId`, then find the group(s) it needs **by `groupName.trim()`** (not by array order/index — different features live in different groups; see the table in §4).
3. `GET /widget/list/:groupId`, then find the widget it needs **by `title.trim()`** (many real widget titles have trailing spaces on this tenant, e.g. `"Device Health "`, `"Trend Report "` — always `.trim()` before comparing).
4. Build the KPI payload (below) and `POST /kpi/data`.

This whole chain is **zero-hardcoded**: nothing but a `groupName` string and a
`widget.title` string is baked into the frontend. If the tenant's admin
renames or reorders a widget, resolution still works as long as the name
matches; if a widget or group doesn't exist, the corresponding panel just
renders nothing (see §5, "fail soft" convention).

### 3.2 `buildKpiDataPayload` / `buildMultiStoreKpiPayload`

Both live in `core/services/kpi.service.ts` and are exported as plain
functions (not methods) so any component can import and use them directly.

```ts
buildKpiDataPayload(
  widget: Widget,
  group: DashboardGroup,
  from: string,               // "YYYY-MM-DD HH:mm:ss"
  to: string,                 // "YYYY-MM-DD HH:mm:ss"
  storeIds = group.stores,                       // override #1
  timeFrame = group.groupByTimeFrame,             // override #2
  dateByFilter = group.dateByFilter,              // override #3
  showDataByOperationalHours = group.showDataByOperationalHours  // override #4
): unknown
```

It maps every store in `storeIds` into `{ storeId, brands }`, applies that
`mapped` array to **every** entry in `widget.dataFilter`, and hands off to the
shared `buildPayload()` which assembles the full request body:

```ts
{
  dataFilter,                 // widget.dataFilter, each entry with `mapped` store scoping attached
  fetchDataFor: widget.fetchDataFor,     // "box" | "line" | "bar" | "pie" | "NA" | ...
  widgetType: widget.widgetType,         // "comparison" | "numeric" | "funnel" | "histogram" | "donutDeviceStatus" | ...
  isPredictive: widget.isPredictive,
  predictiveDay: widget.predictiveDay,
  from, to,
  timeFrame,                  // "hour" | "day" | "dayOfMonth" | ...  — granularity of the response
  dateByFilter,                // "day" | "month" | ...
  showSpecificDate: group.showSpecificDate,
  ...(widget.binFilter ? { binFilter: widget.binFilter } : {}),   // only for histogram widgets (Dwell Time distribution)
  consolidateSiteData, consolidateData, consolidateDate,   // from the group, passed through verbatim
  showDataByOperationalHours,
  title: widget.title,
  udf: {                       // "user-defined fields" — the widget's own saved display config,
    widgetId: widget._id,      // echoed back so the backend can format the response the way the
    axisConfig, dataFilter,    // widget was configured in the admin UI (colors, thresholds, etc.)
    trendConfig, countConfig, campaignConfig, calendarConfig, numericConfig,
    funnelConfig, performerConfig, histogramConfig, heatmapConfig,
    consolidateData, consolidateDate, showSpecificDate,
    compareConfig, compareDateConfig,
    isRowTotal, isColumnTotal, isAdjustHeader
  }
}
```

`buildMultiStoreKpiPayload(widget, group, storeIds, from, to, timeFrame?, dateByFilter?, showDataByOperationalHours?)`
is used instead when a widget must be queried **per child store** rather than
as one combined `mapped` array — e.g. "Trend Report" (per-entrance line
chart) and "Age Demographics" both need one `dataFilter` entry *per store*, so
the response comes back labelled `"<Store Name>::<KPI Name>"` per store
instead of one pre-summed total.

### 3.3 Why every fetch-method takes an `operationalHours` parameter

`showDataByOperationalHours` (0 or 1) is a real Group field, but the
dashboard's "Hours" filter toggle (Operational / 24 Hours) needs to change it
**per-request** without mutating the Group document itself (see §5 for why
mutating shared Group state is dangerous). Every `fetch*` method in
`dashboard.component.ts` therefore takes the current toggle value and passes
it as the **4th override**, e.g.:

```ts
buildKpiDataPayload(widget, group, from, to, undefined, undefined, undefined, operationalHours)
```

Passing `undefined` for the storeIds/timeFrame/dateByFilter positions is
intentional and safe — in JS/TS, `undefined` arguments still trigger a
function's *default* parameter expression, so `storeIds` still resolves to
`group.stores`, etc. Only the 4th override (`operationalHours`) is actually
different from the group's own value.

### 3.4 Overriding `timeFrame` / `dateByFilter` explicitly

Most calls let `timeFrame`/`dateByFilter` default to the Group's own fields.
Two call sites override them explicitly, and both do it for the same reason —
**a query's required granularity is a property of what's being asked for, not
of whatever a shared, mutable Group document currently holds**:

- `fetchTrafficTrend` forces `('hour', 'day')` — a single-day trend line needs
  24 hourly points; if the Group's fields have drifted to `('dayOfMonth',
  'month')` (see §5), the API still answers but collapses the whole day into
  one point, and a 1-point line renders as nothing.
- `fetchAvgDwellTrend` uses the **"My Reports" group's own** fields (not the
  dashboard's "Overview" group) because that widget lives in a different
  group and needs month-wide granularity regardless of what "Overview"
  happens to hold.

### 3.5 Store scoping: `stores`, `storeId`, `parentId`

- A `DashboardGroup.stores` array is normally a single mall-level store ID
  (e.g. `"6a6b1e118d42c6dc0c5e1263"` = "Centerpoint - Dubai Hills Mall") — the
  actual scope the widget's `mapped` array is built from.
- Individual physical devices/entrances are child `Store` documents
  (`GET /store/list`) whose **`parentId` is an array on the child**, not a
  children-array on the parent. To find "all entrances under this mall":
  ```ts
  stores.filter(s => s.categoryName === 'Entrance' && s.parentId.includes(mallStoreId))
  ```
  This is exactly what `dashboard.component.ts` does to build
  `entranceStoreIds`, used by the Traffic Trend, Funnel, and Age Demographics
  widgets (all of which are naturally per-entrance metrics).
- `storeCode` does **not** exist on the Store schema — don't look for it. It's
  a Sales-import spreadsheet column matched against a store's `internalId`,
  unrelated to analytics scoping.

### 3.6 Response shape

`POST /kpi/data` always returns:

```ts
{
  statusCode: 201,
  data: {
    title, timeFrame, from, to, widgetType, fetchDataFor,
    dataFilter: [
      {
        label, color, showOnAxis, fetchDataFor,
        data: [ { value, dateFrom?, date?, variance?, differance?, ... } ],
        storeIds, brandIds, rangeLabel?, selected?
      },
      ...
    ],
    events: [...],   // only for NUMERIC/COMPARISON widgets with LINE/BAR/NA fetchDataFor — nearby Event documents overlapping the query range
    udf: { ... }      // echoes the widget's own saved config back
  }
}
```

For **comparison/box widgets** (KPI cards), `dataFilter` has one entry per
comparison range (`rangeLabel`: "Today", "Previous Day", "Previous Week",
"Previous Month", "Previous Year"), each with a single `data[0]`. The entry
with `selected: true` is the current value; the others are the comparison
baselines, each already carrying the backend-computed `variance` (% change) —
**never recompute % change client-side**, always read `variance`/`variation`
straight from the response.

Some `fetchDataFor` values return genuinely different shapes and need custom
parsing rather than the generic box/comparison path:
- `"NA"` + `widgetType: "donutDeviceStatus"` ("Device Health") → `data[0] = { online, offline }`, no `value` field at all.
- `"NA"` + `widgetType: "twoTierVisitorFlow"` ("Zone Correlation") → each point has `source`/`target`/`value` (a flow-graph edge), not a time series.
- `"bar"` histogram widgets (Dwell Time Distribution) → `data[]` is one point per **bin label** (`"0 - 5"`, `"6 - 15"`, ...), not per date.

## 4. Feature-to-backend map

| Dashboard tab / panel | Group (`groupName`) | Widget (`title`) | Notes |
|---|---|---|---|
| Total/Unique/Passer By/Groups KPI cards | Overview | `Total Footfall`, `Unique Footfall`, `Groups` | "Passer By" has **no real widget** — it reuses Total Footfall's saved display config with the real Passerby `kpiId` (`5f2aa6a1b4bb55f79310edb2`) swapped in via `deriveWidget()`. Confirmed real via `GET /kpi/5f2bb437afaf896e91f8f093`. |
| Traffic Trend chart | Overview | `Trend Report ` | Per-entrance (`buildMultiStoreKpiPayload`), forces `timeFrame:'hour'`. |
| Flow Funnel | Overview | `Funnel` | Per-entrance store scope. |
| Demographics (gender, age) | Overview | `Male`, `Female`, `Age Demographics` | Group size tiles are **not wired** (no real widget) — always show 0, never fabricated. |
| Dwell Time Distribution + Engagement Composition | Overview | `Dwell Time by Time Slots` | Engagement Composition **reuses the same bucket data**, relabeled (`0-5`→"Quick Visit", `6-15`→"Casual Visit", `16-30`→"Engaged Visit", `31-60`→"High Engagement", `>61`→"Long Visit") rather than a separate widget. |
| Average Dwell Trend | **My Reports** | `Average Dwell Time` (`fetchDataFor: 'bar'`) | Cross-group: uses My Reports' own `timeFrame`/`dateByFilter` (stable, month-oriented) but the Overview group's `stores` (5th-arg override) — this KPI has no data against My Reports' own configured store. |
| Active Campaigns | — (no group/widget) | — | Not a widget at all — real marketing campaigns are `Event` documents (`GET /event/list`). "Active" = `to >= today`, scoped by intersecting `storeId` with the Overview group's `stores`. |
| Device Health (Operations panel) | Overview | `Device Health ` (`widgetType: 'donutDeviceStatus'`) | Custom response shape, see §3.6. |
| Weather (Operations panel) | Overview | `Weather` | Normal box/comparison widget; "feels like" has no backing field (never shown); location + condition are derived from the response's box `label` and `icon` fields, not invented. |
| Power Hour Footfall | Instore Analytics | `Power Hour Footfall` | Queried across the **whole month**, then aggregated client-side into weekday × hour cells (every Monday 10am across the month sums into one cell) — see the long comment above `toPeakHours()`. |
| Zone Correlation | **Zone Visualizations** | `Zone Correlation` (`widgetType: 'twoTierVisitorFlow'`) | Cross-group from Instore Analytics tab. Only "Strongest Flow" is real; the other 3 highlight tiles have no backing widget and show an explicit "No data" state. |
| Calendar | **Calendar** | `Calendar` | Own dedicated group; response's "Today"/"PM" ranges are parsed into a client-built week grid. |
| Forecast | — | — | **Not wired to the real API.** `ForecastService`/`StoresService` still call placeholder endpoints (`/analytics/forecast`, `/stores`) that don't exist on the real backend — this tab will show its error state in production. Treat as a known gap, not a bug to "fix" quietly. |

## 5. Known backend quirks (don't re-litigate these — just work around them)

- **Shared Group state / cross-session filter leakage.** `PATCH group/filter/:groupId` (used when applying a dashboard filter) runs an **unscoped `updateMany`** server-side that rewrites `dateType/from/to/groupByTimeFrame/dateByFilter/showSpecificDate` for *every* group sharing that `dashboardId` — not just the one being edited, and with no per-user/session scoping. In practice this means: (a) one browser tab's filter change can leak into another tab/session, and (b) a Group's `groupByTimeFrame`/`dateByFilter` can silently drift between "hour"/"day" and "dayOfMonth"/"month" at any time due to unrelated activity elsewhere on the tenant. **This app never calls that PATCH endpoint** (all filtering is client-side/local), but it must defend against the drift by explicitly overriding `timeFrame`/`dateByFilter` wherever a query's granularity requirement is non-negotiable (see §3.4). This is a real backend bug, not something to fix in the frontend.
- **Trailing spaces in widget titles.** Several real widget titles have a trailing space (`"Trend Report "`, `"Device Health "`, `"Dwell Time by Time Slots "` on some tenants). Always compare with `.trim()`.
- **Highcharts + esbuild.** The bare `highcharts` npm entry is a UMD bundle whose optional modules (heatmap, sankey, dependencywheel, exporting, ...) expect a global `_Highcharts` reference that esbuild (Angular's default builder) doesn't provide. Import the base library from `core/highcharts-setup.ts` (which uses `highcharts/es-modules/masters/highcharts.src`), then import any extra chart module as a side-effect from the matching `es-modules/masters/modules/*.src` path, e.g.:
  ```ts
  import Highcharts from '../../../../core/highcharts-setup';
  import 'highcharts/es-modules/masters/modules/sankey.src';
  ```
- **Highcharts Sankey assumes a strict left-to-right DAG.** A genuinely bidirectional edge set (e.g. Counter1→Counter3 *and* Counter3→Counter1 both present) makes Highcharts loop the "return" edge underneath the chart to reach an earlier column ("drooping" bands). Fixed in `zone-correlation-panel.component.ts` by explicitly assigning every node a fixed `column` and merging each bidirectional pair into one summed forward edge.
- **"Today" is frequently empty.** Analytics ingestion/aggregation lags behind real time, so the current calendar day often has zero data for many widgets — this is expected, not a bug. Verify against a known-good prior date before concluding a wiring is broken.

## 6. Highcharts usage conventions

- Always import the shared `Highcharts` default from `core/highcharts-setup.ts`, never `import * as Highcharts from 'highcharts'` directly in a new chart component (breaks the ES-module registration described above).
- House style for donuts (Gender Split, Engagement Composition): `innerSize: '70–72%'`, `dataLabels: { enabled: false }` (no crowded inner labels), a center `title` showing the total (`"1,234<br/><span>Visits</span>"`), and an external legend list below the chart showing color dot + label + value/%.
- House style for bar/column: `borderRadius`, muted gridlines (`--gridline` CSS var), `dataLabels` in `--ink-secondary`.

## 7. Styling conventions

- **Font:** Poppins, loaded via Google Fonts in `index.html` (weights 400/500/600/700/800) and forced globally in `styles.scss` via `.mat-typography, .mat-typography * { font-family: 'Poppins', ... !important; }` — this reaches Angular Material internals *and* CDK-overlay content (dialogs, menus, tooltips, datepicker), which are appended as direct children of `<body class="mat-typography">`, not inside `<app-root>`. `mat-icon`'s ligature font (`.material-icons`) is explicitly carved back out to `font-family: 'Material Icons'` **after** that rule (same selector specificity, later wins) — omitting this exception breaks every icon into literal text.
- **Color tokens:** defined as CSS custom properties in `styles.scss` (`--navy`, `--ink-primary/secondary/muted`, `--delta-good/bad` (+ `-bg` tints), `--series-1..8` for categorical chart palettes, `--page-plane`, `--gridline`, `--border-hairline`).
- **Card shell:** `.xros-card` (rounded 16px, soft shadow) + `.section-tag` (small uppercase pill label) is the standard panel chrome — every dashboard panel opens with `<span class="section-tag">...</span>`.
- **KPI card comparisons adapt to the selected view:** Day/Week/Custom show Previous Day + Previous Week; Month/Year show Previous Month + Previous Year (`kpi-card.component.ts`'s `comparisons` getter) — the underlying metric always carries all four periods (the query itself is always single-day), this is a display-only filter.
- A mat-form-field nested inside a `display:flex; flex-direction:column` wrapper inflates its outline to ~170px tall (a real Angular Material/Chromium quirk with the notched-outline's percentage-height). Keep filter-bar label+control wrapper `div`s as plain `display:block`, not flex-column.

## 8. Known dead code (left in place, not wired to anything)

Some components/services are declared in `app.module.ts` / imported but never
actually rendered or hit a working endpoint — a legacy of an earlier
mock-data phase before this app was rewired to the real API:

- `core/services/dashboard.service.ts` — calls `/analytics/dashboard`, which doesn't exist. Not imported anywhere.
- `core/services/forecast.service.ts` + `core/services/stores.service.ts` — back the Forecast tab, calling `/analytics/forecast` and `/stores`, neither of which exist on the real backend.
- `pages/dashboard/instore-analytics/floor-plan-panel/` and `.../zone-table-panel/` — declared in `app.module.ts`, never referenced in any template.

Don't build on top of these assuming they're real; treat them as removal
candidates or future work, not as working reference implementations.

## 9. Local development & deployment

- `environment.ts` and `environment.prod.ts` both point `apiUrl` at the **real
  production backend** (`https://xpandanalytics.com/api`) — there is no local
  mock API for this frontend to talk to. `docker-compose.yml`'s `api`/`mongo`
  services build a *different*, unrelated local API (`api_v2/`) that this
  frontend does not call; only the `frontend` service matters for this app.
- Standard rebuild-and-redeploy loop used throughout development:
  ```bash
  npx tsc --noEmit                       # type-check
  npx ng build --configuration development
  docker compose build frontend
  docker compose up -d frontend --force-recreate
  ```
- The frontend container serves the built static files via nginx
  (`nginx.conf`) on port 4200 (mapped from container port 80).
- **Always verify with a real headless browser (Playwright) after deploying**,
  not `curl` — CORS behavior, Highcharts rendering, and Angular Material
  layout only surface in an actual browser context.
