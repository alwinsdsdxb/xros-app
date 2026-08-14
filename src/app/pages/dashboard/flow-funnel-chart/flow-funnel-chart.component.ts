import { Component, Input, OnChanges } from '@angular/core';

export interface FunnelStageData {
  label: string;
  value: number;
  color?: string;
  description?: string;
  secondaryLabel?: string;
}

interface FunnelStage {
  label: string;
  value: number;
  description: string;
  secondaryLabel?: string;
  color: string;
  widthPct: number;
}

interface StagePreset {
  label: string;
  color: string;
  secondaryLabel?: string;
  describe: (value: number, values: number[]) => string;
}

// The fixed 6-stage design this chart is built around, top-to-bottom in
// pipeline order. Heading text, color and description phrasing are assigned
// strictly by POSITION (the 1st value that arrives gets Passer By's styling,
// the 2nd gets Total Traffic's, ...) rather than by matching the API's own
// label/color fields - the backend's wording and per-widget color config
// aren't reliable enough to match against (this is exactly why some
// polygons weren't getting a color before), but the pipeline's stage order
// is. Only applied when the input has exactly these 6 stages; any other
// count falls back to generic, fully data-driven presentation below instead
// of forcing a 6-stage design onto a different-shaped funnel.
const STAGE_PRESETS: StagePreset[] = [
  { label: 'PASSER BY', color: '#F15B24', describe: () => 'Storefront traffic baseline' },
  { label: 'TOTAL TRAFFIC', color: '#B2C617', describe: (value, values) => `${pctOf(value, values[0])}% of passerby` },
  { label: 'UNIQUE VISITORS', color: '#F3A313', describe: (value, values) => `${pctOf(value, values[1])}% of total traffic` },
  { label: 'POTENTIAL BUYERS', color: '#2F708F', describe: () => 'One potential buyer per visitor group' },
  {
    label: 'SALES CONVERSION',
    color: '#22958D',
    secondaryLabel: 'TRANSACTIONS',
    describe: (value, values) => `${pctOf(value, values[2])}% sales conversion`
  },
  { label: 'LOYALTY TRANSACTIONS', color: '#71808F', describe: (value, values) => `${pctOf(value, values[4])}% of transactions` }
];

// Fallback palette for a funnel that isn't exactly these 6 stages - cycles by
// position so every polygon still gets a distinct, real color rather than
// falling through to whatever (or no) color the caller's data happened to
// carry.
const FALLBACK_COLORS = STAGE_PRESETS.map((p) => p.color);

function pctOf(value: number, base: number | undefined): number {
  return base && base > 0 ? Math.round((value / base) * 100) : 0;
}

@Component({
  selector: 'app-flow-funnel-chart',
  templateUrl: './flow-funnel-chart.component.html',
  styleUrl: './flow-funnel-chart.component.scss'
})
export class FlowFunnelChartComponent implements OnChanges {
  @Input() funnelData: FunnelStageData[] = [];

  stages: FunnelStage[] = [];

  // Widths are a fixed, evenly-stepped sequence by position (100% down to a
  // 34% floor) rather than scaled to each stage's real value - a genuine
  // funnel narrows steadily top-to-bottom by design, not proportionally to
  // whatever a given tenant's numbers happen to be (a 1%-of-first stage would
  // otherwise render as a sliver too narrow for its own label).
  private static readonly MIN_WIDTH_PCT = 34;

  ngOnChanges(): void {
    const count = this.funnelData.length;
    const step = count > 1 ? (100 - FlowFunnelChartComponent.MIN_WIDTH_PCT) / (count - 1) : 0;
    const usePresets = count === STAGE_PRESETS.length;
    const values = this.funnelData.map((s) => s.value);

    this.stages = this.funnelData.map((stage, i) => {
      const preset = usePresets ? STAGE_PRESETS[i] : null;
      return {
        label: preset?.label ?? stage.label,
        value: stage.value,
        description: stage.description ?? preset?.describe(stage.value, values) ?? this.genericDescription(stage, i),
        secondaryLabel: stage.secondaryLabel ?? preset?.secondaryLabel,
        color: preset?.color ?? stage.color ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length],
        widthPct: 100 - step * i
      };
    });
  }

  private genericDescription(stage: FunnelStageData, index: number): string {
    if (index === 0) {
      return '';
    }
    const first = this.funnelData[0];
    const pct = pctOf(stage.value, first?.value);
    return first ? `${pct}% of ${first.label}` : '';
  }
}
