import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ForecastQueryParams, ForecastResponse } from '../models/forecast.model';

@Injectable({
  providedIn: 'root'
})
export class ForecastService {
  constructor(private http: HttpClient) {}

  getForecast(params: ForecastQueryParams): Observable<ForecastResponse> {
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
    return this.http.get<ForecastResponse>(`${environment.apiUrl}/analytics/forecast`, {
      params: httpParams
    });
  }
}
