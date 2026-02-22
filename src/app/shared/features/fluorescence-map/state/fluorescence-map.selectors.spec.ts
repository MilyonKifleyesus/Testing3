import {
  selectActiveFilterCount,
  selectProjectRoutesForMap,
  selectStatusCounts,
} from './fluorescence-map.selectors';
import { WarRoomFilters } from '../fluorescence-map.types';
import { ProjectRoute } from '../../../../shared/models/fluorescence-map.interface';
import { Project } from '../../../../shared/models/project.model';

describe('fluorescence-map selectors', () => {
  it('selectProjectRoutesForMap keeps manufacturer routes', () => {
    const routes: ProjectRoute[] = [
      {
        id: 'r1',
        projectId: 'p1',
        fromNodeId: 'c1',
        toNodeId: 'f1',
        status: 'Open',
        fromCoordinates: { latitude: 1, longitude: 1 },
        toCoordinates: { latitude: 2, longitude: 2 },
      },
    ];

    const result = selectProjectRoutesForMap('manufacturer', routes, null, null);
    expect(result.length).toBe(1);
  });

  it('selectStatusCounts computes active/inactive totals', () => {
    const projects: Project[] = [
      { id: '1', status: 'Open' } as Project,
      { id: '2', status: 'Closed' } as Project,
    ];
    const result = selectStatusCounts(projects);
    expect(result).toEqual({ total: 2, active: 1, inactive: 1 });
  });

  it('selectActiveFilterCount counts all active dimensions', () => {
    const filters: WarRoomFilters = {
      status: 'inactive',
      regions: ['North America'],
      clientIds: ['c1'],
      manufacturerIds: ['m1'],
      projectTypeIds: [],
      projectIds: ['p1'],
    };
    expect(selectActiveFilterCount(filters)).toBe(5);
  });
});

