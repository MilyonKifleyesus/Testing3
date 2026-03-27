import { CommonModule } from '@angular/common';
import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, ViewChild, ViewEncapsulation, computed, effect, inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import type { ApiClient, ApiLocation, ApiManufacturer, ApiProject, FleetFilterKind, FleetFilterOption, FleetMode, FleetTab } from './models/fleet-map.models';
import { DataPanelComponent, type FleetEntityViewEvent } from './components/data-panel/data-panel.component';
import { FleetHeaderComponent, type FleetHeaderStatus } from './components/fleet-header/fleet-header.component';
import { MapStageComponent } from './components/map-stage/map-stage.component';
import { SummaryCardsComponent } from './components/summary-cards/summary-cards.component';
import { FleetMapApiService } from './services/fleet-map-api.service';
import { FleetMapStateService } from './services/fleet-map-state.service';
import ExcelJS from 'exceljs';

interface FilterSection {
  title: string;
  kind: FleetFilterKind;
  options: FleetFilterOption[];
}

@Component({
  selector: 'app-fleet-map',
  standalone: true,
  imports: [
    CommonModule,
    FleetHeaderComponent,
    SummaryCardsComponent,
    MapStageComponent,
    DataPanelComponent,
  ],
  templateUrl: './fleet-map.component.html',
  styleUrl: './fleet-map.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  providers: [FleetMapApiService, FleetMapStateService],
})
export class FleetMapComponent implements OnInit, OnDestroy {
  @ViewChild(MapStageComponent) private mapStage?: MapStageComponent;

  readonly state = inject(FleetMapStateService);
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  private readonly document = inject(DOCUMENT);
  private canonicalLink?: HTMLLinkElement;

  readonly headerStatus = computed<FleetHeaderStatus>(() => (
    this.state.isError() ? 'offline' : 'connected'
  ));

  readonly filterSections = computed<FilterSection[]>(() => [
    {
      title: 'Projects',
      kind: 'projects',
      options: this.state.projectOptions(),
    },
    {
      title: 'Clients',
      kind: 'clients',
      options: this.state.clientOptions(),
    },
    {
      title: 'Manufacturers',
      kind: 'manufacturers',
      options: this.state.manufacturerOptions(),
    },
    {
      title: 'Project Type',
      kind: 'types',
      options: this.state.projectTypeOptions(),
    },
    {
      title: 'Status',
      kind: 'statuses',
      options: this.state.statusOptions(),
    },
  ]);

  constructor() {
    effect(() => {
      const mode = this.state.mode();
      const stats = this.state.stats();
      const title = this.buildPageTitle(mode);
      const description = this.buildPageDescription(mode, stats.totalProjects, stats.totalClients);

      this.title.setTitle(title);
      this.meta.updateTag({ name: 'description', content: description });
      this.meta.updateTag({ name: 'keywords', content: 'BusPulse fleet map, fleet operations, project map, client map, manufacturer map' });
      this.meta.updateTag({ property: 'og:title', content: title });
      this.meta.updateTag({ property: 'og:description', content: description });
      this.meta.updateTag({ property: 'og:type', content: 'website' });
      this.meta.updateTag({ name: 'twitter:title', content: title });
      this.meta.updateTag({ name: 'twitter:description', content: description });
      this.updateCanonicalLink();
    });
  }

  ngOnInit(): void {
    this.state.load();
  }

  ngOnDestroy(): void {
    this.canonicalLink?.remove();
  }

  handleEntityView(event: FleetEntityViewEvent): void {
    this.state.handleViewEntity(event.tab, event.entity);
  }

  isProjectsMode(): boolean {
    return this.state.mode() === 'projects';
  }

  draftValues(kind: FleetFilterKind): string[] {
    switch (kind) {
      case 'projects':
        return this.state.draftProjectIds();
      case 'clients':
        return this.state.draftClientIds();
      case 'manufacturers':
        return this.state.draftManufacturerIds();
      case 'types':
        return this.state.draftTypes();
      case 'statuses':
        return this.state.draftStatuses();
    }
  }

  isDraftSelected(kind: FleetFilterKind, optionId: string): boolean {
    return this.draftValues(kind).includes(optionId);
  }

  toggleDraftValue(kind: FleetFilterKind, optionId: string): void {
    this.state.toggleDraftValue(kind, optionId);
  }

