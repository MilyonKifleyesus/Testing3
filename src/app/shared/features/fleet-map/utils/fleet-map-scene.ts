import type { Feature, LineString } from 'geojson';
import type {
  ApiClient,
  ApiLocation,
  ApiManufacturer,
  ApiProject,
  FleetMode,
  FleetSelectedEntity,
} from '../models/fleet-map.models';
import { clampLngLatToWorld, hasUsableCoordinates, toLngLat, type LatLng } from './fleet-map-geo';

export type MarkerType = 'client' | 'manufacturer' | 'location' | 'project';
export type MarkerAppearance =
  | 'client'
  | 'client-destination'
  | 'manufacturer'
  | 'manufacturer-origin'
  | 'location';
export type MarkerAccent = ApiProject['status'] | 'mixed' | 'neutral';

export interface MapRouteProperties {
  id: string;
  selected: boolean;
  status: ApiProject['status'];
}

export type MapRouteFeature = Feature<LineString, MapRouteProperties>;

export interface MapMarkerSpec {
  key: string;
  type: MarkerType;
  appearance: MarkerAppearance;
  accent: MarkerAccent;
  entity: FleetSelectedEntity;
  lngLat: [number, number];
  selected: boolean;
}

export interface MapScene {
  markers: MapMarkerSpec[];
  routes: MapRouteFeature[];
  allBounds: [number, number][];
  focusBounds: [number, number][];
  dataFingerprint: string;
  projectIsolationReady: boolean;
}

interface BuildMapSceneArgs {
  mode: FleetMode;
  projects: ApiProject[];
  clients: ApiClient[];
  manufacturers: ApiManufacturer[];
  locations: ApiLocation[];
  selectedEntity: FleetSelectedEntity | null;
  focusedEntity: FleetSelectedEntity | null;
  viewedProject: ApiProject | null;
  clientById: Map<string, ApiClient>;
  locationById: Map<string, ApiLocation>;
}

function uniqueProjectLocationIds(project: ApiProject): string[] {
  const ids = new Set<string>();

  if (project.locationId) {
    ids.add(project.locationId);
  }

  project.locationIds.forEach((locationId) => ids.add(locationId));
  return Array.from(ids);
}

function resolveLinkedCoordinates(
  locationIds: string[],
  locationById: Map<string, ApiLocation>,
): LatLng | null {
  for (const locationId of locationIds) {
    const location = locationById.get(locationId);
    if (location && hasUsableCoordinates(location.lat, location.lng)) {
      return { lat: location.lat!, lng: location.lng! };
    }
  }

  return null;
}

function resolveEntityCoordinates(
  lat: number | null | undefined,
  lng: number | null | undefined,
  locationIds: string[],
  locationById: Map<string, ApiLocation>,
): LatLng | null {
  if (hasUsableCoordinates(lat, lng)) {
    return { lat: lat!, lng: lng! };
  }

  return resolveLinkedCoordinates(locationIds, locationById);
}

function mergeMarkerAccent(current: MarkerAccent, next: MarkerAccent): MarkerAccent {
  if (current === next) return current;
  if (current === 'neutral') return next;
  if (next === 'neutral') return current;
  return 'mixed';
}

function upsertMarker(markersByKey: Map<string, MapMarkerSpec>, marker: MapMarkerSpec): void {
  const existing = markersByKey.get(marker.key);
  if (!existing) {
    markersByKey.set(marker.key, marker);
    return;
  }

  markersByKey.set(marker.key, {
    ...existing,
    ...marker,
    accent: mergeMarkerAccent(existing.accent, marker.accent),
    selected: existing.selected || marker.selected,
  });
}

function extendBounds(
  allBounds: [number, number][],
  focusBounds: [number, number][],
  coordinates: LatLng,
  isFocused: boolean,
): void {
  const lngLat = toLngLat(coordinates);
  allBounds.push(lngLat);

  if (isFocused) {
    focusBounds.push(lngLat);
  }
}

