import { Component, EventEmitter, Input, OnChanges, OnInit, Output, SimpleChanges } from '@angular/core';
import { catchError, forkJoin, map, of, switchMap } from 'rxjs';
import { AuthService } from '../../../core/services/auth.service';
import { KpiService, buildKpiDataPayload, buildMultiStoreKpiPayload } from '../../../core/services/kpi.service';
import { WidgetService } from '../../../core/services/widget.service';
import { DashboardGroup, DashboardSummary, Widget } from '../../../core/models/widget.model';
import { KpiDataFilterResult } from '../../../core/models/kpi.model';
import { CampaignEvent } from '../../../core/models/dashboard.model';
import { environment } from '../../../../environments/environment';
import {
  CalendarAvailableMonth,
  CalendarCampaignBanner,
  CalendarColumnTotal,
  CalendarDayCell,
  CalendarResponse,
  CalendarWeekRow,
  ChangeResult
} from '../../../core/models/calendar.model';

const NO_BASELINE: ChangeResult = { status: 'na', pct: null };

const CALENDAR_WIDGET_TITLE = 'Calendar';
const UNIQUE_FOOTFALL_WIDGET_TITLE = 'Unique Footfall';
const MALE_WIDGET_TITLE = 'Male';
const FEMALE_WIDGET_TITLE = 'Female';
// Real day-wise widget for Unique Footfall - the same one the main Dashboard
// tab's Traffic Trend chart uses (dashboard.component.ts's fetchTrafficTrend).
// Its per-day granularity comes from the request's top-level timeFrame/
// dateByFilter ('dayOfMonth'/'month'), and it's scoped per-entrance-store
// rather than at the group level - see fetchUniqueFootfall() below.
//
// Male/Female have no equivalent trend-capable widget of their own (backend
// confirmed - xpandretail-api's kpi-data pipeline buckets by day purely off
// the request's own `timeFrame` field for ANY kpiId, not just footfall's -
// see fetchGenderDaily()), so they reuse the exact same trick against the
// plain single-total Male/Female widgets instead, single-store like every
// other existing use of those widgets (fetchGenderSplit in
// dashboard.component.ts), not per-entrance like Unique Footfall.
const TREND_REPORT_WIDGET_TITLE = 'Trend Report';
const ENTRANCE_CATEGORY_NAME = 'Entrance';

// The Male/Female widgets' own stored dataFilter entries scope by
// kpiGroupId (GENDER) with an empty kpiId, not a specific kpiId - fine for
// their normal single-total 'box' fetch, but the backend resolves an empty
// kpiId + a set kpiGroupId by expanding to EVERY kpiId in that group (both
// Male and Female), so the per-day 'line' response silently interleaves both
// genders' rows under the same dates with no per-point kpiId to tell them
// apart - explaining why Female's day-sum came out higher than Total
// Footfall. Forcing an explicit kpiId here (confirmed real IDs, from
// xpandretail-api's src/common/import/enum/kpi.enum.ts - not guessed) skips
// that group-expansion branch entirely, same fix pattern as PASSER_BY_KPI_ID
// below in dashboard.component.ts. See fetchGenderDaily().
const MALE_KPI_ID = '5ccff2f8b815e9357861f37e';
const FEMALE_KPI_ID = '5ccff3f0b815e9357861f37f';

export type CalendarMetric = 'footfall' | 'unique' | 'male' | 'female';

export interface CalendarMetricOption {
  value: CalendarMetric;
  label: string;
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS_OF_HISTORY = 12;
const HOURLY_OPERATIONAL_START = 8;

const HOURLY_COLOR_STOPS: { stop: number; rgb: [number, number, number] }[] = [
  { stop: 0, rgb: [47, 111, 167] },
  { stop: 0.28, rgb: [227, 167, 60] },
  { stop: 0.55, rgb: [214, 88, 45] },
  { stop: 1, rgb: [192, 57, 43] }
];

export interface HourlyDetailRow {
  label: string;
  value: number;
  pct: number;
  color: string;
}

export interface HourlyDetailModel {
  dateLabel: string;
  rangeLabel: string;
  rows: HourlyDetailRow[];
}

@Component({
  selector: 'app-calendar-panel',
  templateUrl: './calendar-panel.component.html',
  styleUrl: './calendar-panel.component.scss'
})
export class CalendarPanelComponent implements OnInit, OnChanges {
  @Input() dashboardId: string | null = null;
  @Input() dashboards: DashboardSummary[] = [];
  @Input() campaigns: CampaignEvent[] | null = null;
  @Output() dashboardChange = new EventEmitter<string>();
  readonly fixedDashboardId = environment.fixedDashboardId;

  data: CalendarResponse | null = null;
  loading = false;
  errorMessage = '';

  hourlyModal: HourlyDetailModel | null = null;
  hourlyLoading = false;
  hourlyError = '';
  hourlyShowAll24 = false;

  viewDate = this.startOfMonth(new Date());

