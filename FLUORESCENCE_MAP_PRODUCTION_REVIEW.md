# Fluorescence Map – Senior Angular Production Review

**Scope:** Fluorescence Map feature (recent files)  
**Mode:** Blocker / High-impact findings only  
**Date:** 2025-02-16

---

## 1. Architecture & Angular Best Practices

| Finding | Severity | Risk | Improvement |
|---------|----------|------|-------------|
| **Monolithic map component (~1594 lines)** – Single component handles map init, overlay sync, geocoding, route building, marker building, tooltip positioning, screenshot capture. | **High** | Hard to maintain, test, and extend; high cognitive load; difficult to isolate failures. | Extract focused services: `MapInitializationService`, `OverlaySyncService`, `GeocodingService`, `RouteBuilderService`. Move route/marker building logic into services; keep component as orchestrator. |
| **Direct DOM manipulation in effect** – Effect at L181–191 uses `document.querySelector` and `setAttribute`/`removeAttribute` on `.war-room-map-container`. | **Medium** | Breaks SSR, harder to test, timing issues if DOM not ready. | Use `@ViewChild` + `ElementRef` and `Renderer2`, or bind via template `[attr.data-has-selection]`. |
| **Smart/dumb separation** – Map component is smart; `WarRoomMapRoutesComponent` and `WarRoomMapMarkersComponent` are presentational with inputs/outputs. | **Low** | Good separation for routes/markers. | No change needed. |
| **Standalone components** – Routes component is standalone; map component uses `imports` array. | **Low** | Aligns with modern Angular. | No change needed. |
| **Dependency injection** – Uses `inject()` for services. | **Low** | Correct usage. | No change needed. |

---

## 2. State Management & Reactivity

| Finding | Severity | Risk | Improvement |
|---------|----------|------|-------------|
| **Multiple effects trigger overlay updates** – Effects at L193–199, L201–215, L217–229 all call `scheduleOverlayUpdate()`. | **High** | Redundant work, possible race conditions, extra change detection. | Consolidate into one effect that watches all relevant signals (nodes, selected, hovered, routes, projectRoutes, filterStatus, theme). |
| **`toSignal` with `initialValue`** – `appState` uses `toSignal` with a full initial object. | **Low** | Avoids undefined; acceptable. | No change needed. |
| **No manual RxJS subscriptions in map component** – Uses signals and effects. | **Low** | No subscription leaks in map component. | No change needed. |

---

## 3. Performance Review

| Finding | Severity | Risk | Improvement |
|---------|----------|------|-------------|
| **`syncOverlays()` invoked on every move/zoom/moveend/idle** – Map events (L673–693) each call `scheduleOverlayUpdate()`. RAF coalesces per frame but rapid pan/zoom still triggers heavy work every frame. | **Critical** | UI jank, battery drain, poor UX with many nodes/routes. | Throttle overlay updates (e.g. max once per 100ms) or use `requestIdleCallback` when available. Consider skipping updates during active drag. |
| **`buildRouteFeatures()` O(n²) complexity** – `findMatches()` (L1378–1411) filters nodes for each route; nested loops over routes × nodes. | **High** | Performance degrades with many routes/nodes. | Pre-index nodes by ID/type in `Map<string, WarRoomNode[]>`; use O(1) lookups instead of repeated `filter()`. |
| **`buildMarkerVm()` runs for every node on every overlay update** – Heavy string work, logo resolution, LOD calculations per node. | **High** | Bottleneck with many markers. | Memoize marker VMs by `node.id + zoom + selectedId + hoveredId`; rebuild only when inputs change. |
| **Large lists use trackBy** – Markers use `track m.id`, routes use `track route.id`. | **Low** | Good practice. | No change needed. |

---

## 4. Edge Cases & Error Handling

| Finding | Severity | Risk | Improvement |
|---------|----------|------|-------------|
| **Geocoding: no rate limiting, silent failures** – `ensureNodeCoordinates` fires `Promise.all` for all nodes needing geocode; errors are caught and ignored (L395–396). | **High** | API rate limits, poor UX when geocoding fails, no user feedback. | Add rate limiting (e.g. max 10 concurrent), retry with backoff, surface failures via toast or inline message. |
| **Geocoding: API response validation** – Assumes `data.results?.[0]` shape; no validation of lat/lng range. | **Medium** | Invalid coordinates could cause map errors. | Validate lat/lng ranges; handle malformed responses. |
| **Loading and error states** – `mapLoading`, `mapLoadError`, `mapErrorDismissed`, `mapErrorUnrecoverable` are handled. | **Low** | Good coverage. | No change needed. |
| **`waitForMapIdle()` timeout not cleaned up on destroy** – If component is destroyed during screenshot capture, timer and `idle` listener may persist. | **Medium** | Minor memory leak in edge case. | Store timer reference; clear in `ngOnDestroy` or use AbortController-style cancellation. |

---

## 5. Memory Leaks & Lifecycle

| Finding | Severity | Risk | Improvement |
|---------|----------|------|-------------|
| **Unbounded caches** – `geocodeCache` and `logoFailureCache` (L121–123) grow without limit. | **Critical** | Memory growth over long sessions, especially with many nodes. | Implement LRU cache with max size (e.g. 1000) or clear caches in `ngOnDestroy`. |
| **Map event listeners not explicitly removed** – `error`, `load`, `move`, `zoom`, `moveend`, `idle` (L647–693) are registered; `mapInstance.remove()` in `ngOnDestroy` destroys the map. MapLibre’s `remove()` typically cleans up, but explicit removal is safer. | **Medium** | Defensive: ensures no lingering references if library behavior changes. | Store listener refs and call `mapInstance.off()` for each before `remove()` in `ngOnDestroy`. |
| **ResizeObserver and fullscreen handler** – Both are correctly disconnected/removed in `ngOnDestroy`. | **Low** | No leak. | No change needed. |
| **RAF and timeouts** – `overlayUpdateRaf`, `selectionZoomTimeoutId`, `zoomStableTimeoutId` are cleared in `ngOnDestroy`. | **Low** | No leak. | No change needed. |

