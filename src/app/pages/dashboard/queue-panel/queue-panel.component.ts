import { Component, EventEmitter, Input, OnChanges, OnInit, Output, SimpleChanges } from '@angular/core';
import { FormBuilder, FormGroup } from '@angular/forms';
import { MatDatepicker } from '@angular/material/datepicker';
import { catchError, forkJoin, map, of, switchMap } from 'rxjs';
import * as Highcharts from 'highcharts';
import { AuthService } from '../../../core/services/auth.service';
import { KpiService, buildKpiDataPayload } from '../../../core/services/kpi.service';
import { WidgetService } from '../../../core/services/widget.service';
import { DashboardGroup, DashboardSummary, StoreListItem, Widget } from '../../../core/models/widget.model';
import { KpiDataFilterResult } from '../../../core/models/kpi.model';
import { environment } from '../../../../environments/environment';

// Confirmed live (real request/response, see conversation) - a "Table"
// widget bundling 4 KPI line series: Total Queue Visitors, Average Queue
// Length, Average Wait Time, Average Service Time. It isn't in a group this
// app already knows the name of, so it's looked up by _id across every
// group on the dashboard instead - see resolveWidget(). Replaces the earlier
// widget id (6a7319ffd7092bb849829b95), which had Queue Abandonments instead
// of Average Service Time - this one is the confirmed source for Service
// Time, so Abandonments is no longer fetched (it was never shown in the UI).
const QUEUE_WIDGET_ID = '6a7328c1114002200ad43a51';
const QUEUE_LENGTH_LABEL = 'Average Queue Length';
const QUEUE_TIME_LABEL = 'Average Wait Time';
const SERVICE_TIME_LABEL = 'Average Service Time';
const QUEUE_COUNT_LABEL = 'Total Queue Visitors';

// Target line shown on the "Queue Time vs Target" chart and used for the
// Queue Target Variance columns - a fixed SLA threshold, not something the
// API returns. Kept as a constant here until the design calls for it to be
// user-configurable.
const QUEUE_TARGET_SECONDS = 90;

const DEFAULT_RANGE_DAYS = 12;

const CALENDAR_WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const CALENDAR_INTENSITY_BUCKETS = 5;

export interface QueueDayRow {
  dateKey: string;
  dateLabel: string;
  isoDate: string;
  queueLength: number;
  queueCount: number;
  queueTimeSec: number;
  serviceTimeSec: number;
  processingTimeSec: number;
  waitToServiceRatio: number;
  waitingSharePct: number;
  queueTargetVarianceSec: number;
  queueTargetVariancePct: number;
}

interface QueueKpiTile {
  label: string;
  icon: string;
  valueLabel: string;
  deltaPct: number | null;
  deltaLabel: string;
  colorClass: 'good' | 'bad' | 'neutral';
  sub: string;
}

interface MetricsSummaryRow {
  metric: string;
  formula: string;
  valueLabel: string;
  interpretation: string;
}

export interface QueueCalendarCell {
  isoDate: string;
  day: number;
  inMonth: boolean;
  row: QueueDayRow | null;
  intensity: number;
}

@Component({
  selector: 'app-queue-panel',
  templateUrl: './queue-panel.component.html',
  styleUrl: './queue-panel.component.scss'
})
export class QueuePanelComponent implements OnInit, OnChanges {
  @Input() dashboardId: string | null = null;
  @Input() dashboards: DashboardSummary[] = [];
  @Output() dashboardChange = new EventEmitter<string>();
  readonly fixedDashboardId = environment.fixedDashboardId;

  filterForm: FormGroup;
  // Starts true (not false) so the chart cards stay behind the loading
  // placeholder for the whole resolveWidget() -> fetch() async chain, not
  // just from fetch() onward. Otherwise there's a window right after
  // component init - while resolveWidget() is still resolving the widget/
  // group and loading/errorMessage are both falsy - where the template
  // mounts <highcharts-chart> with the still-empty {} options, and
  // Highcharts 13's default chart.backgroundColor (a CSS var this app never
  // defines) renders as solid black.
  loading = true;
  errorMessage = '';

  storeOptions: { value: string; label: string }[] = [];
  get allQueuesLabel(): string {
    return this.storeOptions.length === 1 ? this.storeOptions[0].label : 'All Queues';
  }

