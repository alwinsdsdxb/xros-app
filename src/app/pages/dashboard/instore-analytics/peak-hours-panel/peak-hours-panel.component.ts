import { Component, Input, OnChanges } from '@angular/core';
import Highcharts from '../../../../core/highcharts-setup';
import 'highcharts/es-modules/masters/modules/heatmap.src';
import 'highcharts/es-modules/masters/modules/exporting.src';
import 'highcharts/es-modules/masters/modules/offline-exporting.src';
import { PeakHours } from '../../../../core/models/instore-analytics.model';

@Component({
  selector: 'app-peak-hours-panel',
  templateUrl: './peak-hours-panel.component.html',
  styleUrl: './peak-hours-panel.component.scss'
})
export class PeakHoursPanelComponent implements OnChanges {
  @Input() peakHours: PeakHours | null = null;
  @Input() dateFrom: Date | null = null;
  @Input() dateTo: Date | null = null;
  @Input() totalFootfall: number | null = null;
  @Input() uniqueFootfall: number | null = null;
  @Input() male: number | null = null;
  @Input() female: number | null = null;

  Highcharts: typeof Highcharts = Highcharts;
  chartOptions: Highcharts.Options = {};
  chartVisible = true;
  chartHeight = 360;

  ngOnChanges(): void {
    this.buildChart();

    // A filter change can alter the grid's shape (e.g. fewer/more hour
    // columns when toggling Operational Hours), and Highcharts' oneToOne
    // update merges new points onto old ones by index rather than replacing
    // them, which left stale values on screen. Destroying and recreating the
    // chart component guarantees a clean render for the new data.
    this.chartVisible = false;
    setTimeout(() => (this.chartVisible = true));
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
    this.chartHeight = chartHeight;

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
        title: { text: 'Hour of Day', style: { color: '#78909c', fontSize: '11px', fontWeight: '600' } },
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
        stops: [
          [0, '#43a047'],
          [0.5, '#fb8c00'],
          [1, '#c62828']
        ]
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
          return `<b>${days[this.point.y]} - ${hours[this.point.x]}</b><br/><b>${(this.point.value ?? 0).toLocaleString('en-US')}</b>`;
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