  readonly metricOptions: CalendarMetricOption[] = [
    { value: 'footfall', label: 'Total Footfall' },
    { value: 'unique', label: 'Unique Footfall' },
    { value: 'male', label: 'Male' },
    { value: 'female', label: 'Female' }
  ];
  selectedMetric: CalendarMetric = 'footfall';

  private group: DashboardGroup | null = null;
  private widget: Widget | null = null;
  private footfallGroup: DashboardGroup | null = null;
  private uniqueFootfallWidget: Widget | null = null;
  private trendReportWidget: Widget | null = null;
  private maleWidget: Widget | null = null;
  private femaleWidget: Widget | null = null;
  private entranceStoreIds: string[] = [];
  private hourlyRawRows: { hour: number; value: number }[] = [];
  private weekBounds: { start: Date; end: Date }[] = [];

  constructor(
    private authService: AuthService,
    private widgetService: WidgetService,
    private kpiService: KpiService
  ) {}

  ngOnInit(): void {
    this.resolveWidget();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['dashboardId'] && !changes['dashboardId'].firstChange) {
      this.resolveWidget();
    }
    if (changes['campaigns'] && !changes['campaigns'].firstChange) {
      this.recomputeCampaignBanners();
    }
  }

  prevMonth(): void {
    this.shiftMonth(-1);
  }

  nextMonth(): void {
    this.shiftMonth(1);
  }

  goToday(): void {
    this.viewDate = this.startOfMonth(new Date());
    this.fetch();
  }

  onMonthChange(value: string): void {
    const [year, month] = value.split('-').map(Number);
    this.viewDate = new Date(year, month - 1, 1);
    this.fetch();
  }

  selectMetric(metric: CalendarMetric): void {
    if (this.selectedMetric === metric) {
      return;
    }
    this.selectedMetric = metric;
    this.fetch();
  }

  formatCount(value: number | null): string {
    return value === null ? '—' : value.toLocaleString('en-US');
  }

  // Sequential heat scale (light -> dark, one hue) so each day cell's
  // background reflects where its count falls within the visible month for
  // whichever metric is currently selected - recomputed from the live month
  // max rather than cached, so switching metrics (footfall/unique/male/
  // female) re-scales the shading instead of reusing a stale range.
  dayIntensityClass(day: CalendarDayCell): string {
    if (!day.inMonth || day.value === null || day.value <= 0) {
      return '';
    }
    const max = this.monthMaxValue();
    if (max <= 0) {
      return '';
    }
    const bucket = Math.min(3, Math.floor((day.value / max) * 4));
    return `intensity-${bucket}`;
  }

  private monthMaxValue(): number {
    if (!this.data) {
      return 0;
    }
    let max = 0;
    for (const week of this.data.weeks) {
      for (const day of week.days) {
        if (day.inMonth && day.value !== null && day.value > max) {
          max = day.value;
        }
      }
    }
    return max;
  }

