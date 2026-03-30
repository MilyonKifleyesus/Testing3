# Fluorescence Map Feature Documentation

This document describes the current implementation of the BusPulse map feature in this repository. It is based on the code under `src/app/shared/features/fluorescence-map` and the supporting services it depends on.

This is an implementation document, not a future-state design document. Where behavior is described here, it reflects what the code does today.

## 1. What the feature is

The "map feature" in this codebase is the `FluorescenceMapComponent` feature. Despite the older "war room" naming in parts of the code, this is the current FleetPulse map system.

It is not only a map renderer. It is a combined feature that includes:

- An interactive map of clients, manufacturers, and project routes
- View-mode switching between project, client, and manufacturer perspectives
- Filtering across status, region, client, manufacturer, project type, and project
- Realtime updates through a SignalR hub
- Polling fallback when realtime is unavailable
- A data-management table for projects, clients, manufacturers, and locations
- Edit/create workflows for those entities
- Route screenshot capture and preview storage
- Accessibility and dashboard embedding support

## 2. Main entry points

### 2.1 Dev route

The feature is directly routable in development mode at:

- `/_dev/fluorescence-map`

Source:

- `src/app/app.routes.ts`

This route is guarded and only available in Angular dev mode.

### 2.2 Embedded usage

The same component is reused in multiple app surfaces:

- Admin dashboard widget embed
- Client dashboard widget embed
- Admin map page
- Admin data-management page

Sources:

- `src/app/components/admin/dashboard/admin-dashboard.component.html`
- `src/app/components/client/dashboard/client-dashboard.component.html`
- `src/app/components/admin/map/admin-map.component.ts`
- `src/app/components/admin/data-management/admin-data-management.component.ts`

### 2.3 Component modes

`FluorescenceMapComponent` supports multiple host modes through inputs:

- `dashboardFullscreenMode`
- `dashboardFullscreen`
- `expandMapTriggersBrowserFullscreen`
- `dataManagementOnly`
- `dataManagementMode`
- `tableLayout`
- `externalProjectId`

These let the same feature run as:

- A full interactive map shell
- A dashboard widget
- A fullscreen dashboard overlay
- A data-management-only admin screen
- A host-controlled project-filtered embed

## 3. High-level architecture

At a high level, the feature is split into four layers.

### 3.1 Shell/container layer

`src/app/shared/features/fluorescence-map/fluorescence-map.component.ts`

This is the orchestration layer. It owns:

- Endpoint loading state
- Required-data readiness
- Filter draft and applied state
- Persistence to `localStorage`
- Realtime bridge startup and teardown
- Polling fallback
- Selection side effects
- Route fetching
- Table row projection
- Mutation result patching
- Screenshot workflow calls

### 3.2 Domain state layer

`src/app/shared/services/fluorescence-map.service.ts`

This service is the signal-based domain state for:

- Parent group hierarchy
- Subsidiaries/manufacturers
- Manufacturer locations/factories
- Activity logs
- Transit routes
- Selected entity
- Hovered entity
- Current map view mode
- Pan-to requests

It also derives map nodes from the selected hierarchy and current map mode.

### 3.3 Rendering layer

Main renderer:

- `src/app/shared/features/fluorescence-map/components/fluorescence-map-map/fluorescence-map-map.component.ts`

Renderer subcomponents:

- `.../controls/fluorescence-map-map-controls.component.ts`
- `.../routes/fluorescence-map-map-routes.component.ts`
- `.../markers/fluorescence-map-map-markers.component.ts`
- `.../tooltip/fluorescence-map-map-tooltip.component.ts`

Renderer support services:

- `.../services/fluorescence-map-map-overlay.service.ts`
- `.../services/fluorescence-map-map-math.service.ts`
- `.../services/fluorescence-map-map-assets.service.ts`

The renderer uses MapLibre GL for the base map and Angular-rendered overlays for routes, markers, labels, and tooltips.

### 3.4 Backend/data integration layer

Primary backing services:

