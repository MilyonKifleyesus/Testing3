import { Project } from '../../../../shared/models/project.model';
import { FactoryEditPayload, SubsidiaryEditPayload } from '../fluorescence-map.types';

export interface ProjectMutationApi {
  persistFactoryUpdate(payload: FactoryEditPayload): Promise<void>;
  persistSubsidiaryUpdate(payload: SubsidiaryEditPayload): Promise<void>;
  refreshWarRoomFromApi(rebuildHierarchy?: boolean): Promise<void>;
}

export const runBatchMutationWorkflow = async (
  api: ProjectMutationApi,
  payload: { factories: FactoryEditPayload[]; subsidiaries: SubsidiaryEditPayload[] }
): Promise<{ successCount: number; failureCount: number }> => {
  let successCount = 0;
  let failureCount = 0;

  for (const sub of payload.subsidiaries) {
    try {
      await api.persistSubsidiaryUpdate(sub);
      successCount++;
    } catch (error) {
      console.error('persistSubsidiaryUpdate failed', { subsidiaryId: sub.subsidiaryId, payload: sub, error });
      failureCount++;
    }
  }

  for (const fact of payload.factories) {
    try {
      await api.persistFactoryUpdate(fact);
      successCount++;
    } catch (error) {
      console.error('persistFactoryUpdate failed', { factoryId: fact.factoryId, payload: fact, error });
      failureCount++;
    }
  }

  if (successCount > 0) {
    try {
      await api.refreshWarRoomFromApi(true);
    } catch (error) {
      console.error('refreshWarRoomFromApi failed after batch mutation:', error);
    }
  }

  return { successCount, failureCount };
};

export const toCreateProjectPayload = (
  formData: {
    projectName: string;
    clientId: string;
    clientName: string;
    assessmentType: string;
    manufacturerLocationId?: string | number | null;
    factoryId?: string | number | null;
    location: string;
    manufacturerName: string;
    status: 'Active' | 'Inactive';
  },
  projectTypeId: number,
  locationId: number
): Omit<Project, 'id'> => {
  const status = formData.status === 'Active' ? 'Open' : 'Closed';
  const manufacturerLocationId = formData.manufacturerLocationId ?? formData.factoryId ?? String(locationId);
  return {
    projectName: formData.projectName,
    clientId: formData.clientId,
    clientName: formData.clientName,
    assessmentType: formData.assessmentType,
    projectTypeId,
    locationIds: [locationId],
    locationId,
    manufacturerLocationId: String(manufacturerLocationId),
    location: formData.location,
    manufacturer: formData.manufacturerName,
    status,
    closed: status === 'Closed',
  };
};
