export interface KpiDataPoint {
  value: number;
  dateFrom?: string;
  date?: string;
  derviedLabel?: string;
  differance?: number;
  variance?: number;
  variation?: number;
  source?: string;
  target?: string;
  online?: number;
  offline?: number;
  icon?: string;
  // zoneAnalytics ("Zone Analytics" widget, fetchDataFor: "zoneAnalytics") shape
  zoneName?: string;
  traffic?: number;
  visitors?: number;
  attentionVisitors?: number;
  avgResidenceTime?: number;
  visitorTraffic?: number;
  coordinates?: { x: number; y: number }[];
}

export interface KpiDataFilterResult {
  label: string;
  fetchDataFor: string;
  rangeLabel?: string;
  selected?: boolean;
  color?: string;
  data: KpiDataPoint[];
  // Present on the zoneAnalytics filter: floor plan photo the zone polygons overlay onto
  image?: string;
}

export interface KpiDataResponse {
  statusCode: number;
  data: {
    title: string;
    dataFilter: KpiDataFilterResult[];
  };
}