- `src/app/shared/services/project.service.ts`
- `src/app/shared/services/client.service.ts`
- `src/app/shared/services/location.service.ts`

These services load and normalize backend API data, and `ProjectService` is responsible for:

- Project list retrieval
- Manufacturer retrieval
- Hierarchy construction from manufacturers and locations
- Project-type lookup
- Project route generation for the map

## 4. File map of the feature

### 4.1 Core feature files

- `fluorescence-map.component.ts`
- `fluorescence-map.component.html`
- `fluorescence-map.component.scss`
- `fluorescence-map.types.ts`
- `fluorescence-map.constants.ts`

### 4.2 State selectors

- `state/fluorescence-map.selectors.ts`

These selectors power strict filtering and the final map view model.

### 4.3 Workflows

- `workflows/project-workflow.service.ts`
- `workflows/capture-workflow.service.ts`
- `workflows/panel-actions-workflow.service.ts`

These isolate multi-step behavior from the main component.

### 4.4 Realtime

- `realtime/map-realtime.service.ts`
- `realtime/map-polling.service.ts`
- `realtime/map-realtime.types.ts`

### 4.5 Data-management services and models

- `services/activity-log-table.service.ts`
- `services/data-management-mutation.service.ts`
- `models/fleet-vm.models.ts`

### 4.6 Supporting but currently not wired into the live component tree

As of the current repository search, these services exist but are not referenced by the live map component tree:

- `services/fleet-api.service.ts`
- `services/fleet-snapshot.service.ts`
- `services/fleet-map-state.service.ts`

They look like earlier or alternate abstractions that are not the current primary execution path.

## 5. Core data model

The main interfaces live in:

- `src/app/shared/models/fluorescence-map.interface.ts`

Important types:

- `MapViewMode`
- `FleetSelection`
- `ParentGroup`
- `SubsidiaryCompany`
- `ManufacturerLocation`
- `Node`
- `ProjectRoute`
- `TransitRoute`
- `ActivityLog`
- `WarRoomState`

### 5.1 View modes

The broader model still supports these modes:

- `parent`
- `subsidiary`
- `manufacturer`
- `factory`
- `project`
- `client`

In the current UI, the visible primary tabs are:

- `project`
- `client`
- `manufacturer`

Legacy `parent`, `subsidiary`, and `factory` behavior still exists inside the domain service and selection normalization.

### 5.2 Entity meaning

- `ParentGroup`: top-level grouping used for the hierarchy service
- `SubsidiaryCompany`: manufacturer/company grouping
- `ManufacturerLocation`: physical site with coordinates
- `Node`: the normalized marker object the map consumes
- `ProjectRoute`: a client-to-manufacturer/location connection for map display
- `ActivityLog`: table/log entry shape

## 6. Where the map gets its data

The feature does not read from a single endpoint. It composes data from several backend sources.

### 6.1 Required endpoint set

The container considers these required for normal operation:

- Clients
- Projects
- Manufacturers
- Locations

The component tracks individual endpoint statuses:

- `idle`
- `loading`
- `ready`
- `error`

If any required endpoint errors, `hasRequiredEndpointError` becomes true.

### 6.2 Services used

#### Clients

`ClientService`:

- loads `/Clients`
- caches results
- supports `getClientById`
- supports updates and creates

#### Locations

`LocationService`:

- loads `/Locations`
- exposes `getAllLocations()` and filtered `getLocations()`
- filters out zero-coordinate locations in the non-"all" path
- supports update and create

#### Projects and manufacturers

`ProjectService`:

- loads `/Projects`
- loads `/Manufacturers`
- loads `/ProjectTypes`
- joins projects with clients, manufacturers, and locations
- builds map routes
- builds parent/manufacturer hierarchy
- supports create/update for projects and manufacturers

## 7. Initialization and lifecycle

### 7.1 Startup sequence

On `ngOnInit`, the component:

1. Restores persisted state from `localStorage`
2. Restores filter state
3. Restores panel visibility
4. Restores a valid map view mode
5. Applies first-visit onboarding hints
6. Starts the realtime bridge

