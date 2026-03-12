import { Routes } from '@angular/router';

export const fleetMapRoutes: Routes = [
  {
    path: '',
    loadComponent: () => import('./fleet-map.component').then((m) => m.FleetMapComponent),
  },
];