  dailyRows: QueueDayRow[] = [];
  metricsSummaryRows: MetricsSummaryRow[] = [];

  avgQueueTimeSec = 0;
  totalQueueCount = 0;
  avgServiceTimeSec = 0;
  avgProcessingTimeSec = 0;
  waitToServiceRatio = 0;
  waitingTimeSharePct = 0;
  pctWithinTarget = 0;
  pctAboveTarget = 0;
  customersWithinTarget = 0;
  customersAboveTarget = 0;
  readonly queueTargetSeconds = QUEUE_TARGET_SECONDS;

  kpiTiles: QueueKpiTile[] = [];

  Highcharts: typeof Highcharts = Highcharts;
  // Highcharts 13 defaults chart.backgroundColor to a CSS var this app never
  // defines, which resolves to solid black - so even these placeholder
  // pre-data options need an explicit transparent background, not just the
  // real ones built in buildCharts().
  private readonly emptyChartOptions: Highcharts.Options = { chart: { backgroundColor: 'transparent' } };
  trendChartOptions: Highcharts.Options = this.emptyChartOptions;
  targetChartOptions: Highcharts.Options = this.emptyChartOptions;
  demandChartOptions: Highcharts.Options = this.emptyChartOptions;
  ratioChartOptions: Highcharts.Options = this.emptyChartOptions;
  shareChartOptions: Highcharts.Options = this.emptyChartOptions;
  loadChartOptions: Highcharts.Options = this.emptyChartOptions;
  processingChartOptions: Highcharts.Options = this.emptyChartOptions;

  readonly calendarWeekdayLabels = CALENDAR_WEEKDAY_LABELS;
  // Independent from the filter-driven range above - this is its own month
  // browser (prev/today/next), like the main Calendar tab, with its own fetch.
  calendarMonth: Date = this.startOfMonth(new Date());
  calendarMonthLoading = false;
  calendarMonthError = '';
  calendarWeeks: QueueCalendarCell[][] = [];
  selectedCalendarDay: QueueDayRow | null = null;

  get calendarMonthLabel(): string {
    return this.calendarMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

  // Same View/Date Range/Hours filter shape as the Dashboard and Instore
  // Analytics tabs, so all three read as one consistent filter system.
  readonly views = ['Yesterday', 'Day', 'Week', 'Month', 'Year', 'Custom'];
  readonly hoursOptions = [
    { value: 1, label: 'Operational' },
    { value: 0, label: '24 Hours' }
  ];

  private queueWidget: Widget | null = null;
  private queueGroup: DashboardGroup | null = null;
  private rangeDays = DEFAULT_RANGE_DAYS;

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private widgetService: WidgetService,
    private kpiService: KpiService
  ) {
    this.filterForm = this.fb.group({
      scope: ['all'],
      view: ['Month'],
      date: [new Date()],
      customRange: this.fb.group({ start: [null], end: [null] }),
      operationalHours: [1]
    });
    this.metricsSummaryRows = this.buildMetricsSummaryRows();
  }

  get customRangeGroup(): FormGroup {
    return this.filterForm.get('customRange') as FormGroup;
  }

  get usesMonthPicker(): boolean {
    const view = this.filterForm.value.view;
    return view === 'Month' || view === 'Year';
  }

  // Only fires when the datepicker's startView is 'year' (Month/Year views)
  // and the user taps a month tile - Day/Week/Custom use the normal day
  // calendar instead, which closes itself once a day is picked. Same pattern
  // as the Dashboard and Instore Analytics tabs.
  onMonthSelected(date: Date, datepicker: MatDatepicker<Date>): void {
    this.filterForm.patchValue({ date });
    datepicker.close();
  }