Persistence keys come from `fluorescence-map.constants.ts`:

- `war-room-state-v1`
- `war-room-filters-v1` for legacy migration
- onboarding hint keys

### 7.2 Required data loading

Required data streams are built with Angular signals derived from RxJS streams:

- `clientsSignal`
- `projectsSignal`
- `locationsSignal`
- `apiManufacturersSignal`

Each stream:

- sets endpoint status to `loading`
- performs the request
- marks endpoint `ready` on success
- marks endpoint `error` on failure

Once all required endpoints are ready:

- `requiredDataReady` becomes true
- `hasLoadedRequiredData` is set
- delta overlays from realtime are cleared

### 7.3 Parent group load

Parent groups are deliberately loaded after required data is ready.

Reason:

- the code reuses already-needed manufacturers and locations
- it avoids double-counting related failures in the error summary

The hierarchy is built through:

- `ProjectService.buildParentGroupsFromApi()`

Then applied through:

- `WarRoomService.setParentGroupsFromApi()`

## 8. Hierarchy building

The current hierarchy is not fetched as a ready-made backend tree. It is composed in the frontend.

### 8.1 Inputs used

`buildParentGroupsFromApi()` uses:

- manufacturers
- locations

### 8.2 Current grouping strategy

The method creates one synthetic parent group:

- `api-manufacturers`

Under that, it builds `SubsidiaryCompany` rows per manufacturer and `ManufacturerLocation` rows per location.

### 8.3 Important matching rule

The code explicitly prefers name-based location parsing over raw backend manufacturer-to-location linkage in some cases.

Reason from code comments:

- backend location mappings have produced incorrect manufacturer associations
- location names like `City (Manufacturer)` are used as a stronger signal when available

### 8.4 Fallback behavior

Even if a manufacturer has broken or missing location mapping:

- the manufacturer row is still kept visible
- warnings are accumulated internally during hierarchy construction
- strict fallback locations are not synthesized

## 9. Domain state ownership

`WarRoomService` is the map domain state owner for hierarchy and selection.

### 9.1 What it stores

- parent groups
- transit routes
- activity logs
- network metrics
- network throughput
- geopolitical heatmap
- satellite statuses
- map view mode
- selected entity
- hovered entity
- pan-to requests

### 9.2 What it derives

- `subsidiaries`
- `factories` and `manufacturerLocations`
- `nodes`
- `selectedParentGroup`
- `selectedSubsidiary`

### 9.3 Node generation behavior

`WarRoomService.nodes` is computed from:

- current map view mode
- current selection
- optional manufacturer/factory subsidiary filter

Important current behavior:

- `parent` view renders parent nodes
- `client` view returns no nodes from `WarRoomService` itself
- `project`, `factory`, and `manufacturer` views render location/factory-derived nodes

Client nodes are added later by selectors in the shell component, not by `WarRoomService`.

## 10. Filtering model

Filter state lives in the container as `WarRoomFilters`.

Filter dimensions:

- `status`
- `regions`
- `clientIds`
- `manufacturerIds`
- `projectTypeIds`
- `projectIds`

### 10.1 Draft vs applied filters

The feature intentionally separates:

- `filterDraft`
- `filterApplied`

Meaning:

- the overlay edits `filterDraft`
- the map and table use `filterApplied`
- nothing changes on the actual map until `applyFilters()` runs

This behavior is explicitly covered by tests.

### 10.2 Persistence

Applied filters are persisted to `localStorage` together with:

- `mapViewMode`
- `panelVisible`

### 10.3 Pinned client mode

Restricted roles (`client` and `user`) are automatically pinned to their own client id.

Effects of pinned mode:

- client filter is pre-applied
- some controls are hidden
- client view is blocked
- add/edit capability is reduced based on role and host mode

## 11. Strict selector pipeline

The most important map-filter pipeline is in:

- `state/fluorescence-map.selectors.ts`

This is the logic that converts raw entities and filters into the final renderable map view model.

### 11.1 Selector stages

