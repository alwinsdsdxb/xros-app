# app_v2 — Work Log

A running record of what's been built and fixed in the dashboard so far. This
complements [`ARCHITECTURE.md`](ARCHITECTURE.md) (how the system works) with
*why* things look/behave the way they do today — useful when a number or a
layout choice seems unexplained.

Every item below was verified against the real production API
(`https://xpandanalytics.com/api`) and the live Docker-deployed frontend
before being marked done — nothing here is theoretical.

## Backend integration

- **Zero mock data, zero hardcoded IDs.** Every dashboard, group, widget, KPI,
  store and event is discovered at runtime via `dashboard/list` → `group/list`
  → `widget/list` → `kpi/data`, per the chain documented in ARCHITECTURE.md.
  Confirmed no hardcoded login credentials exist anywhere in the frontend
  (login form starts empty; `AuthService.login()` just relays whatever the
  user typed).
- **`api_v2` (the local NestJS backend in this repo) is not used.** Both
  `environment.ts` and `environment.prod.ts` hardcode the real production API
  URL; `api_v2`/`mongo` spin up alongside the frontend in `docker-compose.yml`
  but the frontend never calls them.

## Data-accuracy bugs found and fixed

These were all silent — the API returned `200`/`201` in every case, so the
UI just quietly showed wrong numbers instead of erroring.

- **Traffic Trend chart rendering empty.** The Overview group's
  `groupByTimeFrame`/`dateByFilter` had drifted from `"hour"/"day"` to
  `"dayOfMonth"/"month"` (a backend-side bug: any group filter change on the
  tenant runs an unscoped `updateMany` that rewrites those fields for every
  group sharing the dashboard, not just the one edited). Fixed by forcing
  `timeFrame`/`dateByFilter` explicitly instead of trusting the group's own
  mutable fields.
- **Average Dwell Trend showing flat zero**, same root cause as above but on
  the "My Reports" group. Fixed the same way — pinned `"dayOfMonth"/"month"`
  explicitly.
- **Age Demographics inflated ~4×.** The KPI is captured by a single
  mall-wide sensor, not per-entrance (verified live: querying it against any
  individual entrance ID returns identical numbers to querying the mall-level
  store). The code was querying it across 4 entrances and summing —
  quadruple-counting the same data. Also was reading only the first of many
  hourly data points instead of the whole day. Fixed by querying the
  mall-level store once with `timeFrame: "day"`.
- **Funnel chart wrong for 2 of 5 stages.** Scoped to the 4 entrance stores
  like Total Footfall, but "Adult" and "Long Dwell Visitors" aren't tracked
  per-entrance at all (came back empty), and "Traffic" undercounted (3,035
  instead of the real 5,510) since those 4 entrances don't account for all
  mall traffic. Fixed by querying the mall-level store, matching the real
  Total Footfall figure exactly.
- **KPI card percentage pills overflowing their box.** Long decimal
  percentages (`-78.29%`) plus an icon didn't fit a narrow grid column.
  Fixed by rounding to whole numbers and stacking the value/pill vertically
  instead of side-by-side, so it can never run out of horizontal room.
- **Funnel chart label text unreadable on near-zero days.** A stage with 0
  visitors (e.g. "today" before the day's data has processed) rendered as a
  sliver too narrow for its own label. Went through a few iterations — text
  wrapping broke into single vertical letters; nesting the label inside the
  `clip-path`'d trapezoid clipped it outright — landed on: trapezoid shape
  and label as separate layers (only the shape is clipped), with a dark
  outline on the label text so it stays legible even where it spills onto
  the white card background.

## Features added

- **Active Campaigns panel.** No dedicated campaign API exists — real
  marketing campaigns are `Event` documents (`GET /event/list`), scoped to
  the dashboard's store(s), filtered to "not yet ended."
- **Operations panel wired to real data**: Devices Online/Offline from the
  `donutDeviceStatus` "Device Health" widget (unique response shape:
  `{ online, offline }`, no `value` field); Temperature/condition/location
  from the "Weather" widget (condition derived from the real `icon` slug,
  e.g. `"partly-cloudy-day"` → "Partly Cloudy"). Added explicit uppercase
  titles to all 4 tiles after user feedback that they were unclear.
- **Passer By fallback to Total Footfall.** This tenant's Passer By sensor
  (`outside_innum + outside_outnum`) genuinely has no data in any comparison
  window. Rather than show a flat 0, the KPI card — and later the Traffic
  Trend line — fall back to Total Footfall, but only when Passer By is
  empty across *every* window (a single real zero day still shows as 0, not
  masked).
- **Dwell Time Analysis tiles wired to real data**: Estimated Avg Dwell
  (from the "Average Dwell Time" KPI), Quick/Engaged/Long Stay % and
  Visitors in Analysis (derived from the "Dwell Time by Time Slots"
  histogram's 5 buckets). Since that histogram widget has no `compareConfig`,
  it's fetched twice — selected day and the day before — to get a real
  day-over-day change instead of a fabricated one.
- **Engagement Composition** relabeled from raw minute ranges ("0-5", "6-15"…)
  to semantic tiers (Quick Visit, Casual Visit, Engaged Visit, High
  Engagement, Long Visit) and rebuilt as a donut with a center total and an
  external legend (value + %), matching the Gender Split donut's house style.
- **Traffic Trend chart redesigned**: now shows the whole month (one point
  per day, zero-padded) instead of a single day's hourly breakdown; added a
  genuine 3rd series (Passer By, derived the same way as its KPI card);
  switched to smooth spline lines with markers; toggles restyled as pill
  chips; added a date-range caption row below the chart. Wrapped in its own
  card (previously the only dashboard section without one).

## Styling

- **Global font swapped Inter → Poppins**, including Material internals and
  CDK overlays (dialogs/menus/datepicker), with a follow-up fix for `mat-icon`
  ligatures breaking into literal text (`.material-icons` needs its own
  `font-family: 'Material Icons'` re-asserted after the global override).
- **Filter bar and KPI cards restyled** to match a reference design; added a
  functional Hours (Operational/24h) toggle backed by the real
  `showDataByOperationalHours` group field. Fixed a genuine Angular
  Material/Chromium bug along the way (`mat-form-field` inflating to ~170px
  tall inside a flex-column wrapper — fixed by using `display:block`
  wrappers instead).
- **Dashboard sections (tag row through Operations) grouped into one bordered
  container**, matching how the rest of the page is organized into cards.
- **General spacing/consistency pass**: filter bar padding brought in line
  with every other card, KPI card number-to-description spacing, Operations
  tile gaps, Dwell tile double-spacing (gap + padding were stacking),
  Trend chart header spacing, and sub-section title spacing standardized
  across Demographics/Dwell.

## Documentation

- [`ARCHITECTURE.md`](ARCHITECTURE.md): tech stack, project structure, the
  full KPI payload-construction model, a feature-to-backend map for every
  panel, known backend quirks, Highcharts/styling conventions, and known
  dead code (`DashboardService`, the Forecast tab's placeholder endpoints,
  unrendered `floor-plan-panel`/`zone-table-panel` components).
- `README.md` rewritten from the default Angular CLI boilerplate to a real
  project overview linking into the above.
