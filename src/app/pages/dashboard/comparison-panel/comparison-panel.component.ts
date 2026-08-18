import { Component, EventEmitter, Input, OnChanges, OnInit, Output, SimpleChanges } from '@angular/core';
import { FormBuilder, FormGroup } from '@angular/forms';
import { Observable, catchError, finalize, forkJoin, map, of, switchMap } from 'rxjs';
import * as Highcharts from 'highcharts';
import { MatDatepicker } from '@angular/material/datepicker';
import { AuthService } from '../../../core/services/auth.service';
import { KpiService, buildKpiDataPayload, buildMultiStoreKpiPayload } from '../../../core/services/kpi.service';
import { WidgetService } from '../../../core/services/widget.service';
import { DashboardGroup, DashboardSummary, EventListItem, Widget } from '../../../core/models/widget.model';
import { KpiDataFilterResult } from '../../../core/models/kpi.model';
import { CampaignEvent } from '../../../core/models/dashboard.model';
import { StatTile } from '../../../core/models/instore-analytics.model';
import { environment } from '../../../../environments/environment';

const TOTAL_FOOTFALL_WIDGET_TITLE = 'Total Footfall';
const TREND_REPORT_WIDGET_TITLE = 'Trend Report';
const INSTORE_GROUP_NAME = 'Instore Analytics';
const POWER_HOUR_WIDGET_TITLE = 'Power Hour Footfall';
const ENTRANCE_CATEGORY_NAME = 'Entrance';
// Real widget confirmed live via GET /widget/list/{groupId} - a "Comparison"
// group holds a widgetType:"compareDate"/fetchDataFor:"table" widget titled
// "Periodic Analysis" whose compareDateConfig (date1 "Day" / date2 "Period to
// Date" / date3 "Year to Date", valueType.lastYear, tableAggregator
// total/average/weekday/weekend) matches this table's placeholder structure
// almost exactly. groupName isn't confirmed yet (the widget list only carries
// groupId) - "Comparison" is a best guess matching the tab's own name; see the
// console.warn fallback below if it doesn't match live.
const COMPARISON_GROUP_NAME = 'Comparison';
const PERIODIC_ANALYSIS_WIDGET_TITLE = 'Periodic Analysis';
const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface DailyPoint {
  date: Date;
  value: number;
}

interface ChartBucket {
  label: string;
  current: number;
  previous: number;
}

interface PeriodicGroupStat {
  traffic: number;
  trafficLy: number;
  variation: number;
  variationPct: number;
}

interface PeriodicAnalysisRow {
  date: string;
  day: string;
  dayNum: number;
  groups: PeriodicGroupStat[]; // [Day, Month to Date, Year to Date]
}

interface PeriodicAnalysisSummaryRow {
  label: string;
  groups: PeriodicGroupStat[];
}

@Component({
  selector: 'app-comparison-panel',
  templateUrl: './comparison-panel.component.html',
  styleUrl: './comparison-panel.component.scss'
})
export class ComparisonPanelComponent implements OnInit, OnChanges {
  @Input() dashboardId: string | null = null;
  @Input() dashboards: DashboardSummary[] = [];
  @Output() dashboardChange = new EventEmitter<string>();

  filterForm: FormGroup;
  loading = false;
  errorMessage = '';

  storeOptions: { value: string; label: string }[] = [];
  campaignsForPanel: CampaignEvent[] | null = null;
  campaignsRangeFrom: Date | null = null;
  campaignsRangeTo: Date | null = null;

  currentRangeLabel = '';
  previousRangeLabel = '';
  currentTotal = 0;
  previousTotal = 0;
  variationPct = 0;
  dailyAverage = 0;
  activeDaysCount = 0;

  busiestDay: StatTile = { value: '—', sub: 'No data' };
  peakHour: StatTile = { value: '—', sub: 'No data' };
  weekendAverage: StatTile = { value: '—', sub: 'No data' };
  weekdayAverage: StatTile = { value: '—', sub: 'No data' };

