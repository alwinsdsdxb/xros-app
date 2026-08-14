import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { DashboardGroup, DashboardSummary, EventListItem, StoreListItem, Widget } from '../models/widget.model';

interface ApiEnvelope<T> {
  statusCode: number;
  message: string;
  data: T;
}

interface PaginatedEnvelope<T> {
  statusCode: number;
  message: string;
  pagination: { total: number; page: number; limit: number };
  data: T;
}

@Injectable({
  providedIn: 'root'
})
export class WidgetService {
  constructor(private http: HttpClient) {}

  getDashboards(): Observable<DashboardSummary[]> {
    return this.http
      .get<ApiEnvelope<DashboardSummary[]>>(`${environment.apiUrl}/dashboard/list`)
      .pipe(map((res) => res.data));
  }

  getGroups(dashboardId: string): Observable<DashboardGroup[]> {
    return this.http
      .get<ApiEnvelope<DashboardGroup[]>>(`${environment.apiUrl}/group/list/${dashboardId}`)
      .pipe(map((res) => res.data));
  }

  getWidgets(groupId: string): Observable<Widget[]> {
    return this.http
      .get<ApiEnvelope<Widget[]>>(`${environment.apiUrl}/widget/list/${groupId}`)
      .pipe(map((res) => res.data));
  }

  getStores(): Observable<StoreListItem[]> {
    return this.http
      .get<PaginatedEnvelope<StoreListItem[]>>(`${environment.apiUrl}/store/list`, { params: { limit: 500 } })
      .pipe(map((res) => res.data));
  }

  getEvents(): Observable<EventListItem[]> {
    return this.http
      .get<PaginatedEnvelope<EventListItem[]>>(`${environment.apiUrl}/event/list`, { params: { limit: 100 } })
      .pipe(map((res) => res.data));
  }
}
