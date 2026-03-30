import { MapViewMode } from '../../../shared/models/fluorescence-map.interface';

export const STORAGE_KEY = 'war-room-state-v1';
export const LEGACY_STORAGE_KEY = 'war-room-filters-v1';
export const TIPS_HINT_SEEN_KEY = 'war-room-tips-hint-seen';
export const ADD_PROJECT_SEEN_KEY = 'war-room-add-project-seen';
export const MAP_EXPANDED_CLASS = 'war-room-map-expanded';
export const MAP_EXPANDED_SCROLL_LOCK_STYLE = 'hidden';

export const API_TIMEOUT_MS = 10000;
/** Projects flow runs forkJoin(Projects,Clients,Manufacturers,Locations); use a longer timeout to avoid false "Projects" errors. */
export const PROJECTS_COMBINED_TIMEOUT_MS = 25_000;
export const REQUIRED_DATA_TIMEOUT_MS = 30_000;
export const ZOOM_TO_ENTITY_DELAY_MS = 100;
export const FIT_BOUNDS_DELAY_MS = 150;
export const TIPS_HINT_DURATION_MS = 6000;
export const ADD_PROJECT_PULSE_DURATION_MS = 5000;
export const ACTIVITY_LOG_BUSY_CLEAR_DELAY_MS = 400;
export const CAPTURE_WAIT_MS = 100;
export const ROUTE_PREVIEW_DELAY_MS = 500;
export const CLIENT_CAPTURE_DELAY_MS = 1500;
export const CLEAR_FILTERS_AFTER_ADD_DELAY_MS = 0;
export const FIT_MAP_AFTER_ADD_DELAY_MS = 800;
export const FIT_MAP_AFTER_ADD_RETRY_DELAY_MS = 1800;
export const ANNOUNCEMENT_CLEAR_DELAY_MS = 3000;
export const PREVIOUS_VIEW_BUTTON_DURATION_MS = 5000;
export const MARKER_STABILITY_MESSAGE_DURATION_MS = 5000;
export const RESTORE_FOCUS_DELAY_MS = 0;

export const VALID_RESTORABLE_MAP_MODES: MapViewMode[] = [
  'project',
  'client',
  'manufacturer',
  'factory',
  'parent',
];
