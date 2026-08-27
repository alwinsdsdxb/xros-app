import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

// Shared between dashboard.component.ts (which resolves the real store behind
// the active footfallGroup) and shell.component.ts (which shows it in the
// breadcrumb) - the shell has no route/widget data of its own to derive this
// from.
@Injectable({
  providedIn: 'root'
})
export class StoreContextService {
  private readonly storeNameSubject = new BehaviorSubject<string>('All Stores');
  readonly storeName$ = this.storeNameSubject.asObservable();

  setStoreName(name: string | null | undefined): void {
    this.storeNameSubject.next(name || 'All Stores');
  }
}
