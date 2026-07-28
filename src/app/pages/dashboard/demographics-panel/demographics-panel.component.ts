import { Component, Input, OnChanges } from '@angular/core';
import * as Highcharts from 'highcharts';
import { Demographics, TrendPoint } from '../../../core/models/dashboard.model';

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
  @Input() trend: TrendPoint[] = [];

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
      chart: { type: 'pie', backgroundColor: 'transparent', height: 220 },
      title: {
        text: g ? `${(g.male + g.female).toLocaleString()}<br/><span style="font-size:11px;font-weight:400">Visitors</span>` : '',
        align: 'center',
        verticalAlign: 'middle',
        y: 4,
        style: { color: '#14213d', fontSize: '20px', fontWeight: '800' }
      },
      credits: { enabled: false },
      tooltip: { pointFormat: '{series.name}: <b>{point.y}</b> ({point.percentage:.1f}%)' },
      plotOptions: {
        pie: {
          innerSize: '72%',
          dataLabels: { enabled: false }
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
        lineColor: '#c7cdd8',
        labels: { style: { color: '#5b6472', fontSize: '11px' } }
      },
      yAxis: {
        title: { text: undefined },
        gridLineColor: '#e7eaf0',
        labels: { style: { color: '#8b93a1' } }
      },
      legend: { enabled: false },
      tooltip: { pointFormat: 'Visitors: <b>{point.y}</b>' },
      plotOptions: {
        column: {
          borderRadius: 4,
          borderWidth: 0,
          dataLabels: {
            enabled: true,
            format: '{point.y}',
            style: { color: '#5b6472', textOutline: 'none', fontSize: '11px' }
          }
        }
      },
      series: [
        {
          type: 'column',
          name: 'Age Groups',
          data: groups.map((g, i) => ({ y: g.value, color: palette[i % palette.length] }))
        }
      ]
    };
  }
}
