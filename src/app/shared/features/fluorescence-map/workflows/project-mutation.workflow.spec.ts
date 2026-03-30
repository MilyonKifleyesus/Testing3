import { runBatchMutationWorkflow, toCreateProjectPayload } from './project-mutation.workflow';
import { FactoryEditPayload, SubsidiaryEditPayload } from '../fluorescence-map.types';

describe('project-mutation.workflow', () => {
  describe('runBatchMutationWorkflow', () => {
    it('counts successes and refreshes when any update succeeds', async () => {
      const api = {
        persistFactoryUpdate: jasmine.createSpy('persistFactoryUpdate').and.returnValue(Promise.resolve()),
        persistSubsidiaryUpdate: jasmine.createSpy('persistSubsidiaryUpdate').and.returnValue(Promise.resolve()),
        refreshWarRoomFromApi: jasmine.createSpy('refreshWarRoomFromApi').and.returnValue(Promise.resolve()),
      };

      const payload = {
        subsidiaries: [{ subsidiaryId: 's1', name: '', location: '', description: '', status: 'ACTIVE' } as SubsidiaryEditPayload],
        factories: [{ factoryId: 'f1', name: '', location: '', description: '', status: 'ACTIVE' } as FactoryEditPayload],
      };

      const result = await runBatchMutationWorkflow(api, payload);
      expect(result).toEqual({ successCount: 2, failureCount: 0 });
      expect(api.refreshWarRoomFromApi).toHaveBeenCalledWith(true);
    });

    it('counts failures and skips refresh when all updates fail', async () => {
      spyOn(console, 'error').and.stub();
      const api = {
        persistFactoryUpdate: jasmine.createSpy('persistFactoryUpdate').and.returnValue(Promise.reject(new Error('fail-f'))),
        persistSubsidiaryUpdate: jasmine.createSpy('persistSubsidiaryUpdate').and.returnValue(Promise.reject(new Error('fail-s'))),
        refreshWarRoomFromApi: jasmine.createSpy('refreshWarRoomFromApi').and.returnValue(Promise.resolve()),
      };

      const payload = {
        subsidiaries: [{ subsidiaryId: 's1', name: '', location: '', description: '', status: 'ACTIVE' } as SubsidiaryEditPayload],
        factories: [{ factoryId: 'f1', name: '', location: '', description: '', status: 'ACTIVE' } as FactoryEditPayload],
      };

      const result = await runBatchMutationWorkflow(api, payload);
      expect(result).toEqual({ successCount: 0, failureCount: 2 });
      expect(api.refreshWarRoomFromApi).not.toHaveBeenCalled();
    });

    it('does not throw if refresh fails after successful updates', async () => {
      spyOn(console, 'error').and.stub();
      const api = {
        persistFactoryUpdate: jasmine.createSpy('persistFactoryUpdate').and.returnValue(Promise.resolve()),
        persistSubsidiaryUpdate: jasmine.createSpy('persistSubsidiaryUpdate').and.returnValue(Promise.resolve()),
        refreshWarRoomFromApi: jasmine.createSpy('refreshWarRoomFromApi').and.returnValue(Promise.reject(new Error('refresh-fail'))),
      };

      const payload = {
        subsidiaries: [{ subsidiaryId: 's1', name: '', location: '', description: '', status: 'ACTIVE' } as SubsidiaryEditPayload],
        factories: [],
      };

      const result = await runBatchMutationWorkflow(api, payload);
      expect(result).toEqual({ successCount: 1, failureCount: 0 });
      expect(api.refreshWarRoomFromApi).toHaveBeenCalledWith(true);
    });
  });

  describe('toCreateProjectPayload', () => {
    it('maps Active to Open and sets closed=false', () => {
      const payload = toCreateProjectPayload(
        {
          projectName: 'P',
          clientId: 'c1',
          clientName: 'Client',
          assessmentType: 'New Build',
          manufacturerLocationId: 123,
          location: 'Austin, USA',
          manufacturerName: 'Acme',
          status: 'Active',
        },
        7,
        99
      );

      expect(payload.status).toBe('Open');
      expect(payload.closed).toBeFalse();
      expect(payload.manufacturerLocationId).toBe('123');
      expect(payload.projectTypeId).toBe(7);
      expect(payload.locationId).toBe(99);
      expect(payload.locationIds).toEqual([99]);
    });

    it('maps Inactive to Closed and uses factoryId when manufacturerLocationId is missing', () => {
      const payload = toCreateProjectPayload(
        {
          projectName: 'P',
          clientId: 'c1',
          clientName: 'Client',
          assessmentType: 'Retrofit',
          manufacturerLocationId: null,
          factoryId: '456',
          location: 'Toronto, Canada',
          manufacturerName: 'Acme',
          status: 'Inactive',
        },
        1,
        2
      );

      expect(payload.status).toBe('Closed');
      expect(payload.closed).toBeTrue();
      expect(payload.manufacturerLocationId).toBe('456');
      expect(payload.locationIds).toEqual([2]);
    });

    it('falls back to locationId when neither manufacturerLocationId nor factoryId are provided', () => {
      const payload = toCreateProjectPayload(
        {
          projectName: 'P',
          clientId: 'c1',
          clientName: 'Client',
          assessmentType: 'Inspection',
          manufacturerLocationId: undefined,
          factoryId: undefined,
          location: 'Unknown',
          manufacturerName: 'Acme',
          status: 'Active',
        },
        1,
        777
      );

      expect(payload.manufacturerLocationId).toBe('777');
      expect(payload.locationIds).toEqual([777]);
    });
  });
});
