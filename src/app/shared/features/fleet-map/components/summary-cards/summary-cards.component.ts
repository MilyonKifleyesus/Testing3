import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, ViewEncapsulation, input } from '@angular/core';
import type { FleetStats } from '../../models/fleet-map.models';

interface SummaryCard {
  key: keyof FleetStats;
  label: string;
  iconClass: string;
  toneClass: string;
}

const CARDS: SummaryCard[] = [
  { key: 'totalProjects', label: 'Projects', iconClass: 'bi bi-box-seam', toneClass: 'fleet-summary-card__icon--primary' },
  { key: 'activeProjects', label: 'Active', iconClass: 'bi bi-truck', toneClass: 'fleet-summary-card__icon--success' },
  { key: 'inactiveProjects', label: 'Inactive', iconClass: 'bi bi-exclamation-circle', toneClass: 'fleet-summary-card__icon--danger' },
  { key: 'totalClients', label: 'Clients', iconClass: 'bi bi-people', toneClass: 'fleet-summary-card__icon--info' },
];

@Component({
  selector: 'app-summary-cards',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './summary-cards.component.html',
  styleUrl: './summary-cards.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
})
export class SummaryCardsComponent {
  readonly stats = input.required<FleetStats>();
  readonly cards = CARDS;
}
