import { Component, Input, OnChanges } from '@angular/core';
import Highcharts from '../../../../core/highcharts-setup';
import 'highcharts/es-modules/masters/modules/heatmap.src';
import 'highcharts/es-modules/masters/modules/exporting.src';
import 'highcharts/es-modules/masters/modules/offline-exporting.src';
import { PeakHours } from '../../../../core/models/instore-analytics.model';

const DEFAULT_MAX_COLOR = '#0f4c73';

@Component({
  selector: 'app-peak-hours-panel',
  templateUrl: './peak-hours-panel.component.html',
  styleUrl: './peak-hours-panel.component.scss'
})
export class PeakHoursPanelComponent implements OnChanges {
  @Input() peakHours: PeakHours | null = null;

  Highcharts: typeof Highcharts = Highcharts;
  chartOptions: Highcharts.Options = {};

  ngOnChanges(): void {
    this.buildChart();
  }

  private buildChart(): void {
    const p = this.peakHours;
    if (!p) {
      this.chartOptions = {};
      return;
    }

    const knownValues = p.grid.flat().filter((v): v is number => v !== null);
    const max = knownValues.length ? Math.max(...knownValues) : 0;
    const days = p.days;
    const hours = p.hours;
    const rowHeight = days.length > 10 ? 22 : 40;
    const chartHeight = Math.max(360, days.length * rowHeight + 90);
    const legendHeight = Math.min(280, days.length * rowHeight);

    // Only the day(s) actually present in the queried range get real values -
    // other rows stay null and are simply omitted from the heatmap's data
    // instead of rendering as a misleading zero.
    const data = p.grid.flatMap((row, dayIdx) =>
      row
        .map((value, hourIdx) => ({ value, hourIdx }))
        .filter((cell): cell is { value: number; hourIdx: number } => cell.value !== null)
        .map(({ value, hourIdx }) => ({
          x: hourIdx,
          y: dayIdx,
          value,
          dataLabels: {
            style: { color: value > max * 0.55 ? '#ffffff' : '#14273a' }
          }
        }))
    );

    this.chartOptions = {
      chart: { type: 'heatmap', backgroundColor: 'transparent', height: chartHeight, marginTop: 30, marginBottom: 60 },
      title: { text: undefined },
      credits: { enabled: false },
      xAxis: {
        categories: hours,
        labels: { style: { color: '#78909c', fontSize: '11px' } }
      },
      yAxis: {
        categories: days,
        title: { text: undefined },
        reversed: true,
        labels: { style: { color: '#546e7a', fontSize: '11px', fontWeight: '700' } }
      },
      colorAxis: {
        min: 0,
        minColor: '#ffffff',
        maxColor: p.color || DEFAULT_MAX_COLOR
      },
      legend: {
        enabled: true,
        align: 'right',
        layout: 'vertical',
        margin: 0,
        verticalAlign: 'top',
        y: 25,
        symbolHeight: legendHeight
      },
      tooltip: {
        formatter(this: any): string {
          return `<b>${days[this.point.y]} - ${hours[this.point.x]}</b><br/><b>${this.point.value}</b>`;
        }
      },
      exporting: {
        enabled: true,
        fallbackToExportServer: false,
        sourceWidth: 1200
      },
      series: [
        {
          type: 'heatmap',
          data,
          borderWidth: 1,
          borderColor: '#ffffff',
          dataLabels: {
            enabled: true,
            style: { fontSize: '10px', fontWeight: '600', textOutline: 'none' }
          }
        }
      ]
    };
  }
}
