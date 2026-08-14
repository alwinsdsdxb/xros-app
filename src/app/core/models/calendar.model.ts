export interface CalendarDayCell {
  date: string;
  day: number;
  inMonth: boolean;
  value: number | null;
  lmValue: number | null;
  changePct: number | null;
}

export interface CalendarWeekRow {
  label: string;
  total: number;
  lmTotal: number | null;
  changePct: number | null;
  days: CalendarDayCell[];
}

export interface CalendarColumnTotal {
  total: number;
  lmTotal: number | null;
  changePct: number | null;
}

export interface CalendarBestWeek {
  label: string;
  total: number;
}

export interface CalendarAvailableMonth {
  value: string;
  label: string;
}

export interface CalendarResponse {
  scope: string;
  month: string;
  monthLabel: string;
  lastMonthLabel: string;
  monthTotal: number;
  lastMonthTotal: number | null;
  monthChangePct: number | null;
  bestWeek: CalendarBestWeek | null;
  columnLabels: string[];
  weeks: CalendarWeekRow[];
  columnTotals: CalendarColumnTotal[];
  availableMonths: CalendarAvailableMonth[];
}

export interface CalendarQueryParams {
  scope?: string;
  date?: string;
}