1. `selectProjectRoutesForMap`
2. `selectFilteredProjectRoutesStrict`
3. `selectDerivedNodeIdsFromRoutes`
4. `selectFilteredNodesStrict`
5. `selectMapViewModelStrict`

### 11.2 What the strict pipeline does

- Filters routes by project, client, manufacturer, project type, status, and region
- Resolves numeric-like ids across different formats
- Normalizes `loc-` prefixed node ids
- Derives the exact node set needed from route endpoints
- Produces renderable markers, labels, routes, bounds, and empty-state information

### 11.3 Important route rules

`selectFilteredProjectRoutesStrict()` applies:

- project filter
- client filter
- manufacturer filter
- project type filter
- status filter
- region filter

Region logic is endpoint OR, meaning a route matches if either endpoint belongs to a selected region.

### 11.4 Empty-state logic

The final map view model exposes:

- whether an empty state should show
- the message to show

Current empty-state message:

- `No routes match the selected filters`

## 12. Route generation for the map

The actual route list displayed on the map is built by:

- `ProjectService.getProjectsForMap()`

### 12.1 Route source of truth

Project routes are derived from projects, not from a dedicated route endpoint.

For each project, the service resolves:

- a client coordinate
- one or more location/manufacturer coordinates

Then it emits one `ProjectRoute` per client-to-location pairing.

### 12.2 Coordinate resolution

Client coordinates come from:

- client coordinates directly, when available
- location fallback logic in the shell, before calling `getProjectsForMap`

Factory/location coordinates come from:

- hierarchy factory coordinates
- location coordinates
- explicit project location coordinates when available

### 12.3 Current route limits

Environment-driven route caps are enforced:

- `mapMaxLocationsPerProject`
- `mapMaxTotalRoutes`

Default values from `environment.ts`:

- `mapMaxLocationsPerProject: 20`
- `mapMaxTotalRoutes: 3000`

If routes are skipped because of missing coordinates or caps, the service logs debug information in dev mode.

### 12.4 Route styling

Current status-to-color mapping in route creation:

- `Open` -> green
- `Delayed` -> red
- otherwise -> slate/gray

Open routes are marked `animated: true`.

## 13. Realtime behavior

Realtime is implemented in two parts:

- `MapRealtimeService`
- `MapPollingService`

### 13.1 Realtime transport

`MapRealtimeService` uses SignalR and lazy-loads `@microsoft/signalr`.

Connection states:

- `disconnected`
- `connecting`
- `connected`
- `reconnecting`
- `polling`

### 13.2 Hub URL resolution

Hub URL comes from:

- `environment.mapHubUrl`, or
- `environment.apiBaseUrl + /hubs/map`, or
- `/api/hubs/map`

### 13.3 Realtime event contract

The component expects a `MapChanged` hub event, normalized to:

- `entity`
- `action`
- `id`
- `payload`
- `timestampUtc`

Supported entities:

- `Project`
- `Client`
- `Location`
- `Manufacturer`

Supported actions:

- `Created`
- `Updated`
- `Deleted`

### 13.4 Delta application

The shell component buffers bursts of realtime events and then tries to apply them as in-memory deltas:

- projects
- clients
- locations
- manufacturers

Delta maps maintained in the component:

- `projectDeltaById`
- `clientDeltaById`
- `locationDeltaById`
- `manufacturerDeltaById`

Deleted ids are tracked separately.

### 13.5 When realtime causes a route refresh vs full refresh

Current behavior:

- project/client/location delta success -> refresh routes
- manufacturer delta success -> no route refresh required immediately
- malformed or unapplied delta -> full required-data reload

### 13.6 Polling fallback

If realtime disconnects and stays disconnected past the grace window:

- polling starts
- UI state becomes `polling`

Config:

- `mapPollingIntervalMs`
- `mapDisconnectGraceMs`

Default values:

- `15000`
- `10000`

Polling fallback refreshes only project-backed streams, not the entire required-data stack, unless a hard refresh path is triggered.

## 14. Map rendering behavior

The map renderer is `FluorescenceMapMapComponent`.

### 14.1 Map engine

