import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, forkJoin, map, of, shareReplay } from 'rxjs';
import { environment } from '../../../environments/environment';
import { HourlyQueueRow, VionPlaza } from '../models/queue-hourly.model';

// Raw shape of one row from Vion's own /base/plazaInfo - camelCase like
// /queue/hour, but with no group/company field at all (confirmed against
// the live response) - only location fields to disambiguate similarly-named
// plazas, so those are used instead of a groupName.
interface VionPlazaListRow {
  plazaUnid: string;
  plazaName: string;
  cityName: string;
  provinceName: string;
}

// Vion's own response shape for GET /api/v2/queue/hour - one row per
// entrance gate per time slot, not per store, so multiple gates (and
// multiple stores, when "All Stores" is in scope) get summed/averaged
// together per hour-of-day by aggregate() below.
interface VionQueueHourRow {
  gateUnid: string;
  gateName: string;
  countdate: string;
  countTime: string; // "yyyy-MM-dd HH:mm:ss"
  avgQueueLength: number;
  queueCount: number;
  avgQueueSecond: number;
  abandonTimes: number;
  avgServiceSecond: number;
  serviceCount: number;
}

interface VionQueueHourResponse {
  code: number;
  success: boolean;
  message: string;
  data: VionQueueHourRow[];
}

@Injectable({
  providedIn: 'root'
})
export class QueueHourlyService {
  // ~10k rows in one response, but only ever fetched once per browser
  // session (shareReplay(1)) - every component asking for the plaza list
  // shares this same in-flight/cached request instead of re-fetching it.
  private plazaList$: Observable<VionPlaza[]> | null = null;

  constructor(private http: HttpClient) {}

  getPlazaList(): Observable<VionPlaza[]> {
    if (!this.plazaList$) {
      this.plazaList$ = this.http
        .get<VionPlazaListRow[] | { data: VionPlazaListRow[] }>(`${environment.vionQueueApiUrl}/api/v2/base/plazaInfo`, {
          headers: { Authorization: environment.vionQueueApiToken }
        })
        .pipe(
          map((res) => (Array.isArray(res) ? res : res?.data ?? [])),
          map((rows) =>
            rows.map((row) => ({
              plazaUnid: row.plazaUnid,
              plazaName: row.plazaName,
              cityName: [row.cityName, row.provinceName].filter(Boolean).join(', ')
            }))
          ),
          shareReplay(1)
        );
    }
    return this.plazaList$;
  }

  // One store maps to one Vion plazaUnid (its externalId) - called directly
  // from the browser (see plan doc for why: no server-side proxy for this
  // feature), so this hits Vion's own host, not environment.apiUrl.
  getHourlyQueue(plazaUnids: string[], date: string, timeInterval = 60): Observable<HourlyQueueRow[]> {
    if (!plazaUnids.length) {
      return of(this.emptyRows());
    }

    const requests = plazaUnids.map((plazaUnid) =>
      this.http.get<VionQueueHourResponse>(`${environment.vionQueueApiUrl}/api/v2/queue/hour`, {
        headers: { Authorization: environment.vionQueueApiToken },
        params: { plazaUnid, countdate: date, timeInterval: String(timeInterval) }
      })
    );

    return forkJoin(requests).pipe(map((responses) => this.aggregate(responses)));
  }

  private aggregate(responses: VionQueueHourResponse[]): HourlyQueueRow[] {
    const rows = this.emptyRows();
    const queueWeight = rows.map(() => 0);
    const serviceWeight = rows.map(() => 0);

    for (const response of responses) {
      for (const gate of response.data ?? []) {
        const hour = this.hourOf(gate.countTime);
        if (hour === null) {
          continue;
        }
        const row = rows[hour];
        const queueCount = gate.queueCount ?? 0;
        const serviceCount = gate.serviceCount ?? 0;

        row.queueCount += queueCount;
        row.serviceCount += serviceCount;
        row.abandonTimes += gate.abandonTimes ?? 0;
        row.avgQueueLength += (gate.avgQueueLength ?? 0) * queueCount;
        row.avgQueueSecond += (gate.avgQueueSecond ?? 0) * queueCount;
        row.avgServiceSecond += (gate.avgServiceSecond ?? 0) * serviceCount;
        queueWeight[hour] += queueCount;
        serviceWeight[hour] += serviceCount;
      }
    }

    return rows.map((row, i) => ({
      ...row,
      avgQueueLength: queueWeight[i] ? row.avgQueueLength / queueWeight[i] : 0,
      avgQueueSecond: queueWeight[i] ? row.avgQueueSecond / queueWeight[i] : 0,
      avgServiceSecond: serviceWeight[i] ? row.avgServiceSecond / serviceWeight[i] : 0
    }));
  }

  // Extracted with a plain regex rather than `new Date(...)` - avoids any
  // cross-browser inconsistency in parsing Vion's non-ISO "yyyy-MM-dd
  // HH:mm:ss" string, and there's no timezone conversion to get wrong since
  // Vion already reports in the mall's own local time.
  private hourOf(countTime: string): number | null {
    const match = /\s(\d{2}):\d{2}:\d{2}/.exec(countTime ?? '');
    if (!match) {
      return null;
    }
    const hour = Number(match[1]);
    return hour >= 0 && hour <= 23 ? hour : null;
  }

  private emptyRows(): HourlyQueueRow[] {
    return Array.from({ length: 24 }, (_, hour) => ({
      hour,
      hourLabel: `${hour.toString().padStart(2, '0')}:00`,
      queueCount: 0,
      avgQueueLength: 0,
      avgQueueSecond: 0,
      avgServiceSecond: 0,
      abandonTimes: 0,
      serviceCount: 0
    }));
  }
}
