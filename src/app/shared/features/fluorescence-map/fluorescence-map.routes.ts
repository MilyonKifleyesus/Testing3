import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

export const fluorescenceMapRoutes: Routes = [
  { path: 'war-room', redirectTo: 'apps/fluorescence-map', pathMatch: 'full' },
  {
    path: 'apps/fluorescence-map',
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./fluorescence-map.component').then((m) => m.WarRoomComponent),
      },
    ],
  },
];

@NgModule({
  imports: [RouterModule.forChild(fluorescenceMapRoutes)],
  exports: [RouterModule],
})
export class FluorescenceMapRoutingModule {
  static routes = fluorescenceMapRoutes;
}
