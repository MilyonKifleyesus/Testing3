# Fluorescence Map — Unit Test Strategy (maintainable + high coverage)

## 1) Prioritize fast, pure logic first
- Start with pure functions/services: `workflows/`, `state/` selectors, `components/.../services/` (math/assets).
- Why first: deterministic + minimal DOM/mocks → failures are clearer before UI/MapLibre complexity.

## 2) Organize tests for long-term maintainability
- Naming: `*.spec.ts` next to source; add `testing/` helpers only when reused by 2+ specs.
- Structure: `describe(feature) → describe(scenario) → it(behavior)`; keep AAA (Arrange/Act/Assert) per test.

## 3) Math + projection (FluorescenceMapMathService)
- Happy: `parseViewBox` valid strings, `getZoomFactor` clamps, `createCurvedPath` formats correctly.
- Edge/invalid: empty/garbage viewBox, extreme zoom, very small numbers (no `e/E` in SVG path output).

## 4) Assets + tooltip text (WarRoomMapAssetsService)
- Happy: display name/description, status class mapping, logo path resolution (absolute/relative/baseUrl).
- Edge/invalid: missing fields, “null/undefined/string” logo tokens, alias mapping + failure fallbacks.

## 5) Timer-driven capture workflow (waitForRouteThenCapture)
- Happy: capture triggers when route coords become valid and loading is false (after delay/polls).
- Edge/invalid: max-attempt exhaustion, cancellation stops timers, rejected capture surfaces via `onCaptureError`.

## 6) Panel workflows (selection + batch mutation)
- Happy: `applySelectionFromActivityLog` switches to manufacturer view only for subsidiary selections (project/client views).
- Edge/error: `runBatchMutationWorkflow` counts successes/failures and refreshes only when any success occurred.

## 7) Selector coverage (state/fluorescence-map.selectors.ts)
- Happy: expected filtered collections (routes/nodes) given view mode + filters.
- Edge/invalid: empty state, unknown statuses, missing IDs → selectors return safe defaults (no throws).

## 8) Container component logic (FluorescenceMapComponent)
- Happy: view switches, filter sync, selection propagation, debounced refresh ticks, teardown disconnects.
- Edge/error: empty API responses, inconsistent project-route data, forbidden view modes for restricted roles.

## 9) Map interactions (FluorescenceMapMapComponent + markers/routes)
- Happy: hover/click emits correct selection, route rendering highlights selected endpoints, zoom signals are handled.
- Edge/error: missing coords, map not loaded, rapid hover changes → no console errors + stable UI state.

## 10) UI state matrix (DOM-level assertions)
- Loading/success/empty/error: verify the right panels/controls render, and disabled states prevent actions.
- Accessibility: aria labels/roles, focus restore on ESC, keyboard activation for primary controls.

## 11) Mocking strategy (keep mocks small + typed)
- API/HTTP: `provideHttpClientTesting()` + `HttpTestingController`; flush only the requests a test owns.
- 3rd-party libs: stub MapLibre `Map`/`Marker`, `ToastrService`, screenshot/canvas helpers; prefer spies over full fakes.

## 12) TestSprite integration + “Definition of Done”
- Add/keep stable selectors (`data-testid`) for automation (e.g. `marker-stability-status` after zoom idle/stable).
- Run unit tests headless: `npm test -- --watch=false --browsers=ChromeHeadless`; then run TestSprite flows against `ng serve`.
- DoD: all tests pass locally + CI, no flaky timers, new logic has happy/edge/error tests, and coverage doesn’t regress.
