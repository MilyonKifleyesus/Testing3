import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

export const fluorescenceMapRoutes: Routes = [
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
