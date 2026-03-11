import { Routes } from '@angular/router';
import { roleGuard } from '../../shared/guards/auth.guard';

// Super Admin Routes
export const adminRoutingModule: Routes = [
  {
    path: '',
    redirectTo: 'dashboard',
    pathMatch: 'full'
  },
  {
    path: 'dashboard',
    canActivate: [roleGuard],
    data: { roles: ['superadmin', 'admin'] },
    loadComponent: () => import('../../shared/features/dashboard/dashboard.component').then(m => m.DashboardComponent)
  },
  {
    path: 'projects',
    canActivate: [roleGuard],
    data: { roles: ['superadmin', 'admin'] },
    loadChildren: () => import('../../shared/features/project-management/project-management.routes').then((m) => m.projectManagementRoutes)
  },
  {
    path: 'users',
    canActivate: [roleGuard],
    data: { roles: ['superadmin'] },
    children: [
      {
        path: 'list',
        loadComponent: () => import('./user-management/user-list/user-list.component').then(m => m.UserListComponent)
      },
      {
        path: 'view/:id',
        loadComponent: () => import('./user-management/user-view/user-view.component').then(m => m.UserViewComponent)
      },
      {
        path: 'edit/:id',
        loadComponent: () => import('./user-management/user-edit/user-edit.component').then(m => m.UserEditComponent)
      },
      {
        path: 'new',
        loadComponent: () => import('./user-management/user-edit/user-edit.component').then(m => m.UserEditComponent)
      },
      {
        path: 'inspectors',
        loadComponent: () => import('./user-management/inspectors/inspector-list.component').then(m => m.InspectorListComponent)
      },
      {
        path: 'inspectors/add',
        loadComponent: () => import('./user-management/inspectors/add-inspector/add-inspector.component').then(m => m.AddInspectorComponent)
      },
      {
        path: 'inspectors/:id',
        loadComponent: () => import('./user-management/inspectors/inspector-profile/inspector-profile.component').then(m => m.InspectorProfileComponent)
      }
    ]
  },
  {
    path: 'config',
    canActivate: [roleGuard],
    data: { roles: ['superadmin'] },
    children: [
      {
        path: 'inspector-category',
        loadComponent: () => import('./configuration/inspector-category/inspector-category.component').then(m => m.InspectorCategoryComponent)
      },
      {
        path: 'inspector-task',
        loadComponent: () => import('./configuration/inspector-task/inspector-task.component').then(m => m.InspectorTaskComponent)
      },
      {
        path: 'inspector-status',
        loadComponent: () => import('./configuration/inspector-status/inspector-status.component').then(m => m.InspectorStatusComponent)
      },
      {
        path: 'project-type',
        loadComponent: () => import('./configuration/project-type/project-type.component').then(m => m.ProjectTypeComponent)
      },
      {
        path: 'defect-type',
        loadComponent: () => import('./configuration/defect-type/defect-type.component').then(m => m.DefectTypeComponent)
      },
      {
        path: 'defect-location',
        loadComponent: () => import('./configuration/defect-location/defect-location.component').then(m => m.DefectLocationComponent)
      },
      {
        path: 'types-of-time',
        loadComponent: () => import('./configuration/types-of-time/types-of-time.component').then(m => m.TypesOfTimeComponent)
      },
      {
        path: 'category-inspection',
        loadComponent: () => import('./configuration/category-inspection/category-inspection.component').then(m => m.CategoryInspectionComponent)
      },
      {
        path: 'location',
        loadComponent: () => import('./configuration/location/location.component').then(m => m.LocationComponent)
      },
      {
        path: 'languages',
        loadComponent: () => import('./configuration/languages/languages.component').then(m => m.LanguagesComponent)
      }
    ]
  },
  {
    path: 'timesheet',
    canActivate: [roleGuard],
    data: { roles: ['superadmin'] },
    loadComponent: () => import('./timesheet/timesheet.component').then(m => m.TimesheetComponent)
  },
  {
    path: 'logs',
    canActivate: [roleGuard],
    data: { roles: ['superadmin'] },
    children: [
      {
        path: 'edit',
        loadComponent: () => import('./logs/edit-logs/edit-logs.component').then(m => m.EditLogsComponent)
      },
      {
        path: 'sync',
        loadComponent: () => import('./logs/sync-logs/sync-logs.component').then(m => m.SyncLogsComponent)
      },
      {
        path: 'access',
        loadComponent: () => import('./logs/access-logs/access-logs.component').then(m => m.AccessLogsComponent)
      }
    ]
  },
  {
    path: 'simulator',
    canActivate: [roleGuard],
    data: { roles: ['superadmin'] },
    children: [
      {
        path: 'asset-tracker',
        loadComponent: () => import('./simulator/asset-tracker/asset-tracker.component').then(m => m.AssetTrackerComponent)
      },
      {
        path: 'create-ticket',
        loadComponent: () => import('./simulator/create-ticket/create-ticket.component').then(m => m.CreateTicketComponent)
      },
      {
        path: 'create-snag',
        loadComponent: () => import('./simulator/create-snag/create-snag.component').then(m => m.CreateSnagComponent)
      },
      {
        path: 'create-timesheet',
        loadComponent: () => import('./simulator/create-timesheet/create-timesheet.component').then(m => m.CreateTimesheetComponent)
      },
      {
        path: 'inspection-list',
        loadComponent: () => import('./simulator/inspection-list/inspection-list.component').then(m => m.InspectionListComponent)
      }
    ]
  },
  {
    path: 'reports',
    canActivate: [roleGuard],
    data: { roles: ['superadmin', 'admin'] },
    loadChildren: () => import('../../shared/reports/reports.routes').then((m) => m.sharedReportsRoutes)
  },
    {
    path: 'vehicles',
    canActivate: [roleGuard],
    data: { roles: ['superadmin', 'user'] },
    children: [
      {
        path: 'list',
        loadComponent: () => import('../../shared/features/vehicles/vehicle-list.component').then(m => m.VehicleListComponent)
      },
      {
        path: 'view/:id',
        loadComponent: () => import('../../shared/features/vehicles/vehicle-view/vehicle-view.component').then(m => m.VehicleViewComponent)
      }
    ]
  },
  {
    path: 'snags',
    canActivate: [roleGuard],
    data: { roles: ['superadmin'] },
    loadComponent: () => import('../../shared/features/snags/snags.component').then(m => m.SnagsComponent)
  },
  {
    path: 'tickets',
    canActivate: [roleGuard],
    data: { roles: ['superadmin'] },
    loadComponent: () => import('../../shared/features/tickets/tickets.component').then(m => m.TicketsComponent)
  },
  // YRT Data route removed
];
