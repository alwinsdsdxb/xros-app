import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup } from '@angular/forms';
import { MatDatepicker } from '@angular/material/datepicker';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable, catchError, finalize, forkJoin, map, of, switchMap } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { KpiService, buildKpiDataPayload, buildMultiStoreKpiPayload } from '../../core/services/kpi.service';
import { WidgetService } from '../../core/services/widget.service';
import {
  AgeGroup,
  CampaignEvent,
  ComparisonPoint,
  Demographics,
  Dwell,
  DwellDistributionBucket,
  DwellStat,
  DwellTrendPoint,
  KpiMetric,
  Operations
} from '../../core/models/dashboard.model';
import { KpiDataFilterResult } from '../../core/models/kpi.model';
import { DashboardGroup, DashboardSummary, EventListItem, StoreListItem, Widget } from '../../core/models/widget.model';
import { TrafficTrendSeries } from './trend-chart/trend-chart.component';
import { FunnelStageData } from './flow-funnel-chart/flow-funnel-chart.component';

const TOTAL_FOOTFALL_WIDGET_TITLE = 'Total Footfall';
const UNIQUE_FOOTFALL_WIDGET_TITLE = 'Unique Footfall';
const GROUPS_WIDGET_TITLE = 'Groups';
const TREND_REPORT_WIDGET_TITLE = 'Trend Report';
const FUNNEL_WIDGET_TITLE = 'Funnel';
const AGE_DEMOGRAPHICS_WIDGET_TITLE = 'Age Demographics';
const DWELL_DISTRIBUTION_WIDGET_TITLE = 'Dwell Time by Time Slots';
const DEVICE_HEALTH_WIDGET_TITLE = 'Device Health';
const WEATHER_WIDGET_TITLE = 'Weather';
const DWELL_TREND_GROUP_NAME = 'My Reports';
const DWELL_TREND_WIDGET_TITLE = 'Average Dwell Time';
// Visitor Group Size (solo/2-person/3+) lives in the "My Reports" group as 3
// separate box widgets, confirmed live via kpi/data - real, non-zero values
// when queried against the mall store (footfallGroup.stores), same as Age
// Demographics/Funnel; querying "My Reports"'s own stores returns 0 (that
// group's stores are for a different report, not this tenant's mall).
const SOLO_VISITORS_WIDGET_TITLE = 'Solo Visitors';
const TWO_VISITORS_GROUP_WIDGET_TITLE = 'Two Visitors Group';
const MORE_THAN_TWO_VISITORS_WIDGET_TITLE = 'More than 2 Visitors';

// Engagement Composition reuses Dwell Time Distribution's real time-slot
// buckets (there's no separate widget for it) - this just relabels each
// bucket with what that dwell duration actually represents, rather than
// showing the raw minute ranges twice on the same panel.
const ENGAGEMENT_TIER_LABELS: Record<string, string> = {
  '0 - 5': 'Quick Visit',
  '6 - 15': 'Casual Visit',
  '16 - 30': 'Engaged Visit',
  '31 - 60': 'High Engagement',
  '>61': 'Long Visit'
};
// Traffic Trend's 3 real series, shown left-to-right in this fixed order
// regardless of the order the API happens to return them in, and colored to
// match this app's own palette rather than the widgets' own configured
// colors (which collide once Passer By is cloned from Total Footfall's
// dataFilter entry - see deriveTrendPasserByWidget).
const TREND_SERIES_ORDER = ['Passer By', 'Total Footfall', 'Unique Footfall'];
const TREND_SERIES_COLORS: Record<string, string> = {
  'Passer By': '#0f4c73',
  'Total Footfall': '#a7b62e',
  'Unique Footfall': '#e3a73c'
};
const MALE_WIDGET_TITLE = 'Male';
const FEMALE_WIDGET_TITLE = 'Female';
const ENTRANCE_CATEGORY_NAME = 'Entrance';

// No "Passer By" widget exists on this tenant's dashboards yet (checked live via
// GET /widget/list on every group). This kpiId is confirmed real, from
// GET /kpi/5f2bb437afaf896e91f8f093 ("Passerby", same KPI group as Total Footfall) —
// not guessed. The Passer By card reuses the Total Footfall widget's saved
// display config (countConfig/compareConfig/etc.) with this kpiId swapped in.
const PASSER_BY_KPI_ID = '5f2aa6a1b4bb55f79310edb2';

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss'
})
export class DashboardComponent implements OnInit {
  filterForm: FormGroup;
  loading = false;

  footfallMetric: KpiMetric | null = null;
  passerByMetric: KpiMetric | null = null;
  uniqueFootfallMetric: KpiMetric | null = null;
  groupsMetric: KpiMetric | null = null;
  trafficSeriesForChart: TrafficTrendSeries[] = [];
  funnelStages: FunnelStageData[] = [];
  private rawFunnelStages: FunnelStageData[] = [];
  ageGroups: AgeGroup[] = [];
  demographicsForPanel: Demographics | null = null;
  dwellForPanel: Dwell | null = null;
  campaignsForPanel: CampaignEvent[] | null = null;
  campaignsRangeFrom: Date | null = null;
  campaignsRangeTo: Date | null = null;
  operationsForPanel: Operations | null = null;

  private footfallWidget: Widget | null = null;
  private passerByWidget: Widget | null = null;
  private rawPasserByMetric: KpiMetric | null = null;
  private uniqueFootfallWidget: Widget | null = null;
  private groupsWidget: Widget | null = null;
  private trendReportWidget: Widget | null = null;
  private passerByTrendWidget: Widget | null = null;
  private funnelWidget: Widget | null = null;
  private ageDemographicsWidget: Widget | null = null;
  private dwellDistributionWidget: Widget | null = null;
  private deviceHealthWidget: Widget | null = null;
  private weatherWidget: Widget | null = null;
  private dwellTrendWidget: Widget | null = null;
  private dwellTrendGroup: DashboardGroup | null = null;
  private maleWidget: Widget | null = null;
  private femaleWidget: Widget | null = null;
  private maleCount = 0;
  private femaleCount = 0;
  private soloVisitorsWidget: Widget | null = null;
  private twoVisitorsGroupWidget: Widget | null = null;
  private moreThanTwoVisitorsWidget: Widget | null = null;
  private groupSizeCounts = { solo: 0, twoPerson: 0, threePlus: 0 };
  private entranceStoreIds: string[] = [];
  private footfallGroup: DashboardGroup | null = null;
  private dwellDistribution: { distribution: DwellDistributionBucket[]; engagementComposition: DwellDistributionBucket[] } | null = null;
  private dwellBucketStats: {
    visitorsInAnalysis: DwellStat;
    quickVisitPct: DwellStat;
    engagedVisitPct: DwellStat;
    longStayPct: DwellStat;
  } | null = null;
  private estimatedAvgDwellStat: DwellStat = { value: 0, previousDay: 0, changePct: 0 };
  private avgDwellTrend: DwellTrendPoint[] = [];
  private campaignEvents: EventListItem[] = [];
  private deviceHealth: { online: number; offline: number } | null = null;
  private weather: { temperatureC: number; location?: string; condition?: string } | null = null;

  scopes = [{ value: 'all', label: 'All stores' }];

  dashboards: DashboardSummary[] = [];
  currentDashboardId: string | null = null;

  readonly views = ['Yesterday', 'Day', 'Week', 'Month', 'Year', 'Custom'];

  readonly hoursOptions = [
    { value: 1, label: 'Operational' },
    { value: 0, label: '24 Hours' }
  ];

  activeTab: 'dashboard' | 'instore' | 'calendar' | 'forecast' | 'comparison' = 'dashboard';

