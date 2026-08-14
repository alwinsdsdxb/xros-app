import { Component, Input, OnChanges } from '@angular/core';
import * as Highcharts from 'highcharts';
import { Dwell } from '../../../core/models/dashboard.model';

interface DwellTile {
  label: string;
  value: string;
  previousDay: string;
  changePct: number;
}

interface EngagementLegendItem {
  label: string;
  color: string;
  value: number;
  pct: number;
}

@Component({
  selector: 'app-dwell-panel',
  templateUrl: './dwell-panel.component.html',
  styleUrl: './dwell-panel.component.scss'
})
export class DwellPanelComponent implements OnChanges {
  @Input() dwell: Dwell | null = null;
  @Input() view = 'Day';

  private readonly previousPeriodLabels: Record<string, string> = {
    Day: 'prev day',
    Week: 'prev week',
    Month: 'prev month',
    Year: 'prev year',
    Custom: 'prev period'
  };

  get previousPeriodLabel(): string {
    return this.previousPeriodLabels[this.view] ?? 'prev period';
  }

  Highcharts: typeof Highcharts = Highcharts;
  distributionChartOptions: Highcharts.Options = {};
  engagementChartOptions: Highcharts.Options = {};
  trendChartOptions: Highcharts.Options = {};
  engagementLegend: EngagementLegendItem[] = [];

  private readonly engagementPalette = ['#263238', '#1e8a7c', '#a7b62e', '#e3a73c', '#7b5ea7'];

  get tiles(): DwellTile[] {
    const d = this.dwell;
    if (!d) {
      return [];
    }
    return [
      {
        label: 'Estimated Avg Dwell',
        value: `${d.estimatedAvgDwellMin.value} min`,
        previousDay: `${d.estimatedAvgDwellMin.previousDay} min`,
        changePct: d.estimatedAvgDwellMin.changePct
      },
      {
        label: 'Quick Visit %',
        value: `${d.quickVisitPct.value}%`,
        previousDay: `${d.quickVisitPct.previousDay}%`,
        changePct: d.quickVisitPct.changePct
      },
      {
        label: 'Engaged Visit %',
        value: `${d.engagedVisitPct.value}%`,
        previousDay: `${d.engagedVisitPct.previousDay}%`,
        changePct: d.engagedVisitPct.changePct
      },
      {
        label: 'Long Stay %',
        value: `${d.longStayPct.value}%`,
        previousDay: `${d.longStayPct.previousDay}%`,
        changePct: d.longStayPct.changePct
      },
      {
        label: 'Visitors in Analysis',
        value: `${d.visitorsInAnalysis.value}`,
        previousDay: `${d.visitorsInAnalysis.previousDay}`,
        changePct: d.visitorsInAnalysis.changePct
      }
    ];
  }

  ngOnChanges(): void {
    this.buildDistributionChart();
    this.buildEngagementChart();
    this.buildTrendChart();
  }

  private buildDistributionChart(): void {
    const buckets = [...(this.dwell?.distribution ?? [])].reverse();

    this.distributionChartOptions = {
      chart: { type: 'bar', backgroundColor: 'transparent', height: 220 },
      title: { text: undefined },
      credits: { enabled: false },
      xAxis: {
        categories: buckets.map((b) => b.label),
        labels: { style: { color: '#546e7a', fontSize: '11px' } }
      },
      yAxis: {
        title: { text: undefined },
        gridLineColor: '#e6eaec',
        labels: { style: { color: '#78909c' } }
      },
      legend: { enabled: false },
      plotOptions: {
        bar: {
          color: '#263238',
          borderRadius: 3,
          groupPadding: 0.18,
          dataLabels: { enabled: true, style: { color: '#546e7a', textOutline: 'none', fontSize: '11px' } }
        }
      },
      series: [
        {
          type: 'bar',
          name: 'Visitors',
          data: buckets.map((b) => b.value)
        }
      ]
    };
  }

  // Reuses the Dwell Time distribution's raw visitor counts (there's no
  // separate real "engagement composition" widget), relabeled per dwell tier
  // by the parent. Styled like the Gender Split donut elsewhere on this
  // dashboard for visual consistency: thin ring, no crowded inner labels,
  // center total, external legend carrying the real value + share.
  private buildEngagementChart(): void {
    const buckets = this.dwell?.engagementComposition ?? [];
    const palette = this.engagementPalette;
    const total = buckets.reduce((sum, b) => sum + b.value, 0);

    this.engagementLegend = buckets.map((b, i) => ({
      label: b.label,
      color: palette[i % palette.length],
      value: b.value,
      pct: total > 0 ? Math.round((b.value / total) * 100) : 0
    }));

    this.engagementChartOptions = {
      chart: { type: 'pie', backgroundColor: 'transparent', height: 220 },
      title: {
        text: total ? `${total.toLocaleString()}<br/><span style="font-size:11px;font-weight:400">Visits</span>` : '',
        align: 'center',
        verticalAlign: 'middle',
        y: 4,
        style: { color: '#263238', fontSize: '22px', fontWeight: '600' }
      },
      credits: { enabled: false },
      tooltip: { pointFormat: '{point.name}: <b>{point.y}</b> visits ({point.percentage:.1f}%)' },
      plotOptions: {
        pie: {
          innerSize: '72%',
          borderWidth: 2,
          borderColor: '#ffffff',
          states: { hover: { halo: { size: 6 } } },
          dataLabels: { enabled: false }
        }
      },
      legend: { enabled: false },
      series: [
        {
          type: 'pie',
          name: 'Engagement',
          data: buckets.map((b, i) => ({ name: b.label, y: b.value, color: palette[i % palette.length] }))
        }
      ]
    };
  }

  private buildTrendChart(): void {
    const points = this.dwell?.avgDwellTrend ?? [];

    this.trendChartOptions = {
      chart: { type: 'area', backgroundColor: 'transparent', height: 260 },
      title: { text: undefined },
      credits: { enabled: false },
      xAxis: {
        categories: points.map((p) => p.time),
        labels: { style: { color: '#78909c', fontSize: '11px' } }
      },
      yAxis: {
        title: { text: undefined },
        gridLineColor: '#e6eaec',
        labels: { style: { color: '#78909c' } }
      },
      legend: {
        enabled: true,
        align: 'right',
        verticalAlign: 'top',
        floating: true,
        itemStyle: { color: '#546e7a', fontSize: '11px', fontWeight: '600' },
        symbolWidth: 10,
        symbolRadius: 5
      },
      tooltip: { shared: true },
      plotOptions: {
        area: {
          marker: { enabled: false },
          lineWidth: 2,
          fillOpacity: 0.15
        }
      },
      series: [
        {
          type: 'area',
          name: 'Current',
          color: '#2f6fa7',
          fillColor: 'rgba(47, 111, 167, 0.18)',
          data: points.map((p) => p.current)
        },
        {
          type: 'area',
          name: 'Previous Day',
          color: '#78909c',
          dashStyle: 'ShortDash',
          fillOpacity: 0,
          data: points.map((p) => p.previousDay)
        }
      ]
    };
  }
}
