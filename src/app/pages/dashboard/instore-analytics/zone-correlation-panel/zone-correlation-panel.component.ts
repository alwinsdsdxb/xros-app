import { Component, Input, OnChanges } from '@angular/core';
import Highcharts from '../../../../core/highcharts-setup';
import 'highcharts/es-modules/masters/modules/sankey.src';
import { ZoneCorrelation, ZoneFlowLink, ZoneHighlight, ZoneRow } from '../../../../core/models/instore-analytics.model';

export interface MetricMatrixRow {
  key: string;
  label: string;
  traffic: number;
  uniqueFootfall: number;
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
  // Mirrors chartOptions.chart.height - the <highcharts-chart> container's
  // own CSS height needs to grow along with it (see buildChart()), or a
  // taller-than-380px chart just gets clipped by a container that never
  // resized.
  chartHeight = 380;

  readonly tabs = [
    { key: 'entrance-flow', label: 'Entrance Flow', enabled: true },
    { key: 'customer-flow', label: 'Customer Flow', enabled: true },
    { key: 'metric-matrix', label: 'Metric Matrix', enabled: true },
    { key: 'dwell-comparison', label: 'Dwell Comparison', enabled: true }
  ];
  activeTab = 'entrance-flow';

  // Only show the strongest flows - a wheel/table with every zone-pair link
  // at once is unreadable regardless of chart type (dataviz skill: >~7-8
  // categorical classes blur together). shownFlowCount/totalFlowCount drive
  // the caption so the cap is visible, never silent.
  private readonly maxFlows = 15;
  shownFlowCount = 0;
  totalFlowCount = 0;
  // Only genuinely disconnected flows (neither end reachable from the
  // anchor at all) land here now - same-tier/backward flows are no longer
  // dropped, see buildChart()'s duplicate-node routing.
  untieredFlowCount = 0;
  // The zone(s) buildChart() anchored the linear layout on this run -
  // surfaced so the caption can name them.
  flowAnchorZone = '';
  // True only when no real Entrance zone was in the data and buildChart()
  // fell back to the single highest-traffic zone instead - drives the
  // caption's "(highest-traffic zone)" qualifier, which would be misleading
  // to show whenever a real entrance was found instead.
  flowAnchorIsFallback = false;

