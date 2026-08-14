import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { KpiDataResponse } from '../models/kpi.model';
import { DashboardGroup, Widget } from '../models/widget.model';

export function buildKpiDataPayload(
  widget: Widget,
  group: DashboardGroup,
  from: string,
  to: string,
  storeIds: string[] = group.stores,
  timeFrame: string = group.groupByTimeFrame,
  dateByFilter: string = group.dateByFilter,
  showDataByOperationalHours: number = group.showDataByOperationalHours
): unknown {
  const mapped = storeIds.map((storeId) => ({ storeId, brands: group.brands ?? [] }));
  const dataFilter = widget.dataFilter.map((filter) => ({ ...filter, mapped }));
  return buildPayload(widget, group, dataFilter, from, to, timeFrame, dateByFilter, showDataByOperationalHours);
}

// Some widgets (e.g. a per-entrance "Trend Report") aren't scoped to the group's
// selected store directly — the real app expands to one dataFilter entry per
// child store × per KPI, rather than bundling all stores into one `mapped` array.
//
// timeFrame/dateByFilter default to the group's own fields but can be
// overridden explicitly — a query's required granularity (e.g. "hour" for a
// single-day intraday line) is a property of what's being asked for, not of
// whatever the shared group document happens to hold at request time (that
// document can be rewritten tenant-wide by an unrelated filter change on
// another session — see fetchTrafficTrend in dashboard.component.ts).
export function buildMultiStoreKpiPayload(
  widget: Widget,
  group: DashboardGroup,
  storeIds: string[],
  from: string,
  to: string,
  timeFrame: string = group.groupByTimeFrame,
  dateByFilter: string = group.dateByFilter,
  showDataByOperationalHours: number = group.showDataByOperationalHours
): unknown {
  const dataFilter = storeIds.flatMap((storeId) =>
    widget.dataFilter.map((filter) => ({ ...filter, mapped: [{ storeId, brands: [] }] }))
  );
  return buildPayload(widget, group, dataFilter, from, to, timeFrame, dateByFilter, showDataByOperationalHours);
}

function buildPayload(
  widget: Widget,
  group: DashboardGroup,
  dataFilter: unknown[],
  from: string,
  to: string,
  timeFrame: string,
  dateByFilter: string,
  showDataByOperationalHours: number
): unknown {
  return {
    dataFilter,
    fetchDataFor: widget.fetchDataFor,
    widgetType: widget.widgetType,
    isPredictive: widget.isPredictive,
    predictiveDay: widget.predictiveDay,
    from,
    to,
    timeFrame,
    dateByFilter,
    showSpecificDate: group.showSpecificDate,
    ...(widget.binFilter ? { binFilter: widget.binFilter } : {}),
    consolidateSiteData: group.consolidateSiteData,
    consolidateData: group.consolidateData,
    consolidateDate: group.consolidateDate,
    showDataByOperationalHours,
    title: widget.title,
    udf: {
      widgetId: widget._id,
      axisConfig: widget.axisConfig,
      dataFilter: widget.dataFilter,
      trendConfig: widget.trendConfig,
      countConfig: widget.countConfig,
      campaignConfig: widget.campaignConfig,
      calendarConfig: widget.calendarConfig,
      numericConfig: widget.numericConfig,
      funnelConfig: widget.funnelConfig,
      performerConfig: widget.performerConfig,
      histogramConfig: widget.histogramConfig,
      heatmapConfig: widget.heatmapConfig,
      consolidateData: group.consolidateData,
      consolidateDate: group.consolidateDate,
      showSpecificDate: group.showSpecificDate,
      compareConfig: widget.compareConfig,
      compareDateConfig: widget.compareDateConfig,
      isRowTotal: widget.isRowTotal,
      isColumnTotal: widget.isColumnTotal,
      isAdjustHeader: widget.isAdjustHeader
    }
  };
}

@Injectable({
  providedIn: 'root'
})
export class KpiService {
  constructor(private http: HttpClient) {}

  postKpiData(payload: unknown): Observable<KpiDataResponse> {
    return this.http.post<KpiDataResponse>(`${environment.apiUrl}/kpi/data`, payload);
  }
}
