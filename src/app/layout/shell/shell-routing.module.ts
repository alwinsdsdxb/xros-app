import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { ShellComponent } from './shell.component';

const routes: Routes = [
  {
    path: '',
    component: ShellComponent,
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        loadChildren: () => import('../../pages/dashboard/dashboard.module').then((m) => m.DashboardModule)
      },
      {
        path: 'store-health-score',
        loadComponent: () => import('../../pages/coming-soon/coming-soon.component').then((m) => m.ComingSoonComponent),
        data: { title: 'XR Store Health Score' }
      },
      {
        path: 'stores-comparisons',
        loadComponent: () => import('../../pages/coming-soon/coming-soon.component').then((m) => m.ComingSoonComponent),
        data: { title: 'XR Stores Comparisons™' }
      },
      {
        path: 'marketing-intelligence',
        loadComponent: () =>
          import('../../pages/marketing-intelligence/marketing-intelligence.component').then(
            (m) => m.MarketingIntelligenceComponent
          ),
        data: { title: 'XR Marketing Intelligence™' }
      },
      {
        path: 'sales-data-flow',
        loadComponent: () => import('../../pages/coming-soon/coming-soon.component').then((m) => m.ComingSoonComponent),
        data: { title: 'XR Sales Data Flow™' }
      },
      {
        path: 'climate-iq',
        loadComponent: () => import('../../pages/coming-soon/coming-soon.component').then((m) => m.ComingSoonComponent),
        data: { title: 'XR ClimateIQ™' }
      },
      {
        path: 'my-roster',
        loadComponent: () => import('../../pages/my-roster/my-roster.component').then((m) => m.MyRosterComponent),
        data: { title: 'My Roster' }
      },
      {
        path: 'workforce-intelligence',
        loadComponent: () => import('../../pages/coming-soon/coming-soon.component').then((m) => m.ComingSoonComponent),
        data: { title: 'XR Workforce Intelligence™' }
      },
      {
        path: 'employees',
        loadComponent: () => import('../../pages/coming-soon/coming-soon.component').then((m) => m.ComingSoonComponent),
        data: { title: 'Employees' }
      },
      {
        path: 'settings',
        loadComponent: () => import('../../pages/coming-soon/coming-soon.component').then((m) => m.ComingSoonComponent),
        data: { title: 'Settings' }
      }
    ]
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class ShellRoutingModule {}
