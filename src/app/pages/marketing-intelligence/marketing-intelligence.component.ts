import { Component, ElementRef, HostListener, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { HighchartsChartModule } from 'highcharts-angular';
import Highcharts from '../../core/highcharts-setup';
import { WidgetService } from '../../core/services/widget.service';
import { EventListItem } from '../../core/models/widget.model';

type CampaignStatus = 'Completed' | 'Active' | 'Planned';
type DropdownKey =
  | 'campaigns'
  | 'channel'
  | 'date'
  | 'reportChannel'
  | 'reportStatus'
  | 'openCampaign'
  | 'compareCampaigns'
  | 'landscapeChannel'
  | 'landscapeVolume'
  | 'leaderboardSort';

type LeaderboardSort = 'Highest uplift' | 'Highest traffic' | 'Highest spend' | 'Lowest cost per visitor';
type VolumeFilter = 'Top 5' | 'Top 12' | 'All';

interface CampaignPerformance {
  upliftPct: number;
  traffic: number;
  spend: number;
}

interface MetricTile {
  label: string;
  value: string;
  sub: string;
  icon: string;
}

interface StoreImpactRow {
  store: string;
  note: string;
  status: CampaignStatus;
  traffic: number;
  unique: number;
  baselineAvg: number;
  upliftPct: number;
  incremental: number;
  spend: number;
  costPerUnique: number;
}

interface AudienceBar {
  label: string;
  value: number;
  color: string;
}

interface DailyRow {
  date: string;
  plannedBudget: number;
  actualSpend: number;
  traffic: number;
  uniqueVisitors: number;
  isBestDay?: boolean;
}

interface HourPoint {
  hour: string;
  traffic: number;
  unique: number;
}

// Everything a Reports-tab campaign detail view needs, beyond the catalogue
// fields above. Only populated for campaigns that have a real report behind
// them (see Campaign.report) - campaigns without one fall back to the Reports
// tab's empty state rather than rendering zeros.
interface CampaignReportData {
  description: string;
  scopeNote: string;
  metrics: MetricTile[];
  storesCount: number;
  brandTraffic: number;
  brandUpliftPct: number;
  brandSpend: number;
  bestStoreName: string;
  storeImpactNote: string;
  stores: StoreImpactRow[];
  malePct: number;
  femalePct: number;
  leadAgeRange: string;
  audienceBars: AudienceBar[];
  audienceNote: string;
  benchmarkRankLabel: string;
  benchmarkStats: MetricTile[];
  attribution: MetricTile[];
  apiSignalsNote: string;
  dwellNote: string;
  hours: HourPoint[];
  notes: string;
  dailyData: DailyRow[];
}

interface Campaign {
  id: string;
  name: string;
  channels: string[];
  from: string;
  to: string;
  budget: number;
  status: CampaignStatus;
  performance?: CampaignPerformance;
  report?: CampaignReportData;
}

interface PageTab {
  value: 'overview' | 'reports' | 'analytics';
  label: string;
}

@Component({
  selector: 'app-marketing-intelligence',
  templateUrl: './marketing-intelligence.component.html',
  styleUrl: './marketing-intelligence.component.scss',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, MatProgressSpinnerModule, HighchartsChartModule]
})
export class MarketingIntelligenceComponent implements OnInit {
  readonly tabs: PageTab[] = [
    { value: 'overview', label: 'Overview' },
    { value: 'reports', label: 'Reports' },
    { value: 'analytics', label: 'Analytics' }
  ];
  activeTab: PageTab['value'] = 'overview';

  isLoading = true;
  errorMessage: string | null = null;

  // Populated in ngOnInit from the real campaign API (see below) - every
  // stat tile, the "Campaign list" recent panel, and the catalogue table are
  // all derived from this one array rather than duplicated as separate
  // hardcoded figures.
  campaigns: Campaign[] = [];

  get campaignsCount(): number {
    return this.campaigns.length;
  }

  get activeNow(): number {
    return this.campaigns.filter((c) => c.status === 'Active').length;
  }

