import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup } from '@angular/forms';
import { finalize } from 'rxjs';
import { DashboardService } from '../../core/services/dashboard.service';
import { StoresService } from '../../core/services/stores.service';
import { DashboardResponse } from '../../core/models/dashboard.model';

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss'
})
export class DashboardComponent implements OnInit {
  filterForm: FormGroup;
  data: DashboardResponse | null = null;
  loading = false;
  errorMessage = '';

  scopes = [{ value: 'all', label: 'All stores' }];

  readonly views = ['Day', 'Week', 'Month', 'Year', 'Custom'];

  constructor(
    private fb: FormBuilder,
    private dashboardService: DashboardService,
    private storesService: StoresService
  ) {
    this.filterForm = this.fb.group({
      scope: ['all'],
      view: ['Day'],
      date: [new Date()]
    });
  }

  ngOnInit(): void {
    this.storesService.getStores().subscribe({
      next: (stores) => {
        this.scopes = [
          { value: 'all', label: 'All stores' },
          ...stores.map((s) => ({ value: s.id, label: s.name }))
        ];
      }
    });
    this.fetch();
  }

  apply(): void {
    this.fetch();
  }

  private fetch(): void {
    this.loading = true;
    this.errorMessage = '';

    const { scope, view, date } = this.filterForm.value;
    const dateStr = this.formatDate(date);

    this.dashboardService
      .getDashboard({ scope, view, date: dateStr })
      .pipe(finalize(() => (this.loading = false)))
      .subscribe({
        next: (res) => {
          this.data = res;
          if (res?.date) {
            this.filterForm.patchValue({ date: new Date(res.date) }, { emitEvent: false });
          }
        },
        error: () => {
          this.errorMessage = 'Unable to load dashboard data. Please check the API connection and try again.';
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

  get displayDate(): string {
    if (!this.data?.date) {
      return '';
    }
    return new Date(this.data.date).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  }
}
