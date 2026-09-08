import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

// One shared Store/View/Date/Hours selection for the Dashboard, Instore
// Analytics, Queue Management, and Comparison tabs. Each tab keeps its own
// FormGroup (so it can still be edited independently before Apply), but on
// Apply it publishes here - every other already-visited tab then patches its
// own form to match and refetches, so "Day" picked on one tab is what you
// see when you switch to another instead of that tab silently holding
// whatever it last had.
export interface SharedFilterState {
  store: string;
  view: string;
  date: Date;
  operationalHours: number;
  customRange: { start: Date | null; end: Date | null };
}

const DEFAULT_STATE: SharedFilterState = {
  store: 'all',
  view: 'Month',
  date: new Date(),
  operationalHours: 1,
  customRange: { start: null, end: null }
};

@Injectable({
  providedIn: 'root'
})
export class FilterStateService {
  private readonly stateSubject = new BehaviorSubject<SharedFilterState>(DEFAULT_STATE);
  readonly state$ = this.stateSubject.asObservable();

  get snapshot(): SharedFilterState {
    return this.stateSubject.value;
  }

  setState(state: SharedFilterState): void {
    this.stateSubject.next(state);
  }

  // Field-by-field rather than a reference/deep-equal check on the whole
  // object - each tab rebuilds a fresh {..., customRange: {...}} literal on
  // every Apply/publish, so reference equality never holds even when nothing
  // actually changed, and Date instances need getTime() to compare by value.
  static equal(a: SharedFilterState, b: SharedFilterState): boolean {
    return (
      a.store === b.store &&
      a.view === b.view &&
      a.operationalHours === b.operationalHours &&
      this.dateEqual(a.date, b.date) &&
      this.dateEqual(a.customRange.start, b.customRange.start) &&
      this.dateEqual(a.customRange.end, b.customRange.end)
    );
  }

  private static dateEqual(a: Date | string | null, b: Date | string | null): boolean {
    const aTime = a ? new Date(a).getTime() : null;
    const bTime = b ? new Date(b).getTime() : null;
    return aTime === bTime;
  }
}
