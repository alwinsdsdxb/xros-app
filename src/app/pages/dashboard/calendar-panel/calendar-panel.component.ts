import { Component, EventEmitter, Input, OnChanges, OnInit, Output, SimpleChanges } from '@angular/core';
import { catchError, forkJoin, map, of, switchMap } from 'rxjs';
import { AuthService } from '../../../core/services/auth.service';
import { KpiService, buildKpiDataPayload } from '../../../core/services/kpi.service';
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

  private group: DashboardGroup | null = null;
  private widget: Widget | null = null;
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

  formatCount(value: number | null): string {
    return value === null ? '—' : value.toLocaleString('en-US');
  }

  openHourlyDetail(day: CalendarDayCell): void {
    if (!day.inMonth || day.value === null) {
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

  // "New" (growth from a zero base) still reads as positive news even though
  // it has no numeric sign; "flat"/"na" are neutral, never colored as a gain
  // or a drop.
  isPositiveChange(change: ChangeResult): boolean {
    return change.status === 'new' || (change.status === 'value' && (change.pct ?? 0) >= 0);
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
          this.group = group;
          return group ? this.widgetService.getWidgets(group._id) : of([] as Widget[]);
        })
      )
      .subscribe({
        next: (widgets) => {
          this.widget = widgets.find((w) => w.title.trim() === CALENDAR_WIDGET_TITLE) ?? null;
          this.fetch();
        },
        error: () => {
          this.errorMessage = 'Unable to load calendar data. Please check the API connection and try again.';
        }
      });
  }

  private fetch(): void {
    if (!this.widget || !this.group) {
      this.data = null;
      return;
    }

    const monthStart = this.startOfMonth(this.viewDate);
    const monthEnd = this.endOfMonth(this.viewDate);
    const from = `${this.formatDate(monthStart)} 00:00:00`;
    const to = `${this.formatDate(monthEnd)} 23:59:59`;
    const payload = buildKpiDataPayload(this.widget, this.group, from, to);

    // Last year's same month has no compareConfig relationship to the
    // widget's own "PM" series - it's fetched as its own plain request
    // (same widget/group, just a year-shifted date range), the same pattern
    // used elsewhere in this app whenever a comparison period isn't
    // something the backend already returns for free.
    const lastYearStart = this.addMonths(monthStart, -12);
    const lastYearEnd = this.endOfMonth(lastYearStart);
    const lyFrom = `${this.formatDate(lastYearStart)} 00:00:00`;
    const lyTo = `${this.formatDate(lastYearEnd)} 23:59:59`;
    const lyPayload = buildKpiDataPayload(this.widget, this.group, lyFrom, lyTo);

    this.loading = true;
    this.errorMessage = '';

    forkJoin({
      current: this.kpiService.postKpiData(payload),
      lastYear: this.kpiService.postKpiData(lyPayload).pipe(catchError(() => of(null)))
    }).subscribe({
      next: ({ current, lastYear }) => {
        this.loading = false;
        this.data = this.toCalendarResponse(current.data.dataFilter, lastYear?.data.dataFilter ?? [], monthStart);
      },
      error: () => {
        this.loading = false;
        this.errorMessage = 'Unable to load calendar data. Please check the API connection and try again.';
      }
    });
  }

  // "Today" (selected:true) carries this month's per-day values; "PM" carries
  // the previous-month values, aligned to the same dates. Last year's request
  // returns its own "selected" series for that other month, matched back to
  // this month's days by DAY NUMBER (not date string, since the year
  // differs) - a day that doesn't exist in both months (e.g. Feb 29) simply
  // has no LY value, not a crash.
  //
  // Every LM/LY percentage is computed locally from the real values here
  // rather than trusting the backend's own per-day "variation" field - that
  // field is exactly what produced the misleading "+100%" when the prior
  // value was 0.
  private toCalendarResponse(filters: KpiDataFilterResult[], lyFilters: KpiDataFilterResult[], monthStart: Date): CalendarResponse {
    const today = filters.find((f) => f.selected) ?? filters[0];
    const lastMonth = filters.find((f) => f.label === 'PM');
    const lastYear = lyFilters.find((f) => f.selected) ?? lyFilters[0];

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

    const cellsByDate = new Map<string, CalendarDayCell>();
    (today?.data ?? []).forEach((p) => {
      if (!p.date) {
        return;
      }
      const dayNum = this.parseDdMmYyyy(p.date)?.getDate() ?? 0;
      const lmValue = lmByDate.get(p.date) ?? null;
      const lyValue = lyByDay.get(dayNum) ?? null;
      cellsByDate.set(p.date, {
        date: p.date,
        day: dayNum,
        inMonth: true,
        value: p.value,
        lmValue,
        lmChange: this.computeChange(p.value, lmValue),
        lyValue,
        lyChange: this.computeChange(p.value, lyValue)
      });
    });

    const weeks = this.buildWeeks(monthStart, cellsByDate);
    const monthTotal = Array.from(cellsByDate.values()).reduce((sum, c) => sum + (c.value ?? 0), 0);
    const lastMonthTotal = lastMonth ? Array.from(lmByDate.values()).reduce((sum, v) => sum + v, 0) : null;
    const lastYearTotal = lastYear ? Array.from(lyByDay.values()).reduce((sum, v) => sum + v, 0) : null;
    const bestWeek = weeks.filter((w) => w.total > 0).sort((a, b) => b.total - a.total)[0] ?? null;

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
      columnLabels: WEEKDAY_LABELS,
      weeks,
      columnTotals: this.buildColumnTotals(weeks),
      availableMonths: this.buildAvailableMonths(monthStart)
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
    for (let i = MONTHS_OF_HISTORY; i >= 0; i--) {
      const d = this.addMonths(this.startOfMonth(new Date()), -i);
      months.push({ value: this.formatDate(d).slice(0, 7), label: this.formatMonthLabel(d) });
    }

    const currentKey = this.formatDate(monthStart).slice(0, 7);
    if (!months.some((m) => m.value === currentKey)) {
      months.push({ value: currentKey, label: this.formatMonthLabel(monthStart) });
      months.sort((a, b) => (a.value < b.value ? -1 : 1));
    }

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