---

## 6. Security Review (Frontend)

| Finding | Severity | Risk | Improvement |
|---------|----------|------|-------------|
| **Hardcoded CDN URL in CSS** – `fluorescence-map-map.component.scss` L149: `url('https://a.basemaps.cartocdn.com/dark_all/0/0/0.png')`. | **High** | Single point of failure; if CDN is down or blocked, error overlay degrades. | Move URL to environment config; add fallback `background-color` so overlay remains usable. |
| **External font imports** – `fluorescence-map.component.scss` L1–4: four `@import url('https://fonts.googleapis.com/...')`. | **Medium** | Font loading failures (network, ad blockers) cause layout shifts and missing fonts. | Host fonts locally or use CDN with fallbacks; use `font-display: swap`; preload critical fonts in `index.html`. |
| **API endpoints in environment** – `apiBaseUrl`, `geocodeApiUrl`, `mapStyles` are in environment files. | **Low** | Correct pattern; ensure prod uses `environment.prod.ts`. | Verify `fileReplacements` in `angular.json` for production builds. |
| **Firebase placeholders** – `environment.ts` uses asterisks for Firebase config. | **High** | If not replaced at build time, Firebase init fails. | Ensure real credentials are injected; add runtime validation to fail fast with a clear error. |
| **No XSS vectors found** – No `innerHTML` or unsafe bindings in reviewed templates. | **Low** | Good. | No change needed. |

---

## 7. Debug & Production Readiness

| Finding | Severity | Risk | Improvement |
|---------|----------|------|-------------|
| **Console statements in feature** – `fluorescence-map.component.ts`: `console.warn` (L809, L1622), `console.error` (L1114, L1474, L1497, L1950); `fluorescence-map-clients-panel.component.ts`: `console.warn` (L88). | **Medium** | Performance impact, possible information leakage in production. | Wrap in `if (!environment.production)` or use a logging service with levels; route errors to monitoring (e.g. Sentry). |

---

## 8. Scalability Concerns

| Finding | Severity | Risk | Improvement |
|---------|----------|------|-------------|
| **O(n²) route matching** – `findMatches` + nested loops in `buildRouteFeatures`. | **High** | Will not scale with 10x more routes/nodes. | Pre-index nodes; use `Map` for O(1) lookups. |
| **No virtualization for markers** – All markers rendered; no viewport culling. | **Medium** | With hundreds of markers, DOM and paint cost increase. | Consider viewport culling: only render markers in view; use `ng-container` + spatial index if needed. |
| **Geocoding concurrency** – `Promise.all` over all nodes needing geocode can overwhelm API. | **High** | Rate limits, timeouts, poor UX. | Limit concurrent requests; batch or queue geocode calls. |

---

## 9. Forms & Validation

| Finding | Severity | Risk | Improvement |
|---------|----------|------|-------------|
| **No forms in map component** – Map is view-only; forms live in parent/panels. | **N/A** | — | — |

---

## 10. Angular-Specific Deep Checks

| Finding | Severity | Risk | Improvement |
|---------|----------|------|-------------|
| **Inputs/Outputs** – Uses `input()` and `output()`; correct usage. | **Low** | Good. | No change needed. |
| **ViewChild** – `mapContainerRef` with `static: false`; used after view init. | **Low** | Correct. | No change needed. |
| **No ChangeDetectionStrategy.OnPush** – Map component uses default strategy. | **Medium** | More change detection runs than necessary with signals. | Consider `OnPush`; signals already reduce unnecessary updates, but OnPush would further limit CD. |
| **`initMap()` retry logic** – Retries up to 10 times when container has no dimensions. | **Low** | Logic is sound; ensure retry count is checked before scheduling. | Minor: add max total retry time to avoid indefinite retries in edge cases. |

---

## Summary Table

| Severity | Count |
|----------|-------|
| Critical | 2 |
| High | 9 |
| Medium | 6 |
| Low | 10 |

---

## Final Output

### Overall Code Quality Score: **6/10**

The Fluorescence Map feature is functionally solid and uses modern Angular patterns (signals, standalone components, inject). The main gaps are performance and scalability under load, unbounded caches, and some production-hardening items (external URLs, console logs, geocoding robustness).

### Production Ready? **Needs Work**

Blockers and high-impact issues should be addressed before production, especially:

1. Unbounded caches (memory growth)
2. Overlay sync performance (throttling)
3. Geocoding rate limiting and error handling

### Top 3 Most Important Fixes

1. **Unbounded caches** – Add LRU or size limit to `geocodeCache` and `logoFailureCache`, or clear them in `ngOnDestroy`. Prevents memory growth over long sessions.

2. **Throttle overlay sync** – Throttle or debounce `scheduleOverlayUpdate` (e.g. max once per 100ms) so pan/zoom does not trigger heavy recomputation every frame. Prevents UI jank and battery drain.

3. **Geocoding robustness** – Add rate limiting (e.g. max 10 concurrent), retries with backoff, and user-visible error handling. Prevents API rate limits and silent failures.

---

*Review completed per plan: blocker/high-impact findings only.*
