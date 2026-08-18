import { Component, EventEmitter, Input, OnChanges, OnInit, Output, SimpleChanges } from '@angular/core';
import { FormBuilder, FormGroup } from '@angular/forms';
import { catchError, finalize, forkJoin, map, Observable, of, switchMap } from 'rxjs';
import { MatDatepicker } from '@angular/material/datepicker';
import { AuthService } from '../../../core/services/auth.service';
import { KpiService, buildKpiDataPayload } from '../../../core/services/kpi.service';
import { WidgetService } from '../../../core/services/widget.service';
import { DashboardGroup, DashboardSummary, EventListItem, Widget } from '../../../core/models/widget.model';
import { KpiDataFilterResult } from '../../../core/models/kpi.model';
import { CampaignEvent } from '../../../core/models/dashboard.model';
import { environment } from '../../../../environments/environment';
import {
  AudienceMix,
  FloorPlanReport,
  FloorPlanZoneData,
  InstoreKpis,
  PeakHours,
  StatTile,
  TrafficSignals,
  TrialRoomZoneProxy,
  ZoneCorrelation,
  ZoneFlowLink,
  ZoneHighlight,
  ZoneRow
} from '../../../core/models/instore-analytics.model';
import { ZoneHighlights } from './zone-table-panel/zone-table-panel.component';

const INSTORE_GROUP_NAME = 'Instore Analytics';
const POWER_HOUR_WIDGET_TITLE = 'Power Hour Footfall';
const ZONE_GROUP_NAME = 'Zone Visualizations';
const ZONE_CORRELATION_WIDGET_TITLE = 'Zone Correlation';
const FLOOR_PLAN_WIDGET_TITLE = 'Zone Analytics';
// Same widgets/group the main Dashboard tab uses for its Total Footfall /
// Unique Footfall KPI cards (real entrance-sensor counts, validated live
// there) - reused here instead of the seeded backend's Avg Daily
// Footfall/Unique Visitors tiles. The group is whichever one is first by
// `order` for this dashboard, same lookup dashboard.component.ts uses.
const TOTAL_FOOTFALL_WIDGET_TITLE = 'Total Footfall';
const UNIQUE_FOOTFALL_WIDGET_TITLE = 'Unique Footfall';
// Same Male/Female box widgets the Dashboard tab uses for its gender split -
// real data, reused for Audience Mix's Male/Female fields.
const MALE_WIDGET_TITLE = 'Male';
const FEMALE_WIDGET_TITLE = 'Female';
// Same Funnel widget the Dashboard tab uses (dashboard.component.ts only ever
// reads its "Passer By" entry) - trying its raw dataFilter for an "Adult"
// entry to source Audience Mix's Adult field, with Child = Unique Visitors -
// Adult. Unconfirmed whether this widget's real response actually has an
// "Adult" entry or what it's labeled - see the TEMP DIAGNOSTIC log in
// fetchFunnelAdult(). Falls back to the seeded backend's Adult/Child if no
// match is found, so this is safe to ship speculatively.
const FUNNEL_WIDGET_TITLE = 'Funnel';
// Trial Rooms has no real-data equivalent anywhere on the widget engine (no
// try-on/POS/capture-rate source exists), and no zone-category field exists
// to reliably identify a "trial room" zone across tenants - zoneName is
// free text set per-store. Best-effort proxy: match real zones by name
// pattern instead. Known false-positive risk: a zone named e.g. "Trial
// Promotion Display" would wrongly match; unavoidable without a real
// zone-category field.
const TRIAL_ROOM_ZONE_KEYWORDS = ['trial', 'fitting', 'changing'];
const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const FULL_DAY_HOURS = Array.from({ length: 24 }, (_, h) => `${h.toString().padStart(2, '0')}:00`);

@Component({
  selector: 'app-instore-analytics',
  templateUrl: './instore-analytics.component.html',
  styleUrl: './instore-analytics.component.scss'
})
export class InstoreAnalyticsComponent implements OnInit, OnChanges {
  @Input() dashboardId: string | null = null;
  @Input() dashboards: DashboardSummary[] = [];
  @Output() dashboardChange = new EventEmitter<string>();
  readonly fixedDashboardId = environment.fixedDashboardId;

  filterForm: FormGroup;
  loading = false;
  errorMessage = '';

  peakHoursForPanel: PeakHours | null = null;
  zoneCorrelationForPanel: ZoneCorrelation | null = null;
  floorPlanForPanel: FloorPlanReport | null = null;
  campaignsForPanel: CampaignEvent[] | null = null;
  campaignsRangeFrom: Date | null = null;
  campaignsRangeTo: Date | null = null;
  storeOptions: { value: string; label: string }[] = [];

  // Ranked from the same real "Zone Analytics" widget data as floorPlanForPanel -
  // see deriveZoneAnalysis().
  zonesForPanel: ZoneRow[] = [];
  zoneHighlightsForPanel: ZoneHighlights | null = null;

