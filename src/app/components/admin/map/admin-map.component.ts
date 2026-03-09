import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FluorescenceMapComponent } from '../../../shared/features/fluorescence-map/fluorescence-map.component';

@Component({
  selector: 'app-admin-map',
  standalone: true,
  imports: [CommonModule, FluorescenceMapComponent],
  template: `
    <app-fluorescence-map [dataManagementMode]="'edit'" [tableLayout]="'inline'"></app-fluorescence-map>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class AdminMapComponent {}
