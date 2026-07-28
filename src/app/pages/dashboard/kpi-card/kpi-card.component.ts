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

  get comparisons(): ComparisonRow[] {
    if (!this.metric) {
      return [];
    }
    return [
      { label: 'Previous Day', value: this.metric.previousDay.value, changePct: this.metric.previousDay.changePct },
      {
        label: 'Previous Week',
        value: this.metric.previousWeek.value,
        changePct: this.metric.previousWeek.changePct
      },
      {
        label: 'Previous Month',
        value: this.metric.previousMonth.value,
        changePct: this.metric.previousMonth.changePct
      },
      {
        label: 'Previous Year',
        value: this.metric.previousYear.value,
        changePct: this.metric.previousYear.changePct
      }
    ];
  }
}
