import { FleetSelection } from '../../../../shared/models/fluorescence-map.interface';

export interface PanelActionsApi {
  setMapViewMode(mode: 'project' | 'client' | 'manufacturer' | 'factory' | 'parent' | 'subsidiary'): void;
  setManufacturerFilterSubsidiaryId(id: string | null): void;
  selectEntity(selection: FleetSelection | null): void;
}

export const applySelectionFromActivityLog = (
  api: PanelActionsApi,
  currentView: string,
  selection: FleetSelection
): { ignored: boolean } => {
  if (
    selection.level === 'subsidiary' &&
    currentView !== 'subsidiary' &&
    currentView !== 'project' &&
    currentView !== 'client'
  ) {
    return { ignored: true };
  }

  if (selection.level === 'subsidiary') {
    const subsidiaryId = selection.subsidiaryId || selection.id;
    if (currentView === 'project' || currentView === 'client') {
      api.setMapViewMode('manufacturer');
      api.setManufacturerFilterSubsidiaryId(subsidiaryId);
    } else if (currentView === 'subsidiary') {
      api.setManufacturerFilterSubsidiaryId(subsidiaryId);
    }
  }

  api.selectEntity(selection);
  return { ignored: false };
};
