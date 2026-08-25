// 'value' - a real, computable percentage (previous > 0).
// 'new'   - previous was exactly 0 and current > 0: growth from a zero base
//           isn't a meaningful percentage, but it is real growth.
// 'flat'  - previous was exactly 0 and current is also 0: no activity either
//           period, not "new".
// 'na'    - no baseline data exists at all for that period.
export type ChangeStatus = 'value' | 'new' | 'flat' | 'na';

export interface ChangeResult {
  status: ChangeStatus;
  pct: number | null;
}

export interface CalendarDayCell {
  date: string;
  day: number;
  inMonth: boolean;
  value: number | null;
  lmValue: number | null;
  lmChange: ChangeResult;
  lyValue: number | null;
  lyChange: ChangeResult;
}

export interface CalendarCampaignBanner {
  label: string;
  // 1-indexed grid-column bounds (start inclusive, end exclusive) within a
  // 9-track row: 1 = week-label col, 2-8 = Sun..Sat, 9 = total col.
  startCol: number;
  endCol: number;
}

export interface CalendarWeekRow {
  label: string;
  total: number;
  lmTotal: number | null;
  lmChange: ChangeResult;
  lyTotal: number | null;
  lyChange: ChangeResult;
  days: CalendarDayCell[];
  banners: CalendarCampaignBanner[];
}

export interface CalendarColumnTotal {
  total: number;
  lmTotal: number | null;
  lmChange: ChangeResult;
  lyTotal: number | null;
  lyChange: ChangeResult;
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
  lastYearLabel: string;
  monthTotal: number;
  lastMonthTotal: number | null;
  lmChange: ChangeResult;
  lastYearTotal: number | null;
  lyChange: ChangeResult;
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
