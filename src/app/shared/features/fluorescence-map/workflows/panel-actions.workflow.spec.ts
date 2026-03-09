import { applySelectionFromActivityLog, PanelActionsApi } from './panel-actions.workflow';
import { FleetSelection } from '../../../../shared/models/fluorescence-map.interface';

describe('applySelectionFromActivityLog', () => {
  let api: PanelActionsApi;

  beforeEach(() => {
    api = {
      setMapViewMode: jasmine.createSpy('setMapViewMode'),
      setManufacturerFilterSubsidiaryId: jasmine.createSpy('setManufacturerFilterSubsidiaryId'),
      selectEntity: jasmine.createSpy('selectEntity'),
    };
  });

  it('switches to manufacturer mode for subsidiary selections in project view', () => {
    const selection: FleetSelection = { level: 'subsidiary', id: 'm1', subsidiaryId: 'm1' };
    applySelectionFromActivityLog(api, 'project', selection);
    expect(api.setMapViewMode).toHaveBeenCalledWith('manufacturer');
    expect(api.setManufacturerFilterSubsidiaryId).toHaveBeenCalledWith('m1');
    expect(api.selectEntity).toHaveBeenCalledWith(selection);
  });

  it('uses selection.id when subsidiaryId is missing', () => {
    const selection: FleetSelection = { level: 'subsidiary', id: 'm2' };
    applySelectionFromActivityLog(api, 'client', selection);
    expect(api.setManufacturerFilterSubsidiaryId).toHaveBeenCalledWith('m2');
    expect(api.selectEntity).toHaveBeenCalledWith(selection);
  });

  it('does not change view/filter for non-project/client views but still selects the entity', () => {
    const selection: FleetSelection = { level: 'subsidiary', id: 'm3' };
    applySelectionFromActivityLog(api, 'manufacturer', selection);
    expect(api.setMapViewMode).not.toHaveBeenCalled();
    expect(api.setManufacturerFilterSubsidiaryId).not.toHaveBeenCalled();
    expect(api.selectEntity).toHaveBeenCalledWith(selection);
  });

  it('does not change view/filter for non-subsidiary selections', () => {
    const selection: FleetSelection = { level: 'factory', id: 'f1' } as any;
    applySelectionFromActivityLog(api, 'project', selection);
    expect(api.setMapViewMode).not.toHaveBeenCalled();
    expect(api.setManufacturerFilterSubsidiaryId).not.toHaveBeenCalled();
    expect(api.selectEntity).toHaveBeenCalledWith(selection);
  });
});

