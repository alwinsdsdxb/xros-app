import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { LoginComponent } from './pages/login/login.component';
import { DashboardComponent } from './pages/dashboard/dashboard.component';
import { ComingSoonComponent } from './pages/coming-soon/coming-soon.component';
import { MyRosterComponent } from './pages/my-roster/my-roster.component';
import { ShellComponent } from './layout/shell/shell.component';
import { authGuard } from './core/guards/auth.guard';
import { guestGuard } from './core/guards/guest.guard';

const routes: Routes = [
  { path: 'login', component: LoginComponent, canActivate: [guestGuard] },
  {
    path: '',
    component: ShellComponent,
    canActivate: [authGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      { path: 'dashboard', component: DashboardComponent, data: { title: 'XR Dashboard' } },
      { path: 'dashboard/:dashboardId', component: DashboardComponent, data: { title: 'XR Dashboard' } },
      {
        path: 'store-health-score',
        component: ComingSoonComponent,
        data: { title: 'XR Store Health Score' }
      },
      {
        path: 'stores-comparisons',
        component: ComingSoonComponent,
        data: { title: 'XR Stores Comparisons™' }
      },
      {
        path: 'marketing-intelligence',
        component: ComingSoonComponent,
        data: { title: 'XR Marketing Intelligence™' }
      },
      {
        path: 'sales-data-flow',
        component: ComingSoonComponent,
        data: { title: 'XR Sales Data Flow™' }
      },
      {
        path: 'climate-iq',
        component: ComingSoonComponent,
        data: { title: 'XR ClimateIQ™' }
      },
      { path: 'my-roster', component: MyRosterComponent, data: { title: 'My Roster' } },
      {
        path: 'workforce-intelligence',
        component: ComingSoonComponent,
        data: { title: 'XR Workforce Intelligence™' }
      },
      { path: 'employees', component: ComingSoonComponent, data: { title: 'Employees' } },
      { path: 'settings', component: ComingSoonComponent, data: { title: 'Settings' } }
    ]
  },
  { path: '**', redirectTo: 'dashboard' }
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule {}
