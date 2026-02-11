# War Room Map – Marker & Logo Zoom Stability (TestSprite)

## Purpose

This document defines test scenarios for **TestSprite** to verify that map markers and their logos **stay at the same geographic location** when the user zooms in and out. Previously, markers/logos could drift relative to the map; the fix (overlay inside map container, viewBox, stable coordinates) keeps them fixed.

---

## Scope

- **Component**: War Room Map (`app-war-room-map`, `app-war-room-map-markers`)
- **Feature**: Marker and logo position stability on zoom
- **Type**: Frontend / E2E
- **Entry point**: Dashboard with War Room (e.g. `/dashboard` with War Room map visible)

---

## Prerequisites

- Application running: `npm start` or `ng serve` (default port **4200**)
- War Room map visible (Dashboard → War Room or direct route to War Room)
- Map loaded with at least one company marker (with logo or initials)

---

## Test Cases for Marker/Logo Zoom

### TC-MZ-001 (TC001): Marker and logo stay fixed when zooming in

**Objective**: After zooming in, each marker (circle) and its logo/initials remain on the same geographic point; no visible drift.

**Steps**:

1. Open the app and navigate to the page that shows the War Room map (e.g. Dashboard).
2. Wait for the map to load and for markers to appear.
3. Identify a visible marker (with logo or initials) and note its position on the map (e.g. over a city/country).
4. Use the map **zoom-in** control (or zoom in via UI) 3–5 times.
5. Observe the same marker and its logo/initials.

**Expected**:

- The marker (circle) and the logo/initials inside it stay **on the same geographic location** (e.g. same city/country) at all zoom levels.
- No visible separation between the marker circle and the logo, and no drift of the marker away from the map feature it represents.

**Pass criteria**: Marker and logo remain visually aligned and geographically fixed after zoom in.

---

### TC-MZ-002 (TC002): Marker and logo stay fixed when zooming out

**Objective**: After zooming out, each marker and its logo remain on the same geographic point; no visible drift.

**Steps**:

1. Open the app and navigate to the War Room map.
2. Wait for the map and markers to load.
3. Optionally zoom in once or twice so the map is not at minimum zoom.
4. Identify a visible marker and its logo/initials.
5. Use the map **zoom-out** control (or zoom out via UI) 3–5 times.
6. Observe the same marker and logo.

**Expected**:

- The marker and logo stay on the **same geographic location** at all zoom levels.
- No visible drift or separation between marker and logo.

**Pass criteria**: Marker and logo remain geographically fixed after zoom out.

---

### TC-MZ-003 (TC003): Marker and logo stay fixed when zooming in then out

**Objective**: After a zoom-in then zoom-out cycle, markers and logos return to the same geographic positions with no cumulative drift.

**Steps**:

1. Open the app and navigate to the War Room map.
2. Wait for the map and markers to load.
3. Note the position of one or more markers (and their logos) on the map.
4. Zoom **in** 4–5 times.
5. Observe marker and logo positions (should still be on the same geographic point).
6. Zoom **out** 4–5 times (back to roughly the initial zoom).
7. Compare marker and logo positions to step 3.

**Expected**:

- After zoom in: marker and logo remain on the same geographic location.
- After zoom out: marker and logo return to the same geographic location as in step 3, with no visible cumulative drift.

**Pass criteria**: No drift after a full zoom-in then zoom-out cycle.

---

### TC-MZ-004 (TC004): Multiple markers all stay fixed on zoom

**Objective**: All visible markers (and their logos) stay geographically fixed when zooming; no single marker drifts.

**Steps**:

1. Open the app and navigate to the War Room map.
2. Wait for the map to load; ensure multiple markers are visible (e.g. different regions).
3. Zoom in 3 times, then zoom out 3 times.
4. Observe all visible markers and their logos.

**Expected**:

- Every marker and its logo remain on their respective geographic locations.
- No marker “slides” or drifts relative to the map or relative to its logo.

**Pass criteria**: All markers and logos stay fixed; no drift on any marker.

---

## Technical Notes (for TestSprite / automation)

- **Map container**: The markers overlay is inside `#war-room-map` so that (0,0) matches MapLibre’s `project()` coordinate system.
- **Selectors**: Markers are under `app-war-room-map-markers` (e.g. `.marker-group`, `.marker-logo`, `.marker-dot-core`, `.marker-dot-ring`). Zoom controls are in `app-war-room-map-controls`.
- **Zoom**: Trigger zoom via the on-map zoom controls (“+” / “−” buttons); avoid relying on mouse wheel if the test environment does not support it reliably.
- **Stability**: Position and scale are formatted (`toFixed(6)` for position, `toFixed(4)` for scale) so coordinate systems and transforms remain stable across zoom levels.

---

## TestSprite Test IDs

Use these test IDs when running TestSprite for this issue:

- **TC001** – Marker and logo fixed after zoom in
- **TC002** – Marker and logo fixed after zoom out
- **TC003** – Marker and logo fixed after zoom-in then zoom-out cycle
- **TC004** – Multiple markers and logos all stay fixed on zoom

---

## Reference

- **Related docs**: `docs/apps/fluorescence-map-testing-instructions.md` (general War Room tests)
- **Implementation**: `src/app/shared/features/apps/fluorescence-map/components/apps/fluorescence-map-map/` (map component, markers component, overlay inside `#war-room-map`, viewBox from container size)
