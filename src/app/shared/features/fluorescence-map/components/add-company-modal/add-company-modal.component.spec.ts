import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { AddCompanyModalComponent } from './add-company-modal.component';
import {
  CLIENTS_JSON,
  getFirstClient,
  getFirstManufacturerLocationOption,
} from '../../../../../shared/testing/test-data';

describe('AddCompanyModalComponent (unit)', () => {
  let fixture: ComponentFixture<AddCompanyModalComponent>;
  let component: AddCompanyModalComponent;
  let httpMock: HttpTestingController;

  beforeEach(fakeAsync(() => {
    TestBed.configureTestingModule({
      imports: [AddCompanyModalComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    tick();

    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(AddCompanyModalComponent);
    component = fixture.componentInstance;
    const firstClient = getFirstClient();
    fixture.componentRef.setInput('clients', [{ id: firstClient.id, name: firstClient.name, code: firstClient.code }]);
    fixture.detectChanges();

    // Resolve all HTTP requests (order may vary: clients, manufacturers, locations, projects)
    const url = (r: { url: string }) => r.url;
    const clientsReq = httpMock.match((r) => url(r).includes('/Clients'));
    clientsReq.forEach((req) => req.flush(CLIENTS_JSON));
    const manufacturersReq = httpMock.match((r) => url(r).includes('/Manufacturers'));
    manufacturersReq.forEach((req) => req.flush({ items: [] }));
    const locationsReq = httpMock.match((r) => url(r).includes('/Locations'));
    locationsReq.forEach((req) => req.flush({ items: [] }));
    const projectsReq = httpMock.match((r) => url(r).includes('/Projects'));
    projectsReq.forEach((req) => req.flush({ items: [] }));
    // Flush any remaining requests (e.g. from getProjectTypes)
    const remaining = httpMock.match(() => true);
    remaining.forEach((req) => {
      const u = req.request.url;
      if (u.includes('/Clients')) req.flush({ items: [] });
      else if (u.includes('/Manufacturers')) req.flush({ items: [] });
      else if (u.includes('/Locations')) req.flush({ items: [] });
      else if (u.includes('/Projects')) req.flush({ items: [] });
      else req.flush({});
    });
    tick(200);
    fixture.detectChanges();
  }));

  afterEach(() => {
    for (let i = 0; i < 10; i++) {
      const pending = httpMock.match(() => true);
      if (pending.length === 0) break;
      pending.forEach((req) => {
        try {
          const u = req.request.url;
          if (u.includes('/Clients')) req.flush({ items: [] });
          else if (u.includes('/Manufacturers')) req.flush({ items: [] });
          else if (u.includes('/Locations')) req.flush({ items: [] });
          else if (u.includes('/Projects')) req.flush({ items: [] });
          else req.flush({});
        } catch (err) {
          console.error('Unexpected error in test cleanup:', err);
          throw err;
        }
      });
    }
    httpMock.verify();
  });

  it('emits projectAdded and sets submitting state on valid submit', fakeAsync(() => {
    let emitted: unknown = null;
    component.projectAdded.subscribe((data) => { emitted = data; });

    const firstClient = getFirstClient();
    const firstFactory = getFirstManufacturerLocationOption();
    component.clientId.set(firstClient.id);
    component.selectedManufacturerLocation.set(firstFactory);
    component.projectName.set('Test Project');
    component.assessmentType.set('New Build');
    component.projectStatus.set('Active');

    component.onSubmit();
    fixture.detectChanges();

    expect(component.submissionState()).toBe('SUBMITTING');
    expect(component.isSubmitting()).toBeTrue();
    expect(emitted).toBeTruthy();
    expect((emitted as { projectName: string }).projectName).toBe('Test Project');
  }));

  it('sets error message when client not selected', () => {
    component.clientId.set(null);
    component.selectedManufacturerLocation.set(getFirstManufacturerLocationOption());
    component.projectName.set('Test');
    component.assessmentType.set('New Build');

    component.onSubmit();
    fixture.detectChanges();

    expect(component.errorMessage()).toContain('client');
  });

  it('clears loading and shows success state on success', () => {
    fixture.componentRef.setInput('isVisible', true);
    fixture.detectChanges();
    component.submissionState.set('SUBMITTING');
    component.errorMessage.set(null);

    component.handleSuccess();
    fixture.detectChanges();

    expect(component.submissionState()).toBe('SUCCESS');
    expect(component.isSubmitting()).toBeFalse();

    const successView = fixture.nativeElement.querySelector('.success-view');
    expect(successView).toBeTruthy();
  });
});
