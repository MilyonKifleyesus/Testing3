import { FleetSelection } from '../../../../shared/models/fluorescence-map.interface';

export interface PanelActionsApi {
  setMapViewMode(mode: 'project' | 'client' | 'manufacturer' | 'factory' | 'parent'): void;
  setManufacturerFilterSubsidiaryId(id: string | null): void;
  selectEntity(selection: FleetSelection | null): void;
}

export const applySelectionFromActivityLog = (
  api: PanelActionsApi,
  currentView: string,
  selection: FleetSelection
): void => {
  if (selection.level === 'subsidiary' && (currentView === 'project' || currentView === 'client')) {
    const manufacturerId = selection.subsidiaryId ?? selection.id;
    api.setMapViewMode('manufacturer');
    api.setManufacturerFilterSubsidiaryId(manufacturerId);
  }

  api.selectEntity(selection);
};
