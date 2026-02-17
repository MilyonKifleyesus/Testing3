import { Component, input, computed, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HubStatus, SubsidiaryCompany } from '../../../../../shared/models/fluorescence-map.interface';

@Component({
  selector: 'app-fluorescence-map-hub-status',
  imports: [CommonModule],
  templateUrl: './fluorescence-map-hub-status.component.html',
  styleUrls: ['./fluorescence-map-hub-status.component.scss'],
})
export class FluorescenceMapHubStatusComponent {
  selectedSubsidiary = input<SubsidiaryCompany | null>(null);

  addCompanyRequested = output<void>();

  readonly hubs = computed(() => {
    return this.selectedSubsidiary()?.hubs || [];
  });

  readonly quantumChart = computed(() => {
    return this.selectedSubsidiary()?.quantumChart || null;
  });
  readonly quantumChartAriaLabel = computed(() => {
    const chart = this.quantumChart();
    if (!chart || chart.dataPoints.length === 0) {
      return 'Quantum sync stability chart with no available data.';
    }
    const index = Math.max(0, Math.min(chart.dataPoints.length - 1, chart.highlightedIndex ?? chart.dataPoints.length - 1));
    const current = chart.dataPoints[index];
    return `Quantum sync stability chart. ${chart.dataPoints.length} historical points. Current highlighted stability is ${current} percent.`;
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