  Highcharts: typeof Highcharts = Highcharts;
  chartOptions: Highcharts.Options = {};

  readonly views = ['Yesterday', 'Day', 'Week', 'Month', 'Year', 'Custom'];
  readonly hoursOptions = [
    { value: 1, label: 'Operational' },
    { value: 0, label: '24 Hours' }
  ];
  readonly viewByOptions = ['Daily', 'Weekly', 'Monthly'];
  viewBy: 'Daily' | 'Weekly' | 'Monthly' = 'Daily';

  // Periodic Analysis is UI-only for now - the user hasn't confirmed the real
  // Periodic Analysis widget's POST /kpi/data response shape yet (see
  // fetchPeriodicAnalysisDiagnostic), so these stay placeholder numbers. Rows
  // span day 1 of the current month through today, rather than a handful of
  // fixed dates from the reference screenshot, so the table doesn't visibly
  // drift out of date as time passes.
  // TODO: replace with real API data once the response shape is confirmed.
  readonly periodicRows: PeriodicAnalysisRow[];
  readonly periodicSummaryRows: PeriodicAnalysisSummaryRow[];

  private footfallGroup: DashboardGroup | null = null;
  private instoreGroup: DashboardGroup | null = null;
  private comparisonGroup: DashboardGroup | null = null;
  private trendReportWidget: Widget | null = null;
  private powerHourWidget: Widget | null = null;
  private periodicAnalysisWidget: Widget | null = null;
  private entranceStoreIds: string[] = [];
  private campaignEvents: EventListItem[] = [];
  private currentSeries: DailyPoint[] = [];
  private previousSeries: DailyPoint[] = [];

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private widgetService: WidgetService,
    private kpiService: KpiService
  ) {
    this.filterForm = this.fb.group({
      store: ['all'],
      view: ['Month'],
      date: [new Date()],
      operationalHours: [1]
    });

    this.periodicRows = this.buildPlaceholderPeriodicRows();
    this.periodicSummaryRows = this.buildPlaceholderSummaryRows(this.periodicRows);
  }

  // Deterministic (not Math.random()) so the placeholder numbers stay stable
  // across re-renders/screenshots rather than jittering. Day and Month-to-Date
  // are kept equal per row, matching the reference screenshot's own
  // convention; Year-to-Date grows across rows the same way the reference's
  // did (see PERIODIC_ANALYSIS_WIDGET_TITLE comment for why this isn't wired
  // to the real widget yet).
  private buildPlaceholderPeriodicRows(): PeriodicAnalysisRow[] {
    const today = new Date();
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const dayCount = today.getDate();
    const monthsElapsed = today.getMonth() + 1;

    const rows: PeriodicAnalysisRow[] = [];

    for (let dayNum = 1; dayNum <= dayCount; dayNum++) {
      const date = new Date(monthStart.getFullYear(), monthStart.getMonth(), dayNum);
      const isWeekend = date.getDay() === 0 || date.getDay() === 6;

      const dayTraffic = Math.round(2200 + 500 * Math.sin(dayNum * 1.7) + (isWeekend ? 700 : 0));
      const dayTrafficLy = Math.round(dayTraffic * (0.82 + 0.25 * Math.cos(dayNum * 0.9)));
      const day = this.toGroupStat(dayTraffic, dayTrafficLy);

      const ytdTraffic = Math.round((dayTraffic * dayNum + dayTraffic * 45) * monthsElapsed);
      const ytdTrafficLy = Math.round(ytdTraffic * 0.34);
      const ytd = this.toGroupStat(ytdTraffic, ytdTrafficLy);

      rows.push({
        date: date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
        day: date.toLocaleDateString('en-US', { weekday: 'short' }),
        dayNum,
        groups: [day, day, ytd]
      });
    }

    return rows;
  }

  private buildPlaceholderSummaryRows(rows: PeriodicAnalysisRow[]): PeriodicAnalysisSummaryRow[] {
    if (!rows.length) {
      return [];
    }

    const dayGroups = rows.map((r) => r.groups[0]);
    const weekendDays = ['Sat', 'Sun'];
    const weekdayGroups = rows.filter((r) => !weekendDays.includes(r.day)).map((r) => r.groups[0]);
    const weekendGroups = rows.filter((r) => weekendDays.includes(r.day)).map((r) => r.groups[0]);

    const total = this.sumGroupStats(dayGroups);
    const average = this.averageGroupStat(total, dayGroups.length);
    const weekdayTotal = this.sumGroupStats(weekdayGroups);
    const weekendTotal = this.sumGroupStats(weekendGroups);
    const ytdLast = rows[rows.length - 1].groups[2];

    return [
      { label: 'Total', groups: [total, total, ytdLast] },
      { label: 'Average', groups: [average, average, ytdLast] },
      { label: 'Weekday', groups: [weekdayTotal, weekdayTotal, weekdayTotal] },
      { label: 'Weekend', groups: [weekendTotal, weekendTotal, weekendTotal] }
    ];
  }

  private toGroupStat(traffic: number, trafficLy: number): PeriodicGroupStat {
    const variation = traffic - trafficLy;
    const variationPct = trafficLy > 0 ? Math.round((variation / trafficLy) * 100) : 0;
    return { traffic, trafficLy, variation, variationPct };
  }

  private sumGroupStats(stats: PeriodicGroupStat[]): PeriodicGroupStat {
    const traffic = stats.reduce((sum, s) => sum + s.traffic, 0);
    const trafficLy = stats.reduce((sum, s) => sum + s.trafficLy, 0);
    return this.toGroupStat(traffic, trafficLy);
  }

  private averageGroupStat(total: PeriodicGroupStat, count: number): PeriodicGroupStat {
    if (count === 0) {
      return total;
    }
    return this.toGroupStat(Math.round(total.traffic / count), Math.round(total.trafficLy / count));
  }

  ngOnInit(): void {
    this.resolveWidgets();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['dashboardId'] && !changes['dashboardId'].firstChange) {
      this.resolveWidgets();
    }
  }

  apply(): void {
    this.fetch();
  }

  onViewByChange(value: 'Daily' | 'Weekly' | 'Monthly'): void {
    this.viewBy = value;
    this.buildChart();
  }

  // Only fires when the datepicker's startView is 'year' (Month/Year views
  // below) and the user taps a month tile - same pattern as instore-analytics.
  onMonthSelected(date: Date, datepicker: MatDatepicker<Date>): void {
    this.filterForm.patchValue({ date });
    datepicker.close();
  }

  get usesMonthPicker(): boolean {
    const view = this.filterForm.value.view;
    return view === 'Month' || view === 'Year';
  }

  private resolveWidgets(): void {
    const defaultDashboardId = this.authService.currentUser?.defaultDashboard;
    const dashboardId$ = this.dashboardId
      ? of(this.dashboardId)
      : defaultDashboardId
      ? of(defaultDashboardId)
      : this.widgetService.getDashboards().pipe(map((dashboards) => dashboards[0]?._id));

    dashboardId$
      .pipe(
        switchMap((dashboardId) => (dashboardId ? this.widgetService.getGroups(dashboardId) : of([] as DashboardGroup[]))),
        switchMap((groups) => {
          const footfallGroup = [...groups].sort((a, b) => a.order - b.order)[0] ?? null;
          const instoreGroup = groups.find((g) => g.groupName.trim() === INSTORE_GROUP_NAME) ?? null;
          const comparisonGroup = groups.find((g) => g.groupName.trim() === COMPARISON_GROUP_NAME) ?? null;
          this.footfallGroup = footfallGroup;
          this.instoreGroup = instoreGroup;
          this.comparisonGroup = comparisonGroup;
          if (!comparisonGroup) {
            console.warn(
              `[ComparisonPanel] No group named "${COMPARISON_GROUP_NAME}" found - the Periodic Analysis diagnostic fetch will stay disabled.`,
              'Available groups:', groups.map((g) => g.groupName)
            );
          }
          return forkJoin({
            footfallWidgets: footfallGroup ? this.widgetService.getWidgets(footfallGroup._id) : of([] as Widget[]),
            instoreWidgets: instoreGroup ? this.widgetService.getWidgets(instoreGroup._id) : of([] as Widget[]),
            comparisonWidgets: comparisonGroup ? this.widgetService.getWidgets(comparisonGroup._id) : of([] as Widget[]),
            stores: this.widgetService.getStores(),
            events: this.widgetService.getEvents()
          });
        })
      )
      .subscribe({
        next: ({ footfallWidgets, instoreWidgets, comparisonWidgets, stores, events }) => {
          this.trendReportWidget = footfallWidgets.find((w) => w.title.trim() === TREND_REPORT_WIDGET_TITLE) ?? null;
          this.powerHourWidget = instoreWidgets.find((w) => w.title.trim() === POWER_HOUR_WIDGET_TITLE) ?? null;
          this.periodicAnalysisWidget = comparisonWidgets.find((w) => w.title.trim() === PERIODIC_ANALYSIS_WIDGET_TITLE) ?? null;
          if (this.comparisonGroup && !this.periodicAnalysisWidget) {
            console.warn(
              `[ComparisonPanel] No widget titled "${PERIODIC_ANALYSIS_WIDGET_TITLE}" found in group "${COMPARISON_GROUP_NAME}".`,
              'Available widgets:', comparisonWidgets.map((w) => w.title)
            );
          }

          const parentStoreId = this.footfallGroup?.stores[0];
          this.entranceStoreIds = parentStoreId
            ? stores.filter((s) => s.categoryName === ENTRANCE_CATEGORY_NAME && s.parentId.includes(parentStoreId)).map((s) => s._id)
            : [];

          const scopedStoreIds = new Set(this.footfallGroup?.stores ?? []);
          this.storeOptions = stores.filter((s) => scopedStoreIds.has(s._id)).map((s) => ({ value: s._id, label: s.storeName }));

          this.campaignEvents = events;
          this.refreshActiveCampaigns();

          this.fetch();
        },
        error: () => {
          this.storeOptions = [];
          this.campaignEvents = [];
          this.campaignsForPanel = null;
          this.errorMessage = 'Unable to load comparison data. Please check the API connection and try again.';
        }
      });
  }

  // "Active Campaigns" has no dedicated widget/endpoint - same real Event-list
  // approach the Dashboard/Instore Analytics tabs use, scoped to this group's
  // own stores. Date-range scoping (e.g. only this year's campaigns when View
  // is "Year") happens in the shared app-active-campaigns-panel via
  // campaignsRangeFrom/campaignsRangeTo (set in fetch()) - this just scopes
  // by store.
  private refreshActiveCampaigns(): void {
    const storeIds = new Set(this.footfallGroup?.stores ?? []);

    this.campaignsForPanel = this.campaignEvents
      .filter((e) => e.storeId.some((id) => storeIds.has(id)))
      .map((e) => ({
        id: e._id,
        name: e.eventName,
        from: e.from,
        to: e.to,
        budget: e.budget,
        target: e.target,
        storeNames: e.stores?.map((s) => s.storeName) ?? []
      }));
  }

  // Same View->range mapping as dashboard.component.ts's getDateRange - kept
  // local to this component rather than shared, matching this codebase's
  // existing convention of each panel owning its own date-range logic.
  private getDateRange(view: string, date: Date): { from: Date; to: Date } {
    switch (view) {
      case 'Week': {
        const start = new Date(date);
        const isoDay = (start.getDay() + 6) % 7;
        start.setDate(start.getDate() - isoDay);
        const end = new Date(start);
        end.setDate(end.getDate() + 6);
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
        return { from: start ?? date, to: end ?? start ?? date };
      }
      // 'Yesterday' is resolved to yesterday's actual Date in fetch() before
      // it ever reaches here, so it rides the same single-day path as 'Day'.
      case 'Yesterday':
      case 'Day':
      default:
        return { from: date, to: date };
    }
  }

  // Same "previous equivalent period" logic as dashboard.component.ts's
  // getPreviousDateRange.
  private getPreviousDateRange(view: string, date: Date): { from: Date; to: Date } {
    switch (view) {
      case 'Week': {
        const { from } = this.getDateRange('Week', date);
        const prevEnd = new Date(from);
        prevEnd.setDate(prevEnd.getDate() - 1);
        const prevStart = new Date(prevEnd);
        prevStart.setDate(prevStart.getDate() - 6);
        return { from: prevStart, to: prevEnd };
      }
      case 'Month': {
        const prevMonthAnchor = new Date(date.getFullYear(), date.getMonth() - 1, 1);
        return this.getDateRange('Month', prevMonthAnchor);
      }
      case 'Year': {
        const prevYearAnchor = new Date(date.getFullYear() - 1, 0, 1);
        return this.getDateRange('Year', prevYearAnchor);
      }
      case 'Custom': {
        const { from, to } = this.getDateRange('Custom', date);
        const lengthMs = to.getTime() - from.getTime();
        const prevTo = new Date(from.getTime() - 24 * 60 * 60 * 1000);
        const prevFrom = new Date(prevTo.getTime() - lengthMs);
        return { from: prevFrom, to: prevTo };
      }
      case 'Yesterday':
      case 'Day':
      default: {
        const prev = new Date(date);
        prev.setDate(prev.getDate() - 1);
        return { from: prev, to: prev };
      }
    }
  }

  private yesterday(): Date {
    const y = new Date();
    y.setDate(y.getDate() - 1);
    return y;
  }

  private fetch(): void {
    const { date: rawDate, view, store, operationalHours } = this.filterForm.value;
    const d = view === 'Yesterday' ? this.yesterday() : typeof rawDate === 'string' ? new Date(rawDate) : rawDate;
    const { from, to } = this.getDateRange(view, d);
    const { from: prevFrom, to: prevTo } = this.getPreviousDateRange(view, d);
    this.campaignsRangeFrom = from;
    this.campaignsRangeTo = to;

    this.currentRangeLabel = this.formatRangeLabel(from, to);
    this.previousRangeLabel = this.formatRangeLabel(prevFrom, prevTo);

    if (!this.trendReportWidget || !this.footfallGroup || !this.entranceStoreIds.length) {
      this.currentSeries = [];
      this.previousSeries = [];
      this.refreshDerivedStats();
      this.buildChart();
      return;
    }

    const storeIds = store !== 'all' ? [store] : this.entranceStoreIds;

    this.loading = true;
    this.errorMessage = '';

    forkJoin({
      current: this.fetchDailySeries(storeIds, from, to, operationalHours),
      previous: this.fetchDailySeries(storeIds, prevFrom, prevTo, operationalHours)
    })
      .pipe(finalize(() => (this.loading = false)))
      .subscribe({
        next: ({ current, previous }) => {
          this.currentSeries = current;
          this.previousSeries = previous;
          this.refreshDerivedStats();
          this.buildChart();
        },
        error: () => {
          this.currentSeries = [];
          this.previousSeries = [];
          this.errorMessage = 'Unable to load comparison data. Please check the API connection and try again.';
          this.refreshDerivedStats();
          this.buildChart();
        }
      });

    this.fetchPeakHour(from, to, store, operationalHours);
    this.fetchPeriodicAnalysisDiagnostic(d, operationalHours);
  }

  // TEMP DIAGNOSTIC - the real "Periodic Analysis" widget (compareDateConfig:
  // Day/Period to Date/Year to Date, vs Last Year, Total/Average/Weekday/
  // Weekend aggregators) was confirmed live via GET /widget/list, but its
  // actual POST /kpi/data response shape for a widgetType:"compareDate" +
  // fetchDataFor:"table" widget hasn't been seen yet - none of this app's
  // existing widget types return that shape. Logs the raw response so the
  // real parsing/rendering can be written from actual data instead of
  // guessed; the table itself keeps rendering its static placeholder rows
  // until that shape is confirmed. Remove this once toPeriodicAnalysis() is
  // implemented from a real response.
  private fetchPeriodicAnalysisDiagnostic(date: Date, operationalHours: number): void {
    if (!this.periodicAnalysisWidget || !this.comparisonGroup) {
      return;
    }

    const fromStr = `${this.formatDate(date)} 00:00:00`;
    const toStr = `${this.formatDate(date)} 23:59:59`;
    const payload = buildKpiDataPayload(this.periodicAnalysisWidget, this.comparisonGroup, fromStr, toStr, undefined, undefined, undefined, operationalHours);

    this.kpiService.postKpiData(payload).subscribe({
      next: (res) => {
        if (!environment.production) {
          console.log('[ComparisonPanel] TEMP DIAGNOSTIC - raw Periodic Analysis response:', JSON.stringify(res, null, 2));
        }
      },
      error: (err) => {
        if (!environment.production) {
          console.warn('[ComparisonPanel] TEMP DIAGNOSTIC - Periodic Analysis request failed:', err);
        }
      }
    });
  }

  // Same real "Trend Report" widget dashboard.component.ts's fetchTrafficTrend
  // already validated live (per-entrance Total Footfall, summed across
  // entranceStoreIds) - fetched here for an arbitrary from/to window instead
  // of only the currently selected View's range, so both the current and
  // previous comparison windows can reuse the exact same proven call.
  private fetchDailySeries(storeIds: string[], from: Date, to: Date, operationalHours: number): Observable<DailyPoint[]> {
    const fromStr = `${this.formatDate(from)} 00:00:00`;
    const toStr = `${this.formatDate(to)} 23:59:59`;
    const payload = buildMultiStoreKpiPayload(
      this.trendReportWidget!,
      this.footfallGroup!,
      storeIds,
      fromStr,
      toStr,
      'dayOfMonth',
      'month',
      operationalHours
    );

    return this.kpiService.postKpiData(payload).pipe(
      map((res) => this.toDailySeries(res.data.dataFilter, from, to)),
      catchError(() => of(this.emptyDailySeries(from, to)))
    );
  }

  // Response has one line series per entrance store per KPI - only "Total
  // Footfall" is kept here (Passer By/Unique Footfall aren't part of this
  // tab's single "Traffic" metric). Walks every calendar day in range so a
  // day with no data still shows as a real 0 instead of being skipped.
  private toDailySeries(filters: KpiDataFilterResult[], from: Date, to: Date): DailyPoint[] {
    const byDate = new Map<string, number>();

    for (const filter of filters) {
      const label = filter.label.split('::').pop() || filter.label;
      if (label !== TOTAL_FOOTFALL_WIDGET_TITLE) {
        continue;
      }
      for (const point of filter.data) {
        const key = point.dateFrom ? this.formatDate(new Date(point.dateFrom)) : '';
        if (key) {
          byDate.set(key, (byDate.get(key) ?? 0) + point.value);
        }
      }
    }

    return this.walkDays(from, to).map((date) => ({ date, value: byDate.get(this.formatDate(date)) ?? 0 }));
  }

  private emptyDailySeries(from: Date, to: Date): DailyPoint[] {
    return this.walkDays(from, to).map((date) => ({ date, value: 0 }));
  }

  private walkDays(from: Date, to: Date): Date[] {
    const days: Date[] = [];
    for (const d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
      days.push(new Date(d));
    }
    return days;
  }

  private refreshDerivedStats(): void {
    this.currentTotal = this.currentSeries.reduce((sum, p) => sum + p.value, 0);
    this.previousTotal = this.previousSeries.reduce((sum, p) => sum + p.value, 0);
    this.variationPct = this.previousTotal > 0 ? Math.round(((this.currentTotal - this.previousTotal) / this.previousTotal) * 100) : 0;
    this.activeDaysCount = this.currentSeries.length;
    this.dailyAverage = this.activeDaysCount > 0 ? Math.round(this.currentTotal / this.activeDaysCount) : 0;

    if (this.currentSeries.length) {
      const busiest = this.currentSeries.reduce((a, b) => (b.value > a.value ? b : a));
      this.busiestDay = { value: busiest.value.toLocaleString('en-US'), sub: this.formatLongDate(busiest.date) };
    } else {
      this.busiestDay = { value: '—', sub: 'No data' };
    }

    const weekend = this.currentSeries.filter((p) => p.date.getDay() === 0 || p.date.getDay() === 6);
    const weekday = this.currentSeries.filter((p) => p.date.getDay() !== 0 && p.date.getDay() !== 6);

    this.weekendAverage = weekend.length
      ? { value: Math.round(weekend.reduce((sum, p) => sum + p.value, 0) / weekend.length), sub: 'Average traffic across weekend days' }
      : { value: '—', sub: 'No data' };

    this.weekdayAverage = weekday.length
      ? { value: Math.round(weekday.reduce((sum, p) => sum + p.value, 0) / weekday.length), sub: 'Average traffic across weekdays' }
      : { value: '—', sub: 'No data' };
  }

  // Reuses the same real Power Hour Footfall widget/group instore-analytics
  // uses for its own Peak Hour tile. Label granularity (weekday-only vs an
  // exact calendar date) follows exactly what that widget returns depending
  // on Operational/24-Hour mode - not fabricated beyond that.
  private fetchPeakHour(from: Date, to: Date, store: string, operationalHours: number): void {
    if (!this.powerHourWidget || !this.instoreGroup) {
      this.peakHour = { value: '—', sub: 'No data' };
      return;
    }

    const fromStr = `${this.formatDate(from)} 00:00:00`;
    const toStr = `${this.formatDate(to)} 23:59:59`;
    const storeIds = store !== 'all' ? [store] : undefined;
    const payload = buildKpiDataPayload(this.powerHourWidget, this.instoreGroup, fromStr, toStr, storeIds, undefined, undefined, operationalHours);

    this.kpiService.postKpiData(payload).subscribe({
      next: (res) => {
        this.peakHour = this.toPeakHourStat(res.data.dataFilter, operationalHours === 1);
      },
      error: () => {
        this.peakHour = { value: '—', sub: 'No data' };
      }
    });
  }

  // Same weekday+hour aggregation instore-analytics.component.ts's
  // toPeakHours() uses, simplified to just the single best slot.
  private toPeakHourStat(filters: KpiDataFilterResult[], byOperationalHours: boolean): StatTile {
    const points = filters[0]?.data ?? [];
    const totals = new Map<string, number>();

    for (const point of points) {
      let dayIdx: number;
      let hour: string;

      if (byOperationalHours) {
        const [dayStr, hourStr] = (point.date ?? '').split(' ');
        const isoDay = Number(dayStr);
        if (!isoDay || !hourStr) {
          continue;
        }
        dayIdx = isoDay % 7;
        hour = hourStr;
      } else {
        if (!point.dateFrom) {
          continue;
        }
        const d = new Date(point.dateFrom);
        dayIdx = d.getUTCDay();
        hour = `${d.getUTCHours().toString().padStart(2, '0')}:00`;
      }

      const key = `${dayIdx}-${hour}`;
      totals.set(key, (totals.get(key) ?? 0) + point.value);
    }

    if (!totals.size) {
      return { value: '—', sub: 'No data' };
    }

    let bestKey = '';
    let bestValue = -1;
    totals.forEach((value, key) => {
      if (value > bestValue) {
        bestValue = value;
        bestKey = key;
      }
    });

    const [dayIdxStr, hour] = bestKey.split('-');
    return {
      value: hour,
      sub: `${WEEKDAY_LABELS[Number(dayIdxStr)]} · ${bestValue.toLocaleString('en-US')} visitors`
    };
  }

  private buildChart(): void {
    const buckets = this.bucketSeries();

    this.chartOptions = {
      chart: { type: 'column', backgroundColor: 'transparent', height: 320 },
      title: { text: undefined },
      credits: { enabled: false },
      xAxis: {
        categories: buckets.map((b) => b.label),
        labels: { style: { color: '#78909c', fontSize: '10.5px' } },
        lineColor: '#e6eaec'
      },
      yAxis: {
        title: { text: undefined },
        gridLineColor: '#e6eaec',
        labels: { style: { color: '#78909c', fontSize: '11px' } }
      },
      legend: {
        enabled: true,
        align: 'center',
        verticalAlign: 'bottom',
        itemStyle: { color: '#546e7a', fontSize: '12px', fontWeight: '600' },
        symbolWidth: 10,
        symbolRadius: 5
      },
      tooltip: { shared: true },
      plotOptions: {
        column: {
          borderRadius: 3,
          groupPadding: 0.15,
          pointPadding: 0.05
        }
      },
      series: [
        { type: 'column', name: 'Current Range', color: '#0f4c73', data: buckets.map((b) => b.current) },
        { type: 'column', name: 'Previous Range', color: '#7fa8cc', data: buckets.map((b) => b.previous) }
      ]
    };
  }

  // Current/previous are always fetched as equal-length day series (see
  // getPreviousDateRange), so they're paired by index (day 1 of period vs day
  // 1 of the previous period) rather than by matching calendar date - matches
  // how the reference chart lines up two different calendar ranges side by
  // side. Weekly/Monthly just re-bucket the same two already-fetched series
  // client-side - no extra API calls.
  private bucketSeries(): ChartBucket[] {
    if (this.viewBy === 'Weekly') {
      return this.bucketByWeek();
    }
    if (this.viewBy === 'Monthly') {
      return this.bucketByMonth();
    }
    return this.currentSeries.map((p, i) => ({
      label: this.formatShortDate(p.date),
      current: p.value,
      previous: this.previousSeries[i]?.value ?? 0
    }));
  }

  private bucketByWeek(): ChartBucket[] {
    const buckets: ChartBucket[] = [];
    for (let i = 0; i < this.currentSeries.length; i += 7) {
      const currentChunk = this.currentSeries.slice(i, i + 7);
      const previousChunk = this.previousSeries.slice(i, i + 7);
      buckets.push({
        label: `Week ${buckets.length + 1}`,
        current: currentChunk.reduce((sum, p) => sum + p.value, 0),
        previous: previousChunk.reduce((sum, p) => sum + p.value, 0)
      });
    }
    return buckets;
  }

  private bucketByMonth(): ChartBucket[] {
    const buckets: ChartBucket[] = [];
    let i = 0;
    while (i < this.currentSeries.length) {
      const month = this.currentSeries[i].date.getMonth();
      let j = i;
      while (j < this.currentSeries.length && this.currentSeries[j].date.getMonth() === month) {
        j++;
      }
      const currentChunk = this.currentSeries.slice(i, j);
      const previousChunk = this.previousSeries.slice(i, j);
      buckets.push({
        label: this.currentSeries[i].date.toLocaleDateString('en-US', { month: 'short' }),
        current: currentChunk.reduce((sum, p) => sum + p.value, 0),
        previous: previousChunk.reduce((sum, p) => sum + p.value, 0)
      });
      i = j;
    }
    return buckets;
  }

  private formatRangeLabel(from: Date, to: Date): string {
    const fmt = (d: Date) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    return `${fmt(from)} to ${fmt(to)}`;
  }

  private formatShortDate(date: Date): string {
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  }

  private formatLongDate(date: Date): string {
    return date.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
  }

  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
