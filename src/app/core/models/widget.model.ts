export interface DashboardSummary {
  _id: string;
  dashboardName: string;
}

export interface DashboardGroup {
  _id: string;
  dashboardId: string;
  groupName: string;
  from: string;
  to: string;
  groupByTimeFrame: string;
  dateByFilter: string;
  showSpecificDate: string[];
  stores: string[];
  brands: string[];
  showDataByOperationalHours: number;
  consolidateSiteData: number;
  consolidateData: number;
  consolidateDate: number;
  order: number;
}

export interface WidgetDataFilter {
  fetchDataFor: string;
  kpiGroupId: string;
  kpiId: string;
  label: string;
  [key: string]: unknown;
}

export interface StoreListItem {
  _id: string;
  storeName: string;
  parentId: string[];
  categoryId: string;
  categoryName: string;
}

export interface EventListItem {
  _id: string;
  eventName: string;
  from: string;
  to: string;
  budget: number;
  target: number;
  storeId: string[];
  stores: { _id: string; storeName: string }[];
}

export interface Widget {
  _id: string;
  groupId: string;
  widgetType: string;
  fetchDataFor: string;
  title: string;
  dataFilter: WidgetDataFilter[];
  isPredictive: boolean;
  predictiveDay: number;
  axisConfig: unknown;
  trendConfig: unknown;
  countConfig: unknown;
  campaignConfig: unknown;
  calendarConfig: unknown;
  numericConfig: unknown;
  funnelConfig: unknown;
  performerConfig: unknown;
  histogramConfig: unknown;
  heatmapConfig: unknown;
  compareConfig: unknown;
  compareDateConfig: unknown;
  isRowTotal: unknown;
  isColumnTotal: unknown;
  isAdjustHeader: unknown;
  binFilter?: unknown[];
}
