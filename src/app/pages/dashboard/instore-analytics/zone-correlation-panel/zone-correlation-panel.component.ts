import { Component, Input, OnChanges } from '@angular/core';
import Highcharts from '../../../../core/highcharts-setup';
import 'highcharts/es-modules/masters/modules/sankey.src';
import 'highcharts/es-modules/masters/modules/dependency-wheel.src';
import { ZoneCorrelation, ZoneHighlight, ZoneRow } from '../../../../core/models/instore-analytics.model';

export interface MetricMatrixRow {
  key: string;
  label: string;
  traffic: number;
  sharePct: number;
  capturePct: number;
  dwellSeconds: number;
  dwellLabel: string;
  color: string;
}

@Component({
  selector: 'app-zone-correlation-panel',
  templateUrl: './zone-correlation-panel.component.html',
  styleUrl: './zone-correlation-panel.component.scss'
})
export class ZoneCorrelationPanelComponent implements OnChanges {
  @Input() correlation: ZoneCorrelation | null = null;
  // Same real per-zone data (traffic, attentionVisitors, avgResidenceTime,
  // sharePct) already fetched for the Zone Table panel - reused here for the
  // Metric Matrix tab and to fill in Highest Capture / Engagement Leader,
  // which the Zone Correlation widget itself never carries (see
  // toZoneCorrelation() in the parent).
  @Input() zones: ZoneRow[] = [];

  Highcharts: typeof Highcharts = Highcharts;
  chartOptions: Highcharts.Options = {};

  readonly tabs = [
    { key: 'customer-flow', label: 'Customer Flow', enabled: true },
    { key: 'metric-matrix', label: 'Metric Matrix', enabled: true },
    { key: 'dwell-comparison', label: 'Dwell Comparison', enabled: true }
  ];
  activeTab = 'customer-flow';

  // Only show the strongest flows - a wheel/table with every zone-pair link
  // at once is unreadable regardless of chart type (dataviz skill: >~7-8
  // categorical classes blur together). shownFlowCount/totalFlowCount drive
  // the caption so the cap is visible, never silent.
  private readonly maxFlows = 15;
  shownFlowCount = 0;
  totalFlowCount = 0;

  // Validated categorical palette (dataviz skill default) - same order as
  // floor-plan-panel's ZONE_PALETTE, so a zone's color stays consistent
  // across the Floor Plan overlay and this panel's two tabs.
  private readonly zonePalette = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];

  get matrixRows(): MetricMatrixRow[] {
    return this.zones.map((z, index) => ({
      key: z.key,
      label: z.label,
      traffic: z.traffic,
      sharePct: z.sharePct,
      capturePct: z.traffic > 0 ? Math.round((z.attentionVisitors / z.traffic) * 100) : 0,
      dwellSeconds: z.avgResidenceTime,
      dwellLabel: this.formatMinSec(z.avgResidenceTime),
      color: this.zonePalette[index % this.zonePalette.length]
    }));
  }

  // Ranked longest-to-shortest so the biggest dwell bar leads, matching the
  // Engagement Leader framing below.
  get dwellComparisonRows(): MetricMatrixRow[] {
    return [...this.matrixRows].sort((a, b) => b.dwellSeconds - a.dwellSeconds);
  }

  get highestCaptureTile(): ZoneHighlight {
    const rows = this.matrixRows.filter((r) => r.traffic > 0);
    if (!rows.length) {
      return this.correlation?.highestCapture ?? { label: '—', sub: 'No data' };
    }
    const top = rows.reduce((a, b) => (b.capturePct > a.capturePct ? b : a));
    return { label: top.label, sub: `${top.capturePct}% unique capture rate` };
  }

  get engagementLeaderTile(): ZoneHighlight {
    const rows = this.matrixRows.filter((r) => r.dwellSeconds > 0);
    if (!rows.length) {
      return this.correlation?.engagementLeader ?? { label: '—', sub: 'No data' };
    }
    const top = rows.reduce((a, b) => (b.dwellSeconds > a.dwellSeconds ? b : a));
    return { label: top.label, sub: `${top.dwellLabel} avg dwell` };
  }

  ngOnChanges(): void {
    this.buildChart();
  }

  selectTab(tab: { key: string; enabled: boolean }): void {
    if (!tab.enabled) {
      return;
    }
    this.activeTab = tab.key;
  }

  // Zones exchange visitors in both directions (Counter 1 -> Counter 3 AND
  // Counter 3 -> Counter 1 both appear in the data) and there's no real
  // "stage order" between zones - it's a many-to-many relationship among one
  // set of things, not a pipeline. A left-to-right Sankey has no correct
  // single direction for a two-way edge (previously forced one via a fake
  // per-zone column, which fanned every zone out into its own column and
  // buried the chart in criss-crossing ribbons). A dependency wheel is the
  // right form for "flow between the same set of categories": one ring of
  // zones, arcs through the middle sized by shared volume, no forced
  // direction/column to get wrong. Bidirectional pairs are still merged into
  // one undirected arc (matches the existing "A ↔ B" tooltip framing), and
  // only the strongest maxFlows arcs are drawn - remaining detail lives in
  // the Metric Matrix tab, not crammed into this chart too.
  private buildChart(): void {
    const c = this.correlation;
    if (!c || !c.flows.length) {
      this.chartOptions = {};
      this.shownFlowCount = 0;
      this.totalFlowCount = 0;
      return;
    }

    const merged = new Map<string, { from: string; to: string; weight: number }>();
    for (const f of c.flows) {
      if (f.from === f.to) {
        continue;
      }
      const [from, to] = f.from.localeCompare(f.to) <= 0 ? [f.from, f.to] : [f.to, f.from];
      const key = `${from}|${to}`;
      const existing = merged.get(key);
      if (existing) {
        existing.weight += f.weight;
      } else {
        merged.set(key, { from, to, weight: f.weight });
      }
    }

    const allEdges = Array.from(merged.values()).sort((a, b) => b.weight - a.weight);
    const edges = allEdges.slice(0, this.maxFlows);
    this.totalFlowCount = allEdges.length;
    this.shownFlowCount = edges.length;

    const nodeIds = Array.from(new Set(edges.flatMap((e) => [e.from, e.to]))).sort();
    const nodes = nodeIds.map((id, i) => ({ id, color: this.zonePalette[i % this.zonePalette.length] }));

    this.chartOptions = {
      chart: { type: 'dependencywheel', backgroundColor: 'transparent', height: 380 },
      title: { text: undefined },
      credits: { enabled: false },
      tooltip: {
        pointFormat: '{point.fromNode.name} ↔ {point.toNode.name}: <b>{point.weight}</b>'
      },
      series: [
        {
          type: 'dependencywheel',
          keys: ['from', 'to', 'weight'],
          data: edges.map((e) => [e.from, e.to, e.weight]),
          nodes,
          dataLabels: {
            style: { color: '#14273a', textOutline: 'none', fontSize: '11px', fontWeight: '600' },
            distance: 12
          },
          linkOpacity: 0.55
        } as Highcharts.SeriesDependencywheelOptions
      ]
    };
  }

  private formatMinSec(seconds: number): string {
    const mm = Math.floor(seconds / 60);
    const ss = Math.floor(seconds % 60)
      .toString()
      .padStart(2, '0');
    return `${mm}:${ss}`;
  }
}