  // Best-effort real substitute for Trial Rooms - see deriveTrialRoomProxy()
  // and the TRIAL_ROOM_ZONE_KEYWORDS comment above.
  trialRoomProxyForPanel: TrialRoomZoneProxy | null = null;

  // KPI strip - built from the real Total/Unique Footfall widgets plus the
  // real Peak Hours widget already fetched above (see refreshKpiStrip()).
  kpisForPanel: InstoreKpis | null = null;

  // Real Male/Female widgets + speculative Funnel "Adult" entry only (see
  // fetchAudienceMix()/fetchFunnelAdult()) - null until at least one of
  // those apiUrl sources resolves, never backfilled from seeded/demo data.
  audienceMixForPanel: AudienceMix | null = null;
  trafficSignalsForPanel: TrafficSignals | null = null;

  private group: DashboardGroup | null = null;
  private powerHourWidget: Widget | null = null;
  private zoneGroup: DashboardGroup | null = null;
  private zoneCorrelationWidget: Widget | null = null;
  private floorPlanWidget: Widget | null = null;
  private floorPlanGroup: DashboardGroup | null = null;
  private footfallGroup: DashboardGroup | null = null;
  private footfallWidget: Widget | null = null;
  private uniqueFootfallWidget: Widget | null = null;
  private maleWidget: Widget | null = null;
  private femaleWidget: Widget | null = null;
  private funnelWidget: Widget | null = null;
  private footfallTotal: number | null = null;
  private uniqueFootfallTotal: number | null = null;
  private maleTotal: number | null = null;
  private femaleTotal: number | null = null;
  private adultTotal: number | null = null;
  private kpiRangeDays = 0;
  private kpiWeekendDays = 0;
  // Date range of the last Peak Hours fetch - reused by refreshTrafficSignals()
  // to count how many real calendar days of each weekday fall in range.
  private peakHoursRangeFrom: string | null = null;
  private peakHoursRangeTo: string | null = null;
  private campaignEvents: EventListItem[] = [];

  readonly views = ['Yesterday', 'Day', 'Week', 'Month', 'Year', 'Custom'];
  readonly hoursOptions = [
    { value: 1, label: 'Operational' },
    { value: 0, label: '24 Hours' }
  ];

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

