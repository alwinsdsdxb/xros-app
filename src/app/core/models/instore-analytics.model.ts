export interface StatTile {
  value: number | string;
  sub: string;
}

export interface InstoreKpis {
  avgDailyFootfall: StatTile;
  uniqueVisitors: StatTile;
  peakHour: StatTile;
  weekendAvg: StatTile;
}

export interface PeakHours {
  bestSlot: StatTile;
  activeSlots: StatTile;
  avgActiveSlot: StatTile;
  hours: string[];
  days: string[];
  grid: (number | null)[][];
  color?: string;
}

export interface FloorPlanZoneData {
  zoneName: string;
  traffic: number;
  visitors: number;
  attentionVisitors: number;
  avgResidenceTime: number;
  visitorTraffic: number;
  coordinates: { x: number; y: number }[];
}

export interface FloorPlanReport {
  image: string;
  zones: FloorPlanZoneData[];
}

export type TrialRoomZoneMatchStatus = 'matched' | 'multiple' | 'none';

export interface TrialRoomZoneMatch {
  zoneName: string;
  traffic: number;
  visitors: number;
  attentionVisitors: number;
  avgResidenceTime: number;
}

export interface TrialRoomZoneProxy {
  status: TrialRoomZoneMatchStatus;
  zones: TrialRoomZoneMatch[];
}

export interface ZoneHighlight {
  label: string;
  sub: string;
}

export interface ZoneRow {
  key: string;
  label: string;
  traffic: number;
  visitors: number;
  attentionVisitors: number;
  avgResidenceTime: number;
  visitorTraffic: number;
  sharePct: number;
}

export interface ZoneFlowLink {
  from: string;
  to: string;
  weight: number;
}

export interface ZoneCorrelation {
  strongestFlow: ZoneHighlight;
  highestCapture: ZoneHighlight;
  engagementLeader: ZoneHighlight;
  avgZonesPerVisit: StatTile;
  flows: ZoneFlowLink[];
}

export interface AudienceMix {
  male: number;
  female: number;
  adult: number;
  child: number;
}

export interface TrafficSignals {
  peakDays: number;
  normalDays: number;
  lowDays: number;
  busiestDay: string;
}

