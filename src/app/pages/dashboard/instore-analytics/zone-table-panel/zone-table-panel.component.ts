import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import * as Highcharts from 'highcharts';
import { ZoneHighlight, ZoneRow } from '../../../../core/models/instore-analytics.model';

export interface ZoneHighlights {
  topTrafficZone: ZoneHighlight;
  mostAttentionZone: ZoneHighlight;
  longestDwellZone: ZoneHighlight;
  opportunityZone: ZoneHighlight;
}

type ComparisonMetricKey = 'traffic' | 'visitors' | 'attentionVisitors' | 'avgResidenceTime' | 'sharePct';

interface MetricOption {
  key: ComparisonMetricKey;
  label: string;
}

@Component({
  selector: 'app-zone-table-panel',
  templateUrl: './zone-table-panel.component.html',
  styleUrl: './zone-table-panel.component.scss'
})
export class ZoneTablePanelComponent implements OnChanges {
  @Input() zones: ZoneRow[] = [];
  @Input() highlights: ZoneHighlights | null = null;

  selectedZoneKeys = new Set<string>();
  comparisonMetric: ComparisonMetricKey = 'traffic';
  comparisonChartOptions: Highcharts.Options = {};
  Highcharts: typeof Highcharts = Highcharts;

  readonly metricOptions: MetricOption[] = [
    { key: 'traffic', label: 'Traffic' },
    { key: 'visitors', label: 'Visitors' },
    { key: 'attentionVisitors', label: 'Attention' },
    { key: 'avgResidenceTime', label: 'Avg Dwell' },
    { key: 'sharePct', label: 'Share' }
  ];

  private readonly shareColors = ['#d9695a', '#e3a73c', '#e3c93c', '#a7b62e', '#4fae7a', '#1e8a57'];

  // All zones start selected (matches the old "All Zones" default view);
  // once the user has made their own selection, a fresh zones array (e.g.
  // from a filter/date change upstream) keeps only the keys that still
  // exist rather than silently resetting back to "all".
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['zones']) {
      const keys = new Set(this.zones.map((z) => z.key));
      this.selectedZoneKeys =
        this.selectedZoneKeys.size === 0 ? keys : new Set([...this.selectedZoneKeys].filter((k) => keys.has(k)));
    }
    this.buildComparisonChart();
  }

  get filteredZones(): ZoneRow[] {
    return this.zones.filter((z) => this.selectedZoneKeys.has(z.key));
  }

  get allSelected(): boolean {
    return this.zones.length > 0 && this.selectedZoneKeys.size === this.zones.length;
  }

  isSelected(key: string): boolean {
    return this.selectedZoneKeys.has(key);
  }

  toggleZone(key: string): void {
    const next = new Set(this.selectedZoneKeys);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    this.selectedZoneKeys = next;
    this.buildComparisonChart();
  }

  selectAll(): void {
    this.selectedZoneKeys = new Set(this.zones.map((z) => z.key));
    this.buildComparisonChart();
  }

  clearAll(): void {
    this.selectedZoneKeys = new Set();
    this.buildComparisonChart();
  }

  setComparisonMetric(key: ComparisonMetricKey): void {
    this.comparisonMetric = key;
    this.buildComparisonChart();
  }

  colorForZone(key: string): string {
    const idx = this.zones.findIndex((z) => z.key === key);
    return this.shareColors[idx % this.shareColors.length];
  }

  formatDuration(seconds: number): string {
    const pad = (v: number) => v.toString().padStart(2, '0');
    const hh = Math.floor(seconds / 3600);
    const mm = Math.floor((seconds % 3600) / 60);
    const ss = Math.floor(seconds % 60);
    return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
  }

  // A single metric at a time (toggled via metricOptions) rather than every
  // metric on one chart - Traffic/Visitors/Attention are raw counts in the
  // thousands, Avg Dwell is a duration, and Share is a 0-100 percentage;
  // plotting all of them together on one axis would flatten the smaller-
  // scale ones into invisible slivers.
  private buildComparisonChart(): void {
    const zones = this.filteredZones;
    const metric = this.comparisonMetric;
    const label = this.metricOptions.find((m) => m.key === metric)?.label ?? metric;
    const isDuration = metric === 'avgResidenceTime';
    const isPct = metric === 'sharePct';
    const formatDuration = (seconds: number) => this.formatDuration(seconds);

    this.comparisonChartOptions = {
      chart: { type: 'column', backgroundColor: 'transparent', height: 240 },
      title: { text: undefined },
      credits: { enabled: false },
      xAxis: {
        categories: zones.map((z) => z.label),
        labels: { style: { color: '#546e7a', fontSize: '11px' } }
      },
      yAxis: {
        title: { text: undefined },
        gridLineColor: '#e6eaec',
        labels: {
          style: { color: '#78909c' },
          formatter: function () {
            const value = Number(this.value);
            if (isDuration) {
              return formatDuration(value);
            }
            return isPct ? `${value}%` : `${value}`;
          }
        }
      },
      legend: { enabled: false },
      tooltip: {
        formatter: function () {
          const value = Number(this.y);
          const formatted = isDuration ? formatDuration(value) : isPct ? `${value}%` : value.toLocaleString('en-US');
          return `<b>${this.x}</b><br/>${label}: <b>${formatted}</b>`;
        }
      },
      plotOptions: {
        column: {
          borderRadius: 4,
          colorByPoint: true,
          groupPadding: 0.15
        }
      },
      series: [
        {
          type: 'column',
          name: label,
          data: zones.map((z) => ({ y: z[metric], color: this.colorForZone(z.key) }))
        }
      ]
    };
  }
}
