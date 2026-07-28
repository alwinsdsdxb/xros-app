import { Component, Input, OnChanges } from '@angular/core';
import * as Highcharts from 'highcharts';
import { TrendPoint } from '../../../core/models/dashboard.model';

type TrendSeriesKey = 'passerBy' | 'totalFootfall' | 'uniqueFootfall';

interface SeriesMeta {
  key: TrendSeriesKey;
  label: string;
  color: string;
}

@Component({
  selector: 'app-trend-chart',
  templateUrl: './trend-chart.component.html',
  styleUrl: './trend-chart.component.scss'
})
export class TrendChartComponent implements OnChanges {
  @Input() trend: TrendPoint[] = [];

  Highcharts: typeof Highcharts = Highcharts;
  chartOptions: Highcharts.Options = {};
  private chartRef: Highcharts.Chart | undefined;

  readonly seriesMeta: SeriesMeta[] = [
    { key: 'passerBy', label: 'Passer By', color: '#2a78d6' },
    { key: 'totalFootfall', label: 'Total Footfall', color: '#eb6834' },
    { key: 'uniqueFootfall', label: 'Unique Footfall', color: '#1baf7a' }
  ];

  seriesVisibility: Record<TrendSeriesKey, boolean> = {
    passerBy: true,
    totalFootfall: true,
    uniqueFootfall: true
  };

  ngOnChanges(): void {
    this.buildChart();
  }

  onChartInstance(chart: Highcharts.Chart): void {
    this.chartRef = chart;
  }

  toggleSeries(key: TrendSeriesKey): void {
    this.seriesVisibility[key] = !this.seriesVisibility[key];
    const index = this.seriesMeta.findIndex((s) => s.key === key);
    const series = this.chartRef?.series?.[index];
    if (series) {
      series.setVisible(this.seriesVisibility[key], true);
    }
  }

  private buildChart(): void {
    const categories = this.trend.map((t) => t.time);
    const tickInterval = Math.max(1, Math.floor(categories.length / 12));

    this.chartOptions = {
      chart: { type: 'line', backgroundColor: 'transparent', height: 260 },
      title: { text: undefined },
      credits: { enabled: false },
      xAxis: {
        categories,
        tickInterval,
        lineColor: '#c3c2b7',
        labels: { style: { color: '#898781', fontSize: '11px' } }
      },
      yAxis: {
        title: { text: undefined },
        gridLineColor: '#e1e0d9',
        labels: { style: { color: '#898781' } }
      },
      legend: { enabled: false },
      tooltip: { shared: true },
      plotOptions: {
        line: {
          marker: { enabled: false },
          lineWidth: 2
        }
      },
      series: this.seriesMeta.map((meta) => ({
        type: 'line' as const,
        name: meta.label,
        color: meta.color,
        visible: this.seriesVisibility[meta.key],
        data: this.trend.map((t) => t[meta.key])
      }))
    };
  }
}