  // Tabs the user has switched to at least once. Instore/Calendar/Forecast/Comparison
  // are mounted with *ngIf on first visit only and kept alive with [hidden] after
  // that, so their ngOnInit()/initial API calls never re-run on a later
  // revisit - only Apply refreshes their data (see selectTab()).
  readonly visitedTabs = new Set<'dashboard' | 'instore' | 'calendar' | 'forecast' | 'comparison'>(['dashboard']);

  readonly pageTabs = [
    { value: 'dashboard', label: 'Dashboard', enabled: true },
    { value: 'instore', label: 'Instore Analytics', enabled: true },
    { value: 'calendar', label: 'Calendar', enabled: true },
    { value: 'forecast', label: 'Forecast', enabled: true },
    { value: 'comparison', label: 'Comparison', enabled: true }
  ];

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private widgetService: WidgetService,
    private kpiService: KpiService,
    private route: ActivatedRoute,
    private router: Router
  ) {
    this.filterForm = this.fb.group({
      scope: ['all'],
      view: ['Month'],
      date: [new Date()],
      customRange: this.fb.group({ start: [null], end: [null] }),
      operationalHours: [1]
    });
  }

  get customRangeGroup(): FormGroup {
    return this.filterForm.get('customRange') as FormGroup;
  }

  get usesMonthPicker(): boolean {
    const view = this.filterForm.value.view;
    return view === 'Month' || view === 'Year';
  }

  // Only fires when the datepicker's startView is 'year' (Month/Year views
  // above) and the user taps a month tile - same pattern as instore-analytics.
  onMonthSelected(date: Date, datepicker: MatDatepicker<Date>): void {
    this.filterForm.patchValue({ date });
    datepicker.close();
  }

  ngOnInit(): void {
    this.widgetService.getDashboards().subscribe((dashboards) => (this.dashboards = dashboards));

    this.route.paramMap.subscribe((params) => {
      const routedDashboardId = params.get('dashboardId');
      if (routedDashboardId) {
        this.currentDashboardId = routedDashboardId;
        this.resolveWidgets();
        return;
      }

      this.resolveDefaultDashboardId().subscribe((dashboardId) => {
        if (dashboardId) {
          this.router.navigate(['/dashboard', dashboardId], { replaceUrl: true });
        }
      });
    });
  }

  onDashboardChange(dashboardId: string): void {
    this.router.navigate(['/dashboard', dashboardId]);
  }

  apply(): void {
    this.fetch();
  }

  private resolveDefaultDashboardId(): Observable<string | undefined> {
    const defaultDashboardId = this.authService.currentUser?.defaultDashboard;
    return defaultDashboardId ? of(defaultDashboardId) : this.widgetService.getDashboards().pipe(map((dashboards) => dashboards[0]?._id));
  }

  // Maps the View toggle (Day/Week/Month/Year/Custom) to the calendar range
  // that should actually be queried, since the KPI/funnel/demographics/dwell
  // widgets all take an explicit from/to range rather than inferring one from
  // a granularity keyword. Week starts Monday. Custom reads the two dates
  // picked in the customRange group, falling back to the selected day if
  // either end hasn't been picked yet (so an incomplete range never sends an
  // inverted/empty window to the API).
  private yesterday(): Date {
    const y = new Date();
    y.setDate(y.getDate() - 1);
    return y;
  }

  private getDateRange(view: string, date: Date): { from: Date; to: Date } {
    switch (view) {
      case 'Week': {
        const start = new Date(date);
        const isoDay = (start.getDay() + 6) % 7; // Monday = 0 ... Sunday = 6
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
      // 'Yesterday' isn't a distinct range shape - fetch() resolves it to
      // yesterday's actual Date before calling here, so it rides the same
      // single-day path as 'Day'.
      case 'Yesterday':
      case 'Day':
      default:
        return { from: date, to: date };
    }
  }

  // The comparison window for each view: the immediately preceding period of
  // the same length (previous week/month/year/custom-length window), matching
  // how the existing KPI box widgets already frame "Previous Week"/"Previous
  // Month"/"Previous Year" comparisons elsewhere in this app.
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

  selectTab(tab: { value: string; enabled: boolean }): void {
    if (!tab.enabled) {
      return;
    }
    this.activeTab = tab.value as 'dashboard' | 'instore' | 'calendar' | 'forecast' | 'comparison';
    this.visitedTabs.add(this.activeTab);

    // The Highcharts panels on these tabs (Power Hour Footfall, Zone
    // Correlation, Trend Chart, ...) now stay mounted behind [hidden] instead
    // of being destroyed - see visitedTabs above. A chart never told to
    // reflow after its container goes from display:none back to visible can
    // redraw against a stale/mismatched layout (e.g. overlapping data labels
    // in a heatmap cell). Highcharts' own reflow is wired to the window
    // resize event, so firing one - once [hidden] has actually been applied
    // by Angular's change detection, hence the deferral - makes every
    // mounted chart recompute its layout against its real, now-visible size.
    setTimeout(() => window.dispatchEvent(new Event('resize')));
  }

  private resolveWidgets(): void {
    const dashboardId$ = this.currentDashboardId ? of(this.currentDashboardId) : this.resolveDefaultDashboardId();

    dashboardId$
      .pipe(
        switchMap((dashboardId) => (dashboardId ? this.widgetService.getGroups(dashboardId) : of([]))),
        switchMap((groups) => {
          const group = [...groups].sort((a, b) => a.order - b.order)[0] ?? null;
          this.footfallGroup = group;
          const dwellTrendGroup = groups.find((g) => g.groupName.trim() === DWELL_TREND_GROUP_NAME) ?? null;
          this.dwellTrendGroup = dwellTrendGroup;
          if (!group) {
            return of({
              widgets: [] as Widget[],
              stores: [] as StoreListItem[],
              dwellTrendWidgets: [] as Widget[],
              events: [] as EventListItem[],
              allGroupWidgets: [] as { groupName: string; widgets: Widget[] }[]
            });
          }
          return forkJoin({
            widgets: this.widgetService.getWidgets(group._id),
            stores: this.widgetService.getStores(),
            dwellTrendWidgets: dwellTrendGroup ? this.widgetService.getWidgets(dwellTrendGroup._id) : of([] as Widget[]),
            events: this.widgetService.getEvents()
          });
        })
      )
      .subscribe({
        next: ({ widgets, stores, dwellTrendWidgets, events }) => {
          this.footfallWidget = widgets.find((w) => w.title === TOTAL_FOOTFALL_WIDGET_TITLE) ?? null;
          this.uniqueFootfallWidget = widgets.find((w) => w.title === UNIQUE_FOOTFALL_WIDGET_TITLE) ?? null;
          this.groupsWidget = widgets.find((w) => w.title === GROUPS_WIDGET_TITLE) ?? null;
          this.trendReportWidget = widgets.find((w) => w.title.trim() === TREND_REPORT_WIDGET_TITLE) ?? null;
          this.funnelWidget = widgets.find((w) => w.title === FUNNEL_WIDGET_TITLE) ?? null;
          this.ageDemographicsWidget = widgets.find((w) => w.title === AGE_DEMOGRAPHICS_WIDGET_TITLE) ?? null;
          this.dwellDistributionWidget = widgets.find((w) => w.title.trim() === DWELL_DISTRIBUTION_WIDGET_TITLE) ?? null;
          this.deviceHealthWidget = widgets.find((w) => w.title.trim() === DEVICE_HEALTH_WIDGET_TITLE) ?? null;
          this.weatherWidget = widgets.find((w) => w.title.trim() === WEATHER_WIDGET_TITLE) ?? null;
          this.dwellTrendWidget =
            dwellTrendWidgets.find((w) => w.title.trim() === DWELL_TREND_WIDGET_TITLE && w.fetchDataFor === 'bar') ?? null;
          this.maleWidget = widgets.find((w) => w.title === MALE_WIDGET_TITLE) ?? null;
          this.femaleWidget = widgets.find((w) => w.title === FEMALE_WIDGET_TITLE) ?? null;
          this.soloVisitorsWidget =
            dwellTrendWidgets.find((w) => w.title.trim() === SOLO_VISITORS_WIDGET_TITLE && w.fetchDataFor === 'box') ?? null;
          this.twoVisitorsGroupWidget =
            dwellTrendWidgets.find((w) => w.title.trim() === TWO_VISITORS_GROUP_WIDGET_TITLE && w.fetchDataFor === 'box') ?? null;
          this.moreThanTwoVisitorsWidget =
            dwellTrendWidgets.find((w) => w.title.trim() === MORE_THAN_TWO_VISITORS_WIDGET_TITLE && w.fetchDataFor === 'box') ?? null;
          this.passerByWidget = this.deriveWidget(this.footfallWidget, 'Passer By', PASSER_BY_KPI_ID);
          this.passerByTrendWidget = this.deriveTrendPasserByWidget(this.trendReportWidget);

          const parentStoreId = this.footfallGroup?.stores[0];
          this.entranceStoreIds = parentStoreId
            ? stores.filter((s) => s.categoryName === ENTRANCE_CATEGORY_NAME && s.parentId.includes(parentStoreId)).map((s) => s._id)
            : [];

          this.campaignEvents = events;
          this.refreshActiveCampaigns();

          if (this.footfallGroup) {
            this.filterForm.patchValue({ operationalHours: this.footfallGroup.showDataByOperationalHours }, { emitEvent: false });
          }

          this.fetch();
        },
        error: () => {
          this.footfallMetric = null;
          this.passerByMetric = null;
          this.rawPasserByMetric = null;
          this.uniqueFootfallMetric = null;
          this.groupsMetric = null;
          this.trafficSeriesForChart = [];
          this.funnelStages = [];
          this.ageGroups = [];
          this.maleCount = 0;
          this.femaleCount = 0;
          this.groupSizeCounts = { solo: 0, twoPerson: 0, threePlus: 0 };
          this.refreshDemographicsForPanel();
          this.dwellDistribution = null;
          this.dwellBucketStats = null;
          this.estimatedAvgDwellStat = { value: 0, previousDay: 0, changePct: 0 };
          this.avgDwellTrend = [];
          this.dwellForPanel = null;
          this.campaignEvents = [];
          this.campaignsForPanel = null;
          this.deviceHealth = null;
          this.weather = null;
          this.operationsForPanel = null;
        }
      });
  }

  // "Active Campaigns" has no dedicated widget/endpoint on this backend - real
  // marketing campaigns are stored as Event documents (GET /event/list), scoped
  // to the same store(s) as this dashboard's own group. Date-range scoping
  // (e.g. only this year's campaigns when View is "Year") happens in the
  // shared app-active-campaigns-panel via campaignsRangeFrom/campaignsRangeTo
  // (set in fetch()) - this just scopes by store and hands over every event.
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

  // Passer By (outside_innum + outside_outnum from the storefront counting
  // sensor) and Total Footfall (the store's own door-count sensor) count two
  // different populations - people who passed the storefront and people who
  // walked in - so the real traffic-near-the-store figure is their sum, not
  // either sensor alone. This also naturally covers stores with no Passer By
  // sensor installed/synced yet: the sum just reduces to Total Footfall when
  // the raw Passer By metric is null or all-zero.
  private refreshPasserByMetric(): void {
    this.passerByMetric = this.sumMetrics(this.rawPasserByMetric, this.footfallMetric);
  }

  private sumMetrics(a: KpiMetric | null, b: KpiMetric | null): KpiMetric | null {
    if (!a && !b) {
      return null;
    }
    const prevSum = (key: 'previousDay' | 'previousWeek' | 'previousMonth' | 'previousYear'): number =>
      (a?.[key]?.value ?? 0) + (b?.[key]?.value ?? 0);
    const value = (a?.value ?? 0) + (b?.value ?? 0);
    return {
      value,
      previousDay: this.toComparisonPoint(value, prevSum('previousDay')),
      previousWeek: this.toComparisonPoint(value, prevSum('previousWeek')),
      previousMonth: this.toComparisonPoint(value, prevSum('previousMonth')),
      previousYear: this.toComparisonPoint(value, prevSum('previousYear'))
    };
  }

  private deriveWidget(source: Widget | null, title: string, kpiId: string): Widget | null {
    if (!source) {
      return null;
    }
    return {
      ...source,
      title,
      dataFilter: source.dataFilter.map((filter) => ({ ...filter, kpiId, label: title }))
    };
  }

  // 'Yesterday' is a quick-view, not a date the user actually picked - it
  // always means "the day before today" regardless of whatever's left in the
  // (hidden) date field, so it's resolved to a real Date here, once, before
  // any of the range helpers below (which only know single-day/week/month/
  // year/custom shapes) ever see it.
  private fetch(): void {
    const { date: rawDate, view, operationalHours } = this.filterForm.value;
    const date = view === 'Yesterday' ? this.yesterday() : rawDate;
    const { from, to } = this.getDateRange(view, date);
    this.campaignsRangeFrom = from;
    this.campaignsRangeTo = to;
    const fromStr = this.formatDate(from);
    const toStr = this.formatDate(to);
    const { from: prevFrom, to: prevTo } = this.getPreviousDateRange(view, date);
    const prevFromStr = this.formatDate(prevFrom);
    const prevToStr = this.formatDate(prevTo);

    const selectedDate = typeof date === 'string' ? new Date(date) : date;
    this.fetchKpi(this.footfallWidget, fromStr, toStr, selectedDate, operationalHours, (metric) => {
      this.footfallMetric = metric;
      this.refreshPasserByMetric();
      this.refreshFunnelStages();
    });
    this.fetchKpi(this.passerByWidget, fromStr, toStr, selectedDate, operationalHours, (metric) => {
      this.rawPasserByMetric = metric;
      this.refreshPasserByMetric();
      this.refreshFunnelStages();
    });
    this.fetchKpi(this.uniqueFootfallWidget, fromStr, toStr, selectedDate, operationalHours, (metric) => {
      this.uniqueFootfallMetric = metric;
      this.refreshFunnelStages();
    });
    this.fetchKpi(this.groupsWidget, fromStr, toStr, selectedDate, operationalHours, (metric) => {
      this.groupsMetric = metric;
      this.refreshFunnelStages();
    });
    this.fetchTrafficTrend(view, date, operationalHours);
    this.fetchFunnel(fromStr, toStr, operationalHours);
    this.fetchAgeGroups(fromStr, toStr, operationalHours);
    this.fetchDwellDistribution(fromStr, toStr, prevFromStr, prevToStr, operationalHours);
    this.fetchAvgDwellTrend(view, date);
    this.fetchGenderSplit(fromStr, toStr, operationalHours);
    this.fetchGroupSize(fromStr, toStr, operationalHours);
    this.fetchDeviceHealth(fromStr, toStr, operationalHours);
    this.fetchWeather(fromStr, toStr, operationalHours);
  }

  // The widget's own compareConfig never actually returns "Previous
  // Day"/"Previous Week"/etc rangeLabel box entries on this tenant (confirmed
  // live - a single request's box filters come back with nothing beyond the
  // current selected range). So each comparison period is fetched as its own
  // independent request against the same widget/store scope - the same
  // "query it again for the other window" pattern already used for
  // "Dwell Time by Time Slots" (fetchDwellDistribution), which has the same
  // no-compareConfig problem. Previous Day/Week/Month/Year are always
  // relative to the selected date itself (not to the currently selected
  // view's range), so the KPI card can show all four regardless of which
  // view is active.
  private fetchKpi(
    widget: Widget | null,
    fromStr: string,
    toStr: string,
    date: Date,
    operationalHours: number,
    assign: (metric: KpiMetric | null) => void
  ): void {
    if (!widget || !this.footfallGroup) {
      return;
    }

    this.loading = true;
    const previousDay = this.getPreviousDateRange('Day', date);
    const previousWeek = this.getPreviousDateRange('Week', date);
    const previousMonth = this.getPreviousDateRange('Month', date);
    const previousYear = this.getPreviousDateRange('Year', date);

    forkJoin({
      current: this.fetchKpiCurrentValue(widget, fromStr, toStr, operationalHours),
      previousDay: this.fetchKpiCurrentValue(widget, this.formatDate(previousDay.from), this.formatDate(previousDay.to), operationalHours),
      previousWeek: this.fetchKpiCurrentValue(
        widget,
        this.formatDate(previousWeek.from),
        this.formatDate(previousWeek.to),
        operationalHours
      ),
      previousMonth: this.fetchKpiCurrentValue(
        widget,
        this.formatDate(previousMonth.from),
        this.formatDate(previousMonth.to),
        operationalHours
      ),
      previousYear: this.fetchKpiCurrentValue(
        widget,
        this.formatDate(previousYear.from),
        this.formatDate(previousYear.to),
        operationalHours
      )
    })
      .pipe(finalize(() => (this.loading = false)))
      .subscribe({
        next: ({ current, previousDay: prevDay, previousWeek: prevWeek, previousMonth: prevMonth, previousYear: prevYear }) => {
          assign({
            value: current,
            previousDay: this.toComparisonPoint(current, prevDay),
            previousWeek: this.toComparisonPoint(current, prevWeek),
            previousMonth: this.toComparisonPoint(current, prevMonth),
            previousYear: this.toComparisonPoint(current, prevYear)
          });
        },
        error: () => assign(null)
      });
  }

  // Extracts just the current period's aggregate value from a box-type KPI
  // request - the one number that has always been correct (only the
  // compareConfig-driven "Previous X" boxes are unreliable), reused here to
  // independently query every other comparison window.
  private fetchKpiCurrentValue(widget: Widget, fromStr: string, toStr: string, operationalHours: number): Observable<number> {
    const from = `${fromStr} 00:00:00`;
    const to = `${toStr} 23:59:59`;
    const payload = buildKpiDataPayload(widget, this.footfallGroup!, from, to, undefined, undefined, undefined, operationalHours);

    return this.kpiService.postKpiData(payload).pipe(
      map((res) => res.data.dataFilter.filter((f) => f.fetchDataFor === 'box').find((f) => f.selected)?.data?.[0]?.value ?? 0),
      catchError(() => of(0))
    );
  }

  private toComparisonPoint(current: number, previous: number): ComparisonPoint {
    const changePct = previous > 0 ? Math.round(((current - previous) / previous) * 100) : 0;
    return { value: previous, changePct };
  }

  // "Trend Report" only has Total Footfall/Unique Footfall dataFilter entries.
  // Passer By is derived the same way as its KPI card (deriveWidget) - cloning
  // Total Footfall's own entry with the real Passer By kpiId swapped in - so
  // the chart's 3rd line is real data, not fabricated. Kept to a single
  // cloned entry (not all of trendReportWidget's entries) since deriveWidget
  // would otherwise turn Unique Footfall into a second Passer By line too.
  private deriveTrendPasserByWidget(trendReportWidget: Widget | null): Widget | null {
    const totalFootfallFilter = trendReportWidget?.dataFilter.find((f) => f.label === TOTAL_FOOTFALL_WIDGET_TITLE);
    if (!trendReportWidget || !totalFootfallFilter) {
      return null;
    }
    return {
      ...trendReportWidget,
      title: 'Passer By',
      dataFilter: [{ ...totalFootfallFilter, kpiId: PASSER_BY_KPI_ID, label: 'Passer By' }]
    };
  }

  // One point per day (same pattern as Average Dwell Trend) across whatever
  // range the View filter resolves to - a single Day has no trend of its own,
  // so that case shows its containing month for context instead. timeFrame/
  // dateByFilter stay pinned to the proven-working "dayOfMonth"/"month" pair
  // regardless of the requested range's length - there's no local backend to
  // verify a "week"/"year" granularity value against (the real API is the
  // hosted xpandanalytics.com service), so Week/Custom just narrow this same
  // daily-resolution query to their own from/to window, and Year widens it to
  // the full year and re-buckets the resulting ~365 daily points into 12
  // monthly sums client-side (toYearlyTrendSeries) rather than guessing a
  // "month"/"year" pair the backend has never been confirmed to accept.
  // Pinning the pair also sidesteps the group's own groupByTimeFrame/
  // dateByFilter fields, which are shared tenant-wide state that another
  // session's filter change can silently rewrite (see the comment on
  // fetchAvgDwellTrend) - pairing a wide range with the wrong granularity
  // silently returns the wrong shape instead of a visible line.
  // Total Footfall/Unique Footfall stay entrance-scoped and summed (real
  // distinct per-entrance door sensors, verified earlier); Passer By is
  // queried at the mall level only, matching its own KPI card.
  private fetchTrafficTrend(view: string, date: Date | string, operationalHours: number): void {
    if (!this.trendReportWidget || !this.footfallGroup || !this.entranceStoreIds.length) {
      this.trafficSeriesForChart = [];
      return;
    }

    const d = typeof date === 'string' ? new Date(date) : date;
    const rangeView = view === 'Day' || view === 'Yesterday' ? 'Month' : view;
    const { from: rangeStart, to: rangeEnd } = this.getDateRange(rangeView, d);
    const from = `${this.formatDate(rangeStart)} 00:00:00`;
    const to = `${this.formatDate(rangeEnd)} 23:59:59`;

    const footfallPayload = buildMultiStoreKpiPayload(
      this.trendReportWidget,
      this.footfallGroup,
      this.entranceStoreIds,
      from,
      to,
      'dayOfMonth',
      'month',
      operationalHours
    );
    const passerBy$ = this.passerByTrendWidget
      ? this.kpiService.postKpiData(
          buildKpiDataPayload(this.passerByTrendWidget, this.footfallGroup, from, to, undefined, 'dayOfMonth', 'month', operationalHours)
        )
      : of(null);

    forkJoin({
      footfall: this.kpiService.postKpiData(footfallPayload),
      passerBy: passerBy$
    }).subscribe({
      next: ({ footfall, passerBy }) => {
        const byLabel = this.sumByCalendarDay(footfall.data.dataFilter.filter((f) => f.fetchDataFor === 'line'));
        if (passerBy) {
          for (const [label, series] of this.sumByCalendarDay(passerBy.data.dataFilter)) {
            byLabel.set(label, series);
          }
        }
        this.applyPasserByTrendFallback(byLabel);
        this.trafficSeriesForChart =
          rangeView === 'Year'
            ? this.toYearlyTrendSeries(byLabel, rangeStart, rangeEnd)
            : this.toMonthlyTrendSeries(byLabel, rangeStart, rangeEnd);
      },
      error: () => (this.trafficSeriesForChart = [])
    });
  }

  // Response has one line series per entrance store per KPI (e.g. "Lifestyle
  // Entrance::Unique Footfall"), each broken down into one point per day. Sum
  // across entrances per calendar day so the chart shows one combined
  // day-by-day line per KPI instead of one per entrance.
  private sumByCalendarDay(filters: KpiDataFilterResult[]): Map<string, { color: string; byDate: Map<string, number> }> {
    const byLabel = new Map<string, { color: string; byDate: Map<string, number> }>();

    for (const filter of filters) {
      const label = filter.label.split('::').pop() || filter.label;
      if (!byLabel.has(label)) {
        byLabel.set(label, { color: filter.color ?? '#2a78d6', byDate: new Map() });
      }
      const bucket = byLabel.get(label)!;
      for (const point of filter.data) {
        const key = point.dateFrom ? this.formatDate(point.dateFrom) : '';
        if (key) {
          bucket.byDate.set(key, (bucket.byDate.get(key) ?? 0) + point.value);
        }
      }
    }

    return byLabel;
  }

  // Same "no Passer By data -> show Total Footfall instead" rule as the
  // Passer By KPI card (refreshPasserByMetric): this tenant's Passer By
  // sensor is genuinely empty every day, which would otherwise draw a dead
  // flat line at 0 instead of a real trend.
  private applyPasserByTrendFallback(byLabel: Map<string, { color: string; byDate: Map<string, number> }>): void {
    const passerBy = byLabel.get('Passer By');
    const totalFootfall = byLabel.get(TOTAL_FOOTFALL_WIDGET_TITLE);
    const hasPasserByData = passerBy ? Array.from(passerBy.byDate.values()).some((value) => value > 0) : false;
    if (!hasPasserByData && totalFootfall) {
      byLabel.set('Passer By', { color: passerBy?.color ?? totalFootfall.color, byDate: new Map(totalFootfall.byDate) });
    }
  }

  // Walks every calendar day in the month (not just days with data) so days
  // with no data yet still show up on the axis as 0, matching Average Dwell
  // Trend/Calendar/Power Hour. Series are emitted in a fixed order/color
  // regardless of which order the two API responses happened to resolve in.
  private toMonthlyTrendSeries(
    byLabel: Map<string, { color: string; byDate: Map<string, number> }>,
    monthStart: Date,
    monthEnd: Date
  ): TrafficTrendSeries[] {
    return TREND_SERIES_ORDER.filter((label) => byLabel.has(label)).map((label) => {
      const { color, byDate } = byLabel.get(label)!;
      const points: { time: string; value: number }[] = [];
      for (const d = new Date(monthStart); d <= monthEnd; d.setDate(d.getDate() + 1)) {
        points.push({ time: this.formatShortDate(d), value: byDate.get(this.formatDate(d)) ?? 0 });
      }
      return { label, color: TREND_SERIES_COLORS[label] ?? color, points };
    });
  }

  // Year view still fetches at the same proven daily resolution as
  // toMonthlyTrendSeries (see fetchTrafficTrend) - a year of ~365 daily points
  // would be unreadable as a line chart anyway, so each month's days are
  // summed into a single point here rather than requesting a coarser
  // granularity from the API.
  private toYearlyTrendSeries(
    byLabel: Map<string, { color: string; byDate: Map<string, number> }>,
    yearStart: Date,
    yearEnd: Date
  ): TrafficTrendSeries[] {
    return TREND_SERIES_ORDER.filter((label) => byLabel.has(label)).map((label) => {
      const { color, byDate } = byLabel.get(label)!;
      const points: { time: string; value: number }[] = [];
      for (let month = yearStart.getMonth(); month <= yearEnd.getMonth(); month++) {
        const monthStart = new Date(yearStart.getFullYear(), month, 1);
        const monthEnd = new Date(yearStart.getFullYear(), month + 1, 0);
        let sum = 0;
        for (const d = new Date(monthStart); d <= monthEnd; d.setDate(d.getDate() + 1)) {
          sum += byDate.get(this.formatDate(d)) ?? 0;
        }
        points.push({ time: monthStart.toLocaleDateString('en-GB', { month: 'short' }), value: sum });
      }
      return { label, color: TREND_SERIES_COLORS[label] ?? color, points };
    });
  }

  // Queried against the mall-level store (footfallGroup's own default), not
  // entranceStoreIds - verified live that entrance scoping breaks this
  // widget: "Adult" and "Long Dwell Visitors" come back empty/zero per
  // entrance (those KPIs aren't tracked at the entrance level at all), and
  // "Traffic" (= Total Footfall) sums to a materially different, smaller
  // number across just the 4 tracked entrances than the real mall-wide
  // Total Footfall figure shown on its own KPI card. The mall-level store
  // matches the real Total Footfall value and returns real data for every
  // stage.
  private fetchFunnel(fromStr: string, toStr: string, operationalHours: number): void {
    if (!this.funnelWidget || !this.footfallGroup) {
      this.rawFunnelStages = [];
      this.refreshFunnelStages();
      return;
    }

    const from = `${fromStr} 00:00:00`;
    const to = `${toStr} 23:59:59`;
    const payload = buildKpiDataPayload(
      this.funnelWidget,
      this.footfallGroup,
      from,
      to,
      undefined,
      undefined,
      undefined,
      operationalHours
    );

    this.kpiService.postKpiData(payload).subscribe({
      next: (res) => {
        this.rawFunnelStages = this.toFunnelStages(res.data.dataFilter);
        this.refreshFunnelStages();
      },
      error: () => {
        this.rawFunnelStages = [];
        this.refreshFunnelStages();
      }
    });
  }

  // color is intentionally omitted here - the funnel chart assigns its own
  // fixed 6-stage palette by position rather than trusting this widget's own
  // per-filter color config (see flow-funnel-chart.component.ts).
  private toFunnelStages(filters: KpiDataFilterResult[]): FunnelStageData[] {
    return filters.map((filter) => ({
      label: filter.label.split('::').pop() || filter.label,
      value: filter.data?.[0]?.value ?? 0
    }));
  }

  // Passer By reuses the same cumulative Passer By + Total Footfall metric as
  // its own KPI card (see refreshPasserByMetric) rather than the Funnel
  // widget's own "Passer By" stage, so the top of the funnel is never smaller
  // than Total Traffic below it. Total Traffic/Unique Visitors reuse the
  // Total Footfall/Unique Footfall KPI cards' own values instead of the
  // Funnel widget's own "Total Traffic"/"Unique Visitors" stages, which
  // don't match those real numbers. Potential Buyers reuses the "Groups"
  // KPI card's value (one potential buyer per visitor group). Sales
  // Conversion and Loyalty Transactions have no correct data source on this
  // tenant yet and stay at 0 until one exists.
  private refreshFunnelStages(): void {
    this.funnelStages = [
      { label: 'Passer By', value: this.passerByMetric?.value ?? 0 },
      { label: 'Total Traffic', value: this.footfallMetric?.value ?? 0 },
      { label: 'Unique Visitors', value: this.uniqueFootfallMetric?.value ?? 0 },
      { label: 'Potential Buyers', value: this.groupsMetric?.value ?? 0 },
      { label: 'Sales Conversion', value: 0 },
      { label: 'Loyalty Transactions', value: 0 }
    ];
  }

  // Unlike Total Footfall/Trend Report (real distinct per-entrance door
  // sensors, correctly summed across entranceStoreIds), Age Demographics is
  // captured by a single mall-wide camera/KPI - querying it per entrance and
  // summing the results was quadruple-counting the same mall-wide numbers
  // (verified live: querying this KPI group against any individual entrance
  // ID returns identical data to querying the mall-level store directly).
  // Queried against the mall-level store only, forcing timeFrame "day"
  // explicitly (rather than trusting footfallGroup's own mutable field,
  // which can be "hour") so the API returns one aggregated value per age
  // band for the whole selected day instead of an hourly breakdown.
  private fetchAgeGroups(fromStr: string, toStr: string, operationalHours: number): void {
    if (!this.ageDemographicsWidget || !this.footfallGroup) {
      this.ageGroups = [];
      this.refreshDemographicsForPanel();
      return;
    }

    const from = `${fromStr} 00:00:00`;
    const to = `${toStr} 23:59:59`;
    const payload = buildKpiDataPayload(
      this.ageDemographicsWidget,
      this.footfallGroup,
      from,
      to,
      undefined,
      'day',
      undefined,
      operationalHours
    );

    this.kpiService.postKpiData(payload).subscribe({
      next: (res) => {
        this.ageGroups = this.toAgeGroups(res.data.dataFilter);
        this.refreshDemographicsForPanel();
      },
      error: () => {
        this.ageGroups = [];
        this.refreshDemographicsForPanel();
      }
    });
  }

  private toAgeGroups(filters: KpiDataFilterResult[]): AgeGroup[] {
    const totals = new Map<string, number>();

    for (const filter of filters) {
      const label = filter.label.split('::').pop() || filter.label;
      const value = filter.data?.[0]?.value ?? 0;
      totals.set(label, (totals.get(label) ?? 0) + value);
    }

    const total = Array.from(totals.values()).reduce((sum, v) => sum + v, 0);

    return Array.from(totals.entries()).map(([label, value]) => ({
      label,
      value,
      pct: total > 0 ? Math.round((value / total) * 100) : 0
    }));
  }

  // Male and Female are two separate box widgets — fetch both and join them into
  // one gender-split view rather than showing them as unrelated numbers.
  private fetchGenderSplit(fromStr: string, toStr: string, operationalHours: number): void {
    this.fetchGenderCount(this.maleWidget, fromStr, toStr, operationalHours, (value) => {
      this.maleCount = value;
      this.refreshDemographicsForPanel();
    });
    this.fetchGenderCount(this.femaleWidget, fromStr, toStr, operationalHours, (value) => {
      this.femaleCount = value;
      this.refreshDemographicsForPanel();
    });
  }

  private fetchGenderCount(
    widget: Widget | null,
    fromStr: string,
    toStr: string,
    operationalHours: number,
    assign: (value: number) => void
  ): void {
    if (!widget || !this.footfallGroup) {
      assign(0);
      return;
    }

    const from = `${fromStr} 00:00:00`;
    const to = `${toStr} 23:59:59`;
    const payload = buildKpiDataPayload(widget, this.footfallGroup, from, to, undefined, undefined, undefined, operationalHours);

    this.kpiService.postKpiData(payload).subscribe({
      next: (res) => {
        const boxFilters = res.data.dataFilter.filter((f) => f.fetchDataFor === 'box');
        const current = boxFilters.find((f) => f.selected)?.data?.[0]?.value ?? 0;
        assign(current);
      },
      error: () => assign(0)
    });
  }

  // Solo/2-person/3+ are 3 separate box widgets living in the "My Reports"
  // group (not the main dashboard group), each queried the same way as
  // Male/Female - a single current-period box value, scoped to the mall
  // store (footfallGroup.stores) since this data is mall-wide, not
  // per-entrance (same class of KPI as Age Demographics/Funnel).
  private fetchGroupSize(fromStr: string, toStr: string, operationalHours: number): void {
    forkJoin({
      solo: this.fetchGroupSizeCount(this.soloVisitorsWidget, fromStr, toStr, operationalHours),
      twoPerson: this.fetchGroupSizeCount(this.twoVisitorsGroupWidget, fromStr, toStr, operationalHours),
      threePlus: this.fetchGroupSizeCount(this.moreThanTwoVisitorsWidget, fromStr, toStr, operationalHours)
    }).subscribe(({ solo, twoPerson, threePlus }) => {
      this.groupSizeCounts = { solo, twoPerson, threePlus };
      this.refreshDemographicsForPanel();
    });
  }

  // These widgets' own dataFilter entries are saved with fetchDataFor: '' -
  // unlike Male/Female/Groups (saved as 'box') - so filtering the response by
  // fetchDataFor === 'box' first (like fetchGenderCount does) would always
  // come back empty. The "selected: true" current-period entry is present
  // either way, so read that directly (confirmed live via kpi/data).
  private fetchGroupSizeCount(widget: Widget | null, fromStr: string, toStr: string, operationalHours: number): Observable<number> {
    if (!widget || !this.dwellTrendGroup || !this.footfallGroup) {
      return of(0);
    }

    const from = `${fromStr} 00:00:00`;
    const to = `${toStr} 23:59:59`;
    const payload = buildKpiDataPayload(widget, this.dwellTrendGroup, from, to, this.footfallGroup.stores, undefined, undefined, operationalHours);

    return this.kpiService.postKpiData(payload).pipe(
      map((res) => res.data.dataFilter.find((f) => f.selected)?.data?.[0]?.value ?? 0),
      catchError(() => of(0))
    );
  }

  private refreshDemographicsForPanel(): void {
    const total = this.maleCount + this.femaleCount;
    const { solo, twoPerson, threePlus } = this.groupSizeCounts;
    const groupTotal = solo + twoPerson + threePlus;
    this.demographicsForPanel = {
      totalVisitors: total,
      gender: {
        male: this.maleCount,
        malePct: total > 0 ? Math.round((this.maleCount / total) * 100) : 0,
        female: this.femaleCount,
        femalePct: total > 0 ? Math.round((this.femaleCount / total) * 100) : 0
      },
      ageGroups: this.ageGroups,
      groupSize: {
        solo: { value: solo, pct: groupTotal > 0 ? Math.round((solo / groupTotal) * 100) : 0 },
        twoPerson: { value: twoPerson, pct: groupTotal > 0 ? Math.round((twoPerson / groupTotal) * 100) : 0 },
        threePlus: { value: threePlus, pct: groupTotal > 0 ? Math.round((threePlus / groupTotal) * 100) : 0 }
      }
    };
  }

  // "Dwell Time by Time Slots" has no compareConfig, so a single request
  // never returns a "Previous Day" series the way box-style KPI cards do.
  // Fetched twice - once for the selected period, once for the immediately
  // preceding period of the same length (getPreviousDateRange) - so Visitors
  // in Analysis / Quick Visit % / Engaged Visit % / Long Stay % can show a
  // real period-over-period change instead of a fabricated one. This was a
  // fixed "today vs yesterday" comparison before Week/Month/Year/Custom
  // support existed; "yesterday" only ever made sense for the Day view.
  private fetchDwellDistribution(fromStr: string, toStr: string, prevFromStr: string, prevToStr: string, operationalHours: number): void {
    if (!this.dwellDistributionWidget || !this.footfallGroup) {
      this.dwellDistribution = null;
      this.dwellBucketStats = null;
      this.refreshDwellForPanel();
      return;
    }

    forkJoin({
      current: this.fetchHistogramBuckets(this.dwellDistributionWidget, this.footfallGroup, fromStr, toStr, operationalHours),
      previous: this.fetchHistogramBuckets(this.dwellDistributionWidget, this.footfallGroup, prevFromStr, prevToStr, operationalHours)
    }).subscribe(({ current, previous }) => {
      // Engagement Composition has no separate real widget, so it reuses these
      // same time-slot buckets (only non-zero ones, since a 0-visitor slice is
      // meaningless on a pie), relabeled per ENGAGEMENT_TIER_LABELS.
      const engagementComposition = current
        .filter((b) => b.value > 0)
        .map((b) => ({ label: ENGAGEMENT_TIER_LABELS[b.label] ?? b.label, value: b.value }));
      this.dwellDistribution = { distribution: current, engagementComposition };
      this.dwellBucketStats = this.toDwellBucketStats(current, previous);
      this.refreshDwellForPanel();
    });
  }

  private fetchHistogramBuckets(
    widget: Widget,
    group: DashboardGroup,
    fromStr: string,
    toStr: string,
    operationalHours: number
  ): Observable<DwellDistributionBucket[]> {
    const from = `${fromStr} 00:00:00`;
    const to = `${toStr} 23:59:59`;
    const payload = buildKpiDataPayload(widget, group, from, to, undefined, undefined, undefined, operationalHours);

    return this.kpiService.postKpiData(payload).pipe(
      map((res) => (res.data.dataFilter[0]?.data ?? []).map((point) => ({ label: point.date ?? '', value: point.value }))),
      catchError(() => of([] as DwellDistributionBucket[]))
    );
  }

  // Quick/Engaged/Long Stay are each one real bucket's share of the day's
  // total visitors; Visitors in Analysis is the sum of all 5 buckets. Same
  // shape for both the selected day and the day before, so toDwellStat can
  // turn each pair into a real value/previousDay/changePct.
  private toDwellBucketStats(
    today: DwellDistributionBucket[],
    yesterday: DwellDistributionBucket[]
  ): { visitorsInAnalysis: DwellStat; quickVisitPct: DwellStat; engagedVisitPct: DwellStat; longStayPct: DwellStat } {
    const summarize = (buckets: DwellDistributionBucket[]) => {
      const byLabel = new Map(buckets.map((b) => [b.label, b.value]));
      const total = buckets.reduce((sum, b) => sum + b.value, 0);
      const pct = (label: string) => (total > 0 ? Math.round(((byLabel.get(label) ?? 0) / total) * 100) : 0);
      return { total, quickPct: pct('0 - 5'), engagedPct: pct('16 - 30'), longPct: pct('>61') };
    };

    const current = summarize(today);
    const previous = summarize(yesterday);

    return {
      visitorsInAnalysis: this.toDwellStat(current.total, previous.total),
      quickVisitPct: this.toDwellStat(current.quickPct, previous.quickPct),
      engagedVisitPct: this.toDwellStat(current.engagedPct, previous.engagedPct),
      longStayPct: this.toDwellStat(current.longPct, previous.longPct)
    };
  }

  private toDwellStat(current: number, previous: number): DwellStat {
    const changePct = previous > 0 ? Math.round(((current - previous) / previous) * 100) : 0;
    return { value: current, previousDay: previous, changePct };
  }

  // "Device Health" (widgetType "donutDeviceStatus") returns a shape unlike
  // any other widget - one data point with `online`/`offline` counts instead
  // of the usual `value` - so it's parsed directly here rather than through
  // toKpiMetric.
  private fetchDeviceHealth(fromStr: string, toStr: string, operationalHours: number): void {
    if (!this.deviceHealthWidget || !this.footfallGroup) {
      this.deviceHealth = null;
      this.refreshOperationsForPanel();
      return;
    }

    const from = `${fromStr} 00:00:00`;
    const to = `${toStr} 23:59:59`;
    const payload = buildKpiDataPayload(
      this.deviceHealthWidget,
      this.footfallGroup,
      from,
      to,
      undefined,
      undefined,
      undefined,
      operationalHours
    );

    this.kpiService.postKpiData(payload).subscribe({
      next: (res) => {
        const point = res.data.dataFilter[0]?.data?.[0];
        this.deviceHealth = { online: point?.online ?? 0, offline: point?.offline ?? 0 };
        this.refreshOperationsForPanel();
      },
      error: () => {
        this.deviceHealth = null;
        this.refreshOperationsForPanel();
      }
    });
  }

  // "Weather" is a normal box/comparison widget - the "Today" box is the
  // current temperature. There's no separate feels-like value in the
  // response, so that field is dropped rather than faked. Store name and
  // condition ("Partly Cloudy") aren't separate fields either, but both are
  // genuinely present in the response already - the store name is embedded
  // in the box label ("<account>::<store>::<range>::Weather"), and the icon
  // slug (e.g. "partly-cloudy-day") maps directly to a condition string -
  // so both are derived from real response data, not invented.
  private fetchWeather(fromStr: string, toStr: string, operationalHours: number): void {
    if (!this.weatherWidget || !this.footfallGroup) {
      this.weather = null;
      this.refreshOperationsForPanel();
      return;
    }

    const from = `${fromStr} 00:00:00`;
    const to = `${toStr} 23:59:59`;
    const payload = buildKpiDataPayload(
      this.weatherWidget,
      this.footfallGroup,
      from,
      to,
      undefined,
      undefined,
      undefined,
      operationalHours
    );

    this.kpiService.postKpiData(payload).subscribe({
      next: (res) => {
        this.weather = this.toWeather(res.data.dataFilter);
        this.refreshOperationsForPanel();
      },
      error: () => {
        this.weather = null;
        this.refreshOperationsForPanel();
      }
    });
  }

  private toWeather(filters: KpiDataFilterResult[]): { temperatureC: number; location?: string; condition?: string } | null {
    const today = filters.filter((f) => f.fetchDataFor === 'box').find((f) => f.selected);
    const point = today?.data?.[0];
    if (!today || point?.value === undefined) {
      return null;
    }

    const location = today.label.split('::')[1];
    const condition = point.icon
      ?.replace(/-day$|-night$/, '')
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');

    return { temperatureC: Math.round(point.value), location, condition };
  }

  private refreshOperationsForPanel(): void {
    if (!this.deviceHealth && !this.weather) {
      this.operationsForPanel = null;
      return;
    }

    this.operationsForPanel = {
      temperatureC: this.weather?.temperatureC,
      weatherCondition: this.weather?.condition,
      location: this.weather?.location,
      devicesOnline: this.deviceHealth?.online ?? 0,
      devicesOfflineCount: this.deviceHealth?.offline ?? 0
    };
  }

  // "Average Dwell Time" (widget lives in the "My Reports" group, not this
  // dashboard's own group) is queried one point per day, using this
  // dashboard's store scope — this KPI has no data at all against "My
  // Reports"'s own configured stores, only against the mall-level store.
  //
  // timeFrame/dateByFilter are forced to "dayOfMonth"/"month" explicitly
  // rather than left to "My Reports"'s own group fields: both that group and
  // the dashboard's own footfallGroup can drift to "hour"/"day" from an
  // unrelated filter change elsewhere on the tenant (a real backend bug -
  // PATCH group/filter/:groupId runs an unscoped updateMany that rewrites
  // these fields for every group sharing the same dashboardId, not just the
  // one being edited). Pairing a wide date range with "hour"/"day" silently
  // returns an empty result, which is exactly what happened here - relying on
  // either group's own fields makes this query break whenever that drift
  // happens on the tenant, so the granularity is pinned instead. Same reason
  // Week/Year/Custom don't get their own dateByFilter value here either (see
  // fetchTrafficTrend) - only the requested from/to window changes per view,
  // never the granularity pair.
  //
  // The chart line always spans the selected view's containing month (a
  // single day/week has no trend of its own to plot); the "Estimated Avg
  // Dwell" tile's own current-vs-previous comparison is a second, narrower
  // query for whatever the actual selected period is (day/week/month/year/
  // custom) plus the equivalent-length period immediately before it
  // (getPreviousDateRange) - that comparison window can fall outside the
  // chart's month, e.g. Month view's "previous" is last month, so it can't
  // reuse the chart query's byDate map.
  private fetchAvgDwellTrend(view: string, date: Date | string): void {
    if (!this.dwellTrendWidget || !this.dwellTrendGroup || !this.footfallGroup) {
      this.avgDwellTrend = [];
      this.estimatedAvgDwellStat = { value: 0, previousDay: 0, changePct: 0 };
      this.refreshDwellForPanel();
      return;
    }

    const d = typeof date === 'string' ? new Date(date) : date;
    const chartRangeView = view === 'Day' || view === 'Yesterday' ? 'Month' : view;
    const { from: chartStart, to: chartEnd } = this.getDateRange(chartRangeView, d);
    const { from: periodStart, to: periodEnd } = this.getDateRange(view, d);
    const { from: prevStart, to: prevEnd } = this.getPreviousDateRange(view, d);

    // Every window actually needed (chart span, current period, previous
    // period) gets covered by ONE request per whole calendar month spanned,
    // merged together - never a request narrower than a full month. A single
    // previous DAY (or week) queried in isolation silently comes back empty
    // against this specific widget (see the comment above); the request
    // shape it's proven to work with is a full month, so that's the only
    // shape ever sent, regardless of how narrow the actual slice needed is.
    const spanStart = new Date(Math.min(chartStart.getTime(), periodStart.getTime(), prevStart.getTime()));
    const spanEnd = new Date(Math.max(chartEnd.getTime(), periodEnd.getTime(), prevEnd.getTime()));

    this.fetchAvgDwellMinutesByMonth(spanStart, spanEnd).subscribe({
      next: (byDate) => {
        this.avgDwellTrend =
          chartRangeView === 'Year' ? this.toYearlyAvgDwellTrend(byDate, chartStart, chartEnd) : this.toDailyAvgDwellTrend(byDate, chartStart, chartEnd);

        const currentAvg = this.averageMinutesInRange(byDate, periodStart, periodEnd);
        const previousAvg = this.averageMinutesInRange(byDate, prevStart, prevEnd);
        this.estimatedAvgDwellStat = this.toDwellStat(currentAvg, previousAvg);

        this.refreshDwellForPanel();
      },
      error: () => {
        this.avgDwellTrend = [];
        this.estimatedAvgDwellStat = { value: 0, previousDay: 0, changePct: 0 };
        this.refreshDwellForPanel();
      }
    });
  }

  // Fetches every whole calendar month between start and end (inclusive) with
  // one request each - the one request shape proven to work for this widget -
  // and merges them into a single day->minutes map spanning the full range.
  private fetchAvgDwellMinutesByMonth(start: Date, end: Date): Observable<Map<string, number>> {
    const monthStarts: Date[] = [];
    for (const m = new Date(start.getFullYear(), start.getMonth(), 1); m <= end; m.setMonth(m.getMonth() + 1)) {
      monthStarts.push(new Date(m));
    }

    return forkJoin(
      monthStarts.map((monthStart) => {
        const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
        return this.fetchAvgDwellMinutesByDay(monthStart, monthEnd);
      })
    ).pipe(
      map((maps) => {
        const merged = new Map<string, number>();
        for (const map of maps) {
          for (const [key, value] of map) {
            merged.set(key, value);
          }
        }
        return merged;
      })
    );
  }

  // Values come back in seconds; converted to minutes to match the panel's
  // other dwell stats. Always called with a full calendar month's from/to -
  // never a narrower range - see fetchAvgDwellMinutesByMonth.
  private fetchAvgDwellMinutesByDay(from: Date, to: Date): Observable<Map<string, number>> {
    const fromStr = `${this.formatDate(from)} 00:00:00`;
    const toStr = `${this.formatDate(to)} 23:59:59`;
    const payload = buildKpiDataPayload(
      this.dwellTrendWidget!,
      this.dwellTrendGroup!,
      fromStr,
      toStr,
      this.footfallGroup!.stores,
      'dayOfMonth',
      'month'
    );

    return this.kpiService.postKpiData(payload).pipe(
      map((res) => {
        const points = res.data.dataFilter[0]?.data ?? [];
        const toMinutes = (seconds: number) => Math.round((seconds ?? 0) / 60);
        const byDate = new Map<string, number>();
        for (const point of points) {
          const key = point.dateFrom ? this.formatDate(point.dateFrom) : '';
          if (key) {
            byDate.set(key, toMinutes(point.value));
          }
        }
        return byDate;
      }),
      catchError(() => of(new Map<string, number>()))
    );
  }

  // The widget's own compareConfig is unset, so the API doesn't return a
  // separate "Previous Day" series for this KPI - "Previous Day" is built by
  // pairing each day with the real value reported the day before it, the same
  // way the reference chart lines up two adjacent days on one x position.
  //
  // The API only returns rows for days that already have data (e.g. only
  // Aug 1-4 mid-month) - it does not pad out the rest of the range. Walk every
  // calendar day from start to end instead of just the returned rows, so days
  // with no data yet (today onward) still show up on the axis as 0 rather
  // than being skipped, matching how the Calendar/Power Hour grids already
  // show the full month.
  private toDailyAvgDwellTrend(byDate: Map<string, number>, start: Date, end: Date): DwellTrendPoint[] {
    const days: DwellTrendPoint[] = [];
    let previousCurrent: number | null = null;
    for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const key = this.formatDate(d);
      const current = byDate.get(key) ?? 0;
      days.push({
        time: this.formatShortDate(d),
        current,
        previousDay: previousCurrent ?? current
      });
      previousCurrent = current;
    }
    return days;
  }

  // Year view plots one point per month (a full year of daily points would
  // be unreadable) - each day's minutes within a calendar month are averaged,
  // not summed, since dwell time isn't additive across days. Same
  // "pair with the immediately preceding point" pattern as the daily trend.
  private toYearlyAvgDwellTrend(byDate: Map<string, number>, yearStart: Date, yearEnd: Date): DwellTrendPoint[] {
    const months: DwellTrendPoint[] = [];
    let previousAvg: number | null = null;
    for (let month = yearStart.getMonth(); month <= yearEnd.getMonth(); month++) {
      const monthStart = new Date(yearStart.getFullYear(), month, 1);
      const monthEnd = new Date(yearStart.getFullYear(), month + 1, 0);
      const avg = this.averageMinutesInRange(byDate, monthStart, monthEnd);
      months.push({
        time: monthStart.toLocaleDateString('en-GB', { month: 'short' }),
        current: avg,
        previousDay: previousAvg ?? avg
      });
      previousAvg = avg;
    }
    return months;
  }

  private averageMinutesInRange(byDate: Map<string, number>, start: Date, end: Date): number {
    let sum = 0;
    let count = 0;
    for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      sum += byDate.get(this.formatDate(d)) ?? 0;
      count++;
    }
    return count > 0 ? Math.round(sum / count) : 0;
  }

  private refreshDwellForPanel(): void {
    if (!this.dwellDistribution && !this.avgDwellTrend.length) {
      this.dwellForPanel = null;
      return;
    }

    const zeroStat: DwellStat = { value: 0, previousDay: 0, changePct: 0 };

    this.dwellForPanel = {
      estimatedAvgDwellMin: this.estimatedAvgDwellStat,
      quickVisitPct: this.dwellBucketStats?.quickVisitPct ?? zeroStat,
      engagedVisitPct: this.dwellBucketStats?.engagedVisitPct ?? zeroStat,
      longStayPct: this.dwellBucketStats?.longStayPct ?? zeroStat,
      visitorsInAnalysis: this.dwellBucketStats?.visitorsInAnalysis ?? zeroStat,
      distribution: this.dwellDistribution?.distribution ?? [],
      engagementComposition: this.dwellDistribution?.engagementComposition ?? [],
      avgDwellTrend: this.avgDwellTrend
    };
  }

  private formatShortDate(date?: Date | string): string {
    if (!date) {
      return '';
    }
    return new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  }

  private formatDate(date: Date | string): string {
    const d = typeof date === 'string' ? new Date(date) : date;
    const year = d.getFullYear();
    const month = `${d.getMonth() + 1}`.padStart(2, '0');
    const day = `${d.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  get displayDate(): string {
    const { date, view, customRange } = this.filterForm?.value ?? {};
    if (!date) {
      return '';
    }

    const fmt = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

    if (view === 'Custom' && (!customRange?.start || !customRange?.end)) {
      return 'Select a date range';
    }

    const { from, to } = this.getDateRange(view ?? 'Day', new Date(date));
    switch (view) {
      case 'Week':
      case 'Custom':
        return `${fmt(from)} – ${fmt(to)}`;
      case 'Month':
        return from.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
      case 'Year':
        return `${from.getFullYear()}`;
      case 'Day':
      default:
        return fmt(from);
    }
  }
}
