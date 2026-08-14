import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup } from '@angular/forms';
import { finalize } from 'rxjs';
import { MatDatepicker } from '@angular/material/datepicker';
import { ForecastService } from '../../../core/services/forecast.service';
import { StoresService } from '../../../core/services/stores.service';
import { ForecastResponse } from '../../../core/models/forecast.model';

@Component({
  selector: 'app-forecast-panel',
  templateUrl: './forecast-panel.component.html',
  styleUrl: './forecast-panel.component.scss'
})
export class ForecastPanelComponent implements OnInit {
  filterForm: FormGroup;
  data: ForecastResponse | null = null;
  loading = false;
  errorMessage = '';

  stores: { value: string; label: string }[] = [];
  readonly views = ['Day', 'Week', 'Month', 'Year', 'Custom'];

  constructor(
    private fb: FormBuilder,
    private forecastService: ForecastService,
    private storesService: StoresService
  ) {
    this.filterForm = this.fb.group({
      scope: [''],
      view: ['Month'],
      date: [new Date('2026-05-01')]
    });
  }

  ngOnInit(): void {
    this.storesService.getStores().subscribe({
      next: (stores) => {
        this.stores = stores.map((s) => ({ value: s.id, label: s.name }));
        if (this.stores.length) {
          this.filterForm.patchValue({ scope: this.stores[0].value }, { emitEvent: false });
        }
        this.fetch();
      },
      error: () => this.fetch()
    });
  }

  apply(): void {
    this.fetch();
  }

  // Only fires when the datepicker's startView is 'year' (Month/Year views
  // below) and the user taps a month tile - Day/Week/Custom use the normal
  // day calendar instead, which closes itself once a day is picked.
  onMonthSelected(date: Date, datepicker: MatDatepicker<Date>): void {
    this.filterForm.patchValue({ date });
    datepicker.close();
  }

  get usesMonthPicker(): boolean {
    const view = this.filterForm.value.view;
    return view === 'Month' || view === 'Year';
  }

  barWidth(predicted: number): number {
    const max = this.data?.days.reduce((m, d) => Math.max(m, d.predicted), 0) ?? 0;
    return max ? Math.max(6, Math.round((predicted / max) * 100)) : 0;
  }

  private fetch(): void {
    this.loading = true;
    this.errorMessage = '';
    const { scope, view, date } = this.filterForm.value;
    const dateStr = this.formatDate(date);

    this.forecastService
      .getForecast({ scope, view, date: dateStr })
      .pipe(finalize(() => (this.loading = false)))
      .subscribe({
        next: (res) => {
          this.data = res;
        },
        error: () => {
          this.errorMessage = 'Unable to load forecast data. Please check the API connection and try again.';
        }
      });
  }

  private formatDate(date: Date | string): string {
    const d = typeof date === 'string' ? new Date(date) : date;
    const year = d.getFullYear();
    const month = `${d.getMonth() + 1}`.padStart(2, '0');
    const day = `${d.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