It uses:

- `maplibre-gl`

Base style URLs:

- light: Carto Positron GL
- dark: Carto Dark Matter GL

The environment may override these with `mapStyles`.

### 14.2 Overlay architecture

The base map is MapLibre.

Routes, markers, and labels are built in Angular as overlay view models using:

- `FluorescenceMapMapOverlayService`

The overlay service:

- resolves visible marker coordinates
- projects coordinates to pixel positions
- generates route paths
- groups parallel routes between the same endpoints
- keeps route endpoints locked to marker centers

### 14.3 Marker behavior

Markers are built into `MarkerVm` records with:

- display name
- short name
- sub label
- logo path
- selected/hover state
- status color
- project status color
- level-of-detail class
- pin scale
- anchor geometry

### 14.4 Level-of-detail behavior

The renderer changes marker detail based on zoom thresholds:

- logo-only at low zoom
- compact at mid zoom
- full detail at high zoom

Selected markers force higher detail.

### 14.5 Route rendering behavior

Routes are built as SVG path overlays with:

- stroke width
- optional dash array
- highlighted state
- route id
- project id
- status-derived color

Parallel routes between the same endpoints get pixel offsets so they do not fully overlap.

### 14.6 Tooltip behavior

The tooltip component renders entity metadata and uses the assets service to resolve:

- display name
- description
- hierarchy label
- status label
- candidate logo paths

### 14.7 Fullscreen behavior

The renderer supports two fullscreen patterns:

- browser fullscreen
- host-managed dashboard overlay fullscreen

This matters because the same feature is embedded in dashboards and also used standalone.

## 15. Selection, hover, and panel workflows

The feature has separate concepts for:

- selected entity
- hovered entity
- selected project
- selected route

### 15.1 Entity selection

Entity selection is normalized to `FleetSelection`.

Selection can come from:

- clicking a map marker
- clicking table rows
- workflow-driven actions

### 15.2 PanelActions workflow

`PanelActionsWorkflowService` centralizes selection rules.

Important current rule:

- if a subsidiary is selected while in project or client view, the workflow switches to manufacturer view and scopes the subsidiary filter

### 15.3 Hover synchronization

The map and table synchronize highlight behavior through:

- `WarRoomService.setHoveredEntity()`

### 15.4 Zoom and fit behavior

The component intentionally avoids aggressive re-fitting.

Current fit logic includes:

- fit to client routes when a client selection changes
- fit to filtered nodes when active filters yield a small result set
- avoid repeated fit calls for the same client or same filtered node set

## 16. View modes

### 16.1 Project view

Project view is the main route-rendering mode.

Behavior:

- routes are visible
- clients and manufacturers/sites are shown as endpoint nodes
- filters are applied to route generation and strict selector output

### 16.2 Client view

Client view:

- hides project routes in the main selector/render path
- focuses on client nodes
- is blocked for restricted roles

### 16.3 Manufacturer view

Manufacturer view:

- hides project routes in the main displayed output
- keeps manufacturer hierarchy visible
- ignores status filtering for hierarchy visibility in ways explicitly covered by tests
- is used when drilling into manufacturers/subsidiaries

### 16.4 Parent/factory legacy behavior

The domain service still supports:

- `parent`
- `factory`

These modes remain part of state normalization and some internal transitions even though the current visible shell tabs emphasize project/client/manufacturer.

## 17. Data-management table

The lower panel is implemented by:

- `components/fleet-activity-table/fleet-activity-table.component.ts`

It is more than an activity log. It is an admin/editor surface with tabs for:

- projects
- clients
- manufacturers
- locations

### 17.1 Inputs and outputs

The table receives:

- projected project rows
- client rows
- manufacturer rows
- location rows
- edit permission
- current selected project
- layout mode

It emits:

- row selection
- hover state
- save requests
- create requests
- view actions
- clear-filter requests

### 17.2 Draft handling

The table owns drawer-level draft UI state for:

- project edits
- client edits
- manufacturer edits
- location edits

The parent component performs the actual persistence.

