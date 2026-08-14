export interface ComparisonPoint {
  value: number;
  changePct: number;
}

export interface KpiMetric {
  value: number;
  previousDay: ComparisonPoint;
  previousWeek: ComparisonPoint;
  previousMonth: ComparisonPoint;
  previousYear: ComparisonPoint;
}

export interface Kpis {
  passerBy: KpiMetric;
  totalFootfall: KpiMetric;
  uniqueFootfall: KpiMetric;
  groups: KpiMetric;
}

export interface FlowFunnel {
  passerBy: number;
  totalTraffic: { value: number; entryRatePct: number };
  uniqueVisitors: { value: number; identifiedTrafficPct: number };
  potentialBuyers: { value: number; groupedVisitorsPct: number };
  salesConversion: { value: number; conversionPct: number };
  loyaltyTransactions: { value: number; ofTransactionsPct: number };
}

export interface AgeGroup {
  label: string;
  value: number;
  pct: number;
}

export interface GroupSizeBucket {
  value: number;
  pct: number;
}

export interface Demographics {
  totalVisitors: number;
  gender: { male: number; malePct: number; female: number; femalePct: number; unknown?: number; unknownPct?: number };
  ageGroups: AgeGroup[];
  groupSize: {
    solo: GroupSizeBucket;
    twoPerson: GroupSizeBucket;
    threePlus: GroupSizeBucket;
  };
}

export interface TrendPoint {
  time: string;
  passerBy: number;
  totalFootfall: number;
  uniqueFootfall: number;
}

export interface DwellStat {
  value: number;
  previousDay: number;
  changePct: number;
}

export interface DwellDistributionBucket {
  label: string;
  value: number;
}

export interface DwellEngagementBucket {
  label: string;
  value: number;
}

export interface DwellTrendPoint {
  time: string;
  current: number;
  previousDay: number;
}

export interface Dwell {
  estimatedAvgDwellMin: DwellStat;
  quickVisitPct: DwellStat;
  engagedVisitPct: DwellStat;
  longStayPct: DwellStat;
  visitorsInAnalysis: DwellStat;
  distribution: DwellDistributionBucket[];
  engagementComposition: DwellEngagementBucket[];
  avgDwellTrend: DwellTrendPoint[];
}

export interface Operations {
  temperatureC?: number;
  weatherCondition?: string;
  location?: string;
  liveOccupancy?: number;
  occupancyUpdatedMinsAgo?: number;
  devicesOnline: number;
  devicesOfflineCount: number;
}

export interface DashboardResponse {
  date: string;
  scope: string;
  storesCombined: number;
  kpis: Kpis;
  flowFunnel: FlowFunnel;
  demographics: Demographics;
  trend: TrendPoint[];
  dwell: Dwell;
  operations: Operations;
}

export interface CampaignEvent {
  id: string;
  name: string;
  from: string;
  to: string;
  budget: number;
  target: number;
  storeNames: string[];
}

export interface DashboardQueryParams {
  scope?: string;
  date?: string;
  view?: string;
}