function buildFingerprint(markers: MapMarkerSpec[], routes: MapRouteFeature[]): string {
  const markerPart = markers
    .map((marker) => (
      `${marker.key}:${marker.appearance}:${marker.accent}:${marker.lngLat[0].toFixed(6)}:${marker.lngLat[1].toFixed(6)}`
    ))
    .join('|');
  const routePart = routes
    .map((route) => {
      const coordinates = route.geometry.coordinates
        .map((position) => `${Number(position[0]).toFixed(6)}:${Number(position[1]).toFixed(6)}`)
        .join('>');

      return `${String(route.properties?.id ?? 'route')}:${route.properties?.status ?? 'active'}:${coordinates}`;
    })
    .join('|');

  return `${markerPart}::${routePart}`;
}

function spreadProjectMarkers(markers: MapMarkerSpec[]): MapMarkerSpec[] {
  const groups = new Map<string, MapMarkerSpec[]>();

  markers.forEach((marker) => {
    if (marker.type !== 'project') {
      return;
    }

    const key = `${marker.lngLat[0].toFixed(6)}:${marker.lngLat[1].toFixed(6)}`;
    const current = groups.get(key) ?? [];
    current.push(marker);
    groups.set(key, current);
  });

  const nextMarkers = new Map(markers.map((marker) => [marker.key, marker]));

  groups.forEach((group) => {
    if (group.length < 2) {
      return;
    }

    const radius = 0.00032;
    const angleStep = (Math.PI * 2) / group.length;
    group.forEach((marker, index) => {
      const angle = angleStep * index;
      const lng = marker.lngLat[0] + Math.cos(angle) * radius;
      const lat = marker.lngLat[1] + Math.sin(angle) * radius;

      nextMarkers.set(marker.key, {
        ...marker,
        lngLat: clampLngLatToWorld([lng, lat]),
      });
    });
  });

  return markers.map((marker) => nextMarkers.get(marker.key) ?? marker);
}

function resolveManufacturerForProject(
  project: ApiProject,
  manufacturers: ApiManufacturer[],
  locationById: Map<string, ApiLocation>,
): {
  manufacturer: ApiManufacturer | null;
  coordinates: LatLng | null;
} {
  const manufacturerById = new Map(manufacturers.map((manufacturer) => [manufacturer.id, manufacturer]));
  const manufacturerByLocationId = new Map<string, ApiManufacturer>();

  manufacturers.forEach((manufacturer) => {
    manufacturer.locationIds.forEach((locationId) => {
      if (!manufacturerByLocationId.has(locationId)) {
        manufacturerByLocationId.set(locationId, manufacturer);
      }
    });
  });

  const projectLocationIds = uniqueProjectLocationIds(project);
  let fallbackCoordinates: LatLng | null = null;

  for (const locationId of projectLocationIds) {
    const location = locationById.get(locationId);
    const manufacturer = (location?.manufacturerId
      ? manufacturerById.get(location.manufacturerId)
      : null) ?? manufacturerByLocationId.get(locationId);

    if (!fallbackCoordinates && location && hasUsableCoordinates(location.lat, location.lng)) {
      fallbackCoordinates = { lat: location.lat!, lng: location.lng! };
    }

    if (!manufacturer) {
      continue;
    }

    const coordinates = resolveEntityCoordinates(
      manufacturer.lat,
      manufacturer.lng,
      manufacturer.locationIds,
      locationById,
    ) ?? fallbackCoordinates;

    if (!coordinates) {
      continue;
    }

    return {
      manufacturer,
      coordinates,
    };
  }

  return {
    manufacturer: null,
    coordinates: fallbackCoordinates,
  };
}

function resolveProjectFallbackCoordinates(
  project: ApiProject,
  locationById: Map<string, ApiLocation>,
): LatLng | null {
  return resolveEntityCoordinates(project.lat, project.lng, uniqueProjectLocationIds(project), locationById);
}

