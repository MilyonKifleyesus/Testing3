import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { AddCompanyModalComponent } from './add-company-modal.component';
import { FACTORIES_JSON, CLIENTS_JSON, getFirstClient, getFirstFactoryOption } from '../../../../../shared/testing/test-data';

describe('AddCompanyModalComponent (unit)', () => {
  let fixture: ComponentFixture<AddCompanyModalComponent>;
  let component: AddCompanyModalComponent;
  let httpMock: HttpTestingController;

  beforeEach(fakeAsync(async () => {
    await TestBed.configureTestingModule({
      imports: [AddCompanyModalComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(AddCompanyModalComponent);
    component = fixture.componentInstance;
    const firstClient = getFirstClient();
    fixture.componentRef.setInput('clients', [{ id: firstClient.id, name: firstClient.name, code: firstClient.code }]);
    fixture.detectChanges();

    // Resolve all HTTP requests (order may vary: clients, factories, projects, factory-id-mapping)
    const url = (r: { url: string }) => r.url;
    const clientsReq = httpMock.match((r) => url(r).includes('clients.json'));
    clientsReq.forEach((req) => req.flush(CLIENTS_JSON));
    const factoriesReq = httpMock.match((r) => url(r).includes('factories.json'));
    factoriesReq.forEach((req) => req.flush(FACTORIES_JSON));
    const projectsReq = httpMock.match((r) => url(r).includes('projects.json') || (url(r).includes('projects') && !url(r).includes('factories')));
    projectsReq.forEach((req) => req.flush({ projects: [] }));
    const mappingReq = httpMock.match((r) => url(r).includes('factory-id-mapping'));
    mappingReq.forEach((req) => req.flush({ factoryIdToWarRoom: {}, aliases: {} }));
    // Flush any remaining requests (e.g. from getProjectTypes)
    const remaining = httpMock.match(() => true);
    remaining.forEach((req) => {
      const u = req.request.url;
      if (u.includes('clients')) req.flush({ clients: [] });
      else if (u.includes('factories')) req.flush({ manufacturers: [], factories: [] });
      else if (u.includes('projects')) req.flush({ projects: [] });
      else if (u.includes('factory-id-mapping')) req.flush({ factoryIdToWarRoom: {}, aliases: {} });
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
          if (u.includes('clients')) req.flush({ clients: [] });
          else if (u.includes('factories')) req.flush({ manufacturers: [], factories: [] });
          else if (u.includes('projects')) req.flush({ projects: [] });
          else if (u.includes('factory-id-mapping')) req.flush({ factoryIdToWarRoom: {}, aliases: {} });
          else req.flush({});
        } catch {}
      });
    }
    httpMock.verify();
  });

  it('emits projectAdded and sets submitting state on valid submit', fakeAsync(() => {
    let emitted: unknown = null;
    component.projectAdded.subscribe((data) => { emitted = data; });

    const firstClient = getFirstClient();
    const firstFactory = getFirstFactoryOption();
    component.clientId.set(firstClient.id);
    component.selectedFactory.set(firstFactory);
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
    component.selectedFactory.set(getFirstFactoryOption());
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
