export type ForecastTag = 'holiday' | 'payday' | 'weekend' | 'baseline';

export interface ForecastDay {
  date: string;
  dayLabel: string;
  weekdayLabel: string;
  predicted: number;
  low: number;
  high: number;
  tag: ForecastTag;
  tagLabel: string;
  peakTime: string;
}

export interface ForecastPeakDay {
  date: string;
  dayLabel: string;
  value: number;
}

export interface ForecastResponse {
  scope: string;
  date: string;
  view: string;
  confidenceLabel: string;
  totalForecast: number;
  dailyAverage: number;
  peakForecastDay: ForecastPeakDay;
  scenarioDays: number;
  historyDays: number;
  historyRangeLabel: string;
  selectedRangeLabel: string;
  forecastAnchorLabel: string;
  days: ForecastDay[];
}

export interface ForecastQueryParams {
  scope?: string;
  date?: string;
  view?: string;
}
