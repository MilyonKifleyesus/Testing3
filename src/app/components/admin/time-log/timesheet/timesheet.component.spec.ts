import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { NgbModal, NgbModalRef } from '@ng-bootstrap/ng-bootstrap';
import { ToastrService } from 'ngx-toastr';

import { LookupState, TimeLogLookupAdapterService } from '../../../../shared/services/time-log-lookup-adapter.service';
import { TimeLogService } from '../../../../shared/services/time-log.service';
import { TimesheetComponent } from './timesheet.component';

class MockTimeLogLookupAdapterService {
  private readonly stateSubject = new BehaviorSubject<LookupState>({
    ready: true,
    loading: false,
    projects: [],
    vehicles: [],
    users: [],
  });

  readonly lookups$ = this.stateSubject.asObservable();
  readonly refresh = jasmine.createSpy('refresh');
  readonly resolveUsersByIds = jasmine.createSpy('resolveUsersByIds').and.returnValue(of([]));

  setState(state: Partial<LookupState>): void {
    this.stateSubject.next({
      ...this.stateSubject.value,
      ...state,
    });
  }
}

describe('TimesheetComponent', () => {
  let timeLogService: jasmine.SpyObj<TimeLogService>;
  let lookupAdapter: MockTimeLogLookupAdapterService;
  let modal: jasmine.SpyObj<NgbModal>;
  let modalRef: jasmine.SpyObj<NgbModalRef>;
  let toastr: jasmine.SpyObj<ToastrService>;

  beforeEach(async () => {
    timeLogService = jasmine.createSpyObj<TimeLogService>('TimeLogService', [
      'getTimeLogs',
      'deleteTimeLog',
    ]);
    timeLogService.getTimeLogs.and.returnValue(of({ items: [], total: 0 }));
    timeLogService.deleteTimeLog.and.returnValue(of(void 0));

    lookupAdapter = new MockTimeLogLookupAdapterService();
    modalRef = jasmine.createSpyObj<NgbModalRef>('NgbModalRef', ['dismiss', 'close']);
    modal = jasmine.createSpyObj<NgbModal>('NgbModal', ['open']);
    modal.open.and.returnValue(modalRef);
    toastr = jasmine.createSpyObj<ToastrService>('ToastrService', ['error', 'success', 'warning', 'info']);

    await TestBed.configureTestingModule({
      imports: [TimesheetComponent],
      providers: [
        provideRouter([]),
        { provide: TimeLogService, useValue: timeLogService },
        { provide: TimeLogLookupAdapterService, useValue: lookupAdapter },
        { provide: NgbModal, useValue: modal },
        { provide: ToastrService, useValue: toastr },
      ],
    }).compileComponents();
  });

  it('renders normalized rows using lookup display names after the initial load', fakeAsync(() => {
    lookupAdapter.setState({
      projects: [{ id: 'p-1', name: 'Project Alpha', clientId: 'c-1' }],
      vehicles: [{ id: 'v-1', fleetNumber: 'Bus 100' }],
      users: [{ id: 'u-1', name: 'Jordan' }],
    });
    timeLogService.getTimeLogs.and.returnValue(
      of({
        items: [
          {
            id: '1',
            startDate: '2026-03-10T10:30:00Z',
            spentTimeHours: 2,
            description: 'Brake inspection',
            projectId: 'p-1',
            vehicleId: 'v-1',
            typeOfTime: 'Production',
            userId: 'u-1',
          },
        ],
        total: 1,
      })
    );

    const fixture = TestBed.createComponent(TimesheetComponent);
    fixture.detectChanges();
    tick(400);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Time Log');
    expect(text).toContain('Project Alpha');
    expect(text).toContain('Bus 100');
    expect(text).toContain('Jordan');
    expect(text).toContain('1 record(s)');
    expect(lookupAdapter.refresh).toHaveBeenCalledWith('manual');
  }));

  it('debounces search input and sends filters with the refreshed query', fakeAsync(() => {
    const fixture = TestBed.createComponent(TimesheetComponent);
    const component = fixture.componentInstance;

    fixture.detectChanges();
    tick(400);
    timeLogService.getTimeLogs.calls.reset();

    component.page = 3;
    component.filters = { projectId: 'p-1', fromDate: '2026-03-01' };
    component.searchTerm = 'axle';
    component.onSearch();

    tick(399);
    expect(timeLogService.getTimeLogs).not.toHaveBeenCalled();

    tick(1);
    expect(component.page).toBe(1);
    expect(timeLogService.getTimeLogs).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({
        page: 1,
        pageSize: 25,
        sortBy: 'startDate',
        sortDirection: 'desc',
        projectId: 'p-1',
        fromDate: '2026-03-01',
        searchTerm: 'axle',
      })
    );
  }));

  it('toggles sorting, constrains pagination, and computes page numbers', () => {
    const fixture = TestBed.createComponent(TimesheetComponent);
    const component = fixture.componentInstance;
    spyOn(component.refresh$, 'next');

    component.page = 4;
    component.setSort('spentTimeHours');
    expect(component.sortBy).toBe('spentTimeHours');
    expect(component.sortDirection).toBe('asc');
    expect(component.page).toBe(1);
    expect(component.refresh$.next).toHaveBeenCalledTimes(1);

    component.setSort('spentTimeHours');
    expect(component.sortDirection).toBe('desc');
    expect(component.refresh$.next).toHaveBeenCalledTimes(2);

    component.total = 200;
    component.pageSize = 25;
    component.page = 1;
    component.goToPage(0);
    expect(component.page).toBe(1);

    component.goToPage(3);
    expect(component.page).toBe(3);
    expect(component.refresh$.next).toHaveBeenCalledTimes(3);

    component.page = 4;
    expect(component.getPageNumbers()).toEqual([2, 3, 4, 5, 6]);
  });

  it('deletes the selected row and refreshes the list on success', () => {
    const fixture = TestBed.createComponent(TimesheetComponent);
    const component = fixture.componentInstance;
    spyOn(component.refresh$, 'next');
    component.confirmModalRef = modalRef;
    component.confirmDeleteId = '42';

    component.confirmDelete();

    expect(timeLogService.deleteTimeLog).toHaveBeenCalledWith('42');
    expect(component.confirmDeleteId).toBeNull();
    expect(component.deleting).toBeFalse();
    expect(modalRef.dismiss).toHaveBeenCalled();
    expect(component.refresh$.next).toHaveBeenCalled();
  });

  it('shows an error toast and keeps the modal open when delete fails', () => {
    timeLogService.deleteTimeLog.and.returnValue(
      throwError(() => ({ status: 500, error: { message: 'Delete failed' } }))
    );

    const fixture = TestBed.createComponent(TimesheetComponent);
    const component = fixture.componentInstance;
    component.confirmDeleteId = '42';

    component.confirmDelete();

    expect(component.deleting).toBeFalse();
    expect(component.confirmDeleteId).toBe('42');
    expect(toastr.error).toHaveBeenCalledWith('Server error (500): Delete failed');
  });
});