  // Validated categorical palette (dataviz skill default) - same order as
  // floor-plan-panel's ZONE_PALETTE, so a zone's color stays consistent
  // across the Floor Plan overlay and this panel's two tabs.
  private readonly zonePalette = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];

  // Entrance Flow tab (additive - see zone-correlation-panel plan): a separate
  // Sankey view of the same flows, anchored on entrances instead of the
  // undirected wheel above. Kept fully independent of chartOptions/buildChart()
  // so the Customer Flow tab is untouched.
  entranceFlowChartOptions: Highcharts.Options = {};
  shownEntranceFlowCount = 0;
  totalEntranceFlowCount = 0;
  droppedSameTierCount = 0;
  private readonly entranceColor = '#00b8d9';
  // Same teal as entranceColor, separate field since it marks a different
  // concept (this run's computed highest-traffic zone, not an entrance).
  private readonly flowAnchorColor = '#00b8d9';

  get matrixRows(): MetricMatrixRow[] {
    return this.zones.map((z, index) => ({
      key: z.key,
      label: z.label,
      traffic: z.traffic,
      uniqueFootfall: z.visitors,
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
    this.buildEntranceFlowChart();
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
  // set of things, not a pipeline. A dependency wheel used to be drawn here
  // for exactly that reason (a first Sankey attempt with no anchor forced a
  // fake per-zone column per node and buried the chart in criss-crossing
  // ribbons) - but a wheel with up to maxFlows=15 arcs packs enough nodes
  // around the ring that their labels collide too.
  //
  // This now reuses Entrance Flow's own trick (computeTiersFromAnchors),
  // anchored on the same real Entrance zone(s) Entrance Flow uses (name-match
  // via isEntrance) when the data has one - falling back to the single
  // highest-traffic zone only when no entrance is present, so the diagram
  // still has somewhere sensible to start from. Either way this gives
  // Highcharts a real left-to-right order to lay out instead of inferring
  // one. Unlike Entrance Flow, though, nothing here gets dropped for having
  // "no clear direction": every recorded flow keeps its own weight, and any
  // flow that would go sideways (same tier) or backward (toward the anchor)
  // is routed forward into a *duplicate* instance of its target zone one
  // column later instead - see resolveTargetId(). The same real zone can
  // legitimately appear more than once across the diagram this way (same
  // color, same name, different column), which is the accepted trade-off
  // for showing 100% of the data on a strictly left-to-right chart.
  private buildChart(): void {
    const c = this.correlation;
    if (!c || !c.flows.length) {
      this.chartOptions = {};
      this.chartHeight = 380;
      this.shownFlowCount = 0;
      this.totalFlowCount = 0;
      this.untieredFlowCount = 0;
      this.flowAnchorZone = '';
      this.flowAnchorIsFallback = false;
      return;
    }

    const entranceAnchors = Array.from(new Set(c.flows.flatMap((f) => [f.from, f.to]).filter((n) => this.isEntrance(n))));
    const busiestZone = entranceAnchors.length ? null : this.computeAnchorZone(c.flows);
    const anchors = entranceAnchors.length ? entranceAnchors : busiestZone ? [busiestZone] : [];
    if (!anchors.length) {
      this.chartOptions = {};
      this.chartHeight = 380;
      this.shownFlowCount = 0;
      this.totalFlowCount = 0;
      this.untieredFlowCount = 0;
      this.flowAnchorZone = '';
      this.flowAnchorIsFallback = false;
      return;
    }
    this.flowAnchorZone = anchors.join(', ');
    this.flowAnchorIsFallback = !entranceAnchors.length;

    const tiers = this.computeTiersFromAnchors(c.flows, anchors);

    // id -> tier for every id actually used below, including duplicate ids
    // (real name + "#" + column) minted on demand - parseId() reads this
    // back out for node placement/labeling.
    const idTier = new Map<string, number>();
    for (const [name, tier] of tiers) {
      idTier.set(name, tier);
    }
    const resolveTargetId = (fromTier: number, toName: string): string => {
      const homeTier = tiers.get(toName)!;
      if (homeTier > fromTier) {
        return toName;
      }
      const duplicateTier = fromTier + 1;
      const id = `${toName}#${duplicateTier}`;
      if (!idTier.has(id)) {
        idTier.set(id, duplicateTier);
      }
      return id;
    };
    const parseId = (id: string): { name: string; tier: number } => {
      const hashIdx = id.lastIndexOf('#');
      return hashIdx === -1 ? { name: id, tier: idTier.get(id)! } : { name: id.slice(0, hashIdx), tier: idTier.get(id)! };
    };

    // Every raw flow record becomes its own edge, kept in full (weights
    // are only combined when two records resolve to the exact same
    // from/to pair, e.g. duplicate source rows) - nothing is dropped for
    // lacking a natural left-to-right order the way Entrance Flow drops
    // same-tier pairs.
    const merged = new Map<string, { from: string; to: string; weight: number }>();
    let untiered = 0;
    for (const f of c.flows) {
      if (f.from === f.to) {
        continue;
      }
      const fromTier = tiers.get(f.from);
      if (fromTier === undefined || !tiers.has(f.to)) {
        untiered++;
        continue;
      }
      const to = resolveTargetId(fromTier, f.to);
      const key = `${f.from}|${to}`;
      const existing = merged.get(key);
      if (existing) {
        existing.weight += f.weight;
      } else {
        merged.set(key, { from: f.from, to, weight: f.weight });
      }
    }

    // No maxFlows cap here (unlike Entrance Flow below) - every resolved
    // edge is drawn, sorted only for a stable strongest-first tooltip/legend
    // reading order, not to decide what gets left out.
    const edges = Array.from(merged.values()).sort((a, b) => b.weight - a.weight);
    this.totalFlowCount = edges.length;
    this.shownFlowCount = edges.length;
    this.untieredFlowCount = untiered;

    if (!edges.length) {
      this.chartOptions = {};
      this.chartHeight = 380;
      return;
    }

    const nodeIds = Array.from(new Set(edges.flatMap((e) => [e.from, e.to]))).sort((a, b) => {
      const pa = parseId(a);
      const pb = parseId(b);
      return pa.tier - pb.tier || pa.name.localeCompare(pb.name);
    });
    const colorByName = new Map<string, string>();
    let zoneColorIndex = 0;
    const nodes = nodeIds.map((id) => {
      const { name, tier } = parseId(id);
      if (tier === 0) {
        return { id, name, column: tier, color: this.flowAnchorColor };
      }
      if (!colorByName.has(name)) {
        colorByName.set(name, this.zonePalette[zoneColorIndex % this.zonePalette.length]);
        zoneColorIndex++;
      }
      return { id, name, column: tier, color: colorByName.get(name)! };
    });

    // Height now scales with the tallest column - with no maxFlows cap, a
    // busy day can stack well past the old fixed 380px's worth of nodes in
    // one tier, and a fixed height would just re-introduce label collisions
    // vertically instead of horizontally.
    const columnSizes = new Map<number, number>();
    nodes.forEach((n) => columnSizes.set(n.column, (columnSizes.get(n.column) ?? 0) + 1));
    const tallestColumn = Math.max(1, ...columnSizes.values());
    this.chartHeight = Math.max(380, tallestColumn * 46);

    // The anchor column (tier 0) is usually just the entrance - Sankey node
    // height defaults to being proportional to that node's own flow weight,
    // which is typically much less than other columns' *total* weight
    // (later columns also pick up volume from duplicate-routed same-tier/
    // backward flows that never actually pass through the entrance - see
    // resolveTargetId()). Left alone, that renders the entrance as a short
    // bar with dead space above/below it.
    this.fillAnchorColumn(nodes, edges);

    this.chartOptions = {
      chart: { type: 'sankey', backgroundColor: 'transparent', height: this.chartHeight },
      title: { text: undefined },
      credits: { enabled: false },
      tooltip: {
        pointFormat: '{point.fromNode.name} → {point.toNode.name}: <b>{point.weight:,.0f}</b>'
      },
      series: [
        {
          type: 'sankey',
          keys: ['from', 'to', 'weight'],
          data: edges.map((e) => [e.from, e.to, e.weight]),
          nodes,
          dataLabels: {
            style: { color: '#14273a', textOutline: 'none', fontSize: '11px', fontWeight: '600' },
            allowOverlap: false
          }
        } as Highcharts.SeriesSankeyOptions
      ]
    };
  }

  // Setting a node's `height` alone (what this used to do) isn't enough:
  // Highcharts positions every node in a column using its *natural*,
  // un-overridden weight-proportional height (SankeyColumnComposition.
  // offset()/top() in the highcharts package - the override is only read
  // later, purely for the rendered box size). With 2+ anchor nodes that
  // mismatch stacks the boxes on top of each other instead of below one
  // another. This replicates that same layout math (nodePadding: 10,
  // chart.spacing: [10,10,15,10], 'center' nodeAlignment, getSum() = max of
  // a node's total incoming/outgoing weight - all Highcharts sankey
  // defaults, none overridden elsewhere in this chart) to compute a
  // per-node `offsetVertical` that cancels the natural position out and
  // replaces it with an evenly-split, non-overlapping stack that fills the
  // full plot height. Single-anchor columns are left alone - nothing else
  // in that column to overlap with, so the plain height override is safe.
  private fillAnchorColumn(
    nodes: { id: string; column: number; height?: number; offsetVertical?: number }[],
    edges: { from: string; to: string; weight: number }[]
  ): void {
    const NODE_PADDING = 10;
    const PLOT_SIZE_Y = this.chartHeight - 25; // chart.spacing default: 10 top + 15 bottom
    if (PLOT_SIZE_Y <= 0) {
      return;
    }

    const sumTo = new Map<string, number>();
    const sumFrom = new Map<string, number>();
    for (const e of edges) {
      sumFrom.set(e.from, (sumFrom.get(e.from) ?? 0) + e.weight);
      sumTo.set(e.to, (sumTo.get(e.to) ?? 0) + e.weight);
    }
    const getSum = (id: string) => Math.max(sumTo.get(id) ?? 0, sumFrom.get(id) ?? 0);

    const byColumn = new Map<number, string[]>();
    for (const n of nodes) {
      if (!byColumn.has(n.column)) {
        byColumn.set(n.column, []);
      }
      byColumn.get(n.column)!.push(n.id);
    }

    // Global translation factor - Highcharts uses the same pixels-per-unit-
    // weight ratio for every column, taking whichever column needs the
    // smallest one to fit (SankeySeries.translate()).
    let translationFactor = Infinity;
    for (const ids of byColumn.values()) {
      const columnSum = ids.reduce((s, id) => s + getSum(id), 0);
      if (columnSum > 0) {
        const remainingHeight = PLOT_SIZE_Y - (ids.length - 1) * NODE_PADDING;
        translationFactor = Math.min(translationFactor, remainingHeight / columnSum);
      }
    }
    if (!Number.isFinite(translationFactor)) {
      return;
    }

    // Highcharts does NOT stack a column in the order `nodes` is given to
    // the series. Its node list is built by scanning `series.data` (our
    // `edges`, sorted strongest-first) and adding each id the first time it
    // appears as a `from` or `to` (NodesComposition.generatePoints); nodes
    // are then stable-sorted by a computed graph "level", which every
    // anchor ties at 0 (no incoming edges reach an anchor - see
    // resolveTargetId()), so ties fall straight back to that same
    // first-appearance-in-edges order. Anything else (e.g. alphabetical)
    // assigns each node's offset to the wrong slot in Highcharts' real
    // internal order - this reproduces that exact order for column 0.
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const seen = new Set<string>();
    const nodeAppearanceOrder: string[] = [];
    for (const e of edges) {
      if (!seen.has(e.from)) {
        seen.add(e.from);
        nodeAppearanceOrder.push(e.from);
      }
      if (!seen.has(e.to)) {
        seen.add(e.to);
        nodeAppearanceOrder.push(e.to);
      }
    }
    const anchorIds = nodeAppearanceOrder.filter((id) => nodeById.get(id)?.column === 0);
    if (anchorIds.length < 2) {
      if (anchorIds.length === 1) {
        const node = nodeById.get(anchorIds[0]);
        if (node) {
          node.height = PLOT_SIZE_Y;
        }
      }
      return;
    }

    const naturalHeights = anchorIds.map((id) => getSum(id) * translationFactor);
    const naturalColumnHeight = naturalHeights.reduce((s, h) => s + h, 0) + (anchorIds.length - 1) * NODE_PADDING;
    const naturalColumnTop = 0.5 * (PLOT_SIZE_Y - naturalColumnHeight); // getAlignFactor('center') === 0.5

    const desiredHeight = (PLOT_SIZE_Y - (anchorIds.length - 1) * NODE_PADDING) / anchorIds.length;

    let naturalOffset = 0;
    let desiredOffset = 0;
    anchorIds.forEach((id, i) => {
      const node = nodes.find((n) => n.id === id);
      if (node) {
        node.height = desiredHeight;
        node.offsetVertical = desiredOffset - naturalColumnTop - naturalOffset;
      }
      naturalOffset += naturalHeights[i] + NODE_PADDING;
      desiredOffset += desiredHeight + NODE_PADDING;
    });
  }

  // Highest total incident flow weight (sum of every edge touching the
  // node, either direction) - a self-contained "busiest zone" measure
  // computed straight from the flow graph, so it can't drift out of sync
  // with a separately-fetched zones list keyed by name.
  private computeAnchorZone(flows: ZoneFlowLink[]): string | null {
    const weightByNode = new Map<string, number>();
    for (const f of flows) {
      if (f.from === f.to) {
        continue;
      }
      weightByNode.set(f.from, (weightByNode.get(f.from) ?? 0) + f.weight);
      weightByNode.set(f.to, (weightByNode.get(f.to) ?? 0) + f.weight);
    }
    let best: string | null = null;
    let bestWeight = -1;
    for (const [node, weight] of weightByNode) {
      if (weight > bestWeight) {
        bestWeight = weight;
        best = node;
      }
    }
    return best;
  }

  // "Entrance" isn't a real field anywhere in this data - zoneName is free
  // text from VION with no category/type flag (confirmed against the
  // backend). Name-matching is the only signal available.
  private isEntrance(name: string): boolean {
    return /entrance/i.test(name);
  }

  // Assigns each node a column by shortest hop-count from any of the given
  // anchors (multi-source BFS over an undirected adjacency - a zone pair
  // usually has flow recorded in both directions, but building both
  // directions here regardless means a zone with only a one-way recorded
  // edge into/out of the anchor's side still gets reached), instead of
  // letting Highcharts infer columns from a graph that has cycles - that's
  // what fanned every zone into its own column and produced criss-crossing
  // ribbons the last time Sankey was tried with no anchor at all (see
  // buildChart() above). Nodes with no path from any anchor are left
  // untiered and excluded from whichever diagram called this.
  private computeTiersFromAnchors(flows: ZoneFlowLink[], anchors: string[]): Map<string, number> {
    const adjacency = new Map<string, string[]>();
    const addEdge = (from: string, to: string) => {
      if (!adjacency.has(from)) {
        adjacency.set(from, []);
      }
      adjacency.get(from)!.push(to);
    };
    for (const f of flows) {
      if (f.from === f.to) {
        continue;
      }
      addEdge(f.from, f.to);
      addEdge(f.to, f.from);
    }

    const tiers = new Map<string, number>();
    const queue: string[] = [];
    for (const anchor of anchors) {
      if (!tiers.has(anchor)) {
        tiers.set(anchor, 0);
        queue.push(anchor);
      }
    }

    let head = 0;
    while (head < queue.length) {
      const node = queue[head++];
      const tier = tiers.get(node)!;
      for (const next of adjacency.get(node) ?? []) {
        if (!tiers.has(next)) {
          tiers.set(next, tier + 1);
          queue.push(next);
        }
      }
    }

    return tiers;
  }

  private buildEntranceFlowChart(): void {
    const c = this.correlation;
    if (!c || !c.flows.length || !c.flows.some((f) => this.isEntrance(f.from) || this.isEntrance(f.to))) {
      this.entranceFlowChartOptions = {};
      this.shownEntranceFlowCount = 0;
      this.totalEntranceFlowCount = 0;
      this.droppedSameTierCount = 0;
      return;
    }

    const entranceAnchors = Array.from(new Set(c.flows.flatMap((f) => [f.from, f.to]).filter((n) => this.isEntrance(n))));
    const tiers = this.computeTiersFromAnchors(c.flows, entranceAnchors);

    // Bidirectional pairs are merged into the lower-tier -> higher-tier
    // direction (net volume between the pair), same spirit as buildChart()'s
    // alphabetical merge but ordered by flow-distance-from-entrance so the
    // link actually points the way a Sankey column needs it to. Same-tier
    // pairs have no entrance-relative order to merge by, so they're dropped
    // and disclosed via droppedSameTierCount rather than misplaced.
    const merged = new Map<string, { from: string; to: string; weight: number }>();
    let droppedSameTier = 0;
    for (const f of c.flows) {
      if (f.from === f.to) {
        continue;
      }
      const tierFrom = tiers.get(f.from);
      const tierTo = tiers.get(f.to);
      if (tierFrom === undefined || tierTo === undefined) {
        continue;
      }
      if (tierFrom === tierTo) {
        droppedSameTier++;
        continue;
      }
      const [from, to] = tierFrom < tierTo ? [f.from, f.to] : [f.to, f.from];
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
    this.totalEntranceFlowCount = allEdges.length;
    this.shownEntranceFlowCount = edges.length;
    this.droppedSameTierCount = droppedSameTier;

    if (!edges.length) {
      this.entranceFlowChartOptions = {};
      return;
    }

    const nodeIds = Array.from(new Set(edges.flatMap((e) => [e.from, e.to]))).sort(
      (a, b) => tiers.get(a)! - tiers.get(b)! || a.localeCompare(b)
    );
    let zoneColorIndex = 0;
    const nodes = nodeIds.map((id) => {
      if (this.isEntrance(id)) {
        return { id, column: tiers.get(id)!, color: this.entranceColor };
      }
      const color = this.zonePalette[zoneColorIndex % this.zonePalette.length];
      zoneColorIndex++;
      return { id, column: tiers.get(id)!, color };
    });

    this.entranceFlowChartOptions = {
      chart: { type: 'sankey', backgroundColor: 'transparent', height: 380 },
      title: { text: undefined },
      credits: { enabled: false },
      tooltip: {
        pointFormat: '{point.fromNode.name} → {point.toNode.name}: <b>{point.weight:,.0f}</b>'
      },
      series: [
        {
          type: 'sankey',
          keys: ['from', 'to', 'weight'],
          data: edges.map((e) => [e.from, e.to, e.weight]),
          nodes,
          dataLabels: {
            style: { color: '#14273a', textOutline: 'none', fontSize: '11px', fontWeight: '600' },
            allowOverlap: false
          }
        } as Highcharts.SeriesSankeyOptions
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