  setMode(mode: FleetMode): void {
    this.state.setMode(mode);
  }

  setTab(tab: FleetTab): void {
    this.state.setActiveTab(tab);
  }

  setSearch(value: string): void {
    this.state.setSearch(value);
  }

  clearMapFocus(): void {
    this.state.clearSelection();
  }

  projects(): ApiProject[] {
    return this.state.filteredProjects();
  }

  clients(): ApiClient[] {
    return this.state.filteredClients();
  }

  manufacturers(): ApiManufacturer[] {
    return this.state.filteredManufacturers();
  }

  locations(): ApiLocation[] {
    return this.state.filteredLocations();
  }

  private buildPageTitle(mode: FleetMode): string {
    const label = mode.charAt(0).toUpperCase() + mode.slice(1);
    return `${label} Fleet Map | BusPulse`;
  }

  private buildPageDescription(mode: FleetMode, totalProjects: number, totalClients: number): string {
    const modeLabel = mode === 'projects'
      ? 'project routes and mapped sites'
      : mode === 'clients'
        ? 'client locations and coverage'
        : 'manufacturer sites and linked locations';

    return `Interactive BusPulse fleet map for ${modeLabel}. Currently tracking ${totalProjects} projects across ${totalClients} clients.`;
  }

  showDownloadMenu = false;

  toggleDownloadMenu(event: MouseEvent): void {
    event.stopPropagation();
    this.showDownloadMenu = !this.showDownloadMenu;
  }

  closeDownloadMenu(): void {
    this.showDownloadMenu = false;
  }

  private escapeCsv(value: string): string {
    const str = String(value ?? '');
    return `"${str.replace(/"/g, '""')}"`;
  }

  async downloadMapPNG(): Promise<void> {
    const blob = await this.mapStage?.captureMapImage();
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = this.document.createElement('a');
    a.href = url;
    a.download = 'fleet-map.png';
    a.click();
    URL.revokeObjectURL(url);
  }

  downloadMapCSV(): void {
    const projects = this.state.mapProjects();
    const clients = this.state.mapClients();
    if (!projects.length) return;
    const headers = ['Name', 'Status', 'Type', 'Client', 'Latitude', 'Longitude'];
    const rows = projects.map((p) => {
      const client = clients.find((c) => c.id === p.clientId);
      return [
        this.escapeCsv(p.name ?? ''),
        this.escapeCsv(p.status ?? ''),
        this.escapeCsv(p.type ?? ''),
        this.escapeCsv(client?.name ?? p.clientId ?? ''),
        p.lat ?? '',
        p.lng ?? '',
      ].join(',');
    });
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = this.document.createElement('a');
    a.href = url;
    a.download = 'fleet-map-projects.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  async downloadMapExcel(): Promise<void> {
    const projects = this.state.mapProjects();
    const clients = this.state.mapClients();
    if (!projects.length) return;
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'BusPulse';
    const sheet = workbook.addWorksheet('Fleet Map Projects');
    sheet.columns = [
      { header: 'Name', key: 'name', width: 30 },
      { header: 'Status', key: 'status', width: 14 },
      { header: 'Type', key: 'type', width: 18 },
      { header: 'Client', key: 'client', width: 24 },
      { header: 'Latitude', key: 'lat', width: 14 },
      { header: 'Longitude', key: 'lng', width: 14 },
    ];
    sheet.getRow(1).font = { bold: true };
    projects.forEach((p) => {
      const client = clients.find((c) => c.id === p.clientId);
      sheet.addRow({
        name: p.name ?? '',
        status: p.status ?? '',
        type: p.type ?? '',
        client: client?.name ?? p.clientId ?? '',
        lat: p.lat ?? '',
        lng: p.lng ?? '',
      });
    });
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'fleet-map-projects.xlsx';
    a.click();
    URL.revokeObjectURL(url);
  }

  private updateCanonicalLink(): void {
    const href = this.document?.location?.href;
    if (!href) return;

    if (!this.canonicalLink) {
      this.canonicalLink = this.document.createElement('link');
      this.canonicalLink.setAttribute('rel', 'canonical');
      this.document.head.appendChild(this.canonicalLink);
    }

    this.canonicalLink.setAttribute('href', href);
  }
}
