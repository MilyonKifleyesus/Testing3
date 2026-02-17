import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { ProjectService, ApiProject } from './project.service';
import { FACTORIES_JSON, CLIENTS_JSON } from '../testing/test-data';

describe('ProjectService', () => {
  let service: ProjectService;
  let httpMock: HttpTestingController;

  const MAPPING_JSON = {
    factoryIdToWarRoom: { '1': 'nova-saint-eustache', '2': 'new-flyer-crookston', '100': 'eastway-pembroke' },
    aliases: {},
  };

  function flushAllRequests(
    projectsPayload: { projects: ApiProject[] },
    mapping = MAPPING_JSON
  ): void {
    const url = (r: { url: string }) => r.url;
    const isClients = (r: { url: string }) => url(r).includes('clients.json');
    const isMapping = (r: { url: string }) => url(r).includes('factory-id-mapping');
    const isProjects = (r: { url: string }) => url(r).includes('projects.json');
    const isFactories = (r: { url: string }) => url(r).includes('factories.json');

    const req1 = httpMock.expectOne(isClients);
    req1.flush(CLIENTS_JSON);
    tick(160);

    const req2 = httpMock.expectOne(isMapping);
    req2.flush(mapping);

    const req3 = httpMock.expectOne(isMapping);
    req3.flush(mapping);

    const req4 = httpMock.expectOne(isProjects);
    req4.flush(projectsPayload);

    const req5 = httpMock.expectOne(isFactories);
    req5.flush(FACTORIES_JSON);
    tick(160);
  }

  beforeEach(fakeAsync(() => {
    localStorage.removeItem('war-room-added-projects');
    TestBed.configureTestingModule({
      providers: [ProjectService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ProjectService);
    httpMock = TestBed.inject(HttpTestingController);
  }));

  afterEach(() => {
    httpMock.verify();
  });

  describe('mapApiProjectToProject (via getProjects)', () => {
    it('Case A: factory_id present + explicit JSON manufacturer/location -> explicit values win', fakeAsync(() => {
      const projectsPayload = {
        projects: [
          {
            project_id: 69,
            project_name: 'SR-3049',
            client: 'DRT',
            manufacturer_id: 2,
            factory_id: 2,
            assessment_type: 'New Build',
            status: 'Active',
            manufacturer: 'New Flyer',
            location: 'Winnipeg-Crookston (New Flyer)',
          },
        ],
      };
      let result: unknown[] = [];
      service.getProjects().subscribe((list) => (result = list));
      flushAllRequests(projectsPayload);
      tick(200);

      expect(result.length).toBe(1);
      const p = result[0] as { manufacturer?: string; location?: string; manufacturerLocationId?: string };
      expect(p.manufacturer).toBe('New Flyer');
      expect(p.location).toBe('Winnipeg-Crookston (New Flyer)');
      expect(p.manufacturerLocationId).toBe('new-flyer-crookston');
    }));

    it('Case B: factory_id present + missing JSON manufacturer/location -> factory fallback used', fakeAsync(() => {
      const projectsPayload = {
        projects: [
          {
            project_id: 15,
            project_name: 'Nova - LE96 40FT',
            client: 'DRT',
            manufacturer_id: 1,
            factory_id: 1,
            assessment_type: 'New Build',
            status: 'Inactive',
          },
        ],
      };
      let result: unknown[] = [];
      service.getProjects().subscribe((list) => (result = list));
      flushAllRequests(projectsPayload);
      tick(200);

      expect(result.length).toBe(1);
      const p = result[0] as { manufacturer?: string; location?: string; status?: string };
      expect(p.manufacturer).toBe('Nova');
      expect(p.location).toBe('St. Eustache, Quebec, Canada');
      expect(p.status).toBe('Closed');
    }));

    it('Case C: no factory_id -> direct JSON manufacturer/location used', fakeAsync(() => {
      const projectsPayload = {
        projects: [
          {
            project_id: 99,
            project_name: 'Standalone Project',
            client: 'DRT',
            assessment_type: 'New Build',
            status: 'Open',
            manufacturer: 'Custom Mfr',
            location: 'Custom City, Custom Country',
          },
        ],
      };
      let result: unknown[] = [];
      service.getProjects().subscribe((list) => (result = list));
      flushAllRequests(projectsPayload);
      tick(200);

      expect(result.length).toBe(1);
      const p = result[0] as { manufacturer?: string; location?: string; manufacturerLocationId?: string };
      expect(p.manufacturer).toBe('Custom Mfr');
      expect(p.location).toBe('Custom City, Custom Country');
      expect(p.manufacturerLocationId).toBeUndefined();
    }));

    it('Case D: status mapping Active/Inactive -> Open/Closed', fakeAsync(() => {
      const projectsPayload = {
        projects: [
          { project_id: 1, project_name: 'P1', client: 'DRT', status: 'Active' },
          { project_id: 2, project_name: 'P2', client: 'DRT', status: 'Inactive' },
          { project_id: 3, project_name: 'P3', client: 'DRT', status: 'Delayed' },
          { project_id: 4, project_name: 'P4', client: 'DRT', status: 'Closed' },
          { project_id: 5, project_name: 'P5', client: 'DRT', status: 'Open' },
        ],
      };
      let result: unknown[] = [];
      service.getProjects().subscribe((list) => (result = list));
      flushAllRequests(projectsPayload);
      tick(200);

      expect(result.length).toBe(5);
      const statuses = result.map((r) => (r as { status?: string }).status);
      expect(statuses).toEqual(['Open', 'Closed', 'Delayed', 'Closed', 'Open']);
    }));

    it('partial explicit: factory_id + explicit location only -> location from JSON, manufacturer from factory', fakeAsync(() => {
      const projectsPayload = {
        projects: [
          {
            project_id: 11,
            project_name: 'MCI Refurbishment 45FT',
            client: 'Metrolinx',
            manufacturer_id: 10,
            factory_id: 100,
            assessment_type: 'Condition Assessment',
            status: 'Active',
            location: 'Ottawa - Pembroke (Eastway)',
          },
        ],
      };
      let result: unknown[] = [];
      service.getProjects().subscribe((list) => (result = list));
      flushAllRequests(projectsPayload);
      tick(200);

      expect(result.length).toBe(1);
      const p = result[0] as { manufacturer?: string; location?: string };
      expect(p.location).toBe('Ottawa - Pembroke (Eastway)');
      expect(p.manufacturer).toBe('Eastway');
    }));
  });
});
