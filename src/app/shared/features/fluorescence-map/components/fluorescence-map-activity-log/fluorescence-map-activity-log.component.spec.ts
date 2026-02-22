import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WarRoomActivityLogComponent } from './fluorescence-map-activity-log.component';
import {
  ActivityLog,
  FactoryLocation,
  ParentGroup,
  SubsidiaryCompany,
} from '../../../../../shared/models/fluorescence-map.interface';

describe('WarRoomActivityLogComponent', () => {
  let fixture: ComponentFixture<WarRoomActivityLogComponent>;
  let component: WarRoomActivityLogComponent;

  const factory: FactoryLocation = {
    id: 'factory-1',
    parentGroupId: 'parent-1',
    subsidiaryId: 'sub-1',
    name: 'Test Site',
    city: 'Austin',
    country: 'USA',
    coordinates: { latitude: 30.2672, longitude: -97.7431 },
    status: 'ACTIVE',
    syncStability: 92,
    assets: 6,
    incidents: 0,
    description: 'Test site description',
  };

  const subsidiary: SubsidiaryCompany = {
    id: 'sub-1',
    parentGroupId: 'parent-1',
    name: 'TEST1',
    status: 'ACTIVE',
    metrics: { assetCount: 6, incidentCount: 0, syncStability: 92 },
    manufacturerLocations: [factory],
    factories: [factory],
    hubs: [],
    quantumChart: { dataPoints: [60, 64, 68, 70, 73, 78], highlightedIndex: 5 },
    location: 'Austin',
  };

  const parentGroup: ParentGroup = {
    id: 'parent-1',
    name: 'Manufacturers',
    status: 'ACTIVE',
    metrics: { assetCount: 6, incidentCount: 0, syncStability: 92 },
    subsidiaries: [subsidiary],
  };

  function buildLog(
    id: string,
    timestamp: Date | string,
    description: string,
    overrides?: Partial<ActivityLog>
  ): ActivityLog {
    return {
      id,
      timestamp,
      status: 'ACTIVE',
      title: 'TEST1 | TEST SITE',
      description,
      parentGroupId: 'parent-1',
      subsidiaryId: 'sub-1',
      manufacturerLocationId: 'factory-1',
      factoryId: 'factory-1',
      location: 'Austin, USA',
      ...overrides,
    };
  }

  function setInputs(logs: ActivityLog[]): void {
    fixture.componentRef.setInput('parentGroups', [parentGroup]);
    fixture.componentRef.setInput('activityLogs', logs);
    fixture.componentRef.setInput(
      'projectStatusByFactoryId',
      new Map<string, 'active' | 'inactive' | 'none'>([['factory-1', 'active']])
    );
    fixture.componentRef.setInput('selectedEntity', null);
    fixture.componentRef.setInput('editMode', false);
    fixture.componentRef.setInput('mapViewMode', 'subsidiary');
    fixture.componentRef.setInput('isBusy', false);
    fixture.detectChanges();
    component.toggleSubsidiary('sub-1');
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WarRoomActivityLogComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(WarRoomActivityLogComponent);
    component = fixture.componentInstance;
  });

  it('renders manufacturer summary logs when expanded and logs exist', () => {
    const logs = [
      buildLog('log-older', '2026-02-19T12:05:00Z', 'Older manufacturer event'),
      buildLog('log-newer', '2026-02-19T12:15:00Z', 'Newest manufacturer event'),
      buildLog('log-mid', '2026-02-19T12:10:00Z', 'Middle manufacturer event'),
    ];
    setInputs(logs);

    const summary = fixture.nativeElement.querySelector('.manufacturer-log-summary') as HTMLElement | null;
    expect(summary).toBeTruthy();
    expect(summary?.textContent).toContain('Last activity');
    expect(summary?.textContent).toContain('Recent logs');
    expect(summary?.textContent).toContain('Newest manufacturer event');
    expect(summary?.textContent).not.toContain('No activity logs for this manufacturer yet.');
  });

  it('renders manufacturer no-log message when none exist', () => {
    setInputs([]);
    const summary = fixture.nativeElement.querySelector('.manufacturer-log-summary') as HTMLElement | null;
    expect(summary).toBeTruthy();
    expect(summary?.textContent).toContain('No activity logs for this manufacturer yet.');
  });

  it('renders site latest log preview', () => {
    const logs = [
      buildLog('log-1', '2026-02-19T11:00:00Z', 'Earlier site event'),
      buildLog('log-2', '2026-02-19T11:45:00Z', 'Latest site event'),
    ];
    setInputs(logs);

    const factoryRow = fixture.nativeElement.querySelector('.factory-row') as HTMLElement | null;
    expect(factoryRow).toBeTruthy();
    const sitePreview = factoryRow?.querySelector('.factory-log-preview') as HTMLElement | null;
    expect(sitePreview).toBeTruthy();
    expect(sitePreview?.textContent).toContain('Last activity');
    expect(sitePreview?.textContent).toContain('Latest site event');
  });

  it('expands and collapses site recent logs from toggle', () => {
    const logs = [
      buildLog('log-1', '2026-02-19T12:01:00Z', 'Event 1'),
      buildLog('log-2', '2026-02-19T12:02:00Z', 'Event 2'),
      buildLog('log-3', '2026-02-19T12:03:00Z', 'Event 3'),
    ];
    setInputs(logs);

    const factoryRow = fixture.nativeElement.querySelector('.factory-row') as HTMLElement | null;
    expect(factoryRow).toBeTruthy();
    const toggle = factoryRow?.querySelector('.factory-log-toggle') as HTMLButtonElement | null;
    expect(toggle).toBeTruthy();
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');

    toggle?.click();
    fixture.detectChanges();

    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    const expandedList = factoryRow?.querySelector('.factory-log-list');
    expect(expandedList).toBeTruthy();
    expect(expandedList?.querySelectorAll('.manufacturer-log-item').length).toBe(3);

    toggle?.click();
    fixture.detectChanges();

    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    const collapsedList = factoryRow?.querySelector('.factory-log-list');
    expect(collapsedList).toBeFalsy();
  });

  it('uses factoryId fallback when manufacturerLocationId is missing', () => {
    const logs = [
      buildLog('log-fallback', '2026-02-19T12:10:00Z', 'Factory id fallback log', {
        manufacturerLocationId: undefined,
        factoryId: 'factory-1',
      }),
    ];
    setInputs(logs);

    const latest = component.getLatestFactoryLog('factory-1');
    expect(latest).toBeTruthy();
    expect(latest?.id).toBe('log-fallback');
  });

  it('sorts logs newest-first and safely handles invalid timestamps', () => {
    const logs = [
      buildLog('log-old', '2026-02-19T12:01:00Z', 'Old log'),
      buildLog('log-invalid', 'not-a-date', 'Invalid timestamp log'),
      buildLog('log-new', '2026-02-19T12:05:00Z', 'Newest log'),
    ];
    setInputs(logs);

    const ordered = component.getRecentFactoryLogs('factory-1', 3);
    expect(ordered[0].id).toBe('log-new');
    expect(ordered[1].id).toBe('log-old');
    expect(ordered[2].id).toBe('log-invalid');
    expect(component.formatTimestamp('not-a-date')).toBe('');
  });
});