### 17.3 Activity-log projection service

`ActivityLogTableService` converts project/client/manufacturer/location view models into `ActivityLogRow` records.

It handles:

- filtering
- search
- manufacturer resolution by location id
- multiple-manufacturer detection
- CSV export formatting
- row sorting by newest update

## 18. Create and update workflows

### 18.1 Mutation service

`DataManagementMutationService` is the main save orchestration service for the table.

It supports:

- project row saves
- client entity saves
- manufacturer entity saves
- location entity saves

It deliberately writes strict API fields, not loose UI-only fields.

### 18.2 Project workflow

`ProjectWorkflowService` handles:

- project creation
- factory update persistence
- subsidiary/manufacturer update persistence
- batch mutation flows

Notable behavior:

- resolves project type ids by name
- uses location ids for project creation
- refreshes hierarchy after successful edits
- triggers post-create map fit
- triggers delayed route capture after project creation

### 18.3 Local optimistic overlay after saves

The component merges mutation results back into signal state using delta maps so the UI reflects changes before the next full backend refresh fully settles.

## 19. Capture and route preview system

The feature supports screenshot capture of:

- a single project route
- all routes for a selected client

### 19.1 Workflow service

`CaptureWorkflowService` handles:

- waiting for routes to exist
- turning on screenshot mode
- invoking map capture methods
- converting blobs to data URLs
- retry behavior when capture cannot proceed

### 19.2 Storage

`RoutePreviewStorageService` stores previews:

- in memory
- and in `localStorage` when small enough

Storage prefix:

- `route-preview-`

It also triggers downloads of generated PNG previews.

### 19.3 Screenshot mode

The shell uses `screenshotMode` to hide unnecessary UI and capture cleaner route images.

## 20. Role restrictions and host behavior

The feature changes behavior based on the signed-in user role.

Restricted roles:

- `client`
- `user`

Current restrictions include:

- client view hidden or blocked
- add/edit permissions reduced
- map pinned to the current client id
- panel behavior adjusted to client context

Host pages can also control the feature through `externalProjectId`.

Current behavior:

- `undefined` means uncontrolled
- `null` clears host-driven project filtering
- any other id forces project filter synchronization into both draft and applied state

## 21. Loading, error, and empty states

### 21.1 Required data loading overlay

The shell shows a blocking loading state while required endpoint data is loading and no required endpoint has failed yet.

### 21.2 Endpoint error summary

The component tracks per-endpoint errors and produces a human-readable list of affected endpoints.

### 21.3 Map runtime errors

The renderer separately tracks map engine failures, including:

- load errors
- runtime warnings
- unrecoverable error detection
- retry behavior
- dismissible overlays for some error states

### 21.4 Empty map state

When filters are active but nothing renderable remains, the feature shows a map empty-state overlay instead of silently rendering a blank map.

## 22. Configuration and environment flags

The main environment entries relevant to this feature are in:

- `src/environments/environment.ts`
- `src/environments/environment.prod.template.ts`

Relevant keys:

- `apiBaseUrl`
- `mapHubUrl`
- `mapRealtimeEnabled`
- `mapPollingIntervalMs`
- `mapDisconnectGraceMs`
- `mapMaxLocationsPerProject`
- `mapMaxTotalRoutes`
- `allowedLogoOrigins`
- `logoPayloadMode`

Current development defaults:

- realtime disabled
- polling interval `15000`
- disconnect grace `10000`
- project location cap `20`
- total route cap `3000`

## 23. Accessibility and UX support

The code includes explicit UX and accessibility support such as:

- screen reader announcement messages
- role-based button labels and pressed state
- focus restoration after modal interactions
- empty-state messaging
- onboarding hints
- visible marker stability status for automated verification

There is also dedicated UI test coverage for:

- responsive behavior
- focus restore
- keyboard/screen-reader attributes
- restricted-role control visibility

## 24. Test coverage in the repository

This feature has unusually broad test coverage compared to a typical map widget.

### 24.1 Main spec groups

