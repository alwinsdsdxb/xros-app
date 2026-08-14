import { Component, Input, OnChanges } from '@angular/core';
import * as Highcharts from 'highcharts';

export interface TrafficTrendSeries {
  label: string;
  color: string;
  points: { time: string; value: number }[];
}

@Component({
  selector: 'app-trend-chart',
  templateUrl: './trend-chart.component.html',
  styleUrl: './trend-chart.component.scss'
})
export class TrendChartComponent implements OnChanges {
  @Input() series: TrafficTrendSeries[] = [];

  Highcharts: typeof Highcharts = Highcharts;
  chartOptions: Highcharts.Options = {};
  private chartRef: Highcharts.Chart | undefined;

  seriesVisibility: Record<string, boolean> = {};

  ngOnChanges(): void {
    for (const s of this.series) {
      if (!(s.label in this.seriesVisibility)) {
        this.seriesVisibility[s.label] = true;
      }
    }
    this.buildChart();
  }

  onChartInstance(chart: Highcharts.Chart): void {
    this.chartRef = chart;
  }

  toggleSeries(label: string): void {
    this.seriesVisibility[label] = !this.seriesVisibility[label];
    const index = this.series.findIndex((s) => s.label === label);
    const chartSeries = this.chartRef?.series?.[index];
    if (chartSeries) {
      chartSeries.setVisible(this.seriesVisibility[label], true);
    }
  }

  rangeStart = '';
  rangeMid = '';
  rangeEnd = '';

  private buildChart(): void {
    // A series can legitimately come back with no points (e.g. no readings for
    // this store/date) — categories must come from whichever series actually has
    // data, not blindly from the first one.
    const richestSeries = this.series.reduce<TrafficTrendSeries | null>(
      (best, current) => (!best || current.points.length > best.points.length ? current : best),
      null
    );
    const categories = richestSeries?.points.map((p) => p.time) ?? [];
    const tickInterval = Math.max(1, Math.round(categories.length / 8));

    this.rangeStart = categories[0] ?? '';
    this.rangeMid = categories[Math.floor((categories.length - 1) / 2)] ?? '';
    this.rangeEnd = categories[categories.length - 1] ?? '';

    this.chartOptions = {
      chart: { type: 'spline', backgroundColor: 'transparent', height: 320 },
      title: { text: undefined },
      credits: { enabled: false },
      xAxis: {
        categories,
        tickInterval,
        lineColor: '#e6eaec',
        tickColor: '#e6eaec',
        labels: { style: { color: '#78909c', fontSize: '11px' } }
      },
      yAxis: {
        title: { text: undefined },
        gridLineColor: '#eef1f5',
        labels: { style: { color: '#78909c', fontSize: '11px' } }
      },
      legend: { enabled: false },
      tooltip: { shared: true },
      plotOptions: {
        spline: {
          marker: { enabled: true, radius: 3, symbol: 'circle', lineWidth: 0 },
          lineWidth: 2.5
        }
      },
      series: this.series.map((s) => ({
        type: 'spline' as const,
        name: s.label,
        color: s.color,
        visible: this.seriesVisibility[s.label] ?? true,
        data: s.points.map((p) => p.value)
      }))
    };
  }
}
