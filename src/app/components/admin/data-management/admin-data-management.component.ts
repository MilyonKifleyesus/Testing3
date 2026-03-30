import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FluorescenceMapComponent } from '../../../shared/features/fluorescence-map/fluorescence-map.component';

@Component({
  selector: 'app-admin-data-management',
  standalone: true,
  imports: [CommonModule, FluorescenceMapComponent],
  template: `
    <div class="main-container container-fluid px-0">
      <div class="d-md-flex d-block align-items-center justify-content-between my-4 page-header-breadcrumb">
        <div>
          <h1 class="page-title fw-semibold fs-20 mb-0">Data Management</h1>
          <p class="mb-0 text-muted fs-13">Projects, Clients, Manufacturers, and Locations</p>
        </div>
      </div>

      <app-fluorescence-map
        [dataManagementOnly]="true"
        [dataManagementMode]="'edit'">
      </app-fluorescence-map>
    </div>
  `,
})
export class AdminDataManagementComponent {}

