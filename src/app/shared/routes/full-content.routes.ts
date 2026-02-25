import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
export const content: Routes = [
  {
    path: '',
    children: [
      { path: '', loadChildren: () => import('../features/dashboard/dashboard.routes').then((r) => r.dashboardRoutingModule) },
      { path: '', loadChildren: () => import('../../../app/components/ecommerce/ecommerce.routes').then((r) => r.ecommerceRoutingModule) },
      { path: '', loadChildren: () => import('../../../app/components/apps/blog/blog.routes').then((r) => r.blogRoutingModule) },
      { path: '', loadChildren: () => import('../../../app/components/apps/filemanager/filemanager.routes').then((r) => r.filemanagerRoutingModule) },
      { path: '', loadChildren: () => import('../../../app/components/apps/mail/mail.routes').then((r) => r.mailRoutingModule) },
      { path: '', loadChildren: () => import('../../../app/components/apps/maps/maps.routes').then((r) => r.mapsRoutingModule) },
      { path: '', loadChildren: () => import('../../../app/components/apps/tables/tables.route').then((r) => r.tablesRoutingModule) },
      { path: '', loadChildren: () => import('../../../app/components/apps/apps.routes').then((r) => r.appsRoutingModule) },
      { path: '', loadChildren: () => import('../../../app/components/elements/elements.routes').then((r) => r.elementsRoutingModule) },
      { path: '', loadChildren: () => import('../../../app/components/advancedui/advancedui.routes').then((r) => r.advanceduiRoutingModule) },
      { path: '', loadChildren: () => import('../../../app/components/pages/pages.routes').then((r) => r.pagesRoutingModule) },
      { path: '', loadChildren: () => import('../../../app/components/utilities/utilities.routes').then((r) => r.utilitiesRoutingModule) },
      { path: '', loadChildren: () => import('../../../app/components/charts/charts.route').then((r) => r.chartsRoutingModule) },
      { path: '', loadChildren: () => import('../../../app/components/Forms/Form-Elements/form-elements.routes').then((r) => r.formelementsRoutingModule) },
      { path: '', loadChildren: () => import('../../../app/components/Forms/forms.routes').then((r) => r.formsRoutingModule) },
      { path: '', loadChildren: () => import('../../../app/components/Forms/form-editor/form-editor.routes').then((r) => r.formeditorRoutingModule) },
      { path: 'admin', loadChildren: () => import('../../components/admin/admin.routes').then((r) => r.adminRoutingModule) },
      { path: 'client', loadChildren: () => import('../../components/client/client.routes').then((r) => r.clientRoutingModule) },
    ],
  },
];

@NgModule({
  imports: [RouterModule.forChild(content)],
  exports: [RouterModule],
})
export class SaredRoutingModule { }
