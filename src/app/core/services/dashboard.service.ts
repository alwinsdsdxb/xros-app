import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { DashboardQueryParams, DashboardResponse } from '../models/dashboard.model';

@Injectable({
  providedIn: 'root'
})
export class DashboardService {
  constructor(private http: HttpClient) {}

  getDashboard(params: DashboardQueryParams): Observable<DashboardResponse> {
    let httpParams = new HttpParams();
    if (params.scope) {
      httpParams = httpParams.set('scope', params.scope);
    }
    if (params.date) {
      httpParams = httpParams.set('date', params.date);
    }
    if (params.view) {
      httpParams = httpParams.set('view', params.view);
    }
    return this.http.get<DashboardResponse>(`${environment.apiUrl}/analytics/dashboard`, { params: httpParams });
  }
}
