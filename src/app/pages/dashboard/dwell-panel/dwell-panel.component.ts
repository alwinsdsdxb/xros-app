import { Component, Input, OnChanges } from '@angular/core';
import * as Highcharts from 'highcharts';
import { Dwell } from '../../../core/models/dashboard.model';

interface DwellTile {
  label: string;
  value: string;
  previousDay: string;
  changePct: number;
}

interface EngagementLegendItem {
  label: string;
  color: string;
}

@Component({
  selector: 'app-dwell-panel',
  templateUrl: './dwell-panel.component.html',
  styleUrl: './dwell-panel.component.scss'
})
export class DwellPanelComponent implements OnChanges {
  @Input() dwell: Dwell | null = null;

  Highcharts: typeof Highcharts = Highcharts;
  distributionChartOptions: Highcharts.Options = {};
  engagementChartOptions: Highcharts.Options = {};
  trendChartOptions: Highcharts.Options = {};
  engagementLegend: EngagementLegendItem[] = [];

  private readonly engagementPalette = ['#173a56', '#1e8a7c', '#a7b62e', '#e3a73c', '#7b5ea7'];

  get tiles(): DwellTile[] {
    const d = this.dwell;
    if (!d) {
      return [];
    }
    return [
      {
        label: 'Estimated Avg Dwell',
        value: `${d.estimatedAvgDwellMin.value} min`,
        previousDay: `${d.estimatedAvgDwellMin.previousDay} min`,
        changePct: d.estimatedAvgDwellMin.changePct
      },
      {
        label: 'Quick Visit %',
        value: `${d.quickVisitPct.value}%`,
        previousDay: `${d.quickVisitPct.previousDay}%`,
        changePct: d.quickVisitPct.changePct
      },
      {
        label: 'Engaged Visit %',
        value: `${d.engagedVisitPct.value}%`,
        previousDay: `${d.engagedVisitPct.previousDay}%`,
        changePct: d.engagedVisitPct.changePct
      },
      {
        label: 'Long Stay %',
        value: `${d.longStayPct.value}%`,
        previousDay: `${d.longStayPct.previousDay}%`,
        changePct: d.longStayPct.changePct
      },
      {
        label: 'Visitors in Analysis',
        value: `${d.visitorsInAnalysis.value}`,
        previousDay: `${d.visitorsInAnalysis.previousDay}`,
        changePct: d.visitorsInAnalysis.changePct
      }
    ];
  }

  ngOnChanges(): void {
    this.buildDistributionChart();
    this.buildEngagementChart();
    this.buildTrendChart();
  }

  private buildDistributionChart(): void {
    const buckets = [...(this.dwell?.distribution ?? [])].reverse();

    this.distributionChartOptions = {
      chart: { type: 'bar', backgroundColor: 'transparent', height: 220 },
      title: { text: undefined },
      credits: { enabled: false },
      xAxis: {
        categories: buckets.map((b) => b.label),
        labels: { style: { color: '#5b6472', fontSize: '11px' } }
      },
      yAxis: {
        title: { text: undefined },
        gridLineColor: '#e7eaf0',
        labels: { style: { color: '#8b93a1' } }
      },
      legend: { enabled: false },
      plotOptions: {
        bar: {
          color: '#173a56',
          borderRadius: 3,
          groupPadding: 0.18,
          dataLabels: { enabled: true, style: { color: '#5b6472', textOutline: 'none', fontSize: '11px' } }
        }
      },
      series: [
        {
          type: 'bar',
          name: 'Visitors',
          data: buckets.map((b) => b.value)
        }
      ]
    };
  }

  private buildEngagementChart(): void {
    const buckets = this.dwell?.engagementComposition ?? [];
    const palette = this.engagementPalette;

    this.engagementLegend = buckets.map((b, i) => ({ label: b.label, color: palette[i % palette.length] }));

    this.engagementChartOptions = {
      chart: { type: 'pie', backgroundColor: 'transparent', height: 220 },
      title: { text: undefined },
      credits: { enabled: false },
      tooltip: { pointFormat: '{point.name}: <b>{point.y}%</b>' },
      plotOptions: {
        pie: {
          innerSize: '62%',
          dataLabels: {
            enabled: true,
            format: '{point.name}: {point.y}%',
            style: { color: '#14213d', textOutline: 'none', fontSize: '10.5px' }
          }
        }
      },
      legend: { enabled: false },
      series: [
        {
          type: 'pie',
          name: 'Engagement',
          data: buckets.map((b, i) => ({ name: b.label, y: b.value, color: palette[i % palette.length] }))
        }
      ]
    };
  }

  private buildTrendChart(): void {
    const points = this.dwell?.avgDwellTrend ?? [];

    this.trendChartOptions = {
      chart: { type: 'area', backgroundColor: 'transparent', height: 260 },
      title: { text: undefined },
      credits: { enabled: false },
      xAxis: {
        categories: points.map((p) => p.time),
        labels: { style: { color: '#8b93a1', fontSize: '11px' } }
      },
      yAxis: {
        title: { text: undefined },
        gridLineColor: '#e7eaf0',
        labels: { style: { color: '#8b93a1' } }
      },
      legend: {
        enabled: true,
        align: 'right',
        verticalAlign: 'top',
        floating: true,
        itemStyle: { color: '#5b6472', fontSize: '11px', fontWeight: '600' },
        symbolWidth: 10,
        symbolRadius: 5
      },
      tooltip: { shared: true },
      plotOptions: {
        area: {
          marker: { enabled: false },
          lineWidth: 2,
          fillOpacity: 0.15
        }
      },
      series: [
        {
          type: 'area',
          name: 'Current',
          color: '#2f6fa7',
          fillColor: 'rgba(47, 111, 167, 0.18)',
          data: points.map((p) => p.current)
        },
        {
          type: 'area',
          name: 'Previous Day',
          color: '#8b93a1',
          dashStyle: 'ShortDash',
          fillOpacity: 0,
          data: points.map((p) => p.previousDay)
        }
      ]
    };
  }
}
