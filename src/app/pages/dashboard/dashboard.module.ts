import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';

import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { HighchartsChartModule } from 'highcharts-angular';

import { DashboardRoutingModule } from './dashboard-routing.module';
import { DashboardComponent } from './dashboard.component';
import { KpiCardComponent } from './kpi-card/kpi-card.component';
import { FlowFunnelChartComponent } from './flow-funnel-chart/flow-funnel-chart.component';
import { DemographicsPanelComponent } from './demographics-panel/demographics-panel.component';
import { TrendChartComponent } from './trend-chart/trend-chart.component';
import { DwellPanelComponent } from './dwell-panel/dwell-panel.component';
import { OperationsPanelComponent } from './operations-panel/operations-panel.component';
import { InstoreAnalyticsComponent } from './instore-analytics/instore-analytics.component';
import { PeakHoursPanelComponent } from './instore-analytics/peak-hours-panel/peak-hours-panel.component';
import { FloorPlanPanelComponent } from './instore-analytics/floor-plan-panel/floor-plan-panel.component';
import { ZoneTablePanelComponent } from './instore-analytics/zone-table-panel/zone-table-panel.component';
import { ZoneCorrelationPanelComponent } from './instore-analytics/zone-correlation-panel/zone-correlation-panel.component';
import { TrialRoomsPanelComponent } from './instore-analytics/trial-rooms-panel/trial-rooms-panel.component';
import { CalendarPanelComponent } from './calendar-panel/calendar-panel.component';
import { ActiveCampaignsPanelComponent } from './active-campaigns-panel/active-campaigns-panel.component';
import { ForecastPanelComponent } from './forecast-panel/forecast-panel.component';
import { ComparisonPanelComponent } from './comparison-panel/comparison-panel.component';

@NgModule({
  declarations: [
    DashboardComponent,
    KpiCardComponent,
    FlowFunnelChartComponent,
    DemographicsPanelComponent,
    TrendChartComponent,
    DwellPanelComponent,
    OperationsPanelComponent,
    InstoreAnalyticsComponent,
    PeakHoursPanelComponent,
    FloorPlanPanelComponent,
    ZoneTablePanelComponent,
    ZoneCorrelationPanelComponent,
    TrialRoomsPanelComponent,
    CalendarPanelComponent,
    ActiveCampaignsPanelComponent,
    ForecastPanelComponent,
    ComparisonPanelComponent
  ],
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    HighchartsChartModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatInputModule,
    MatFormFieldModule,
    MatSelectModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatCheckboxModule,
    MatProgressSpinnerModule,
    MatButtonToggleModule,
    DashboardRoutingModule
  ]
})
export class DashboardModule {}
