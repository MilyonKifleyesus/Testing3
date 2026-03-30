export type TicketsByVehicleQueryScope =
  | {
      kind: 'project';
      clientId?: number;
      includeClosed: boolean;
      projectId: string;
      vehicleId?: string;
    }
  | {
      kind: 'vehicle';
      clientId?: number;
      includeClosed: boolean;
      vehicleId: string;
    }
  | {
      kind: 'all';
      clientId?: number;
      includeClosed: boolean;
      vehicleId?: string;
    };

interface ResolveTicketsByVehicleQueryScopeInput {
  clientId?: number;
  includeClosed: boolean;
  selectedProject: string;
  selectedVehicle: string;
  visibleProjectIds: string[];
}

export function resolveTicketsByVehicleQueryScope(
  input: ResolveTicketsByVehicleQueryScopeInput,
): TicketsByVehicleQueryScope {
  const selectedProject = String(input.selectedProject ?? '').trim();
  const selectedVehicle = String(input.selectedVehicle ?? '').trim();
  const vehicleId = selectedVehicle && selectedVehicle.toLowerCase() !== 'all'
    ? selectedVehicle
    : undefined;

  if (selectedProject && selectedProject.toLowerCase() !== 'all') {
    return {
      kind: 'project',
      clientId: input.clientId,
      includeClosed: input.includeClosed,
      projectId: selectedProject,
      vehicleId,
    };
  }

  // With "All Projects" selected, a direct vehicle-scoped request is more accurate
  // than fanning out one request per project.
  if (vehicleId) {
    return {
      kind: 'vehicle',
      clientId: input.clientId,
      includeClosed: input.includeClosed,
      vehicleId,
    };
  }

  return {
    kind: 'all',
    clientId: input.clientId,
    includeClosed: input.includeClosed,
  };
}