  // Total Footfall only for now - the hour-level override below is only
  // confirmed to work on the real "Calendar" widget (see the comment on the
  // override itself). Unique Footfall's Trend Report widget gets its day-wise
  // granularity a completely different way (top-level timeFrame, not
  // calendarConfig), and whether it even supports an hour-level request at
  // all hasn't been checked - so its day cells simply aren't clickable
  // instead of guessing at a second unverified mechanism (see the template's
  // [class.clickable]).
  openHourlyDetail(day: CalendarDayCell): void {
    if (this.selectedMetric !== 'footfall' || !day.inMonth || day.value === null) {
      return;
    }

    const date = this.parseDdMmYyyy(day.date);
    if (!date || !this.widget || !this.group) {
      return;
    }

    this.hourlyRawRows = [];
    this.hourlyError = '';
    this.hourlyLoading = true;
    this.hourlyModal = {
      dateLabel: date.toLocaleDateString('en-US', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' }),
      rangeLabel: this.hourlyRangeLabel(),
      rows: []
    };

    const dayKey = this.formatDate(date);
    const from = `${dayKey} 00:00:00`;
    const to = `${dayKey} 23:59:59`;
    // calendarConfig.segregateDate is what actually drives hour-vs-day
    // bucketing on the backend (confirmed by comparing two dashboards' live
    // captures - one widget stored "hour" and returned 24 points for a
    // single-day range, another stored "dayOfMonth" and collapsed the same
    // range to one point). The widget's own stored value reflects how it's
    // configured for the month grid, not this drill-down, so it's forced to
    // "hour" here regardless of what the widget document holds.
    const hourlyWidget: Widget = {
      ...this.widget,
      calendarConfig: { ...(this.widget.calendarConfig as object), segregateDate: 'hour' }
    };
    const payload = buildKpiDataPayload(hourlyWidget, this.group, from, to);

    this.kpiService.postKpiData(payload).subscribe({
      next: (res) => {
        const today = res.data.dataFilter.find((f) => f.selected) ?? res.data.dataFilter[0];
        this.hourlyRawRows = (today?.data ?? []).map((p) => ({
          hour: this.extractHour(p.date ?? ''),
          value: p.value ?? 0
        }));
        this.hourlyLoading = false;
        this.rebuildHourlyRows();
      },
      error: () => {
        this.hourlyLoading = false;
        this.hourlyError = 'Unable to load hourly detail. Please check the API connection and try again.';
      }
    });
  }

  toggleHourlyRange(showAll: boolean): void {
    this.hourlyShowAll24 = showAll;
    this.rebuildHourlyRows();
  }

  closeHourlyDetail(): void {
    this.hourlyModal = null;
    this.hourlyRawRows = [];
    this.hourlyError = '';
    this.hourlyLoading = false;
  }

  private rebuildHourlyRows(): void {
    if (!this.hourlyModal) {
      return;
    }

    const rows = this.hourlyShowAll24
      ? this.hourlyRawRows
      : this.hourlyRawRows.filter((r) => r.hour >= HOURLY_OPERATIONAL_START);
    const maxValue = Math.max(...rows.map((r) => r.value), 1);

    this.hourlyModal = {
      ...this.hourlyModal,
      rangeLabel: this.hourlyRangeLabel(),
      rows: rows.map((r) => ({
        label: `${r.hour.toString().padStart(2, '0')}:00`,
        value: r.value,
        pct: (r.value / maxValue) * 100,
        color: this.hourlyColorFor(r.value / maxValue)
      }))
    };
  }

  private hourlyRangeLabel(): string {
    return this.hourlyShowAll24 ? '00:00 to 23:00' : `${HOURLY_OPERATIONAL_START}:00 to 23:00`;
  }

  private extractHour(dateStr: string): number {
    const time = dateStr.split(' ')[1] ?? '00:00';
    return parseInt(time.split(':')[0], 10) || 0;
  }

  private hourlyColorFor(t: number): string {
    const clamped = Math.max(0, Math.min(1, t));
    let lower = HOURLY_COLOR_STOPS[0];
    let upper = HOURLY_COLOR_STOPS[HOURLY_COLOR_STOPS.length - 1];

    for (let i = 0; i < HOURLY_COLOR_STOPS.length - 1; i++) {
      if (clamped >= HOURLY_COLOR_STOPS[i].stop && clamped <= HOURLY_COLOR_STOPS[i + 1].stop) {
        lower = HOURLY_COLOR_STOPS[i];
        upper = HOURLY_COLOR_STOPS[i + 1];
        break;
      }
    }

    const span = upper.stop - lower.stop || 1;
    const localT = (clamped - lower.stop) / span;
    const rgb = lower.rgb.map((channel, i) => Math.round(channel + (upper.rgb[i] - channel) * localT));
    return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
  }

  // A previous value of exactly 0 can never produce a meaningful percentage
  // (current-vs-0 is mathematically undefined, and displaying "+100%" - as
  // this data used to, straight from the backend's own variation field -
  // reads as if the backend measured 100% growth, which it didn't measure at
  // all). This is the single rule both LM and LY comparisons run through.
  private computeChange(current: number, previous: number | null): ChangeResult {
    if (previous === null) {
      return NO_BASELINE;
    }
    if (previous === 0) {
      return { status: current > 0 ? 'new' : 'flat', pct: null };
    }
    return { status: 'value', pct: Math.round(((current - previous) / previous) * 1000) / 10 };
  }

  changeLabel(change: ChangeResult): string {
    switch (change.status) {
      case 'na':
        return 'N/A';
      case 'flat':
        return '—';
      case 'new':
        return 'New';
      case 'value':
        return `${change.pct! >= 0 ? '+' : ''}${change.pct}%`;
    }
  }

  // "New" is growth from a zero base - real activity where there was none -
  // but a zero baseline still makes the growth *rate* meaningless (there's no
  // denominator to measure it against), so it stays neutral like "flat"/"na"
  // rather than colored green. Only a genuine, comparable non-zero-baseline
  // change earns the positive/negative color.
  isPositiveChange(change: ChangeResult): boolean {
    return change.status === 'value' && (change.pct ?? 0) >= 0;
  }

  isNegativeChange(change: ChangeResult): boolean {
    return change.status === 'value' && (change.pct ?? 0) < 0;
  }

  private shiftMonth(delta: number): void {
    this.viewDate = new Date(this.viewDate.getFullYear(), this.viewDate.getMonth() + delta, 1);
    this.fetch();
  }

  private resolveWidget(): void {
    const defaultDashboardId = this.authService.currentUser?.defaultDashboard;
    const dashboardId$ = this.dashboardId
      ? of(this.dashboardId)
      : defaultDashboardId
      ? of(defaultDashboardId)
      : this.widgetService.getDashboards().pipe(map((dashboards) => dashboards[0]?._id));

    dashboardId$
      .pipe(
        switchMap((dashboardId) => (dashboardId ? this.widgetService.getGroups(dashboardId) : of([]))),
        switchMap((groups) => {
          const group = groups.find((g) => g.groupName.trim() === CALENDAR_WIDGET_TITLE) ?? null;
          // Same "first group by order" lookup dashboard.component.ts uses to
          // find its Total/Unique Footfall KPI cards and Trend Report widget -
          // Unique Footfall has no equivalent widget in the Calendar group.
          const footfallGroup = [...groups].sort((a, b) => a.order - b.order)[0] ?? null;
          this.group = group;
          this.footfallGroup = footfallGroup;
          return forkJoin({
            calendarWidgets: group ? this.widgetService.getWidgets(group._id) : of([] as Widget[]),
            footfallWidgets: footfallGroup ? this.widgetService.getWidgets(footfallGroup._id) : of([] as Widget[]),
            stores: this.widgetService.getStores()
          });
        })
      )
      .subscribe({
        next: ({ calendarWidgets, footfallWidgets, stores }) => {
          this.widget = calendarWidgets.find((w) => w.title.trim() === CALENDAR_WIDGET_TITLE) ?? null;
          this.uniqueFootfallWidget = footfallWidgets.find((w) => w.title.trim() === UNIQUE_FOOTFALL_WIDGET_TITLE) ?? null;
          this.trendReportWidget = footfallWidgets.find((w) => w.title.trim() === TREND_REPORT_WIDGET_TITLE) ?? null;
          this.maleWidget = footfallWidgets.find((w) => w.title.trim() === MALE_WIDGET_TITLE) ?? null;
          this.femaleWidget = footfallWidgets.find((w) => w.title.trim() === FEMALE_WIDGET_TITLE) ?? null;

          const parentStoreId = this.footfallGroup?.stores[0];
          this.entranceStoreIds = parentStoreId
            ? stores.filter((s) => s.categoryName === ENTRANCE_CATEGORY_NAME && s.parentId.includes(parentStoreId)).map((s) => s._id)
            : [];

          this.fetch();
        },
        error: () => {
          this.errorMessage = 'Unable to load calendar data. Please check the API connection and try again.';
        }
      });
  }

  private fetch(): void {
    if (this.selectedMetric === 'unique') {
      this.fetchUniqueFootfall();
      return;
    }
    if (this.selectedMetric === 'male' || this.selectedMetric === 'female') {
      this.fetchGenderDaily(this.selectedMetric);
      return;
    }
    this.fetchCalendarWidget();
  }

  private fetchCalendarWidget(): void {
    if (!this.widget || !this.group) {
      this.data = null;
      return;
    }
    const widget = this.widget;
    const group = this.group;

    const monthStart = this.startOfMonth(this.viewDate);
    const monthEnd = this.endOfMonth(this.viewDate);
    const from = `${this.formatDate(monthStart)} 00:00:00`;
    const to = `${this.formatDate(monthEnd)} 23:59:59`;
    const payload = buildKpiDataPayload(widget, group, from, to);

    // Last year's same month has no compareConfig relationship to the
    // widget's own "PM" series - it's fetched as its own plain request
    // (same widget/group, just a year-shifted date range), the same pattern
    // used elsewhere in this app whenever a comparison period isn't
    // something the backend already returns for free.
    const lastYearStart = this.addMonths(monthStart, -12);
    const lastYearEnd = this.endOfMonth(lastYearStart);
    const lyFrom = `${this.formatDate(lastYearStart)} 00:00:00`;
    const lyTo = `${this.formatDate(lastYearEnd)} 23:59:59`;
    const lyPayload = buildKpiDataPayload(widget, group, lyFrom, lyTo);

    this.loading = true;
    this.errorMessage = '';

    forkJoin({
      current: this.kpiService.postKpiData(payload),
      lastYear: this.kpiService.postKpiData(lyPayload).pipe(catchError(() => of(null)))
    }).subscribe({
      next: ({ current, lastYear }) => {
        this.loading = false;
        const { todayByDate, lmByDate, lyByDay } = this.mapsFromCalendarFilters(current.data.dataFilter, lastYear?.data.dataFilter ?? []);
        this.data = this.toCalendarResponse(todayByDate, lmByDate, lyByDay, monthStart);
      },
      error: () => {
        this.loading = false;
        this.errorMessage = 'Unable to load calendar data. Please check the API connection and try again.';
      }
    });
  }

  // Unique Footfall has no Calendar-style widget of its own - it reuses the
  // Trend Report widget the main Dashboard's Traffic Trend chart already gets
  // real per-day values from (see dashboard.component.ts's fetchTrafficTrend).
  // That widget doesn't bundle a "PM" comparison series the way the Calendar
  // widget does, so LM/LY here are two extra explicit requests (same trick
  // fetchCalendarWidget already uses for LY) rather than one bundled response.
  private fetchUniqueFootfall(): void {
    if (!this.trendReportWidget || !this.footfallGroup || !this.entranceStoreIds.length) {
      this.data = null;
      return;
    }
    const widget = this.trendReportWidget;
    const group = this.footfallGroup;
    const storeIds = this.entranceStoreIds;

    const monthStart = this.startOfMonth(this.viewDate);
    const monthEnd = this.endOfMonth(this.viewDate);
    const lastMonthStart = this.addMonths(monthStart, -1);
    const lastMonthEnd = this.endOfMonth(lastMonthStart);
    const lastYearStart = this.addMonths(monthStart, -12);
    const lastYearEnd = this.endOfMonth(lastYearStart);

    const toRange = (start: Date, end: Date) => ({
      from: `${this.formatDate(start)} 00:00:00`,
      to: `${this.formatDate(end)} 23:59:59`
    });
    const fetchDaily = (range: { from: string; to: string }) =>
      this.kpiService
        .postKpiData(buildMultiStoreKpiPayload(widget, group, storeIds, range.from, range.to, 'dayOfMonth', 'month'))
        .pipe(map((res) => this.sumUniqueFootfallByDay(res.data.dataFilter)));

    this.loading = true;
    this.errorMessage = '';

    forkJoin({
      todayByDate: fetchDaily(toRange(monthStart, monthEnd)),
      lmByDate: fetchDaily(toRange(lastMonthStart, lastMonthEnd)).pipe(catchError(() => of(new Map<string, number>()))),
      lyByDate: fetchDaily(toRange(lastYearStart, lastYearEnd)).pipe(catchError(() => of(new Map<string, number>())))
    }).subscribe({
      next: ({ todayByDate, lmByDate, lyByDate }) => {
        this.loading = false;
        const lyByDay = new Map<number, number>();
        lyByDate.forEach((value, dateKey) => {
          const day = this.parseDdMmYyyy(dateKey)?.getDate();
          if (day) {
            lyByDay.set(day, value);
          }
        });
        this.data = this.toCalendarResponse(todayByDate, lmByDate, lyByDay, monthStart);
      },
      error: () => {
        this.loading = false;
        this.errorMessage = 'Unable to load calendar data. Please check the API connection and try again.';
      }
    });
  }

  // Response has one line series per entrance store (e.g. "Lifestyle
  // Entrance::Unique Footfall"), each broken into one point per day - same
  // shape dashboard.component.ts's own sumByCalendarDay handles for the
  // Traffic Trend chart. Summed across entrances per calendar day, keyed in
  // the same DD-MM-YYYY format the Calendar widget's own response uses (via
  // dateFrom, since this widget doesn't populate the Calendar-style `date`
  // field) so it can flow through the same toCalendarResponse() as that path.
  private sumUniqueFootfallByDay(filters: KpiDataFilterResult[]): Map<string, number> {
    const byDate = new Map<string, number>();
    for (const filter of filters) {
      const label = filter.label.split('::').pop() || filter.label;
      if (label !== UNIQUE_FOOTFALL_WIDGET_TITLE) {
        continue;
      }
      for (const point of filter.data) {
        if (!point.dateFrom) {
          continue;
        }
        const key = this.formatDdMmYyyy(new Date(point.dateFrom));
        byDate.set(key, (byDate.get(key) ?? 0) + (point.value ?? 0));
      }
    }
    return byDate;
  }

  // Male/Female have no trend-capable widget of their own (see the const
  // comment above) - reuses the plain single-total Male/Female widget already
  // resolved for other tabs' gender-split displays, just with timeFrame
  // forced to 'dayOfMonth' the same way fetchUniqueFootfall forces it on the
  // Trend Report widget. Single-store (footfallGroup's own default), not
  // per-entrance - matches how these two widgets are queried everywhere else
  // in the app (dashboard.component.ts's fetchGenderCount).
  private fetchGenderDaily(metric: 'male' | 'female'): void {
    const rawWidget = metric === 'male' ? this.maleWidget : this.femaleWidget;
    if (!rawWidget || !this.footfallGroup) {
      this.data = null;
      return;
    }
    const group = this.footfallGroup;
    // Two separate backend quirks fixed here on top of the widget's own
    // stored dataFilter:
    // 1. fetchDataFor: 'box' (the widget's own stored value) takes a
    //    different pipeline branch than 'line' - it drops the day-of-month
    //    $group stage and collapses the whole requested range into ONE
    //    summed point stamped near the range's start date (the "huge number
    //    on day 1" bug). fetchDataFor is read per dataFilter entry, so
    //    overriding it to 'line' here keeps the day grouping intact.
    // 2. kpiId (the widget's own stored value is empty, scoped only by
    //    kpiGroupId: GENDER) makes the backend expand to EVERY kpiId in that
    //    group - both Male and Female - so per-day sums silently included
    //    both genders. Forcing the specific kpiId (see the consts above)
    //    skips that expansion.
    const kpiId = metric === 'male' ? MALE_KPI_ID : FEMALE_KPI_ID;
    const widget: Widget = {
      ...rawWidget,
      dataFilter: rawWidget.dataFilter.map((filter) => ({ ...filter, fetchDataFor: 'line', kpiId }))
    };

    const monthStart = this.startOfMonth(this.viewDate);
    const monthEnd = this.endOfMonth(this.viewDate);
    const lastMonthStart = this.addMonths(monthStart, -1);
    const lastMonthEnd = this.endOfMonth(lastMonthStart);
    const lastYearStart = this.addMonths(monthStart, -12);
    const lastYearEnd = this.endOfMonth(lastYearStart);

    const toRange = (start: Date, end: Date) => ({
      from: `${this.formatDate(start)} 00:00:00`,
      to: `${this.formatDate(end)} 23:59:59`
    });
    const fetchDaily = (range: { from: string; to: string }) =>
      this.kpiService
        .postKpiData(buildKpiDataPayload(widget, group, range.from, range.to, undefined, 'dayOfMonth', 'month'))
        .pipe(map((res) => this.sumPointsByDay(res.data.dataFilter)));

    this.loading = true;
    this.errorMessage = '';

    forkJoin({
      todayByDate: fetchDaily(toRange(monthStart, monthEnd)),
      lmByDate: fetchDaily(toRange(lastMonthStart, lastMonthEnd)).pipe(catchError(() => of(new Map<string, number>()))),
      lyByDate: fetchDaily(toRange(lastYearStart, lastYearEnd)).pipe(catchError(() => of(new Map<string, number>())))
    }).subscribe({
      next: ({ todayByDate, lmByDate, lyByDate }) => {
        this.loading = false;
        const lyByDay = new Map<number, number>();
        lyByDate.forEach((value, dateKey) => {
          const day = this.parseDdMmYyyy(dateKey)?.getDate();
          if (day) {
            lyByDay.set(day, value);
          }
        });
        this.data = this.toCalendarResponse(todayByDate, lmByDate, lyByDay, monthStart);
      },
      error: () => {
        this.loading = false;
        this.errorMessage = 'Unable to load calendar data. Please check the API connection and try again.';
      }
    });
  }

  // Box-type widget responses bundle more than just the current period's
  // series in one dataFilter[] - dashboard.component.ts's own fetchGenderCount
  // (the proven-correct single-total read of this exact widget) has to filter
  // down to `f.selected` before reading a value, rather than trusting every
  // entry it gets back. Blindly summing every dataFilter entry here (as this
  // used to) silently included whatever else was bundled alongside the real
  // series, inflating the total - same shape of bug as the kpiId-expansion
  // fix above, just at the dataFilter level instead of the kpiId level.
  // Falls back to the first entry only if none are marked selected, rather
  // than falling back to summing everything.
  private sumPointsByDay(filters: KpiDataFilterResult[]): Map<string, number> {
    const selected = filters.filter((f) => f.selected);
    const source = selected.length ? selected : filters.slice(0, 1);
    const byDate = new Map<string, number>();
    for (const filter of source) {
      for (const point of filter.data) {
        const key = point.date ?? (point.dateFrom ? this.formatDdMmYyyy(new Date(point.dateFrom)) : null);
        if (!key) {
          continue;
        }
        byDate.set(key, (byDate.get(key) ?? 0) + (point.value ?? 0));
      }
    }
    return byDate;
  }

  // "Today" (selected:true) carries this month's per-day values; "PM" carries
  // the previous-month values, aligned to the same dates. Last year's request
  // returns its own "selected" series for that other month, matched back to
  // this month's days by DAY NUMBER (not date string, since the year
  // differs) - a day that doesn't exist in both months (e.g. Feb 29) simply
  // has no LY value, not a crash.
  private mapsFromCalendarFilters(
    filters: KpiDataFilterResult[],
    lyFilters: KpiDataFilterResult[]
  ): { todayByDate: Map<string, number>; lmByDate: Map<string, number>; lyByDay: Map<number, number> } {
    const today = filters.find((f) => f.selected) ?? filters[0];
    const lastMonth = filters.find((f) => f.label === 'PM');
    const lastYear = lyFilters.find((f) => f.selected) ?? lyFilters[0];

    const todayByDate = new Map<string, number>();
    (today?.data ?? []).forEach((p) => {
      if (p.date) {
        todayByDate.set(p.date, p.value);
      }
    });

    const lmByDate = new Map<string, number>();
    (lastMonth?.data ?? []).forEach((p) => {
      if (p.date) {
        lmByDate.set(p.date, p.value);
      }
    });

    const lyByDay = new Map<number, number>();
    (lastYear?.data ?? []).forEach((p) => {
      const day = this.parseDdMmYyyy(p.date ?? '')?.getDate();
      if (day) {
        lyByDay.set(day, p.value);
      }
    });

    return { todayByDate, lmByDate, lyByDay };
  }

  // Source-agnostic: takes the current month/last month/last year values as
  // plain date-keyed maps (DD-MM-YYYY, except lyByDay which is keyed by day
  // number since the year differs) so it works the same whether those maps
  // came from the bundled Calendar widget response or three separate Trend
  // Report requests - see mapsFromCalendarFilters() and fetchUniqueFootfall().
  // A day that doesn't exist in both months (e.g. Feb 29) simply has no LY
  // value, not a crash.
  //
  // Every LM/LY percentage is computed locally from the real values here
  // rather than trusting the backend's own per-day "variation" field - that
  // field is exactly what produced the misleading "+100%" when the prior
  // value was 0.
  private toCalendarResponse(
    todayByDate: Map<string, number>,
    lmByDate: Map<string, number>,
    lyByDay: Map<number, number>,
    monthStart: Date
  ): CalendarResponse {
    const cellsByDate = new Map<string, CalendarDayCell>();
    todayByDate.forEach((value, date) => {
      const dayNum = this.parseDdMmYyyy(date)?.getDate() ?? 0;
      const lmValue = lmByDate.get(date) ?? null;
      const lyValue = lyByDay.get(dayNum) ?? null;
      cellsByDate.set(date, {
        date,
        day: dayNum,
        inMonth: true,
        value,
        lmValue,
        lmChange: this.computeChange(value, lmValue),
        lyValue,
        lyChange: this.computeChange(value, lyValue)
      });
    });

    const weeks = this.buildWeeks(monthStart, cellsByDate);
    const monthTotal = Array.from(cellsByDate.values()).reduce((sum, c) => sum + (c.value ?? 0), 0);
    const lastMonthTotal = lmByDate.size ? Array.from(lmByDate.values()).reduce((sum, v) => sum + v, 0) : null;
    const lastYearTotal = lyByDay.size ? Array.from(lyByDay.values()).reduce((sum, v) => sum + v, 0) : null;
    const bestWeek = weeks.filter((w) => w.total > 0).sort((a, b) => b.total - a.total)[0] ?? null;
    const { weekdayAvg, weekendAvg } = this.computeDayTypeAverages(cellsByDate);

    return {
      scope: 'all',
      month: this.formatDate(monthStart),
      monthLabel: this.formatMonthLabel(monthStart),
      lastMonthLabel: this.formatMonthLabel(this.addMonths(monthStart, -1)),
      lastYearLabel: this.formatMonthLabel(this.addMonths(monthStart, -12)),
      monthTotal,
      lastMonthTotal,
      lmChange: this.computeChange(monthTotal, lastMonthTotal),
      lastYearTotal,
      lyChange: this.computeChange(monthTotal, lastYearTotal),
      bestWeek: bestWeek ? { label: bestWeek.label, total: bestWeek.total } : null,
      weekdayAvg,
      weekendAvg,
      columnLabels: WEEKDAY_LABELS,
      weeks,
      columnTotals: this.buildColumnTotals(weeks),
      availableMonths: this.buildAvailableMonths(monthStart)
    };
  }

  // Weekend = Sat/Sun (Date.getDay() 0 and 6), weekday = Mon-Fri - same
  // convention instore-analytics.component.ts's own weekday/weekend KPI tiles
  // already use, not this file's Sun-start grid column order. Averaged only
  // over in-month days that actually have a value, so a partial month doesn't
  // get dragged down by days with no data.
  private computeDayTypeAverages(cellsByDate: Map<string, CalendarDayCell>): { weekdayAvg: number | null; weekendAvg: number | null } {
    let weekdaySum = 0;
    let weekdayCount = 0;
    let weekendSum = 0;
    let weekendCount = 0;

    cellsByDate.forEach((cell, date) => {
      if (cell.value === null) {
        return;
      }
      const day = this.parseDdMmYyyy(date)?.getDay();
      if (day === undefined) {
        return;
      }
      if (day === 0 || day === 6) {
        weekendSum += cell.value;
        weekendCount++;
      } else {
        weekdaySum += cell.value;
        weekdayCount++;
      }
    });

    return {
      weekdayAvg: weekdayCount > 0 ? Math.round(weekdaySum / weekdayCount) : null,
      weekendAvg: weekendCount > 0 ? Math.round(weekendSum / weekendCount) : null
    };
  }

  private buildWeeks(monthStart: Date, cellsByDate: Map<string, CalendarDayCell>): CalendarWeekRow[] {
    const monthEnd = this.endOfMonth(monthStart);
    let cursor = new Date(monthStart);
    cursor.setDate(cursor.getDate() - cursor.getDay());

    const weeks: CalendarWeekRow[] = [];
    let weekIndex = 1;
    this.weekBounds = [];

    while (cursor <= monthEnd) {
      const weekStart = new Date(cursor);
      const days: CalendarDayCell[] = [];
      for (let i = 0; i < 7; i++) {
        const inMonth = cursor.getMonth() === monthStart.getMonth() && cursor.getFullYear() === monthStart.getFullYear();
        const key = this.formatDdMmYyyy(cursor);
        days.push(
          (inMonth && cellsByDate.get(key)) || {
            date: key,
            day: cursor.getDate(),
            inMonth,
            value: null,
            lmValue: null,
            lmChange: NO_BASELINE,
            lyValue: null,
            lyChange: NO_BASELINE
          }
        );
        cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
      }

      const total = days.reduce((sum, d) => sum + (d.value ?? 0), 0);
      const hasLm = days.some((d) => d.lmValue !== null);
      const lmTotal = hasLm ? days.reduce((sum, d) => sum + (d.lmValue ?? 0), 0) : null;
      const hasLy = days.some((d) => d.lyValue !== null);
      const lyTotal = hasLy ? days.reduce((sum, d) => sum + (d.lyValue ?? 0), 0) : null;

      const weekEnd = this.addDays(weekStart, 6);
      this.weekBounds.push({ start: weekStart, end: weekEnd });

      weeks.push({
        label: `Week ${weekIndex}`,
        total,
        lmTotal,
        lmChange: this.computeChange(total, lmTotal),
        lyTotal,
        lyChange: this.computeChange(total, lyTotal),
        days,
        banners: this.buildCampaignBanners(weekStart, weekEnd)
      });
      weekIndex++;
    }

    return weeks;
  }

  // Campaigns are handed down from the dashboard's own Event-list fetch (the
  // same data app-active-campaigns-panel renders) - this just projects each
  // campaign's [from, to] onto whichever week row(s) it overlaps, clipped to
  // that week's own Sun-Sat bounds so a campaign spanning weeks gets its own
  // banner segment per row rather than one banner that's positioned wrong.
  private buildCampaignBanners(weekStart: Date, weekEnd: Date): CalendarCampaignBanner[] {
    const campaigns = this.campaigns ?? [];
    const banners: CalendarCampaignBanner[] = [];

    for (const c of campaigns) {
      const from = this.stripTime(new Date(c.from));
      const to = this.stripTime(new Date(c.to));
      if (isNaN(from.getTime()) || isNaN(to.getTime()) || to < weekStart || from > weekEnd) {
        continue;
      }

      const clippedStart = from < weekStart ? weekStart : from;
      const clippedEnd = to > weekEnd ? weekEnd : to;
      banners.push({
        label: c.name,
        startCol: clippedStart.getDay() + 2,
        endCol: clippedEnd.getDay() + 3
      });
    }

    return banners;
  }

  private recomputeCampaignBanners(): void {
    if (!this.data) {
      return;
    }
    this.data = {
      ...this.data,
      weeks: this.data.weeks.map((w, i) => ({
        ...w,
        banners: this.weekBounds[i] ? this.buildCampaignBanners(this.weekBounds[i].start, this.weekBounds[i].end) : []
      }))
    };
  }

  private stripTime(date: Date): Date {
    date.setHours(0, 0, 0, 0);
    return date;
  }

  private buildColumnTotals(weeks: CalendarWeekRow[]): CalendarColumnTotal[] {
    return Array.from({ length: 7 }, (_, col) => {
      const cells = weeks.map((w) => w.days[col]).filter((d) => d.inMonth);
      const total = cells.reduce((sum, d) => sum + (d.value ?? 0), 0);
      const hasLm = cells.some((d) => d.lmValue !== null);
      const lmTotal = hasLm ? cells.reduce((sum, d) => sum + (d.lmValue ?? 0), 0) : null;
      const hasLy = cells.some((d) => d.lyValue !== null);
      const lyTotal = hasLy ? cells.reduce((sum, d) => sum + (d.lyValue ?? 0), 0) : null;
      return {
        total,
        lmTotal,
        lmChange: this.computeChange(total, lmTotal),
        lyTotal,
        lyChange: this.computeChange(total, lyTotal)
      };
    });
  }

  private buildAvailableMonths(monthStart: Date): CalendarAvailableMonth[] {
    const months: CalendarAvailableMonth[] = [];
    for (let i = 0; i <= MONTHS_OF_HISTORY; i++) {
      const d = this.addMonths(this.startOfMonth(new Date()), -i);
      months.push({ value: this.formatDate(d).slice(0, 7), label: this.formatMonthLabel(d) });
    }

    const currentKey = this.formatDate(monthStart).slice(0, 7);
    if (!months.some((m) => m.value === currentKey)) {
      months.push({ value: currentKey, label: this.formatMonthLabel(monthStart) });
    }
    months.sort((a, b) => (a.value < b.value ? 1 : -1));

    return months;
  }

  private startOfMonth(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }

  private endOfMonth(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0);
  }

  private addMonths(date: Date, delta: number): Date {
    return new Date(date.getFullYear(), date.getMonth() + delta, 1);
  }

  private addDays(date: Date, days: number): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
  }

  private formatMonthLabel(date: Date): string {
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private formatDdMmYyyy(date: Date): string {
    const day = `${date.getDate()}`.padStart(2, '0');
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    return `${day}-${month}-${date.getFullYear()}`;
  }

  private parseDdMmYyyy(value: string): Date | null {
    const [day, month, year] = value.split('-').map(Number);
    if (!day || !month || !year) {
      return null;
    }
    return new Date(year, month - 1, day);
  }
}
