import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ClientService } from '../../../services/client.service';
import { LocationService } from '../../../services/location.service';
import { ProjectService } from '../../../services/project.service';
import {
  ActivityLogRow,
  ClientManagementDraft,
  ClientManagementRow,
  DataManagementRowDraft,
  LocationManagementDraft,
  LocationManagementRow,
  ManufacturerManagementDraft,
  ManufacturerManagementRow,
} from '../models/fleet-vm.models';
import { DataManagementMutationService } from './data-management-mutation.service';

describe('DataManagementMutationService', () => {
  let service: DataManagementMutationService;
  let projectService: jasmine.SpyObj<ProjectService>;
  let clientService: jasmine.SpyObj<ClientService>;
  let locationService: jasmine.SpyObj<LocationService>;

  const baseRow: ActivityLogRow = {
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
    clientId: '200',
    clientName: 'Client One',
    clientLocationId: '300',
    clientCoordinates: null,
    manufacturerId: '400',
    manufacturerName: 'OEM One',
    manufacturerLocationId: '500',
    manufacturerCoordinates: null,
    locationId: '500',
    locationIds: [500, 501],
    locationName: 'Factory A',
    locationCoordinates: null,
    startDate: null,
    endDate: null,
    updatedAt: '2026-01-05T00:00:00.000Z',
    coordinates: null,
    source: 'project_snapshot',
  };

  const baseDraft: DataManagementRowDraft = {
    projectDraft: {
      name: 'Project One',
      status: 'Active',
      type: 'Inspection',
      projectTypeId: '10',
      contract: 'C-01',
      hasRoadTest: false,
      clientId: '200',
      locationIds: [500, 501],
      manufacturerDisplay: 'OEM One',
    },
    locationDraft: {
      name: 'Factory A',
      latitude: '42.100000',
      longitude: '-80.200000',
    },
    clientDraft: {
      name: 'Client One',
      locationIds: [300],
      customerLogo: null,
      customerLogoName: null,
    },
    manufacturerDraft: {
      name: 'OEM One',
      locationId: '500',
      locationIds: [500],
      disabled: true,
      manufacturerLogo: null,
      manufacturerLogoName: null,
    },
  };

  beforeEach(() => {
    projectService = jasmine.createSpyObj<ProjectService>('ProjectService', ['updateProject', 'updateManufacturer']);
    clientService = jasmine.createSpyObj<ClientService>('ClientService', ['updateClient']);
    locationService = jasmine.createSpyObj<LocationService>('LocationService', ['updateLocation']);

    projectService.updateProject.and.returnValue(of({ id: 1, projectName: 'Project One', clientId: '200', assessmentType: 'Inspection', status: 'Open' } as any));
    projectService.updateManufacturer.and.returnValue(of({ id: 400, manufacturerName: 'OEM One', locationId: 500 } as any));
    clientService.updateClient.and.returnValue(of({ id: '200', name: 'Client One', code: 'C1', locationId: 300 } as any));
    locationService.updateLocation.and.returnValue(of({ id: 500, name: 'Factory A', latitude: 42.1, longitude: -80.2 } as any));

    TestBed.configureTestingModule({
      providers: [
        DataManagementMutationService,
        { provide: ProjectService, useValue: projectService },
        { provide: ClientService, useValue: clientService },
        { provide: LocationService, useValue: locationService },
      ],
    });

    service = TestBed.inject(DataManagementMutationService);
  });

  it('preserves existing project locationIds when selection is untouched', async () => {
    await service.saveRowDraft({
      row: baseRow,
      draft: {
        ...baseDraft,
        projectDraft: {
          ...baseDraft.projectDraft,
          contract: 'C-02',
          locationIds: undefined,
        },
      },
      project: {
        id: 1,
        projectName: 'Project One',
        clientId: '200',
        assessmentType: 'Inspection',
        projectTypeId: 10,
        locationIds: [500, 501],
        status: 'Open',
        contract: 'C-01',
        hasRoadTest: false,
      } as any,
      client: null,
      manufacturer: null,
      location: null,
    });

    expect(projectService.updateProject).toHaveBeenCalled();
    const updateArg = projectService.updateProject.calls.mostRecent().args[0] as any;
    expect(updateArg.locationIds).toEqual([500, 501]);
  });

  it('saves client with strict fields and numeric locationIds', async () => {
    const row: ClientManagementRow = {
      id: 'client-200',
      clientId: '200',
      clientName: 'Client One',
      locationIds: [300, 301],
      linkedLocations: [],
      locationId: '300',
      locationName: 'Client Yard',
      latitude: null,
      longitude: null,
      projectCount: 1,
    };

    const draft: ClientManagementDraft = {
      name: 'Client One Updated',
      locationIds: [300, 301],
      customerLogo: 'data:image/png;base64,AAA',
      customerLogoName: 'logo.png',
    };

    await service.saveClientEntityDraft({
      row,
      draft,
      client: {
        id: '200',
        name: 'Client One',
        code: 'C1',
        locationId: 300,
        locationIds: [300, 301],
      },
      location: null,
    });

    expect(clientService.updateClient).toHaveBeenCalledWith('200', jasmine.objectContaining({
      customerName: 'Client One Updated',
      customerLogo: 'data:image/png;base64,AAA',
      customerLogoName: 'logo.png',
      locationIds: [300, 301],
    }));

    const updateBody = clientService.updateClient.calls.mostRecent().args[1] as any;
    expect(updateBody.latitude).toBeUndefined();
    expect(updateBody.longitude).toBeUndefined();
  });

  it('saves manufacturer with strict fields and locationIds array', async () => {
    const row: ManufacturerManagementRow = {
      id: 'manufacturer-400',
      manufacturerId: '400',
      manufacturerName: 'OEM One',
      locationIds: [500, 501],
      linkedLocations: [],
      locationId: '500',
      locationName: 'Factory A',
      latitude: null,
      longitude: null,
    };

    const draft: ManufacturerManagementDraft = {
      name: 'OEM One Updated',
      locationIds: [500, 501],
      manufacturerLogo: 'data:image/png;base64,BBB',
      manufacturerLogoName: 'oem.png',
    };

    await service.saveManufacturerEntityDraft({
      row,
      draft,
      manufacturer: {
        id: '400',
        name: 'OEM One',
        locationId: 500,
      },
      location: null,
    });

    expect(projectService.updateManufacturer).toHaveBeenCalledWith(400, jasmine.objectContaining({
      manufacturerName: 'OEM One Updated',
      manufacturerLogo: 'data:image/png;base64,BBB',
      manufacturerLogoName: 'oem.png',
      locationIds: [500, 501],
    }));
  });

  it('location save writes only name/latitude/longitude', async () => {
    const row: LocationManagementRow = {
      id: 'location-500',
      locationId: '500',
      locationName: 'Factory A',
      latitude: 42.1,
      longitude: -80.2,
    };

    const draft: LocationManagementDraft = {
      name: 'Factory A Updated',
      latitude: '42.3',
      longitude: '-80.1',
    };

    await service.saveLocationEntityDraft({
      row,
      draft,
      location: {
        id: 500,
        name: 'Factory A',
        latitude: 42.1,
        longitude: -80.2,
      },
    });

    expect(locationService.updateLocation).toHaveBeenCalledWith(500, {
      name: 'Factory A Updated',
      latitude: 42.3,
      longitude: -80.1,
    });
  });
});
