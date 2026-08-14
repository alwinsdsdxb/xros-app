import { Component, EventEmitter, Input, OnChanges, OnInit, Output, SimpleChanges } from '@angular/core';
import { map, of, switchMap } from 'rxjs';
import { AuthService } from '../../../core/services/auth.service';
import { KpiService, buildKpiDataPayload } from '../../../core/services/kpi.service';
import { WidgetService } from '../../../core/services/widget.service';
import { DashboardGroup, DashboardSummary, Widget } from '../../../core/models/widget.model';
import { KpiDataFilterResult } from '../../../core/models/kpi.model';
import {
  CalendarAvailableMonth,
  CalendarColumnTotal,
  CalendarDayCell,
  CalendarResponse,
  CalendarWeekRow
} from '../../../core/models/calendar.model';

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
  @Output() dashboardChange = new EventEmitter<string>();

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

  formatPct(pct: number | null): string {
    if (pct === null) {
      return '';
    }
    return `${pct >= 0 ? '+' : ''}${pct}%`;
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

    const from = `${this.formatDate(this.startOfMonth(this.viewDate))} 00:00:00`;
    const to = `${this.formatDate(this.endOfMonth(this.viewDate))} 23:59:59`;
    const payload = buildKpiDataPayload(this.widget, this.group, from, to);

    this.loading = true;
    this.errorMessage = '';

    this.kpiService.postKpiData(payload).subscribe({
      next: (res) => {
        this.loading = false;
        this.data = this.toCalendarResponse(res.data.dataFilter);
      },
      error: () => {
        this.loading = false;
        this.errorMessage = 'Unable to load calendar data. Please check the API connection and try again.';
      }
    });
  }

  // "Today" (selected:true) carries this month's per-day values; "PM" carries the
  // previous-month comparison, aligned to the same dates, with the backend's own
  // per-day variation already computed — we reuse that rather than recompute it.
  private toCalendarResponse(filters: KpiDataFilterResult[]): CalendarResponse {
    const today = filters.find((f) => f.selected) ?? filters[0];
    const lastMonth = filters.find((f) => f.label === 'PM');

    const lmByDate = new Map<string, { value: number; changePct: number | null }>();
    (lastMonth?.data ?? []).forEach((p) => {
      if (p.date) {
        lmByDate.set(p.date, { value: p.value, changePct: p.variation ?? null });
      }
    });

    const cellsByDate = new Map<string, CalendarDayCell>();
    (today?.data ?? []).forEach((p) => {
      if (!p.date) {
        return;
      }
      const lm = lmByDate.get(p.date) ?? null;
      cellsByDate.set(p.date, {
        date: p.date,
        day: this.parseDdMmYyyy(p.date)?.getDate() ?? 0,
        inMonth: true,
        value: p.value,
        lmValue: lm?.value ?? null,
        changePct: lm?.changePct ?? null
      });
    });

    const monthStart = this.startOfMonth(this.viewDate);
    const weeks = this.buildWeeks(monthStart, cellsByDate);
    const monthTotal = Array.from(cellsByDate.values()).reduce((sum, c) => sum + (c.value ?? 0), 0);
    const lastMonthTotal = Array.from(lmByDate.values()).reduce((sum, v) => sum + v.value, 0);
    const bestWeek = weeks.filter((w) => w.total > 0).sort((a, b) => b.total - a.total)[0] ?? null;

    return {
      scope: 'all',
      month: this.formatDate(monthStart),
      monthLabel: this.formatMonthLabel(monthStart),
      lastMonthLabel: this.formatMonthLabel(this.addMonths(monthStart, -1)),
      monthTotal,
      lastMonthTotal: lastMonth ? lastMonthTotal : null,
      monthChangePct: this.pct(monthTotal, lastMonthTotal, !!lastMonth),
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

    while (cursor <= monthEnd) {
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
            changePct: null
          }
        );
        cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
      }

      const total = days.reduce((sum, d) => sum + (d.value ?? 0), 0);
      const hasLm = days.some((d) => d.lmValue !== null);
      const lmTotal = hasLm ? days.reduce((sum, d) => sum + (d.lmValue ?? 0), 0) : null;

      weeks.push({
        label: `Week ${weekIndex}`,
        total,
        lmTotal,
        changePct: this.pct(total, lmTotal ?? 0, hasLm),
        days
      });
      weekIndex++;
    }

    return weeks;
  }

  private buildColumnTotals(weeks: CalendarWeekRow[]): CalendarColumnTotal[] {
    return Array.from({ length: 7 }, (_, col) => {
      const cells = weeks.map((w) => w.days[col]).filter((d) => d.inMonth);
      const total = cells.reduce((sum, d) => sum + (d.value ?? 0), 0);
      const hasLm = cells.some((d) => d.lmValue !== null);
      const lmTotal = hasLm ? cells.reduce((sum, d) => sum + (d.lmValue ?? 0), 0) : null;
      return { total, lmTotal, changePct: this.pct(total, lmTotal ?? 0, hasLm) };
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

  private pct(current: number, previous: number, hasBaseline: boolean): number | null {
    if (!hasBaseline || previous === 0) {
      return null;
    }
    return Math.round(((current - previous) / previous) * 1000) / 10;
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
