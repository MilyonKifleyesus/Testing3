import { Routes } from '@angular/router';
import { roleGuard } from '../../shared/guards/auth.guard';

// Client Routes
export const clientRoutingModule: Routes = [
  {
    path: '',
    redirectTo: 'dashboard',
    pathMatch: 'full'
  },
  {
    path: 'dashboard',
    canActivate: [roleGuard],
    data: { roles: ['client', 'user'] },
    loadComponent: () => import('../../shared/features/dashboard/dashboard.component').then(m => m.DashboardComponent)
  },
  // ========== ASSETS ==========
  {
    path: 'assets',
    canActivate: [roleGuard],
    data: { roles: ['client', 'user'] },
    loadComponent: () => import('../../shared/features/tickets/tickets.component').then(m => m.TicketsComponent)
  },
  // ========== TICKETS ==========
  {
    path: 'tickets',
    canActivate: [roleGuard],
    data: { roles: ['client', 'user'] },
    loadComponent: () => import('../../shared/features/tickets/tickets.component').then(m => m.TicketsComponent)
  },
  // ========== SNAGS ==========
  {
    path: 'snags',
    canActivate: [roleGuard],
    data: { roles: ['client', 'user'] },
    loadComponent: () => import('../../shared/features/snags/snags.component').then(m => m.SnagsComponent)
  },
  // ========== PROJECTS ==========
  {
    path: 'projects',
    canActivate: [roleGuard],
    data: { roles: ['client', 'user'] },
    loadChildren: () => import('../../shared/features/project-management/project-management.routes').then((m) => m.projectManagementRoutes)
  },
  // ========== STATIONS ==========
  {
    path: 'stations',
    canActivate: [roleGuard],
    data: { roles: ['client', 'user'] },
    children: [
      {
        path: 'list',
        loadComponent: () => import('../../shared/features/tickets/tickets.component').then(m => m.TicketsComponent)
      },
      {
        path: 'tracker',
        loadComponent: () => import('../../shared/features/tickets/tickets.component').then(m => m.TicketsComponent)
      }
    ]
  },
  // ========== VEHICLES ==========
  {
    path: 'vehicles',
    canActivate: [roleGuard],
    data: { roles: ['client', 'user'] },
    children: [
      {
        path: 'list',
        loadComponent: () => import('../../shared/features/vehicles/vehicle-list.component').then(m => m.VehicleListComponent)
      },
      {
        path: 'propulsion',
        loadComponent: () => import('../../shared/features/vehicles/vehicle-list.component').then(m => m.VehicleListComponent)
      },
      {
        path: 'mileage',
        loadComponent: () => import('../../shared/features/vehicles/vehicle-list.component').then(m => m.VehicleListComponent)
      },
      {
        path: 'view/:id',
        loadComponent: () => import('../../shared/features/vehicles/vehicle-view/vehicle-view.component').then(m => m.VehicleViewComponent)
      }
    ]
  },
  // ========== REPORTS ROUTES (Using Shared Components) ==========
  {
    path: 'reports',
    canActivate: [roleGuard],
    data: { roles: ['client', 'user'] },
    loadChildren: () => import('../../shared/reports/reports.routes').then((m) => m.sharedReportsRoutes)
  }
];
