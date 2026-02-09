import { Component, input, computed, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HubStatus, SubsidiaryCompany } from '../../../../../shared/models/war-room.interface';

@Component({
  selector: 'app-war-room-hub-status',
  imports: [CommonModule],
  templateUrl: './war-room-hub-status.component.html',
  styleUrl: './war-room-hub-status.component.scss',
})
export class WarRoomHubStatusComponent {
  selectedSubsidiary = input<SubsidiaryCompany | null>(null);

  addCompanyRequested = output<void>();

  readonly hubs = computed(() => {
    return this.selectedSubsidiary()?.hubs || [];
  });

  readonly quantumChart = computed(() => {
    return this.selectedSubsidiary()?.quantumChart || null;
  });

  /** Two states: active (ACTIVE) vs inactive (INACTIVE). */
  private isActiveHub(status: HubStatus): boolean {
    return status === 'ACTIVE';
  }

  getHubBorderClass(status: HubStatus): string {
    return this.isActiveHub(status) ? 'border-tactical-green' : 'border-critical-red';
  }

  getHubAccentColor(status: HubStatus): string {
    return this.isActiveHub(status) ? '#00FF41' : '#ef4444';
  }

  getHubStatusLabel(status: HubStatus): string {
    return this.isActiveHub(status) ? 'ACTIVE' : 'INACTIVE';
  }

  getHubStatusIcon(status: HubStatus): string {
    return this.isActiveHub(status) ? 'check_circle' : 'report';
  }

  /**
   * Handle add company click – request modal (handled by war-room, modal over map)
   */
  onAddCompany(): void {
    this.addCompanyRequested.emit();
  }
}
