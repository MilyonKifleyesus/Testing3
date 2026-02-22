import { Injectable } from '@angular/core';
import { FleetSelection, MapViewMode, Node } from '../../../../shared/models/fluorescence-map.interface';

export interface PanelActionsContext {
  mapViewMode(): MapViewMode;
  selectedEntity(): FleetSelection | null;
  setSelectedEntity(selection: FleetSelection | null): void;
  showPanel(panel: 'log' | 'hub'): void;
  setManufacturerFilterSubsidiaryId(id: string | null): void;
  setMapViewMode(mode: MapViewMode): void;
  zoomToEntity(id: string, zoom?: number): void;
  announce(message: string): void;
}

@Injectable({ providedIn: 'root' })
export class PanelActionsWorkflowService {
  onEntitySelected(ctx: PanelActionsContext, selection: FleetSelection): { ignored: boolean; sameSelection: boolean } {
    const currentView = ctx.mapViewMode();
    if (selection.level === 'subsidiary' && currentView !== 'subsidiary' && currentView !== 'project' && currentView !== 'client') {
      return { ignored: true, sameSelection: false };
    }
    if (selection.level === 'subsidiary') {
      const subsidiaryId = selection.subsidiaryId || selection.id;
      if (currentView === 'project' || currentView === 'client') {
        ctx.setMapViewMode('manufacturer');
        ctx.setManufacturerFilterSubsidiaryId(subsidiaryId);
      } else if (currentView === 'subsidiary') {
        ctx.setManufacturerFilterSubsidiaryId(subsidiaryId);
      }
    }

    const currentSelection = ctx.selectedEntity();
    const sameSelection = currentSelection?.id === selection.id && currentSelection?.level === selection.level;
    ctx.setSelectedEntity(selection);
    ctx.showPanel('log');
    if (sameSelection) {
      ctx.zoomToEntity(selection.id);
    }
    return { ignored: false, sameSelection };
  }

  onNodeSelected(node: Node | undefined): FleetSelection | null {
    if (!node) return null;
    const nodeLevel = node.level ?? 'manufacturer';
    return {
      level: nodeLevel,
      id: node.companyId,
      parentGroupId: node.parentGroupId,
      subsidiaryId: node.subsidiaryId,
      manufacturerLocationId: node.manufacturerLocationId ?? node.factoryId,
      factoryId: node.factoryId,
    };
  }
}
