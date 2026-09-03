import { Component, Input, OnChanges } from '@angular/core';
import * as Highcharts from 'highcharts';
import { Demographics } from '../../../core/models/dashboard.model';

interface GroupSizeRow {
  label: string;
  icon: string;
  value: number;
  pct: number;
}

interface AgeStat {
  label: string;
  value: number;
  pct: number;
  color: string;
}

@Component({
  selector: 'app-demographics-panel',
  templateUrl: './demographics-panel.component.html',
  styleUrl: './demographics-panel.component.scss'
})
export class DemographicsPanelComponent implements OnChanges {
  @Input() demographics: Demographics | null = null;

  Highcharts: typeof Highcharts = Highcharts;
  genderChartOptions: Highcharts.Options = {};
  ageChartOptions: Highcharts.Options = {};
  ageStats: AgeStat[] = [];

  readonly agePalette = ['#a7b62e', '#c7d833', '#e3a73c', '#7b5ea7'];

  get groupSizeRows(): GroupSizeRow[] {
    const gs = this.demographics?.groupSize;
    if (!gs) {
      return [];
    }
    return [
      { label: 'Solo Groups', icon: 'person', value: gs.solo.value, pct: gs.solo.pct },
      { label: '2-Person Groups', icon: 'people', value: gs.twoPerson.value, pct: gs.twoPerson.pct },
      { label: '3+ Person Groups', icon: 'groups', value: gs.threePlus.value, pct: gs.threePlus.pct }
    ];
  }

  ngOnChanges(): void {
    this.buildGenderChart();
    this.buildAgeChart();
  }

  private buildGenderChart(): void {
    const g = this.demographics?.gender;

    this.genderChartOptions = {
      chart: { type: 'pie', backgroundColor: 'transparent', height: 220, spacing: [6, 6, 6, 6] },
      // The center total used to be a chart.title positioned via align/
      // verticalAlign/floating - Highcharts computes that box from its own
      // internal spacing/plotArea math, which kept landing a pixel or two
      // off the ring's true center no matter how it was tuned. Rendered as
      // a plain centered HTML overlay instead (see .donut-center-label in
      // the template/scss) - CSS flexbox centering over the chart's own
      // bounding box can't drift the way Highcharts' title alignment did.
      title: { text: undefined },
      credits: { enabled: false },
      tooltip: {
        pointFormat: '{series.name}: <b>{point.percentage:.1f}%</b>',
        backgroundColor: '#ffffff',
        borderColor: '#e6eaec',
        borderRadius: 8,
        shadow: true
      },
      plotOptions: {
        pie: {
          innerSize: '74%',
          borderRadius: 4,
          borderWidth: 3,
          borderColor: '#ffffff',
          dataLabels: { enabled: false },
          states: {
            hover: { brightness: 0.05, halo: { size: 4 } }
          }
        }
      },
      legend: { enabled: false },
      series: [
        {
          type: 'pie',
          name: 'Visitors',
          data: g
            ? [
                { name: 'Male', y: g.male, color: '#2f6fa7' },
                { name: 'Female', y: g.female, color: '#e3a73c' }
              ]
            : []
        }
      ]
    };
  }

  private buildAgeChart(): void {
    const groups = this.demographics?.ageGroups ?? [];
    const palette = this.agePalette;

    this.ageStats = groups.map((g, i) => ({
      label: g.label,
      value: g.value,
      pct: g.pct,
      color: palette[i % palette.length]
    }));

    this.ageChartOptions = {
      chart: { type: 'column', backgroundColor: 'transparent', height: 220 },
      title: { text: undefined },
      credits: { enabled: false },
      xAxis: {
        categories: groups.map((g) => g.label),
        lineColor: '#b3c0c6',
        labels: { style: { color: '#546e7a', fontSize: '11px' } }
      },
      yAxis: {
        title: { text: undefined },
        gridLineColor: '#e6eaec',
        max: 100,
        labels: { style: { color: '#78909c' }, format: '{value}%' }
      },
      legend: { enabled: false },
      tooltip: { pointFormat: '<b>{point.y}%</b> of visitors' },
      plotOptions: {
        column: {
          borderRadius: 4,
          borderWidth: 0,
          dataLabels: {
            enabled: true,
            format: '{point.y}%',
            style: { color: '#546e7a', textOutline: 'none', fontSize: '11px' }
          }
        }
      },
      series: [
        {
          type: 'column',
          name: 'Age Groups',
          data: groups.map((g, i) => ({ y: g.pct, color: palette[i % palette.length] }))
        }
      ]
    };
  }
}
