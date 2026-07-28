import { Component, Input, OnChanges } from '@angular/core';
import { FlowFunnel } from '../../../core/models/dashboard.model';

interface FunnelStage {
  label: string;
  value: number;
  sub: string;
  color: string;
  widthPct: number;
}

@Component({
  selector: 'app-flow-funnel-chart',
  templateUrl: './flow-funnel-chart.component.html',
  styleUrl: './flow-funnel-chart.component.scss'
})
export class FlowFunnelChartComponent implements OnChanges {
  @Input() funnel: FlowFunnel | null = null;

  stages: FunnelStage[] = [];

  private readonly stageColors = [
    'var(--series-2)', // orange
    'var(--series-3)', // olive
    'var(--series-4)', // gold
    'var(--series-1)', // blue
    'var(--series-5)', // teal
    'var(--series-7)' // slate navy
  ];

  private readonly stageWidths = [100, 91, 82, 73, 64, 56];

  ngOnChanges(): void {
    const f = this.funnel;
    if (!f) {
      this.stages = [];
      return;
    }

    const raw: Omit<FunnelStage, 'color' | 'widthPct'>[] = [
      { label: 'Passer By', value: f.passerBy, sub: '' },
      { label: 'Total Traffic', value: f.totalTraffic.value, sub: `${f.totalTraffic.entryRatePct}% entry rate` },
      {
        label: 'Unique Visitors',
        value: f.uniqueVisitors.value,
        sub: `${f.uniqueVisitors.identifiedTrafficPct}% identified traffic`
      },
      {
        label: 'Potential Buyers',
        value: f.potentialBuyers.value,
        sub: `${f.potentialBuyers.groupedVisitorsPct}% grouped visitors`
      },
      {
        label: 'Sales Conversion',
        value: f.salesConversion.value,
        sub: `${f.salesConversion.conversionPct}% sales conversion`
      },
      {
        label: 'Loyalty Transactions',
        value: f.loyaltyTransactions.value,
        sub: `${f.loyaltyTransactions.ofTransactionsPct}% of transactions`
      }
    ];

    this.stages = raw.map((s, i) => ({
      ...s,
      color: this.stageColors[i],
      widthPct: this.stageWidths[i]
    }));
  }
}
