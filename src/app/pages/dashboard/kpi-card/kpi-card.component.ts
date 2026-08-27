import { Component, Input } from '@angular/core';
import { KpiMetric } from '../../../core/models/dashboard.model';

interface ComparisonRow {
  label: string;
  dateLabel: string;
  value: number;
  changePct: number;
}

export interface ComparisonDateLabels {
  day: string;
  week: string;
  month: string;
  year: string;
}

@Component({
  selector: 'app-kpi-card',
  templateUrl: './kpi-card.component.html',
  styleUrl: './kpi-card.component.scss'
})
export class KpiCardComponent {
  @Input() label = '';
  @Input() icon = 'trending_up';
  @Input() description = '';
  @Input() date = '';
  @Input() metric: KpiMetric | null = null;
  @Input() showComparisons = true;
  @Input() view = 'Day';
  // The actual calendar date/range each "Previous X" box is comparing
  // against - these are always relative to the selected date itself (see
  // dashboard.component.ts's getPreviousDateRange), not to the current
  // view's range, so they're computed once by the parent and handed down
  // rather than re-derived here from `view` alone.
  @Input() comparisonDateLabels: ComparisonDateLabels | null = null;

  // All four comparison periods are always present on the metric (the
  // widget's own compareConfig returns them together in one response,
  // regardless of the requested range) - which ones are relevant to show
  // depends on the view. Month/Year (and Custom, whose length isn't known)
  // only show Previous Month/Year - a "previous day" next to a month-wide
  // total isn't a meaningful comparison. Week only adds Previous Week to
  // that - previousDay is a single day's total next to a 7-day total, the
  // same mismatched comparison Month/Year already exclude it for. Day/
  // Yesterday show all four, since a single day is small enough that every
  // comparison period still reads as useful context.
  get comparisons(): ComparisonRow[] {
    if (!this.metric) {
      return [];
    }
    const dateLabels = this.comparisonDateLabels;
    const previousWeek = {
      label: 'Previous Week',
      dateLabel: dateLabels?.week ?? '',
      value: this.metric.previousWeek.value,
      changePct: this.metric.previousWeek.changePct
    };
    const monthAndYear = [
      {
        label: 'Previous Month',
        dateLabel: dateLabels?.month ?? '',
        value: this.metric.previousMonth.value,
        changePct: this.metric.previousMonth.changePct
      },
      {
        label: 'Previous Year',
        dateLabel: dateLabels?.year ?? '',
        value: this.metric.previousYear.value,
        changePct: this.metric.previousYear.changePct
      }
    ];
    if (this.view === 'Week') {
      return [previousWeek, ...monthAndYear];
    }
    const isLongRangeView = this.view === 'Month' || this.view === 'Year' || this.view === 'Custom';
    if (isLongRangeView) {
      return monthAndYear;
    }
    return [
      {
        label: 'Previous Day',
        dateLabel: dateLabels?.day ?? '',
        value: this.metric.previousDay.value,
        changePct: this.metric.previousDay.changePct
      },
      previousWeek,
      ...monthAndYear
    ];
  }
}