- `fluorescence-map.component.spec.ts`
- `fluorescence-map.integration.spec.ts`
- `fluorescence-map.ui.spec.ts`
- `state/fluorescence-map.selectors.spec.ts`
- `components/fleet-activity-table/fleet-activity-table.component.spec.ts`
- `components/fluorescence-map-map/fluorescence-map-map.logic.spec.ts`
- marker, route, math, and assets service specs
- realtime service specs
- polling service specs
- workflow specs
- mutation service specs

### 24.2 What is explicitly tested

Examples already covered by tests:

- route visibility by view mode
- filter application and draft/apply separation
- empty-state behavior
- manufacturer matching rules
- realtime burst coalescing
- polling fallback start/stop behavior
- strict selector endpoint matching with `loc-` normalization
- route coloring by status
- marker pixel coordinate caching
- data-management save flows
- responsive and accessibility behavior
- marker level-of-detail rendering
- map error handling

There is also a feature-local testing notes file:

- `src/app/shared/features/fluorescence-map/TESTING.md`

## 25. Known implementation characteristics and constraints

These are important for future work on the feature.

### 25.1 Projects are the route truth

The map does not read prebuilt route records from the backend. Routes are synthesized from projects plus resolved client and location coordinates.

### 25.2 ID normalization is a major concern

The feature actively normalizes ids because different sources use:

- raw numeric ids
- string ids
- `loc-<id>` ids
- `source-<id>` ids

Selector logic, overlay logic, and table logic all contain normalization helpers for this reason.

### 25.3 Hierarchy and map nodes are not the same thing

Hierarchy is owned by `WarRoomService`, but renderable client nodes are injected later by selector logic when route or client data demands it.

### 25.4 Realtime is best-effort delta first

The system tries to apply small deltas first and only falls back to full reload when necessary.

### 25.5 There is still legacy naming in the code

The code still uses older names such as:

- war room
- factory
- subsidiary

But the live product language and visible UI are centered around FleetPulse, manufacturers, clients, projects, and locations.

## 26. Practical mental model for maintaining the feature

If you need to reason about the feature quickly, the safest mental model is:

1. `ClientService`, `LocationService`, and `ProjectService` load normalized backend data.
2. `ProjectService` builds project routes and manufacturer hierarchy.
3. `WarRoomService` holds hierarchy, selection, and derived base nodes.
4. `FluorescenceMapComponent` merges required data, filters, role rules, persistence, route streams, and realtime deltas.
5. Strict selectors convert that into the exact marker/route set to render.
6. `FluorescenceMapMapComponent` projects those entities into MapLibre + Angular overlays.
7. The table and workflow services handle editing, creation, and capture behavior around the same dataset.

## 27. Most important source files to read first

If someone is new to this feature, these are the highest-value files to read in order:

1. `src/app/shared/features/fluorescence-map/fluorescence-map.component.ts`
2. `src/app/shared/features/fluorescence-map/state/fluorescence-map.selectors.ts`
3. `src/app/shared/services/project.service.ts`
4. `src/app/shared/services/fluorescence-map.service.ts`
5. `src/app/shared/features/fluorescence-map/components/fluorescence-map-map/fluorescence-map-map.component.ts`
6. `src/app/shared/features/fluorescence-map/services/data-management-mutation.service.ts`
7. `src/app/shared/features/fluorescence-map/workflows/project-workflow.service.ts`
8. `src/app/shared/features/fluorescence-map/realtime/map-realtime.service.ts`

## 28. Summary

The current map feature is a full FleetPulse operational surface, not just a map widget. It combines backend data composition, hierarchy derivation, strict filter-based route rendering, realtime delta handling, polling fallback, dashboard embedding, screenshot capture, and admin data-management workflows inside one feature boundary.

The most important implementation boundaries are:

- `ProjectService` builds the data needed for routes and hierarchy
- `WarRoomService` owns hierarchy and selection state
- `FluorescenceMapComponent` owns orchestration and UI state
- `FluorescenceMapMapComponent` owns MapLibre rendering and overlays

That is the current architecture of the map feature in this repository.
