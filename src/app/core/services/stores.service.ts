import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface Store {
  id: string;
  name: string;
  code: string;
}

@Injectable({
  providedIn: 'root'
})
export class StoresService {
  constructor(private http: HttpClient) {}

  getStores(): Observable<Store[]> {
    return this.http.get<Store[]>(`${environment.apiUrl}/stores`);
  }
}