  get plannedBudget(): number {
    return this.campaigns.reduce((sum, c) => sum + c.budget, 0);
  }

  get topCampaign(): Campaign | null {
    if (!this.campaigns.length) {
      return null;
    }
    const withPerformance = this.campaigns.filter((c) => c.performance);
    if (!withPerformance.length) {
      return this.campaigns[0];
    }
    return withPerformance.reduce((a, b) => (b.performance!.upliftPct > a.performance!.upliftPct ? b : a));
  }

  // null (rendered as "—") rather than 0 when no campaign has performance
  // data, so an empty/unavailable state doesn't read as a fabricated "0%".
  get bestUpliftPct(): number | null {
    return this.topCampaign?.performance?.upliftPct ?? null;
  }

  get recentCampaigns(): Campaign[] {
    return [...this.campaigns].sort((a, b) => (a.from < b.from ? 1 : a.from > b.from ? -1 : 0)).slice(0, 4);
  }

  get channelOptions(): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const c of this.campaigns) {
      for (const ch of c.channels) {
        if (!seen.has(ch)) {
          seen.add(ch);
          result.push(ch);
        }
      }
    }
    return result;
  }

  // Filter dropdown draft state (what's currently checked/typed in an open
  // panel) - kept separate from the applied* fields below so the table only
  // refilters when "Apply Filters" is clicked, matching the rest of this
  // app's Apply-button pattern (see dashboard/comparison/instore filter bars).
  openDropdown: DropdownKey | null = null;
  campaignSearchQuery = '';
  channelSearchQuery = '';
  readonly selectedCampaignNames = new Set<string>();
  readonly selectedChannels = new Set<string>();
  dateStartDraft = '';
  dateEndDraft = '';

  private appliedCampaignNames = new Set<string>();
  private appliedChannels = new Set<string>();
  private appliedStart = '';
  private appliedEnd = '';

  constructor(
    private elementRef: ElementRef<HTMLElement>,
    private widgetService: WidgetService
  ) {}

  // Real campaign data - the same Event documents the Dashboard's Active
  // Campaigns panel reads (GET /event/list via WidgetService.getEvents(),
  // see dashboard.component.ts's refreshActiveCampaigns()). That endpoint
  // has no channel or per-campaign performance (uplift/traffic/spend) fields,
  // so channel is shown as a static placeholder and performance/report stay
  // undefined - the template already renders both as "unavailable" (no
  // top-campaign-stats block, no report, empty Analytics lists) rather than
  // inventing numbers that aren't in the real API response.
  ngOnInit(): void {
    this.widgetService.getEvents().subscribe({
      next: (events) => {
        this.campaigns = events.map((e) => this.toCampaign(e));
        const firstId = this.campaigns[0]?.id ?? '';
        this.selectedReportCampaignId = firstId;
        this.openCampaignDraftId = firstId;
        this.isLoading = false;
        this.buildReportCharts();
        this.buildCompareCharts();
        this.buildLandscapeChart();
      },
      error: () => {
        this.campaigns = [];
        this.isLoading = false;
        this.errorMessage = 'Unable to load campaign data. Please check the API connection and try again.';
      }
    });
  }

  private toCampaign(e: EventListItem): Campaign {
    const from = e.from.slice(0, 10);
    const to = e.to.slice(0, 10);
    return {
      id: e._id,
      name: e.eventName,
      channels: ['General'],
      from,
      to,
      budget: e.budget,
      status: this.deriveStatus(from, to)
    };
  }

  private deriveStatus(from: string, to: string): CampaignStatus {
    const today = new Date().toISOString().slice(0, 10);
    if (today < from) {
      return 'Planned';
    }
    if (today > to) {
      return 'Completed';
    }
    return 'Active';
  }

  // Closes any open filter dropdown on outside click. Checking
  // elementRef.nativeElement.contains(target) (rather than a fixed-position
  // backdrop overlay) sidesteps this app's <app-root> transform:scale(0.8)
  // wrapper, under which position:fixed elements resolve against the scaled
  // element's own box instead of the real viewport (see styles.scss).
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this.openDropdown && !this.elementRef.nativeElement.contains(event.target as Node)) {
      this.openDropdown = null;
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.openDropdown = null;
  }

  selectTab(tab: PageTab['value']): void {
    this.activeTab = tab;
  }

  toggleDropdown(key: DropdownKey): void {
    this.openDropdown = this.openDropdown === key ? null : key;
  }

  get filteredCampaignNameOptions(): string[] {
    const q = this.campaignSearchQuery.trim().toLowerCase();
    const names = this.campaigns.map((c) => c.name);
    return q ? names.filter((n) => n.toLowerCase().includes(q)) : names;
  }

  get filteredChannelOptions(): string[] {
    const q = this.channelSearchQuery.trim().toLowerCase();
    return q ? this.channelOptions.filter((ch) => ch.toLowerCase().includes(q)) : this.channelOptions;
  }

  toggleCampaignName(name: string): void {
    if (this.selectedCampaignNames.has(name)) {
      this.selectedCampaignNames.delete(name);
    } else {
      this.selectedCampaignNames.add(name);
    }
  }

  toggleChannel(channel: string): void {
    if (this.selectedChannels.has(channel)) {
      this.selectedChannels.delete(channel);
    } else {
      this.selectedChannels.add(channel);
    }
  }

  get campaignFilterLabel(): string {
    return this.selectedCampaignNames.size === 0 ? 'All campaigns' : `${this.selectedCampaignNames.size} selected`;
  }

  get channelFilterLabel(): string {
    return this.selectedChannels.size === 0 ? 'All channels' : `${this.selectedChannels.size} selected`;
  }

  get dateRangeLabel(): string {
    return this.appliedStart && this.appliedEnd ? `${this.appliedStart} to ${this.appliedEnd}` : 'Select date range';
  }

  get filteredCampaigns(): Campaign[] {
    return this.campaigns.filter((c) => {
      if (this.appliedCampaignNames.size && !this.appliedCampaignNames.has(c.name)) {
        return false;
      }
      if (this.appliedChannels.size && !c.channels.some((ch) => this.appliedChannels.has(ch))) {
        return false;
      }
      if (this.appliedStart && c.to < this.appliedStart) {
        return false;
      }
      if (this.appliedEnd && c.from > this.appliedEnd) {
        return false;
      }
      return true;
    });
  }

  applyFilters(): void {
    this.appliedCampaignNames = new Set(this.selectedCampaignNames);
    this.appliedChannels = new Set(this.selectedChannels);
    this.appliedStart = this.dateStartDraft;
    this.appliedEnd = this.dateEndDraft;
    this.openDropdown = null;
  }

  clearFilters(): void {
    this.selectedCampaignNames.clear();
    this.selectedChannels.clear();
    this.campaignSearchQuery = '';
    this.channelSearchQuery = '';
    this.dateStartDraft = '';
    this.dateEndDraft = '';
    this.appliedCampaignNames = new Set();
    this.appliedChannels = new Set();
    this.appliedStart = '';
    this.appliedEnd = '';
    this.openDropdown = null;
  }

  formatCurrency(value: number | undefined): string {
    if (value == null) {
      return '';
    }
    return `AED ${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  trackByCampaignId(_index: number, c: Campaign): string {
    return c.id;
  }

  // Reports tab - its own filter state (free-text search + single-select
  // Channel/Status, rather than the Overview catalogue's multi-select
  // checkboxes above) because this bar's job is narrowing down to ONE
  // campaign to open, not filtering a list that stays on screen. Selecting
  // a campaign in "Open campaign" is a draft like the rest of this app's
  // Apply-button pattern - it only becomes the report on screen once "Open
  // Report" is clicked (or via openReportFor(), used by the Overview tab's
  // own Open Report buttons).
  reportSearchQuery = '';
  reportChannelFilter = 'All channels';
  reportStatusFilter: 'All statuses' | CampaignStatus = 'All statuses';
  openCampaignDraftId = '';
  selectedReportCampaignId = '';

  Highcharts: typeof Highcharts = Highcharts;
  trendChartOptions: Highcharts.Options = {};
  hoursChartOptions: Highcharts.Options = {};

  get reportFilteredCampaigns(): Campaign[] {
    const q = this.reportSearchQuery.trim().toLowerCase();
    return this.campaigns.filter((c) => {
      if (this.reportChannelFilter !== 'All channels' && !c.channels.includes(this.reportChannelFilter)) {
        return false;
      }
      if (this.reportStatusFilter !== 'All statuses' && c.status !== this.reportStatusFilter) {
        return false;
      }
      if (!q) {
        return true;
      }
      const haystack = `${c.name} ${c.channels.join(' ')} ${c.from} ${c.to}`.toLowerCase();
      return haystack.includes(q);
    });
  }

  get selectedReportCampaign(): Campaign | undefined {
    return this.campaigns.find((c) => c.id === this.selectedReportCampaignId);
  }

  get openCampaignDraft(): Campaign | undefined {
    return this.campaigns.find((c) => c.id === this.openCampaignDraftId);
  }

  get peakHourLabel(): string {
    const hours = this.selectedReportCampaign?.report?.hours;
    if (!hours?.length) {
      return '';
    }
    const peak = hours.reduce((a, b) => (b.traffic > a.traffic ? b : a));
    return `Peak ${this.formatHourLabel(peak.hour)}`;
  }

  get audienceSkewLabel(): string {
    const report = this.selectedReportCampaign?.report;
    if (!report) {
      return '';
    }
    return report.femalePct === report.malePct ? 'Even split' : report.femalePct > report.malePct ? 'Female skew' : 'Male skew';
  }

  get audienceMaxBarValue(): number {
    const bars = this.selectedReportCampaign?.report?.audienceBars ?? [];
    return bars.reduce((max, b) => Math.max(max, b.value), 0) || 1;
  }

  selectOpenCampaignDraft(id: string): void {
    this.openCampaignDraftId = id;
    this.openDropdown = null;
  }

  openReport(): void {
    this.openReportFor(this.openCampaignDraftId);
  }

  // Shared by the Reports tab's own "Open Report" button and the Overview
  // tab's Featured-card/catalogue-row "Open Report" buttons - both land here
  // so opening a report always behaves the same way regardless of entry point.
  openReportFor(id: string): void {
    this.selectedReportCampaignId = id;
    this.openCampaignDraftId = id;
    this.activeTab = 'reports';
    this.openDropdown = null;
    this.buildReportCharts();
  }

  clearReportFilters(): void {
    this.reportSearchQuery = '';
    this.reportChannelFilter = 'All channels';
    this.reportStatusFilter = 'All statuses';
    this.openDropdown = null;
  }

  formatShortDate(iso: string): string {
    const d = new Date(`${iso}T00:00:00`);
    return d.toLocaleDateString('en-US', { day: '2-digit', month: 'short' });
  }

  formatHourLabel(hour24: string): string {
    const h = parseInt(hour24.split(':')[0], 10);
    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12} ${period}`;
  }

  audienceBarPct(value: number): number {
    return (value / this.audienceMaxBarValue) * 100;
  }

  private buildReportCharts(): void {
    const report = this.selectedReportCampaign?.report;
    if (!report) {
      this.trendChartOptions = {};
      this.hoursChartOptions = {};
      return;
    }

    const axisLabelStyle = { style: { color: '#78909c', fontSize: '11px' } };
    const categories = report.dailyData.map((d) => this.formatShortDate(d.date));

    this.trendChartOptions = {
      chart: { type: 'line', backgroundColor: 'transparent', height: 320 },
      title: { text: undefined },
      credits: { enabled: false },
      xAxis: {
        categories,
        lineColor: '#b3c0c6',
        labels: { style: { color: '#546e7a', fontSize: '11px' } }
      },
      yAxis: [
        {
          title: { text: 'Traffic / unique visitors', ...axisLabelStyle },
          gridLineColor: '#e6eaec',
          labels: axisLabelStyle,
          min: 0
        },
        {
          title: { text: 'Total spend', ...axisLabelStyle },
          gridLineColor: 'transparent',
          labels: axisLabelStyle,
          opposite: true,
          min: 0
        }
      ],
      legend: { enabled: true, itemStyle: { color: '#546e7a', fontSize: '11.5px', fontWeight: '600' } },
      tooltip: { shared: true },
      series: [
        {
          type: 'line',
          name: 'Traffic',
          yAxis: 0,
          color: '#0f4c73',
          marker: { enabled: true, radius: 4 },
          data: report.dailyData.map((d) => d.traffic)
        },
        {
          type: 'line',
          name: 'Unique',
          yAxis: 0,
          color: '#eda100',
          dashStyle: 'Dot',
          marker: { enabled: true, radius: 4 },
          data: report.dailyData.map((d) => d.uniqueVisitors)
        },
        {
          type: 'line',
          name: 'Spend',
          yAxis: 1,
          color: '#c9a06a',
          marker: { enabled: false },
          data: report.dailyData.map((d) => d.actualSpend)
        }
      ]
    };

    this.hoursChartOptions = {
      chart: { backgroundColor: 'transparent', height: 320 },
      title: { text: undefined },
      credits: { enabled: false },
      xAxis: {
        categories: report.hours.map((h) => h.hour),
        lineColor: '#b3c0c6',
        labels: { style: { color: '#78909c', fontSize: '10.5px' } }
      },
      yAxis: {
        title: { text: 'Values', ...axisLabelStyle },
        gridLineColor: '#e6eaec',
        labels: axisLabelStyle,
        min: 0
      },
      legend: { enabled: true, itemStyle: { color: '#546e7a', fontSize: '11.5px', fontWeight: '600' } },
      tooltip: { shared: true },
      series: [
        {
          type: 'column',
          name: 'Traffic',
          color: '#3f7cad',
          data: report.hours.map((h) => h.traffic)
        },
        {
          type: 'line',
          name: 'Unique',
          color: '#eda100',
          marker: { enabled: false },
          data: report.hours.map((h) => h.unique)
        }
      ]
    };
  }

  // Analytics tab - aggregate/cross-campaign view, unlike Reports above
  // (one campaign in depth). Every stat here is a live getter over
  // campaigns[].performance rather than a hardcoded figure, so it stays
  // correct as campaign data changes instead of drifting out of sync.
  readonly campaignPalette = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];

  // Starts empty since no real campaign has performance data yet (the
  // Compare picker only lists campaignsWithPerformance, so there's nothing
  // real to default-select).
  compareDraftIds = new Set<string>();
  compareSelectedIds: string[] = [];
  compareSearchQuery = '';

  landscapeChannelFilter = 'All channels';
  landscapeVolumeFilter: VolumeFilter = 'Top 12';
  private appliedLandscapeChannel = 'All channels';
  private appliedLandscapeVolume: VolumeFilter = 'Top 12';

  leaderboardSort: LeaderboardSort = 'Highest uplift';
  readonly leaderboardSortOptions: LeaderboardSort[] = ['Highest uplift', 'Highest traffic', 'Highest spend', 'Lowest cost per visitor'];

  trafficCompareChart: Highcharts.Options = {};
  spendCompareChart: Highcharts.Options = {};
  upliftCompareChart: Highcharts.Options = {};
  costCompareChart: Highcharts.Options = {};
  landscapeChartOptions: Highcharts.Options = {};

  get campaignsWithPerformance(): Campaign[] {
    return this.campaigns.filter((c) => c.performance);
  }

  get totalActualSpend(): number {
    return this.campaignsWithPerformance.reduce((sum, c) => sum + c.performance!.spend, 0);
  }

  get totalTraffic(): number {
    return this.campaignsWithPerformance.reduce((sum, c) => sum + c.performance!.traffic, 0);
  }

  get avgUpliftPct(): number {
    const list = this.campaignsWithPerformance;
    if (!list.length) {
      return 0;
    }
    return Math.round((list.reduce((sum, c) => sum + c.performance!.upliftPct, 0) / list.length) * 10) / 10;
  }

  get avgCostPerVisitor(): number {
    return this.totalTraffic ? this.totalActualSpend / this.totalTraffic : 0;
  }

  costPerVisitor(c: Campaign): number {
    const p = c.performance;
    return p && p.traffic ? p.spend / p.traffic : 0;
  }

  // Small non-null template accessors - every list these read from
  // (compareSelectedCampaigns/landscapeCampaigns/leaderboardCampaigns) is
  // already filtered to campaigns with performance data, but the type stays
  // optional, so this keeps the template itself free of "!" assertions.
  trafficOf(c: Campaign): number {
    return c.performance?.traffic ?? 0;
  }

  spendOf(c: Campaign): number {
    return c.performance?.spend ?? 0;
  }

  upliftOf(c: Campaign): number {
    return c.performance?.upliftPct ?? 0;
  }

  colorForCampaign(id: string): string {
    const idx = this.campaigns.findIndex((c) => c.id === id);
    return this.campaignPalette[idx % this.campaignPalette.length];
  }

  get compareSearchOptions(): Campaign[] {
    const q = this.compareSearchQuery.trim().toLowerCase();
    const list = this.campaignsWithPerformance;
    return q ? list.filter((c) => c.name.toLowerCase().includes(q)) : list;
  }

  get compareSelectedCampaigns(): Campaign[] {
    return this.compareSelectedIds.map((id) => this.campaigns.find((c) => c.id === id)).filter((c): c is Campaign => !!c);
  }

  get compareDraftCount(): number {
    return this.compareDraftIds.size;
  }

  toggleCompareDraft(id: string): void {
    if (this.compareDraftIds.has(id)) {
      this.compareDraftIds.delete(id);
    } else if (this.compareDraftIds.size < 3) {
      this.compareDraftIds.add(id);
    }
  }

  applyCompare(): void {
    if (this.compareDraftIds.size < 2) {
      return;
    }
    this.compareSelectedIds = Array.from(this.compareDraftIds);
    this.openDropdown = null;
    this.buildCompareCharts();
  }

  get landscapeCampaigns(): Campaign[] {
    const filtered = this.campaignsWithPerformance.filter(
      (c) => this.appliedLandscapeChannel === 'All channels' || c.channels.includes(this.appliedLandscapeChannel)
    );
    const sorted = [...filtered].sort((a, b) => b.performance!.spend - a.performance!.spend);
    const cap = this.appliedLandscapeVolume === 'Top 5' ? 5 : this.appliedLandscapeVolume === 'Top 12' ? 12 : sorted.length;
    return sorted.slice(0, cap);
  }

  applyLandscapeFilters(): void {
    this.appliedLandscapeChannel = this.landscapeChannelFilter;
    this.appliedLandscapeVolume = this.landscapeVolumeFilter;
    this.openDropdown = null;
    this.buildLandscapeChart();
  }

  setLeaderboardSort(sort: LeaderboardSort): void {
    this.leaderboardSort = sort;
    this.openDropdown = null;
  }

  private leaderboardMetricValue(c: Campaign): number {
    switch (this.leaderboardSort) {
      case 'Highest uplift':
        return c.performance!.upliftPct;
      case 'Highest traffic':
        return c.performance!.traffic;
      case 'Highest spend':
        return c.performance!.spend;
      case 'Lowest cost per visitor':
        return this.costPerVisitor(c);
    }
  }

  get leaderboardCampaigns(): Campaign[] {
    const list = [...this.campaignsWithPerformance];
    const invert = this.leaderboardSort === 'Lowest cost per visitor' ? -1 : 1;
    return list.sort((a, b) => invert * (this.leaderboardMetricValue(b) - this.leaderboardMetricValue(a)));
  }

  leaderboardBarPct(c: Campaign): number {
    const values = this.leaderboardCampaigns.map((x) => this.leaderboardMetricValue(x));
    const max = Math.max(...values, 1);
    return (this.leaderboardMetricValue(c) / max) * 100;
  }

  private compareBarChart(categories: string[], values: number[], colors: string[], tooltipFormat: string): Highcharts.Options {
    return {
      chart: { type: 'bar', backgroundColor: 'transparent', height: 220 },
      title: { text: undefined },
      credits: { enabled: false },
      xAxis: { categories, labels: { style: { color: '#546e7a', fontSize: '10.5px' } } },
      yAxis: {
        title: { text: undefined },
        gridLineColor: '#e6eaec',
        labels: { style: { color: '#78909c', fontSize: '10.5px' } },
        min: 0
      },
      legend: { enabled: false },
      tooltip: { pointFormat: tooltipFormat },
      plotOptions: { bar: { borderRadius: 3, pointPadding: 0.15, groupPadding: 0.12 } },
      series: [{ type: 'bar', name: '', data: values.map((v, i) => ({ y: v, color: colors[i] })) }]
    };
  }

  private buildCompareCharts(): void {
    const list = this.compareSelectedCampaigns;
    if (!list.length) {
      this.trafficCompareChart = {};
      this.spendCompareChart = {};
      this.upliftCompareChart = {};
      this.costCompareChart = {};
      return;
    }

    const categories = list.map((c) => c.name);
    const colors = list.map((c) => this.colorForCampaign(c.id));

    this.trafficCompareChart = this.compareBarChart(
      categories,
      list.map((c) => c.performance!.traffic),
      colors,
      '<b>{point.y:,.0f}</b> traffic'
    );
    this.spendCompareChart = this.compareBarChart(
      categories,
      list.map((c) => c.performance!.spend),
      colors,
      'AED <b>{point.y:,.2f}</b>'
    );
    this.upliftCompareChart = this.compareBarChart(
      categories,
      list.map((c) => c.performance!.upliftPct),
      colors,
      '<b>{point.y}%</b> uplift'
    );
    this.costCompareChart = this.compareBarChart(
      categories,
      list.map((c) => this.costPerVisitor(c)),
      colors,
      'AED <b>{point.y:.2f}</b> / visitor'
    );
  }

  private buildLandscapeChart(): void {
    const list = this.landscapeCampaigns;
    if (!list.length) {
      this.landscapeChartOptions = {};
      return;
    }

    const data = list.map((c) => ({
      x: c.performance!.spend,
      y: c.performance!.traffic,
      name: c.name,
      upliftPct: c.performance!.upliftPct,
      color: this.colorForCampaign(c.id)
    }));

    this.landscapeChartOptions = {
      chart: { type: 'scatter', backgroundColor: 'transparent', height: 420 },
      title: { text: undefined },
      credits: { enabled: false },
      xAxis: {
        title: { text: 'Campaign spend', style: { color: '#78909c', fontSize: '11px' } },
        gridLineColor: '#e6eaec',
        gridLineWidth: 1,
        labels: { style: { color: '#78909c' }, formatter(this: { value: number | string }): string {
          return `AED ${Number(this.value).toLocaleString('en-US')}`;
        } },
        min: 0
      },
      yAxis: {
        title: { text: 'Traffic', style: { color: '#78909c', fontSize: '11px' } },
        gridLineColor: '#e6eaec',
        labels: { style: { color: '#78909c' } },
        min: 0
      },
      legend: { enabled: false },
      tooltip: {
        pointFormatter(this: any): string {
          return `<b>${this.name}</b><br/>Spend: AED ${(this.x ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}<br/>Traffic: ${(this.y ?? 0).toLocaleString('en-US')}<br/>Uplift: ${this.upliftPct}%`;
        }
      },
      series: [
        {
          type: 'scatter',
          name: 'Campaigns',
          data,
          marker: { radius: 7, lineWidth: 1, lineColor: '#ffffff' }
        }
      ]
    };
  }
}