  ngOnInit(): void {
    this.resolveWidget();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['dashboardId'] && !changes['dashboardId'].firstChange) {
      this.resolveWidget();
    }
  }

  apply(): void {
    this.fetch();
  }

  prevCalendarMonth(): void {
    this.calendarMonth = this.addMonths(this.calendarMonth, -1);
    this.fetchCalendarMonth();
  }

  nextCalendarMonth(): void {
    this.calendarMonth = this.addMonths(this.calendarMonth, 1);
    this.fetchCalendarMonth();
  }

  goToCalendarToday(): void {
    this.calendarMonth = this.startOfMonth(new Date());
    this.fetchCalendarMonth();
  }

  selectCalendarDay(cell: QueueCalendarCell): void {
    if (!cell.row) {
      return;
    }
    this.selectedCalendarDay = cell.row;
  }

  formatCount(value: number): string {
    return Math.round(value).toLocaleString('en-US');
  }

  formatDuration(totalSeconds: number): string {
    const s = Math.max(0, Math.round(totalSeconds));
    const hh = Math.floor(s / 3600);
    const mm = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    return `${hh.toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')}:${ss.toString().padStart(2, '0')}`;
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
        switchMap((dashboardId) => (dashboardId ? this.widgetService.getGroups(dashboardId) : of([] as DashboardGroup[]))),
        switchMap((groups) =>
          forkJoin({
            // Queue's widget isn't under a known group name/order - every
            // group's widget list is fetched here so it can be found by _id
            // regardless of which group actually holds it.
            groupWidgets: groups.length
              ? forkJoin(groups.map((g) => this.widgetService.getWidgets(g._id).pipe(map((widgets) => ({ group: g, widgets })))))
              : of([] as { group: DashboardGroup; widgets: Widget[] }[]),
            stores: this.widgetService.getStores()
          })
        )
      )
      .subscribe({
        next: ({ groupWidgets, stores }) => {
          const match = groupWidgets.find((gw) => gw.widgets.some((w) => w._id === QUEUE_WIDGET_ID));
          this.queueGroup = match?.group ?? null;
          this.queueWidget = match?.widgets.find((w) => w._id === QUEUE_WIDGET_ID) ?? null;

          const queueStoreIds = new Set(this.queueGroup?.stores ?? []);
          this.storeOptions = stores.filter((s: StoreListItem) => queueStoreIds.has(s._id)).map((s) => ({ value: s._id, label: s.storeName }));

          if (!this.queueWidget || !this.queueGroup) {
            this.loading = false;
            this.errorMessage = 'Queue widget not found on this dashboard.';
            return;
          }
          this.fetch();
          this.fetchCalendarMonth();
        },
        error: () => {
          this.loading = false;
          this.errorMessage = 'Unable to load queue data. Please check the API connection and try again.';
        }
      });
  }

  private fetch(): void {
    if (!this.queueWidget || !this.queueGroup) {
      return;
    }
    const widget = this.queueWidget;
    const group = this.queueGroup;

    const { date: rawDate, view, operationalHours } = this.filterForm.value;
    const date = view === 'Yesterday' ? this.yesterday() : rawDate;
    const { from, to } = this.getDateRange(view, this.stripTime(new Date(date)));
    this.rangeDays = this.diffDaysInclusive(from, to);

    const prevTo = this.addDays(from, -1);
    const prevFrom = this.addDays(prevTo, -(this.rangeDays - 1));

    const toRangeStrings = (s: Date, e: Date) => ({ from: `${this.formatDate(s)} 00:00:00`, to: `${this.formatDate(e)} 23:59:59` });
    const currentRange = toRangeStrings(from, to);
    const previousRange = toRangeStrings(prevFrom, prevTo);

    this.loading = true;
    this.errorMessage = '';

    forkJoin({
      current: this.kpiService.postKpiData(
        buildKpiDataPayload(widget, group, currentRange.from, currentRange.to, undefined, 'dayOfMonth', 'month', operationalHours)
      ),
      previous: this.kpiService
        .postKpiData(buildKpiDataPayload(widget, group, previousRange.from, previousRange.to, undefined, 'dayOfMonth', 'month', operationalHours))
        .pipe(catchError(() => of(null)))
    }).subscribe({
      next: ({ current, previous }) => {
        this.loading = false;
        this.buildFromResponses(current.data.dataFilter, previous?.data.dataFilter ?? [], from, to, prevFrom, prevTo);
      },
      error: () => {
        this.loading = false;
        this.errorMessage = 'Unable to load queue data. Please check the API connection and try again.';
      }
    });
  }

  // Mirrors the Day/Week/Month/Year/Custom range logic the Dashboard and
  // Instore Analytics tabs use, so the View filter behaves identically here.
  private getDateRange(view: string, date: Date): { from: Date; to: Date } {
    switch (view) {
      case 'Week': {
        const isoDay = (date.getDay() + 6) % 7; // Monday = 0 ... Sunday = 6
        const start = this.addDays(date, -isoDay);
        const end = this.addDays(start, 6);
        return { from: start, to: end };
      }
      case 'Month': {
        const start = new Date(date.getFullYear(), date.getMonth(), 1);
        const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
        return { from: start, to: end };
      }
      case 'Year': {
        const start = new Date(date.getFullYear(), 0, 1);
        const end = new Date(date.getFullYear(), 11, 31);
        return { from: start, to: end };
      }
      case 'Custom': {
        const { start, end } = this.filterForm.value.customRange ?? {};
        const from = start ? this.stripTime(new Date(start)) : date;
        const to = end ? this.stripTime(new Date(end)) : from;
        return { from, to };
      }
      // 'Yesterday' is resolved to yesterday's actual Date in fetch() before
      // it ever reaches here, so it rides the same single-day path as 'Day'.
      case 'Yesterday':
      case 'Day':
      default:
        return { from: date, to: date };
    }
  }

  private yesterday(): Date {
    const y = new Date();
    y.setDate(y.getDate() - 1);
    return y;
  }

  // Each of the 4 real KPIs comes back as its own dataFilter entry, labeled
  // "<store>::<kpi label>" - same "store::label" shape used elsewhere in
  // this app for per-store series (e.g. calendar-panel's Unique Footfall).
  // Labels are trimmed before comparing - the widget's own stored KPI config
  // has inconsistent trailing whitespace (e.g. "Average Wait Time " vs
  // "Average Service Time") depending on how it was set up in the builder.
  private metricByDate(filters: KpiDataFilterResult[], metricLabel: string): Map<string, number> {
    const byDate = new Map<string, number>();
    for (const filter of filters) {
      const label = (filter.label.split('::').pop() || filter.label).trim();
      if (label !== metricLabel) {
        continue;
      }
      for (const point of filter.data) {
        const key = point.dateFrom ? this.formatDate(new Date(point.dateFrom)) : this.ddmmyyyyToKey(point.date ?? '');
        if (!key) {
          continue;
        }
        byDate.set(key, (byDate.get(key) ?? 0) + (point.value ?? 0));
      }
    }
    return byDate;
  }

  private ddmmyyyyToKey(value: string): string {
    const [day, month, year] = value.split('-').map(Number);
    if (!day || !month || !year) {
      return '';
    }
    return this.formatDate(new Date(year, month - 1, day));
  }

  // Shared by fetch() (the filter-driven range) and fetchCalendarMonth() (an
  // independent month browser) - both just need "one QueueDayRow per day in
  // [from, to]" from a dataFilter response.
  private rowsFromFilters(filters: KpiDataFilterResult[], from: Date, to: Date): QueueDayRow[] {
    const queueLengthByDate = this.metricByDate(filters, QUEUE_LENGTH_LABEL);
    const queueTimeByDate = this.metricByDate(filters, QUEUE_TIME_LABEL);
    const serviceTimeByDate = this.metricByDate(filters, SERVICE_TIME_LABEL);
    const queueCountByDate = this.metricByDate(filters, QUEUE_COUNT_LABEL);

    const rows: QueueDayRow[] = [];
    for (const d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
      const key = this.formatDate(d);
      const queueTimeSec = queueTimeByDate.get(key) ?? 0;
      const serviceTimeSec = serviceTimeByDate.get(key) ?? 0;
      const processingTimeSec = queueTimeSec + serviceTimeSec;
      const queueCount = queueCountByDate.get(key) ?? 0;
      const varianceSec = queueTimeSec - QUEUE_TARGET_SECONDS;

      rows.push({
        dateKey: key,
        dateLabel: d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
        isoDate: this.formatDate(d),
        queueLength: queueLengthByDate.get(key) ?? 0,
        queueCount,
        queueTimeSec,
        serviceTimeSec,
        processingTimeSec,
        waitToServiceRatio: serviceTimeSec > 0 ? queueTimeSec / serviceTimeSec : 0,
        waitingSharePct: processingTimeSec > 0 ? (queueTimeSec / processingTimeSec) * 100 : 0,
        queueTargetVarianceSec: varianceSec,
        queueTargetVariancePct: QUEUE_TARGET_SECONDS > 0 ? (varianceSec / QUEUE_TARGET_SECONDS) * 100 : 0
      });
    }
    return rows;
  }

  private buildFromResponses(
    currentFilters: KpiDataFilterResult[],
    previousFilters: KpiDataFilterResult[],
    from: Date,
    to: Date,
    prevFrom: Date,
    prevTo: Date
  ): void {
    const rows = this.rowsFromFilters(currentFilters, from, to);
    this.dailyRows = rows;

    const prevQueueTimeByDate = this.metricByDate(previousFilters, QUEUE_TIME_LABEL);
    const prevServiceTimeByDate = this.metricByDate(previousFilters, SERVICE_TIME_LABEL);
    const prevQueueCountByDate = this.metricByDate(previousFilters, QUEUE_COUNT_LABEL);
    const prevDayKeys: string[] = [];
    for (const d = new Date(prevFrom); d <= prevTo; d.setDate(d.getDate() + 1)) {
      prevDayKeys.push(this.formatDate(d));
    }
    const prevQueueTimes = prevDayKeys.map((k) => prevQueueTimeByDate.get(k) ?? 0);
    const prevAvgQueueTimeSec = prevQueueTimes.length ? prevQueueTimes.reduce((s, v) => s + v, 0) / prevQueueTimes.length : 0;
    const prevQueueCountTotal = prevDayKeys.reduce((s, k) => s + (prevQueueCountByDate.get(k) ?? 0), 0);
    const prevServiceTimes = prevDayKeys.map((k) => prevServiceTimeByDate.get(k) ?? 0);
    const prevAvgServiceTimeSec = prevServiceTimes.length ? prevServiceTimes.reduce((s, v) => s + v, 0) / prevServiceTimes.length : 0;

    this.refreshSummary(prevAvgQueueTimeSec, prevQueueCountTotal, prevAvgServiceTimeSec);
    this.buildCharts();
  }

  private refreshSummary(prevAvgQueueTimeSec: number, prevQueueCountTotal: number, prevAvgServiceTimeSec: number): void {
    const rows = this.dailyRows;
    const n = rows.length || 1;

    this.avgQueueTimeSec = Math.round(rows.reduce((s, r) => s + r.queueTimeSec, 0) / n);
    this.totalQueueCount = rows.reduce((s, r) => s + r.queueCount, 0);
    this.avgServiceTimeSec = Math.round(rows.reduce((s, r) => s + r.serviceTimeSec, 0) / n);
    this.avgProcessingTimeSec = this.avgQueueTimeSec + this.avgServiceTimeSec;
    this.waitToServiceRatio = this.avgServiceTimeSec > 0 ? this.avgQueueTimeSec / this.avgServiceTimeSec : 0;
    this.waitingTimeSharePct = this.avgProcessingTimeSec > 0 ? (this.avgQueueTimeSec / this.avgProcessingTimeSec) * 100 : 0;

    // "Within target" is estimated by treating a whole day's queue count as
    // within/above target based on that day's own average queue time vs the
    // target - the API only returns daily averages, not individual customer
    // wait times, so exact SLA compliance can't be computed here (same
    // caveat the design itself calls out).
    const withinCount = rows.filter((r) => r.queueTimeSec <= QUEUE_TARGET_SECONDS).reduce((s, r) => s + r.queueCount, 0);
    const aboveCount = Math.max(0, this.totalQueueCount - withinCount);
    this.customersWithinTarget = withinCount;
    this.customersAboveTarget = aboveCount;
    this.pctWithinTarget = this.totalQueueCount > 0 ? Math.round((withinCount / this.totalQueueCount) * 1000) / 10 : 0;
    this.pctAboveTarget = this.totalQueueCount > 0 ? Math.round((aboveCount / this.totalQueueCount) * 1000) / 10 : 0;

    const prevProcessing = prevAvgQueueTimeSec + prevAvgServiceTimeSec;
    const prevRatio = prevAvgServiceTimeSec > 0 ? prevAvgQueueTimeSec / prevAvgServiceTimeSec : 0;
    const prevShare = prevProcessing > 0 ? (prevAvgQueueTimeSec / prevProcessing) * 100 : 0;
    const rangeLabel = `vs Prev ${this.rangeDays} Days`;

    this.kpiTiles = [
      this.toTile('Avg. Queue Time', 'schedule', this.formatDuration(this.avgQueueTimeSec), this.avgQueueTimeSec, prevAvgQueueTimeSec, true, rangeLabel),
      this.toTile('Queue Count', 'groups', this.formatCount(this.totalQueueCount), this.totalQueueCount, prevQueueCountTotal, null, rangeLabel),
      this.toTile(
        'Avg. Service Time',
        'support_agent',
        this.formatDuration(this.avgServiceTimeSec),
        this.avgServiceTimeSec,
        prevAvgServiceTimeSec,
        true,
        rangeLabel
      ),
      this.toTile(
        'Avg. Processing Time',
        'update',
        this.formatDuration(this.avgProcessingTimeSec),
        this.avgProcessingTimeSec,
        prevProcessing,
        true,
        rangeLabel
      ),
      {
        label: 'Queue Target (1.5 min)',
        icon: 'track_changes',
        valueLabel: `${this.pctWithinTarget}%`,
        deltaPct: null,
        deltaLabel: 'Within Target',
        colorClass: this.pctWithinTarget >= 90 ? 'good' : this.pctWithinTarget >= 75 ? 'neutral' : 'bad',
        sub: rangeLabel
      },
      this.toTile(
        'Wait-to-Service Ratio',
        'hub',
        `${this.waitToServiceRatio.toFixed(2)}x`,
        this.waitToServiceRatio,
        prevRatio,
        true,
        rangeLabel
      ),
      this.toTile(
        'Waiting Time Share',
        'pie_chart',
        `${this.waitingTimeSharePct.toFixed(1)}%`,
        this.waitingTimeSharePct,
        prevShare,
        true,
        rangeLabel
      )
    ];
  }

  // lowerIsBetter: null means the metric is purely informational (e.g. raw
  // Queue Count) and gets a neutral color regardless of direction.
  private toTile(
    label: string,
    icon: string,
    valueLabel: string,
    current: number,
    previous: number,
    lowerIsBetter: boolean | null,
    sub: string
  ): QueueKpiTile {
    const deltaPct = previous ? Math.round(((current - previous) / previous) * 1000) / 10 : null;
    let colorClass: 'good' | 'bad' | 'neutral' = 'neutral';
    if (deltaPct !== null && lowerIsBetter !== null) {
      const improved = lowerIsBetter ? deltaPct <= 0 : deltaPct >= 0;
      colorClass = improved ? 'good' : 'bad';
    }
    const deltaLabel = deltaPct === null ? sub : `${deltaPct >= 0 ? '+' : ''}${deltaPct}% ${sub}`;
    return { label, icon, valueLabel, deltaPct, deltaLabel, colorClass, sub };
  }

  private buildMetricsSummaryRows(): MetricsSummaryRow[] {
    return [
      { metric: 'Avg. Queue Time', formula: 'Σ Waiting Time / Queue Count', valueLabel: '', interpretation: 'Average time customers waited before service' },
      { metric: 'Avg. Service Time', formula: 'Σ Service Time / Service Observations', valueLabel: '', interpretation: 'Average time taken to serve a customer' },
      { metric: 'Avg. Processing Time', formula: 'Avg. Queue Time + Avg. Service Time', valueLabel: '', interpretation: 'Total time spent from waiting to service completion' },
      { metric: 'Wait-to-Service Ratio', formula: 'Avg. Queue Time / Avg. Service Time', valueLabel: '', interpretation: 'How many multiples of service time were spent waiting' },
      { metric: 'Waiting Time Share', formula: 'Avg. Queue Time / (Queue + Service) × 100', valueLabel: '', interpretation: 'Share of total time spent waiting' },
      { metric: 'Queue Target Variance', formula: 'Avg. Queue Time – Target (1.5 min)', valueLabel: '', interpretation: 'How far the average wait is from target, in seconds' },
      { metric: 'Queue Target Variance %', formula: '(Avg. Queue Time – Target) / Target × 100', valueLabel: '', interpretation: 'How far the average wait is from target, as a percentage' },
      { metric: 'Queue Demand Change %', formula: '(Current – Previous) / Previous × 100', valueLabel: '', interpretation: 'Change in queue demand vs previous period' },
      { metric: 'Queue Time Change %', formula: '(Current – Previous) / Previous × 100', valueLabel: '', interpretation: 'Improvement/regression in waiting time vs previous period' },
      { metric: 'Service Time Change %', formula: '(Current – Previous) / Previous × 100', valueLabel: '', interpretation: 'Improvement/regression in service efficiency vs previous period' }
    ];
  }

  private buildCharts(): void {
    const rows = this.dailyRows;
    const categories = rows.map((r) => r.dateLabel);
    const durationLabels = { formatter: (ctx: { value: number | string }) => this.formatDuration(Number(ctx.value)) };

    this.trendChartOptions = this.lineChart(categories, [
      { name: 'Avg. Queue Time', color: '#0f4c73', data: rows.map((r) => r.queueTimeSec) },
      { name: 'Avg. Service Time', color: '#2e9e6b', data: rows.map((r) => r.serviceTimeSec) }
    ], durationLabels, (v) => this.formatDuration(v));

    this.targetChartOptions = {
      ...this.barChart(categories, 'Avg. Queue Time', '#2a78d6', rows.map((r) => r.queueTimeSec), durationLabels, (v) => this.formatDuration(v)),
      series: [
        {
          type: 'column',
          name: 'Avg. Queue Time',
          color: '#2a78d6',
          data: rows.map((r) => r.queueTimeSec)
        },
        {
          type: 'line',
          name: 'Target (1.5 min)',
          color: '#e2431e',
          dashStyle: 'ShortDash',
          marker: { enabled: false },
          data: rows.map(() => QUEUE_TARGET_SECONDS)
        }
      ]
    };

    this.demandChartOptions = this.barChart(categories, 'Queue Count', '#2a78d6', rows.map((r) => r.queueCount));

    this.ratioChartOptions = this.lineChart(
      categories,
      [{ name: 'Wait-to-Service Ratio', color: '#8e44ad', data: rows.map((r) => Math.round(r.waitToServiceRatio * 100) / 100) }],
      { formatter: (ctx: { value: number | string }) => `${ctx.value}x` },
      (v) => `${v.toFixed(2)}x`
    );

    this.shareChartOptions = this.lineChart(
      categories,
      [{ name: 'Waiting Time Share', color: '#e3a73c', data: rows.map((r) => Math.round(r.waitingSharePct * 10) / 10) }],
      { formatter: (ctx: { value: number | string }) => `${ctx.value}%` },
      (v) => `${v.toFixed(1)}%`
    );

    this.loadChartOptions = this.barChart(
      categories,
      'Customer-Minutes',
      '#0f4c73',
      rows.map((r) => Math.round((r.queueCount * r.queueTimeSec) / 60))
    );

    this.processingChartOptions = this.lineChart(
      categories,
      [{ name: 'Avg. Processing Time', color: '#1fa38f', data: rows.map((r) => r.processingTimeSec) }],
      durationLabels,
      (v) => this.formatDuration(v)
    );

  }

  private lineChart(
    categories: string[],
    series: { name: string; color: string; data: number[] }[],
    yLabels: { formatter: (ctx: { value: number | string }) => string },
    tooltipFormat: (v: number) => string
  ): Highcharts.Options {
    return {
      chart: { type: 'spline', backgroundColor: 'transparent', height: 320 },
      title: { text: undefined },
      credits: { enabled: false },
      xAxis: { categories, labels: { style: { color: '#78909c', fontSize: '10px' } }, lineColor: '#e6eaec', tickColor: '#e6eaec' },
      yAxis: { title: { text: undefined }, gridLineColor: '#eef1f5', labels: { style: { color: '#78909c', fontSize: '10px' }, ...yLabels } },
      legend: { enabled: series.length > 1, itemStyle: { fontSize: '11px' } },
      tooltip: {
        shared: true,
        formatter(this: any): string {
          return `<b>${this.x}</b><br/>${this.points?.map((p: any) => `${p.series.name}: ${tooltipFormat(p.y)}`).join('<br/>') ?? tooltipFormat(this.y)}`;
        }
      },
      plotOptions: { spline: { marker: { enabled: true, radius: 3, symbol: 'circle', lineWidth: 0 }, lineWidth: 2.5 } },
      series: series.map((s) => ({ type: 'spline' as const, name: s.name, color: s.color, data: s.data }))
    };
  }

  private barChart(
    categories: string[],
    name: string,
    color: string,
    data: number[],
    yLabels?: { formatter: (ctx: { value: number | string }) => string },
    tooltipFormat?: (v: number) => string
  ): Highcharts.Options {
    return {
      chart: { type: 'column', backgroundColor: 'transparent', height: 320 },
      title: { text: undefined },
      credits: { enabled: false },
      xAxis: { categories, labels: { style: { color: '#78909c', fontSize: '10px' } }, lineColor: '#e6eaec', tickColor: '#e6eaec' },
      yAxis: {
        title: { text: undefined },
        gridLineColor: '#eef1f5',
        labels: { style: { color: '#78909c', fontSize: '10px' }, ...(yLabels ?? {}) }
      },
      legend: { enabled: false },
      tooltip: tooltipFormat
        ? {
            formatter(this: any): string {
              return `<b>${this.x}</b><br/>${name}: ${tooltipFormat(this.y)}`;
            }
          }
        : {},
      plotOptions: { column: { borderRadius: 3, pointPadding: 0.1, groupPadding: 0.12 } },
      series: [{ type: 'column', name, color, data }]
    };
  }

  // Independent month browser (like the main Calendar tab's prev/today/next)
  // - fetches the full selected calendar month's daily rows for this widget,
  // separate from the filter-driven range above, so browsing months doesn't
  // disturb the KPI tiles/charts/tables.
  private fetchCalendarMonth(): void {
    if (!this.queueWidget || !this.queueGroup) {
      return;
    }
    const widget = this.queueWidget;
    const group = this.queueGroup;
    const monthStart = this.calendarMonth;
    const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
    const from = `${this.formatDate(monthStart)} 00:00:00`;
    const to = `${this.formatDate(monthEnd)} 23:59:59`;

    this.calendarMonthLoading = true;
    this.calendarMonthError = '';

    this.kpiService.postKpiData(buildKpiDataPayload(widget, group, from, to, undefined, 'dayOfMonth', 'month')).subscribe({
      next: (res) => {
        this.calendarMonthLoading = false;
        const rows = this.rowsFromFilters(res.data.dataFilter, monthStart, monthEnd);
        this.buildCalendarWeeks(monthStart, monthEnd, rows);
      },
      error: () => {
        this.calendarMonthLoading = false;
        this.calendarMonthError = 'Unable to load calendar data. Please check the API connection and try again.';
      }
    });
  }

  // One cell per calendar day, padded to full Sun-Sat weeks before/after the
  // month so the grid aligns like a real calendar. Padding cells from the
  // adjacent month are marked out-of-month and never carry a row, even if a
  // date happens to collide with one already loaded for the current month.
  private buildCalendarWeeks(monthStart: Date, monthEnd: Date, rows: QueueDayRow[]): void {
    const rowByDate = new Map(rows.map((r) => [r.isoDate, r]));
    const gridStart = this.addDays(monthStart, -monthStart.getDay());
    const gridEnd = this.addDays(monthEnd, 6 - monthEnd.getDay());

    const max = Math.max(1, ...rows.map((r) => r.queueTimeSec));
    const cells: QueueCalendarCell[] = [];
    for (const d = new Date(gridStart); d <= gridEnd; d.setDate(d.getDate() + 1)) {
      const isoDate = this.formatDate(d);
      const inMonth = d.getMonth() === monthStart.getMonth();
      const row = inMonth ? rowByDate.get(isoDate) ?? null : null;
      const intensity = row ? Math.min(CALENDAR_INTENSITY_BUCKETS - 1, Math.floor((row.queueTimeSec / max) * CALENDAR_INTENSITY_BUCKETS)) : 0;
      cells.push({ isoDate, day: d.getDate(), inMonth, row, intensity });
    }

    const weeks: QueueCalendarCell[][] = [];
    for (let i = 0; i < cells.length; i += 7) {
      weeks.push(cells.slice(i, i + 7));
    }
    this.calendarWeeks = weeks;

    const todayIso = this.formatDate(this.stripTime(new Date()));
    this.selectedCalendarDay = rowByDate.get(todayIso) ?? rows[rows.length - 1] ?? null;
  }

  private startOfMonth(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }

  private addMonths(date: Date, months: number): Date {
    return new Date(date.getFullYear(), date.getMonth() + months, 1);
  }

  private stripTime(date: Date): Date {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  private addDays(date: Date, days: number): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
  }

  private diffDaysInclusive(from: Date, to: Date): number {
    return Math.max(1, Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)) + 1);
  }

  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
