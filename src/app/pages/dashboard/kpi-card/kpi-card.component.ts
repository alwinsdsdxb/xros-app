import { Component, Input } from '@angular/core';
import { KpiMetric } from '../../../core/models/dashboard.model';

interface ComparisonRow {
  label: string;
  value: number;
  changePct: number;
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

  // All four comparison periods are always present on the metric (the
  // widget's own compareConfig returns them together in one response,
  // regardless of the requested range) - which ones are relevant to show
  // depends on the view. Month/Year (and Custom, whose length isn't known)
  // only show Previous Month/Year - a "previous day" next to a month-wide
  // total isn't a meaningful comparison. Day/Week show all four, since a
  // single day or week is small enough that every comparison period still
  // reads as useful context.
  get comparisons(): ComparisonRow[] {
    if (!this.metric) {
      return [];
    }
    const monthAndYear = [
      { label: 'Previous Month', value: this.metric.previousMonth.value, changePct: this.metric.previousMonth.changePct },
      { label: 'Previous Year', value: this.metric.previousYear.value, changePct: this.metric.previousYear.changePct }
    ];
    const isLongRangeView = this.view === 'Month' || this.view === 'Year' || this.view === 'Custom';
    if (isLongRangeView) {
      return monthAndYear;
    }
    return [
      { label: 'Previous Day', value: this.metric.previousDay.value, changePct: this.metric.previousDay.changePct },
      { label: 'Previous Week', value: this.metric.previousWeek.value, changePct: this.metric.previousWeek.changePct },
      ...monthAndYear
    ];
  }
}
