import { Routes } from '@angular/router';

export const projectManagementRoutes: Routes = [
  {
    path: '',
    redirectTo: 'list',
    pathMatch: 'full',
  },
  {
    path: 'list',
    loadComponent: () => import('./project-list/project-list.component').then((m) => m.ProjectListComponent),
  },
  {
    path: 'new',
    loadComponent: () => import('./new-project/new-project.component').then((m) => m.NewProjectComponent),
  },
  {
    path: 'view/:id',
    loadComponent: () => import('./project-view/project-view.component').then((m) => m.ProjectViewComponent),
  },
  {
    path: 'final-vehicle',
    loadComponent: () => import('./project-list/project-list.component').then((m) => m.ProjectListComponent),
  },
];
