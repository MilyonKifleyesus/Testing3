import { CommonModule } from '@angular/common';
import { Component, Input, ViewChild } from '@angular/core';
import { SpkApexChartsComponent } from '../../reusable-charts/spk-apex-charts/spk-apex-charts.component';

export interface SpkTicketActivityWidgetViewModel {
  scopeLabel: string;
  projectLabel: string;
  totalTickets: string;
  spanDays: string;
  activeDays: string;
  averagePerDay: string;
  peakDayLabel: string;
  peakDayCount: string;
  firstTicketLabel: string;
  lastTicketLabel: string;
  rangeLabel: string;
}

const EMPTY_VIEW_MODEL: SpkTicketActivityWidgetViewModel = {
  scopeLabel: 'Current selection',
  projectLabel: '',
  totalTickets: '0',
  spanDays: '0',
  activeDays: '0',
  averagePerDay: '0.0',
  peakDayLabel: '-',
  peakDayCount: '0',
  firstTicketLabel: '-',
  lastTicketLabel: '-',
  rangeLabel: 'No created ticket dates',
};

@Component({
  selector: 'spk-ticket-activity-widget',
  standalone: true,
  imports: [CommonModule, SpkApexChartsComponent],
  templateUrl: './spk-ticket-activity-widget.component.html',
  styleUrl: './spk-ticket-activity-widget.component.scss',
})
export class SpkTicketActivityWidgetComponent {
  @Input() chartOptions: any;
  @Input() loading = false;
  @Input() fullscreen = false;
  @Input() eyebrow = 'Created Date Timeline';
  @Input() viewModel: SpkTicketActivityWidgetViewModel = EMPTY_VIEW_MODEL;

  @ViewChild(SpkApexChartsComponent) private apexChart?: SpkApexChartsComponent;

  exportChartPng(): Promise<{ imgURI: string } | null> {
    return this.apexChart?.exportDataURI() ?? Promise.resolve(null);
  }
}
