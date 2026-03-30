import { Injectable, computed } from '@angular/core';

import { FluorescenceMapBootstrapData } from '../fluorescence-map.types';
import { Node, ProjectRoute, TransitRoute } from '../../../models/fluorescence-map.interface';
import {
  ClientVm,
  LocationVm,
  ManufacturerVm,
  ProjectVm,
} from '../models/fleet-vm.models';

interface BootstrapInputs {
  projects: () => ProjectVm[];
  clients: () => ClientVm[];
  manufacturers: () => ManufacturerVm[];
  locations: () => LocationVm[];
  regionValues: () => string[];
  nodes: () => Node[];
  projectRoutes: () => ProjectRoute[];
  transitRoutes: () => TransitRoute[];
  projectClientIdByProjectId: () => Map<string, string | null>;
  projectTypeIdByProjectId: () => Map<string, string | null>;
  manufacturerIdsByProjectId: () => Map<string, string[]>;
  manufacturerIdsByNodeId: () => Map<string, string[]>;
  projectRegionByProjectId: () => Map<string, string | null>;
}

@Injectable({ providedIn: 'root' })
export class FluorescenceMapPageFacade {
  createBootstrapData(inputs: BootstrapInputs) {
    return computed<FluorescenceMapBootstrapData>(() => ({
      projects: inputs.projects(),
      clients: inputs.clients(),
      manufacturers: inputs.manufacturers(),
      locations: inputs.locations(),
      regionValues: inputs.regionValues(),
      nodes: inputs.nodes(),
      projectRoutes: inputs.projectRoutes(),
      transitRoutes: inputs.transitRoutes(),
      projectIds: inputs.projects().map((project) => String(project.id)),
      projectClientIdByProjectId: inputs.projectClientIdByProjectId(),
      projectTypeIdByProjectId: inputs.projectTypeIdByProjectId(),
      manufacturerIdsByProjectId: inputs.manufacturerIdsByProjectId(),
      manufacturerIdsByNodeId: inputs.manufacturerIdsByNodeId(),
      projectRegionByProjectId: inputs.projectRegionByProjectId(),
    }));
  }
}
