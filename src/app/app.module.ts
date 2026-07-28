import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';

import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatListModule } from '@angular/material/list';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatTableModule } from '@angular/material/table';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatMenuModule } from '@angular/material/menu';
import { HighchartsChartModule } from 'highcharts-angular';

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { LoginComponent } from './pages/login/login.component';
import { ComingSoonComponent } from './pages/coming-soon/coming-soon.component';
import { DashboardComponent } from './pages/dashboard/dashboard.component';
import { KpiCardComponent } from './pages/dashboard/kpi-card/kpi-card.component';
import { FlowFunnelChartComponent } from './pages/dashboard/flow-funnel-chart/flow-funnel-chart.component';
import { DemographicsPanelComponent } from './pages/dashboard/demographics-panel/demographics-panel.component';
import { TrendChartComponent } from './pages/dashboard/trend-chart/trend-chart.component';
import { DwellPanelComponent } from './pages/dashboard/dwell-panel/dwell-panel.component';
import { OperationsPanelComponent } from './pages/dashboard/operations-panel/operations-panel.component';
import { ShellComponent } from './layout/shell/shell.component';
import { authInterceptor } from './core/interceptors/auth.interceptor';

const MATERIAL_MODULES = [
  MatCardModule,
  MatButtonModule,
  MatIconModule,
  MatInputModule,
  MatFormFieldModule,
  MatSelectModule,
  MatDatepickerModule,
  MatNativeDateModule,
  MatListModule,
  MatToolbarModule,
  MatSidenavModule,
  MatTableModule,
  MatCheckboxModule,
  MatProgressSpinnerModule,
  MatDividerModule,
  MatTooltipModule,
  MatButtonToggleModule,
  MatMenuModule
];

@NgModule({
  declarations: [
    AppComponent,
    LoginComponent,
    ComingSoonComponent,
    DashboardComponent,
    KpiCardComponent,
    FlowFunnelChartComponent,
    DemographicsPanelComponent,
    TrendChartComponent,
    DwellPanelComponent,
    OperationsPanelComponent,
    ShellComponent
  ],
  imports: [
    BrowserModule,
    AppRoutingModule,
    FormsModule,
    ReactiveFormsModule,
    HighchartsChartModule,
    ...MATERIAL_MODULES
  ],
  providers: [
    provideAnimationsAsync(),
    provideHttpClient(withInterceptors([authInterceptor]))
  ],
  bootstrap: [AppComponent]
})
export class AppModule {}