  // Only fires when the datepicker's startView is 'year' (Month/Year views
  // below) and the user taps a month tile - Day/Week/Custom use the normal
  // day calendar instead, which closes itself once a day is picked.
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
        switchMap((dashboardId) => (dashboardId ? this.widgetService.getGroups(dashboardId) : of([]))),
        switchMap((groups) => {
          const instoreGroup = groups.find((g) => g.groupName.trim() === INSTORE_GROUP_NAME) ?? null;
          const zoneGroup = groups.find((g) => g.groupName.trim() === ZONE_GROUP_NAME) ?? null;
          // Same "first group by order" lookup dashboard.component.ts uses to
          // find its Total Footfall/Unique Footfall KPI cards.
          const footfallGroup = [...groups].sort((a, b) => a.order - b.order)[0] ?? null;
          this.group = instoreGroup;
          this.zoneGroup = zoneGroup;
          this.footfallGroup = footfallGroup;
          return forkJoin({
            powerHourWidgets: instoreGroup ? this.widgetService.getWidgets(instoreGroup._id) : of([] as Widget[]),
            zoneWidgets: zoneGroup ? this.widgetService.getWidgets(zoneGroup._id) : of([] as Widget[]),
            footfallWidgets: footfallGroup ? this.widgetService.getWidgets(footfallGroup._id) : of([] as Widget[]),
            stores: this.widgetService.getStores(),
            events: this.widgetService.getEvents()
          });
        })
      )
      .subscribe({
        next: ({ powerHourWidgets, zoneWidgets, footfallWidgets, stores, events }) => {
          this.powerHourWidget = powerHourWidgets.find((w) => w.title.trim() === POWER_HOUR_WIDGET_TITLE) ?? null;
          this.zoneCorrelationWidget = zoneWidgets.find((w) => w.title.trim() === ZONE_CORRELATION_WIDGET_TITLE) ?? null;
          this.footfallWidget = footfallWidgets.find((w) => w.title.trim() === TOTAL_FOOTFALL_WIDGET_TITLE) ?? null;
          this.uniqueFootfallWidget = footfallWidgets.find((w) => w.title.trim() === UNIQUE_FOOTFALL_WIDGET_TITLE) ?? null;
          this.maleWidget = footfallWidgets.find((w) => w.title.trim() === MALE_WIDGET_TITLE) ?? null;
          this.femaleWidget = footfallWidgets.find((w) => w.title.trim() === FEMALE_WIDGET_TITLE) ?? null;
          this.funnelWidget = footfallWidgets.find((w) => w.title.trim() === FUNNEL_WIDGET_TITLE) ?? null;

          // Unlike Power Hour / Zone Correlation, the "Zone Analytics" widget's
          // owning group isn't confirmed - search both fetched groups instead of
          // assuming Zone Visualizations, and remember which one actually had it
          // so the payload is built with that group's store scoping/time config.
          const matchesFloorPlan = (w: Widget) => w.title.trim().toLowerCase() === FLOOR_PLAN_WIDGET_TITLE.toLowerCase();
          const floorPlanInZoneGroup = zoneWidgets.find(matchesFloorPlan);
          const floorPlanInInstoreGroup = powerHourWidgets.find(matchesFloorPlan);
          if (floorPlanInZoneGroup) {
            this.floorPlanWidget = floorPlanInZoneGroup;
            this.floorPlanGroup = this.zoneGroup;
          } else if (floorPlanInInstoreGroup) {
            this.floorPlanWidget = floorPlanInInstoreGroup;
            this.floorPlanGroup = this.group;
          } else {
            this.floorPlanWidget = null;
            this.floorPlanGroup = null;
            console.warn(
              `[InstoreAnalytics] "${FLOOR_PLAN_WIDGET_TITLE}" widget not found - the floor plan panel will stay empty.`,
              'Zone Visualizations widgets:', zoneWidgets.map((w) => w.title),
              'Instore Analytics widgets:', powerHourWidgets.map((w) => w.title)
            );
          }

          const footfallStoreIds = new Set(this.footfallGroup?.stores ?? []);
          this.storeOptions = stores
            .filter((s) => footfallStoreIds.has(s._id))
            .map((s) => ({ value: s._id, label: s.storeName }));

          this.campaignEvents = events;
          this.refreshActiveCampaigns();

          this.fetch();
        },
        error: () => {
          this.storeOptions = [];
          this.campaignEvents = [];
          this.campaignsForPanel = null;
          this.errorMessage = 'Unable to load instore analytics data. Please check the API connection and try again.';
        }
      });
  }

  // "Active Campaigns" has no dedicated widget/endpoint - real marketing
  // campaigns are stored as Event documents (GET /event/list), scoped to the
  // Footfall Analysis group's stores, same approach as the main Dashboard tab.
  // Date-range scoping (e.g. only this year's campaigns when View is "Year")
  // happens in the shared app-active-campaigns-panel via campaignsRangeFrom/
  // campaignsRangeTo (set in fetch()) - this just scopes by store.
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

  private yesterday(): Date {
    const y = new Date();
    y.setDate(y.getDate() - 1);
    return y;
  }

  // 'Yesterday' is a quick-view, not a date the user actually picked - it
  // always means "the day before today" regardless of whatever's in the date
  // field, so it's resolved to a real Date here, once, before being handed to
  // every sub-fetch below (each of which independently calls getDateRange).
  private fetch(): void {
    const { date: rawDate, view, store, operationalHours } = this.filterForm.value;
    const date = view === 'Yesterday' ? this.yesterday() : rawDate;
    const { from, to } = this.getDateRange(date, view);
    this.campaignsRangeFrom = new Date(from);
    this.campaignsRangeTo = new Date(to);
    this.fetchPeakHours(date, view, store, operationalHours);
    this.fetchZoneCorrelation(date, view, store, operationalHours);
    this.fetchFloorPlan(date, view, store, operationalHours);
    this.fetchFootfallKpis(date, view, operationalHours);
    this.fetchAudienceMix(date, view, operationalHours);
    this.fetchFunnelAdult(date, view, operationalHours);
  }

  // Mirrors the Day/Week/Month/Year range logic the legacy endpoint already
  // applies server-side (api_v2 AnalyticsService.getDateRange), so the
  // widget-engine panels below (Peak Hours, Zone Correlation, Floor Plan)
  // respect the same View filter instead of a fixed range.
  private getDateRange(date: Date | string, view: string): { from: string; to: string } {
    const d = typeof date === 'string' ? new Date(date) : date;

    switch (view) {
      case 'Week': {
        const diffToMonday = (d.getDay() + 6) % 7;
        const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - diffToMonday);
        const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
        return { from: `${this.formatDate(start)} 00:00:00`, to: `${this.formatDate(end)} 23:59:59` };
      }
      case 'Month': {
        const start = new Date(d.getFullYear(), d.getMonth(), 1);
        const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
        return { from: `${this.formatDate(start)} 00:00:00`, to: `${this.formatDate(end)} 23:59:59` };
      }
      case 'Year': {
        const start = new Date(d.getFullYear(), 0, 1);
        const end = new Date(d.getFullYear(), 11, 31);
        return { from: `${this.formatDate(start)} 00:00:00`, to: `${this.formatDate(end)} 23:59:59` };
      }
      // 'Yesterday' is resolved to yesterday's actual Date in fetch() before
      // it ever reaches here, so it rides the same single-day path as 'Day'.
      case 'Yesterday':
      case 'Day':
      case 'Custom':
      default: {
        const dateStr = this.formatDate(d);
        return { from: `${dateStr} 00:00:00`, to: `${dateStr} 23:59:59` };
      }
    }
  }

  // Fetches the same real Male/Female widgets the Dashboard tab uses for its
  // gender split - same footfallGroup/no-store-filter pattern as
  // fetchFootfallKpis, since Male/Female live in that same group.
  private fetchAudienceMix(date: Date | string, view: string, operationalHours: number): void {
    if (!this.footfallGroup || (!this.maleWidget && !this.femaleWidget)) {
      this.maleTotal = null;
      this.femaleTotal = null;
      this.refreshAudienceMix();
      return;
    }

    const { from, to } = this.getDateRange(date, view);
    forkJoin({
      male: this.fetchKpiCurrentValue(this.maleWidget, from, to, operationalHours),
      female: this.fetchKpiCurrentValue(this.femaleWidget, from, to, operationalHours)
    }).subscribe(({ male, female }) => {
      this.maleTotal = male;
      this.femaleTotal = female;
      this.refreshAudienceMix();
    });
  }

  // Built entirely from real apiUrl sources (Male/Female widgets, the
  // speculative Funnel "Adult" entry) - each field appears the moment its
  // own source resolves. Stays null - hiding the whole card - until at
  // least one of those sources has actually returned something; no seeded/
  // demo backend fallback for whichever fields haven't resolved yet.
  private refreshAudienceMix(): void {
    if (this.maleTotal === null && this.femaleTotal === null && this.adultTotal === null) {
      this.audienceMixForPanel = null;
      return;
    }
    const child =
      this.adultTotal !== null && this.uniqueFootfallTotal !== null ? Math.max(this.uniqueFootfallTotal - this.adultTotal, 0) : 0;
    this.audienceMixForPanel = {
      male: this.maleTotal ?? 0,
      female: this.femaleTotal ?? 0,
      adult: this.adultTotal ?? 0,
      child
    };
  }

  // Speculative: dashboard.component.ts's Funnel widget fetch only ever reads
  // its "Passer By" entry - trying the rest of its raw dataFilter here for an
  // "Adult" entry, on the theory that the funnel's real response carries one
  // even though nothing in this codebase has read it before. TEMP DIAGNOSTIC
  // log below shows the actual raw labels/values so this can be confirmed
  // (or ruled out) from the browser console - remove once confirmed either
  // way. Falls back to the seeded Adult/Child (via refreshAudienceMix) if no
  // "adult" label is found, so this is safe to ship without confirmation.
  private fetchFunnelAdult(date: Date | string, view: string, operationalHours: number): void {
    if (!this.funnelWidget || !this.footfallGroup) {
      this.adultTotal = null;
      this.refreshAudienceMix();
      return;
    }

    const { from, to } = this.getDateRange(date, view);
    const payload = buildKpiDataPayload(this.funnelWidget, this.footfallGroup, from, to, undefined, undefined, undefined, operationalHours);

    this.kpiService.postKpiData(payload).subscribe({
      next: (res) => {
        if (!environment.production) {
          console.log(
            '[InstoreAnalytics] TEMP DIAGNOSTIC - raw Funnel dataFilter (looking for an "Adult" entry):',
            res.data.dataFilter.map((f) => ({ label: f.label, value: f.data?.[0]?.value }))
          );
        }
        const adultFilter = res.data.dataFilter.find((f) => (f.label.split('::').pop() || f.label).trim().toLowerCase() === 'adult');
        this.adultTotal = adultFilter?.data?.[0]?.value ?? null;
        this.refreshAudienceMix();
      },
      error: () => {
        this.adultTotal = null;
        this.refreshAudienceMix();
      }
    });
  }

  // Fully real, derived from the same Peak Hours widget response already
  // fetched above (no new call) - no day-classification rule (what counts as
  // "peak" vs "normal" vs "low") exists anywhere in the real widget engine to
  // reuse, so this ranks the 7 weekdays by their average footfall per
  // occurrence in the selected range: the top 2 are "peak", the bottom 2 are
  // "low", the middle 3 are "normal". Peak/Normal/LowDays are then the count
  // of real calendar days in range that fall on one of those weekdays, so the
  // three always sum to the full range length. Busiest Day is the weekday
  // whose hours sum to the highest total across the range.
  private refreshTrafficSignals(): void {
    const grid = this.peakHoursForPanel?.grid;
    const busiestDay = this.computeBusiestDay();
    if (!grid || !this.peakHoursRangeFrom || !this.peakHoursRangeTo) {
      this.trafficSignalsForPanel = null;
      return;
    }

    const occurrences = this.weekdayOccurrenceCounts(this.peakHoursRangeFrom, this.peakHoursRangeTo);
    const ranked = grid
      .map((row, dayIdx) => ({
        dayIdx,
        avg: occurrences[dayIdx] > 0 ? this.gridRowTotal(row) / occurrences[dayIdx] : 0
      }))
      .sort((a, b) => b.avg - a.avg);
    const peakIdx = new Set(ranked.slice(0, 2).map((r) => r.dayIdx));
    const lowIdx = new Set(ranked.slice(5, 7).map((r) => r.dayIdx));

    let peakDays = 0;
    let normalDays = 0;
    let lowDays = 0;
    occurrences.forEach((count, dayIdx) => {
      if (peakIdx.has(dayIdx)) {
        peakDays += count;
      } else if (lowIdx.has(dayIdx)) {
        lowDays += count;
      } else {
        normalDays += count;
      }
    });

    this.trafficSignalsForPanel = { peakDays, normalDays, lowDays, busiestDay: busiestDay ?? '—' };
  }

  // Index 0 = Sunday, matching WEEKDAY_LABELS/Date.getDay() and the grid's
  // dayIdx convention used throughout toPeakHours()/computeBusiestDay().
  private weekdayOccurrenceCounts(from: string, to: string): number[] {
    const counts = [0, 0, 0, 0, 0, 0, 0];
    const fromDay = new Date(from.split(' ')[0]);
    const toDay = new Date(to.split(' ')[0]);
    for (let d = new Date(fromDay); d.getTime() <= toDay.getTime(); d.setDate(d.getDate() + 1)) {
      counts[d.getDay()]++;
    }
    return counts;
  }

  private computeBusiestDay(): string | null {
    const grid = this.peakHoursForPanel?.grid;
    if (!grid) {
      return null;
    }
    let bestIdx = -1;
    let bestTotal = 0;
    grid.forEach((row, idx) => {
      const total = this.gridRowTotal(row);
      if (total > bestTotal) {
        bestTotal = total;
        bestIdx = idx;
      }
    });
    return bestIdx >= 0 ? WEEKDAY_LABELS[bestIdx] : null;
  }

  private gridRowTotal(row: (number | null)[] | undefined): number {
    return (row ?? []).reduce((sum: number, v) => sum + (v ?? 0), 0);
  }

  private fetchPeakHours(date: Date | string, view: string, store: string, operationalHours: number): void {
    if (!this.powerHourWidget || !this.group) {
      this.peakHoursForPanel = null;
      this.peakHoursRangeFrom = null;
      this.peakHoursRangeTo = null;
      return;
    }

    const { from, to } = this.getDateRange(date, view);
    this.peakHoursRangeFrom = from;
    this.peakHoursRangeTo = to;
    const storeIds = store !== 'all' ? [store] : undefined;
    const payload = buildKpiDataPayload(this.powerHourWidget, this.group, from, to, storeIds, undefined, undefined, operationalHours);

    this.loading = true;
    this.errorMessage = '';

    this.kpiService
      .postKpiData(payload)
      .pipe(finalize(() => (this.loading = false)))
      .subscribe({
        next: (res) => {
          this.peakHoursForPanel = this.toPeakHours(res.data.dataFilter, operationalHours === 1);
          this.refreshKpiStrip();
          this.refreshTrafficSignals();
        },
        error: () => {
          this.peakHoursForPanel = null;
          this.errorMessage = 'Unable to load instore analytics data. Please check the API connection and try again.';
          this.refreshKpiStrip();
          this.refreshTrafficSignals();
        }
      });
  }

  // Fetches the same real Total Footfall/Unique Footfall widgets the main
  // Dashboard tab uses for its KPI cards - not scoped to this page's Store
  // filter, matching dashboard.component.ts's fetchKpi (footfallGroup already
  // scopes to its own entrance stores; per-store filtering isn't part of the
  // validated pattern being reused here).
  private fetchFootfallKpis(date: Date | string, view: string, operationalHours: number): void {
    if (!this.footfallGroup || (!this.footfallWidget && !this.uniqueFootfallWidget)) {
      this.footfallTotal = null;
      this.uniqueFootfallTotal = null;
      this.refreshKpiStrip();
      this.refreshAudienceMix();
      return;
    }

    const { from, to } = this.getDateRange(date, view);
    this.kpiRangeDays = this.countDaysInclusive(from, to);
    this.kpiWeekendDays = this.countWeekendDaysInclusive(from, to);

    forkJoin({
      footfall: this.fetchKpiCurrentValue(this.footfallWidget, from, to, operationalHours),
      uniqueFootfall: this.fetchKpiCurrentValue(this.uniqueFootfallWidget, from, to, operationalHours)
    }).subscribe(({ footfall, uniqueFootfall }) => {
      this.footfallTotal = footfall;
      this.uniqueFootfallTotal = uniqueFootfall;
      this.refreshKpiStrip();
      this.refreshAudienceMix();
    });
  }

  // Extracts just the current period's aggregate ("box") value - same
  // extraction dashboard.component.ts uses for its Total/Unique Footfall
  // cards. Returns null (rather than 0) when the widget itself doesn't exist,
  // so the KPI strip can tell "no data" apart from "confirmed zero".
  private fetchKpiCurrentValue(widget: Widget | null, from: string, to: string, operationalHours: number): Observable<number | null> {
    if (!widget || !this.footfallGroup) {
      return of(null);
    }
    const payload = buildKpiDataPayload(widget, this.footfallGroup, from, to, undefined, undefined, undefined, operationalHours);
    return this.kpiService.postKpiData(payload).pipe(
      map((res) => res.data.dataFilter.filter((f) => f.fetchDataFor === 'box').find((f) => f.selected)?.data?.[0]?.value ?? 0),
      catchError(() => of(null))
    );
  }

  // Builds the real KPI strip from whichever of its two data sources
  // (Total/Unique Footfall widgets, Peak Hours widget) have loaded so far -
  // each tile appears as soon as its own source resolves rather than waiting
  // on both.
  private refreshKpiStrip(): void {
    const dayLabel = this.kpiRangeDays === 1 ? '1 day' : `${this.kpiRangeDays} days`;

    const avgDailyFootfall: StatTile =
      this.footfallTotal === null
        ? { value: '—', sub: 'No data' }
        : { value: Math.round(this.footfallTotal / Math.max(this.kpiRangeDays, 1)), sub: `Avg over ${dayLabel}` };

    const uniqueVisitors: StatTile =
      this.uniqueFootfallTotal === null ? { value: '—', sub: 'No data' } : { value: this.uniqueFootfallTotal, sub: `Total over ${dayLabel}` };

    const peakHour: StatTile = this.peakHoursForPanel ? this.peakHoursForPanel.bestSlot : { value: '—', sub: 'No data' };

    let weekendAvg: StatTile = { value: '—', sub: 'No data' };
    if (this.peakHoursForPanel && this.kpiWeekendDays > 0) {
      const grid = this.peakHoursForPanel.grid;
      const weekendTotal = this.gridRowTotal(grid[0]) + this.gridRowTotal(grid[6]);
      weekendAvg = { value: Math.round(weekendTotal / this.kpiWeekendDays), sub: 'Sat/Sun avg over range' };
    }

    this.kpisForPanel = { avgDailyFootfall, uniqueVisitors, peakHour, weekendAvg };
  }

  private countDaysInclusive(from: string, to: string): number {
    const fromDay = new Date(from.split(' ')[0]);
    const toDay = new Date(to.split(' ')[0]);
    return Math.round((toDay.getTime() - fromDay.getTime()) / 86400000) + 1;
  }

  private countWeekendDaysInclusive(from: string, to: string): number {
    const fromDay = new Date(from.split(' ')[0]);
    const toDay = new Date(to.split(' ')[0]);
    let count = 0;
    for (let d = new Date(fromDay); d.getTime() <= toDay.getTime(); d.setDate(d.getDate() + 1)) {
      const day = d.getDay();
      if (day === 0 || day === 6) {
        count++;
      }
    }
    return count;
  }

  private fetchZoneCorrelation(date: Date | string, view: string, store: string, operationalHours: number): void {
    if (!this.zoneCorrelationWidget || !this.zoneGroup) {
      this.zoneCorrelationForPanel = null;
      return;
    }

    const { from, to } = this.getDateRange(date, view);
    const storeIds = store !== 'all' ? [store] : undefined;
    const payload = buildKpiDataPayload(this.zoneCorrelationWidget, this.zoneGroup, from, to, storeIds, undefined, undefined, operationalHours);

    this.kpiService.postKpiData(payload).subscribe({
      next: (res) => (this.zoneCorrelationForPanel = this.toZoneCorrelation(res.data.dataFilter)),
      error: () => (this.zoneCorrelationForPanel = null)
    });
  }

  private fetchFloorPlan(date: Date | string, view: string, store: string, operationalHours: number): void {
    if (!this.floorPlanWidget || !this.floorPlanGroup) {
      this.floorPlanForPanel = null;
      this.deriveZoneAnalysis([]);
      this.deriveTrialRoomProxy([]);
      return;
    }

    const { from, to } = this.getDateRange(date, view);
    const storeIds = store !== 'all' ? [store] : undefined;
    const payload = buildKpiDataPayload(this.floorPlanWidget, this.floorPlanGroup, from, to, storeIds, undefined, undefined, operationalHours);

    this.kpiService.postKpiData(payload).subscribe({
      next: (res) => {
        // TEMP DIAGNOSTIC - checking whether the real "Zone Analytics" widget
        // response carries a per-zone gender split (male/female) that the
        // KpiDataPoint model/toFloorPlan() below simply never mapped, before
        // deciding whether the Metric Matrix table can show it. Remove once
        // confirmed either way.
        if (!environment.production) {
          console.log('[InstoreAnalytics] raw zoneAnalytics point keys:', res.data.dataFilter[0]?.data?.[0]);
        }
        const zones = this.toZoneRows(res.data.dataFilter);
        this.floorPlanForPanel = this.toFloorPlan(res.data.dataFilter);
        this.deriveZoneAnalysis(zones);
        this.deriveTrialRoomProxy(zones);
      },
      error: () => {
        this.floorPlanForPanel = null;
        this.deriveZoneAnalysis([]);
        this.deriveTrialRoomProxy([]);
      }
    });
  }

  // Best-effort real substitute for Trial Rooms - see the
  // TRIAL_ROOM_ZONE_KEYWORDS comment above. Deliberately keeps every matched
  // zone separate (no summing) so a false positive or a second real trial
  // room is visible rather than silently folded into one number.
  private deriveTrialRoomProxy(zones: FloorPlanZoneData[]): void {
    const matched = zones.filter((z) =>
      TRIAL_ROOM_ZONE_KEYWORDS.some((kw) => z.zoneName.toLowerCase().includes(kw))
    );
    this.trialRoomProxyForPanel = {
      status: matched.length === 0 ? 'none' : matched.length === 1 ? 'matched' : 'multiple',
      zones: matched.map((z) => ({
        zoneName: z.zoneName,
        traffic: z.traffic,
        visitors: z.visitors,
        attentionVisitors: z.attentionVisitors,
        avgResidenceTime: z.avgResidenceTime
      }))
    };
  }

  // Zone Data Visibility & Ranked Analysis is ranked from the same real
  // per-zone data the floor plan overlay already fetches (traffic, visitors,
  // attentionVisitors, avgResidenceTime, visitorTraffic) - no separate
  // endpoint. Only sharePct is derived (each zone's share of total traffic);
  // everything else is the raw widget value. There's no capture-rate or
  // audience-mix field on this widget, so those don't appear here.
  private deriveZoneAnalysis(zones: FloorPlanZoneData[]): void {
    if (!zones.length) {
      this.zonesForPanel = [];
      this.zoneHighlightsForPanel = null;
      return;
    }

    const totalTraffic = zones.reduce((sum, z) => sum + z.traffic, 0);
    this.zonesForPanel = zones.map((z, index) => ({
      key: `${z.zoneName}-${index}`,
      label: z.zoneName,
      traffic: z.traffic,
      visitors: z.visitors,
      attentionVisitors: z.attentionVisitors,
      avgResidenceTime: z.avgResidenceTime,
      visitorTraffic: z.visitorTraffic,
      sharePct: totalTraffic > 0 ? Math.round((z.traffic / totalTraffic) * 1000) / 10 : 0
    }));

    const topTraffic = zones.reduce((a, b) => (b.traffic > a.traffic ? b : a));
    const mostAttention = zones.reduce((a, b) => (b.attentionVisitors > a.attentionVisitors ? b : a));
    const longestDwell = zones.reduce((a, b) => (b.avgResidenceTime > a.avgResidenceTime ? b : a));
    const zonesWithTraffic = zones.filter((z) => z.traffic > 0);
    const opportunity = zonesWithTraffic.length
      ? zonesWithTraffic.reduce((a, b) => (this.attentionRatio(b) < this.attentionRatio(a) ? b : a))
      : null;

    this.zoneHighlightsForPanel = {
      topTrafficZone: { label: topTraffic.zoneName, sub: `${topTraffic.traffic.toLocaleString('en-US')} traffic` },
      mostAttentionZone: {
        label: mostAttention.zoneName,
        sub: `${mostAttention.attentionVisitors.toLocaleString('en-US')} attention visitors`
      },
      longestDwellZone: { label: longestDwell.zoneName, sub: this.formatDuration(longestDwell.avgResidenceTime) },
      opportunityZone: opportunity
        ? {
            label: opportunity.zoneName,
            sub: `${Math.round(this.attentionRatio(opportunity) * 100)}% attention capture`
          }
        : { label: '—', sub: 'No data' }
    };
  }

  private attentionRatio(zone: FloorPlanZoneData): number {
    return zone.traffic > 0 ? zone.attentionVisitors / zone.traffic : 0;
  }

  private formatDuration(seconds: number): string {
    const pad = (v: number) => v.toString().padStart(2, '0');
    const hh = Math.floor(seconds / 3600);
    const mm = Math.floor((seconds % 3600) / 60);
    const ss = Math.floor(seconds % 60);
    return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
  }

  // The widget only returns raw zone-to-zone flow volumes (source/target/value) -
  // no capture rate, dwell/engagement, or journey-depth metrics exist on this
  // tenant yet, so those three tiles stay as an explicit "no data" state rather
  // than showing fabricated numbers. Strongest Flow is real: the single
  // highest-weight link in the same dataset.
  private toZoneCorrelation(filters: KpiDataFilterResult[]): ZoneCorrelation {
    const points = filters[0]?.data ?? [];
    const flows: ZoneFlowLink[] = points
      .filter((p) => p.source && p.target)
      .map((p) => ({ from: p.source as string, to: p.target as string, weight: p.value }));

    const noData: ZoneHighlight = { label: '—', sub: 'No data' };
    const strongest = flows.length ? flows.reduce((a, b) => (b.weight > a.weight ? b : a)) : null;

    return {
      strongestFlow: strongest
        ? { label: `${strongest.from} → ${strongest.to}`, sub: `${strongest.weight.toLocaleString('en-US')} modelled visitors` }
        : noData,
      highestCapture: noData,
      engagementLeader: noData,
      avgZonesPerVisit: { value: '—', sub: 'No data' },
      flows
    };
  }

  // Only zones with a drawn polygon can be overlaid on the photo - coordinates
  // are a manual annotation step separate from whether the zone is actively
  // collecting traffic data, so plenty of real zones report metrics here
  // without ever having had a shape drawn for them yet.
  private toFloorPlan(filters: KpiDataFilterResult[]): FloorPlanReport | null {
    const filter = filters[0];
    if (!filter?.image) {
      return null;
    }

    const zones = filter.data
      .filter((p) => p.zoneName && p.coordinates?.length)
      .map((p) => ({
        zoneName: p.zoneName as string,
        traffic: p.traffic ?? 0,
        visitors: p.visitors ?? 0,
        attentionVisitors: p.attentionVisitors ?? 0,
        avgResidenceTime: p.avgResidenceTime ?? 0,
        visitorTraffic: p.visitorTraffic ?? 0,
        coordinates: p.coordinates as { x: number; y: number }[]
      }));

    return { image: filter.image, zones };
  }

  // Unlike toFloorPlan() above, the Zone Table / Metric Matrix don't draw
  // anything on the photo, so they shouldn't inherit its "has coordinates"
  // restriction - every zone reporting metrics belongs in the data table,
  // whether or not it has a floor-plan shape drawn yet.
  private toZoneRows(filters: KpiDataFilterResult[]): FloorPlanZoneData[] {
    const filter = filters[0];
    return (filter?.data ?? [])
      .filter((p) => p.zoneName)
      .map((p) => ({
        zoneName: p.zoneName as string,
        traffic: p.traffic ?? 0,
        visitors: p.visitors ?? 0,
        attentionVisitors: p.attentionVisitors ?? 0,
        avgResidenceTime: p.avgResidenceTime ?? 0,
        visitorTraffic: p.visitorTraffic ?? 0,
        coordinates: p.coordinates ?? []
      }));
  }

  // One row per weekday (Sunday-Saturday), one column per hour. Every
  // occurrence of a given weekday+hour within the selected View's date range
  // (e.g. every Monday 10am) gets summed into the same cell - so each row
  // shows that weekday's typical hourly pattern across the range, not just
  // a single date. `date` only carries an ISO weekday when the Hours filter
  // is set to Operational; otherwise the UTC day/hour of `dateFrom` is used.
  private toPeakHours(filters: KpiDataFilterResult[], byOperationalHours: boolean): PeakHours {
    const points = filters[0]?.data ?? [];
    const color = filters[0]?.color;

    const totals = new Map<string, number>();
    const dayIndices = new Set<number>();
    const hourSet = new Set<string>();

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

      hourSet.add(hour);
      dayIndices.add(dayIdx);
      const key = `${dayIdx}-${hour}`;
      totals.set(key, (totals.get(key) ?? 0) + point.value);
    }

    const hours = byOperationalHours ? Array.from(hourSet).sort() : FULL_DAY_HOURS;
    const grid = WEEKDAY_LABELS.map((_, dayIdx) =>
      dayIndices.has(dayIdx) ? hours.map((h) => totals.get(`${dayIdx}-${h}`) ?? 0) : hours.map(() => null)
    );

    const cells = grid
      .flatMap((row, dayIdx) => row.map((value, hourIdx) => ({ value, dayIdx, hourIdx })))
      .filter((c): c is { value: number; dayIdx: number; hourIdx: number } => c.value !== null);

    if (!cells.length) {
      return {
        bestSlot: { value: '—', sub: 'No data' },
        activeSlots: { value: 0, sub: 'of 0 slots' },
        avgActiveSlot: { value: 0, sub: 'visitors / active hour' },
        hours,
        days: WEEKDAY_LABELS,
        grid,
        color
      };
    }

    const best = cells.reduce((a, b) => (b.value > a.value ? b : a));
    const active = cells.filter((c) => c.value > 0);
    const avgActive = active.length ? Math.round(active.reduce((sum, c) => sum + c.value, 0) / active.length) : 0;

    return {
      bestSlot: {
        value: hours[best.hourIdx] ?? '—',
        sub: `${WEEKDAY_LABELS[best.dayIdx]} · ${best.value.toLocaleString('en-US')} visitors`
      },
      activeSlots: { value: active.length, sub: `of ${cells.length} slots` },
      avgActiveSlot: { value: avgActive.toLocaleString('en-US'), sub: 'visitors / active hour' },
      hours,
      days: WEEKDAY_LABELS,
      grid,
      color
    };
  }

  private formatDate(date: Date | string): string {
    const d = typeof date === 'string' ? new Date(date) : date;
    const year = d.getFullYear();
    const month = `${d.getMonth() + 1}`.padStart(2, '0');
    const day = `${d.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
