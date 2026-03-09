import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  ActivityLogRow,
  ClientManagementRow,
  LocationManagementRow,
  ManufacturerManagementRow,
} from '../../models/fleet-vm.models';
import { FleetActivityTableComponent } from './fleet-activity-table.component';

describe('FleetActivityTableComponent', () => {
  let fixture: ComponentFixture<FleetActivityTableComponent>;
  let component: FleetActivityTableComponent;

  const sampleRow: ActivityLogRow = {
    id: 'project-1',
    entityType: 'project',
    entityId: '1',
    projectId: '1',
    projectTypeId: '10',
    projectTypeName: 'Inspection',
    contract: 'C-01',
    hasRoadTest: false,
    entityName: 'Project One',
    status: 'Active',
    clientId: '100',
    clientName: 'Client One',
    clientLocationId: '20',
    clientCoordinates: { latitude: 43.7, longitude: -79.4 },
    manufacturerId: '200',
    manufacturerName: 'OEM One',
    manufacturerLocationId: '30',
    manufacturerCoordinates: { latitude: 42.1, longitude: -80.2 },
    locationId: '30',
    locationIds: [30, 31],
    locationName: 'Factory A',
    locationCoordinates: { latitude: 42.1, longitude: -80.2 },
    startDate: '2026-01-01',
    endDate: '2026-01-05',
    updatedAt: '2026-01-05T00:00:00.000Z',
    coordinates: { latitude: 42.1, longitude: -80.2 },
    source: 'project_snapshot',
  };

  const clientRow: ClientManagementRow = {
    id: 'client-100',
    clientId: '100',
    clientName: 'Client One',
    locationIds: [20],
    linkedLocations: [{ id: 20, name: 'Client Yard' }],
    locationId: '20',
    locationName: 'Client Yard',
    latitude: 43.7,
    longitude: -79.4,
    projectCount: 2,
  };

  const manufacturerRow: ManufacturerManagementRow = {
    id: 'manufacturer-200',
    manufacturerId: '200',
    manufacturerName: 'OEM One',
    locationIds: [30],
    linkedLocations: [{ id: 30, name: 'Factory A' }],
    locationId: '30',
    locationName: 'Factory A',
    latitude: 42.1,
    longitude: -80.2,
  };

  const locationRows: LocationManagementRow[] = [
    {
      id: 'location-30',
      locationId: '30',
      locationName: 'Factory A',
      latitude: 42.1,
      longitude: -80.2,
    },
    {
      id: 'location-31',
      locationId: '31',
      locationName: 'Factory B',
      latitude: 43.2,
      longitude: -81.3,
    },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FleetActivityTableComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(FleetActivityTableComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('rows', [sampleRow]);
    fixture.componentRef.setInput('clientRows', [clientRow]);
    fixture.componentRef.setInput('manufacturerRows', [manufacturerRow]);
    fixture.componentRef.setInput('locationRows', locationRows);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
  });

  it('renders simplified project table headers', () => {
    const headers = fixture.debugElement
      .queryAll(By.css('thead th'))
      .map((el) => (el.nativeElement as HTMLElement).textContent?.trim());

    expect(headers).toEqual([
      'Project Name',
      'Client',
      'Locations',
      'Manufacturer',
      'Status',
      'Actions',
    ]);
  });

  it('renders primary and secondary toolbar controls', () => {
    const createButton = fixture.debugElement.query(By.css('.export-btn'))?.nativeElement as HTMLButtonElement;
    const secondaryControls = fixture.debugElement.query(By.css('.secondary-controls'))?.nativeElement as HTMLElement;
    const searchInput = fixture.debugElement.query(By.css('.search-wrap input'))?.nativeElement as HTMLInputElement;

    expect(createButton.textContent?.trim()).toBe('Create');
    expect(secondaryControls).toBeTruthy();
    expect(searchInput.placeholder).toBe('Search...');
  });

  it('keeps row actions visible for scannable tables', () => {
    const actionContainers = fixture.debugElement.queryAll(By.css('.row-actions.always-visible'));
    expect(actionContainers.length).toBeGreaterThan(0);
  });

  it('opens project editor drawer with derived manufacturer display', () => {
    const multiRow: ActivityLogRow = {
      ...sampleRow,
      manufacturerId: null,
      manufacturerName: 'Multiple',
    };

    component.openProjectEdit(multiRow);
    fixture.detectChanges();

    const derived = fixture.debugElement.query(By.css('.editor-readonly-value'))?.nativeElement as HTMLElement;
    expect(derived.textContent?.trim()).toBe('Multiple');
  });

  it('project, client, and manufacturer editors do not render latitude/longitude inputs', () => {
    component.openProjectEdit(sampleRow);
    fixture.detectChanges();
    let labels = fixture.debugElement
      .queryAll(By.css('.editor-label'))
      .map((node) => (node.nativeElement as HTMLElement).textContent?.trim());
    expect(labels).not.toContain('Latitude');
    expect(labels).not.toContain('Longitude');

    component.openClientEdit(clientRow);
    fixture.detectChanges();
    labels = fixture.debugElement
      .queryAll(By.css('.editor-label'))
      .map((node) => (node.nativeElement as HTMLElement).textContent?.trim());
    expect(labels).not.toContain('Latitude');
    expect(labels).not.toContain('Longitude');

    component.openManufacturerEdit(manufacturerRow);
    fixture.detectChanges();
    labels = fixture.debugElement
      .queryAll(By.css('.editor-label'))
      .map((node) => (node.nativeElement as HTMLElement).textContent?.trim());
    expect(labels).not.toContain('Latitude');
    expect(labels).not.toContain('Longitude');
  });

  it('location editor is the only editor that shows coordinates', () => {
    component.openLocationEdit(locationRows[0]);
    fixture.detectChanges();

    const labels = fixture.debugElement
      .queryAll(By.css('.editor-label'))
      .map((node) => (node.nativeElement as HTMLElement).textContent?.trim());

    expect(labels).toContain('Latitude');
    expect(labels).toContain('Longitude');
  });

  it('emits project save request with numeric locationIds from drawer', fakeAsync(() => {
    component.openProjectEdit(sampleRow);
    component.patchProjectDraft('locationIds', [31]);
    fixture.detectChanges();

    component.rowSaveRequested.subscribe((request) => {
      expect(request.row.id).toBe(sampleRow.id);
      expect(request.draft.projectDraft.locationIds).toEqual([31]);
      request.resolve();
    });

    void component.saveDrawer();
    tick();

    expect(component.drawerOpen()).toBeFalse();
  }));

  it('emits client create request from drawer in create mode', fakeAsync(() => {
    component.setActiveTab('clients');
    component.openCreateDrawer();
    component.patchClientDraft('name', 'New Client');
    component.patchClientDraft('locationIds', [20, 30]);
    fixture.detectChanges();

    component.clientCreateRequested.subscribe((request) => {
      expect(request.draft.name).toBe('New Client');
      expect(request.draft.locationIds).toEqual([20, 30]);
      request.resolve();
    });

    void component.saveDrawer();
    tick();

    expect(component.drawerOpen()).toBeFalse();
  }));
});