export function buildMapScene({
  mode,
  projects,
  clients,
  manufacturers,
  locations,
  selectedEntity,
  focusedEntity,
  viewedProject,
  clientById,
  locationById,
}: BuildMapSceneArgs): MapScene {
  const markersByKey = new Map<string, MapMarkerSpec>();
  const allBounds: [number, number][] = [];
  const focusBounds: [number, number][] = [];
  const routes: MapRouteFeature[] = [];
  let projectIsolationReady = viewedProject == null;

  if (mode === 'clients') {
    clients.forEach((client) => {
      const coordinates = resolveEntityCoordinates(client.lat, client.lng, client.locationIds, locationById);
      if (!coordinates) return;

      const isSelected = selectedEntity?.kind === 'client' && selectedEntity.data.id === client.id;
      const isFocused = focusedEntity?.kind === 'client' && focusedEntity.data.id === client.id;
      extendBounds(allBounds, focusBounds, coordinates, isFocused);
      upsertMarker(markersByKey, {
        key: `client:${client.id}`,
        type: 'client',
        appearance: 'client',
        accent: 'neutral',
        entity: { kind: 'client', data: client },
        lngLat: toLngLat(coordinates),
        selected: isSelected,
      });
    });
  } else if (mode === 'manufacturers') {
    manufacturers.forEach((manufacturer) => {
      const coordinates = resolveEntityCoordinates(
        manufacturer.lat,
        manufacturer.lng,
        manufacturer.locationIds,
        locationById,
      );
      if (!coordinates) return;

      const isSelected = selectedEntity?.kind === 'manufacturer' && selectedEntity.data.id === manufacturer.id;
      const isFocused = focusedEntity?.kind === 'manufacturer' && focusedEntity.data.id === manufacturer.id;
      extendBounds(allBounds, focusBounds, coordinates, isFocused);
      upsertMarker(markersByKey, {
        key: `manufacturer:${manufacturer.id}`,
        type: 'manufacturer',
        appearance: 'manufacturer',
        accent: 'neutral',
        entity: { kind: 'manufacturer', data: manufacturer },
        lngLat: toLngLat(coordinates),
        selected: isSelected,
      });
    });

    if (locations.length > 0) {
      locations.forEach((location) => {
        if (!hasUsableCoordinates(location.lat, location.lng)) return;

        const isSelected = selectedEntity?.kind === 'location' && selectedEntity.data.id === location.id;
        const isFocused = focusedEntity?.kind === 'location' && focusedEntity.data.id === location.id;
        const coordinates = { lat: location.lat!, lng: location.lng! };
        extendBounds(allBounds, focusBounds, coordinates, isFocused);
        upsertMarker(markersByKey, {
          key: `location:${location.id}`,
          type: 'location',
          appearance: 'location',
          accent: 'neutral',
          entity: { kind: 'location', data: location },
          lngLat: toLngLat(coordinates),
          selected: isSelected,
        });
      });
    }
  } else {
    const isolatedProject = mode === 'projects' && viewedProject
      ? projects.find((project) => project.id === viewedProject.id) ?? viewedProject
      : null;

    if (isolatedProject) {
      const client = clientById.get(isolatedProject.clientId);
      const projectSelected = selectedEntity?.kind === 'project' && selectedEntity.data.id === isolatedProject.id;
      const clientSelected = !!client &&
        selectedEntity?.kind === 'client' &&
        selectedEntity.data.id === client.id;
      const manufacturerSelection = selectedEntity?.kind === 'manufacturer'
        ? selectedEntity.data.id
        : null;
      const clientCoordinates = client
        ? resolveEntityCoordinates(client.lat, client.lng, client.locationIds, locationById)
        : null;
      const projectCoordinates = resolveProjectFallbackCoordinates(isolatedProject, locationById);
      const { manufacturer, coordinates: manufacturerCoordinates } = resolveManufacturerForProject(
        isolatedProject,
        manufacturers,
        locationById,
      );
      const originCoordinates = manufacturerCoordinates ?? projectCoordinates;
      projectIsolationReady = Boolean(client && clientCoordinates && originCoordinates);

      if (!projectIsolationReady) {
        const markers = Array.from(markersByKey.values());
        return {
          markers,
          routes,
          allBounds,
          focusBounds,
          dataFingerprint: buildFingerprint(markers, routes),
          projectIsolationReady,
        };
      }

      if (manufacturer && manufacturerCoordinates) {
        extendBounds(allBounds, focusBounds, manufacturerCoordinates, true);
        upsertMarker(markersByKey, {
          key: `manufacturer:${manufacturer.id}`,
          type: 'manufacturer',
          appearance: 'manufacturer-origin',
          accent: isolatedProject.status,
          entity: { kind: 'manufacturer', data: manufacturer },
          lngLat: toLngLat(manufacturerCoordinates),
          selected: projectSelected || manufacturerSelection === manufacturer.id,
        });
      } else if (projectCoordinates) {
        extendBounds(allBounds, focusBounds, projectCoordinates, true);
        upsertMarker(markersByKey, {
          key: `project:${isolatedProject.id}`,
          type: 'project',
          appearance: 'manufacturer-origin',
          accent: isolatedProject.status,
          entity: { kind: 'project', data: isolatedProject },
          lngLat: toLngLat(projectCoordinates),
          selected: projectSelected,
        });
      }

      if (client && clientCoordinates) {
        extendBounds(allBounds, focusBounds, clientCoordinates, true);
        upsertMarker(markersByKey, {
          key: `client:${client.id}`,
          type: 'client',
          appearance: 'client-destination',
          accent: isolatedProject.status,
          entity: { kind: 'client', data: client },
          lngLat: toLngLat(clientCoordinates),
          selected: projectSelected || clientSelected,
        });
      }

      if (originCoordinates && clientCoordinates) {
        routes.push({
          type: 'Feature',
          properties: {
            id: isolatedProject.id,
            selected: projectSelected,
            status: isolatedProject.status,
          },
          geometry: {
            type: 'LineString',
            coordinates: [
              toLngLat(originCoordinates),
              toLngLat(clientCoordinates),
            ],
          },
        });
      }
    } else {
      projects.forEach((project) => {
        const client = clientById.get(project.clientId);
        const projectSelected = selectedEntity?.kind === 'project' && selectedEntity.data.id === project.id;
        const projectFocused = focusedEntity?.kind === 'project' && focusedEntity.data.id === project.id;
        const clientSelected = !!client &&
          selectedEntity?.kind === 'client' &&
          selectedEntity.data.id === client.id;
        const clientCoordinates = client
          ? resolveEntityCoordinates(client.lat, client.lng, client.locationIds, locationById)
          : null;
        const linkedLocations = project.locationIds
          .map((locationId) => locationById.get(locationId))
          .filter((location): location is ApiLocation => (
            !!location && hasUsableCoordinates(location.lat, location.lng)
          ));

        if (client && clientCoordinates) {
          extendBounds(allBounds, focusBounds, clientCoordinates, projectFocused);
          upsertMarker(markersByKey, {
            key: `client:${client.id}`,
            type: 'client',
            appearance: 'client-destination',
            accent: project.status,
            entity: { kind: 'client', data: client },
            lngLat: toLngLat(clientCoordinates),
            selected: clientSelected || projectSelected,
          });
        }

        if (linkedLocations.length > 0) {
          linkedLocations.forEach((location, index) => {
            const coordinates = { lat: location.lat!, lng: location.lng! };

            extendBounds(allBounds, focusBounds, coordinates, projectFocused);
            upsertMarker(markersByKey, {
              key: `project:${project.id}:location:${location.id}:${index}`,
              type: 'project',
              appearance: 'manufacturer-origin',
              accent: project.status,
              entity: { kind: 'project', data: project },
              lngLat: toLngLat(coordinates),
              selected: projectSelected,
            });

            if (clientCoordinates) {
              routes.push({
                type: 'Feature',
                properties: {
                  id: project.id,
                  selected: projectSelected,
                  status: project.status,
                },
                geometry: {
                  type: 'LineString',
                  coordinates: [
                    toLngLat(coordinates),
                    toLngLat(clientCoordinates),
                  ],
                },
              });
            }
          });
        } else {
          const projectCoordinates = resolveProjectFallbackCoordinates(project, locationById);
          if (!projectCoordinates) {
            return;
          }

          extendBounds(allBounds, focusBounds, projectCoordinates, projectFocused);
          upsertMarker(markersByKey, {
            key: `project:${project.id}`,
            type: 'project',
            appearance: 'manufacturer-origin',
            accent: project.status,
            entity: { kind: 'project', data: project },
            lngLat: toLngLat(projectCoordinates),
            selected: projectSelected,
          });

          if (clientCoordinates) {
            routes.push({
              type: 'Feature',
              properties: {
                id: project.id,
                selected: projectSelected,
                status: project.status,
              },
              geometry: {
                type: 'LineString',
                coordinates: [
                  toLngLat(projectCoordinates),
                  toLngLat(clientCoordinates),
                ],
              },
            });
          }
        }
      });
    }
  }

  const markers = spreadProjectMarkers(Array.from(markersByKey.values()));

  return {
    markers,
    routes,
    allBounds,
    focusBounds,
    dataFingerprint: buildFingerprint(markers, routes),
    projectIsolationReady,
  };
}
