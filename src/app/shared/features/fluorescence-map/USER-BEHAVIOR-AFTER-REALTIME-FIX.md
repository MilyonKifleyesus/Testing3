# Fluorescence Map – User Behavior After Realtime Fix

Text diagram of how the map behaves **after** the fix: realtime updates when the user interacts, **without** a full refresh on every click.

---

## 1. User clicks view buttons (Project / Client / Manufacturer)

```
USER ACTION                    SYSTEM RESPONSE
─────────────────────────────────────────────────────────────────────────────
Click "PROJECT VIEW"    →      • mapViewMode = 'project'
                              • projectRoutesForMap() recomputes (same data, filter by project)
                              • Map re-renders routes only (no API call, no full refresh)
                              • Announcement: "Switched to project view."

Click "CLIENT VIEW"     →      • mapViewMode = 'client'
                              • projectRoutesForMap() recomputes
                              • Map re-renders (no API call, no full refresh)
                              • Announcement: "Switched to client view."

Click "MANUFACTURER VIEW" →    • mapViewMode = 'manufacturer'
                              • logPanelMode = 'manufacturer'
                              • projectRoutesForMap() recomputes
                              • Map re-renders (no API call, no full refresh)
                              • Announcement: "Switched to manufacturer view."
```

**Result:** View changes instantly; no loading spinner, no refetch, no full refresh.

---

## 2. User clicks toolbar actions (Panels / Expand Map / Tactical View)

```
USER ACTION                    SYSTEM RESPONSE
─────────────────────────────────────────────────────────────────────────────
Click "PANELS"          →      • panelVisible toggles (open/close)
                              • No data reload, no route refetch
                              • Announcement: "Activity log opened." / "Panels hidden."

Click "EXPAND MAP"      →      • mapExpanded toggles OR browser fullscreen
                              • Layout/UI only; map data unchanged
                              • No refresh

Click "TACTICAL VIEW"   →      • tacticalMode toggles (toolbar hidden)
                              • Map-only view; no data reload
                              • Announcement: "Tactical view on/off."
```

**Result:** UI state only; map data and realtime connection stay as-is.

---

## 3. User interacts with the map (pan, zoom, click)

```
USER ACTION                    SYSTEM RESPONSE
─────────────────────────────────────────────────────────────────────────────
Drag / zoom / click map →     • onMapUserInteracted()
                              • Cancels any pending programmatic zoom
                              • Shows "Return to previous view" if applicable
                              • No refresh, no API call
```

**Result:** Interaction is local; realtime still pushes updates in the background.

---

## 4. Realtime updates (background, no user click)

```
REALTIME EVENT                 SYSTEM RESPONSE
─────────────────────────────────────────────────────────────────────────────
Hub sends delta (e.g.          • applyProjectDeltaEvent / applyClientDeltaEvent / etc.
Project/Client/Location        • In-memory state updated (deltas merged)
updated)                       • If routes affected: projectRoutesRefreshTrigger++
                               • Routes effect re-runs, fetches routes only (no full war-room reload)
                               • Map updates with new routes
                               • NO full refresh

Hub sends event that           • handleRealtimeMapChanged returns 'full'
cannot be applied as delta     • retryRequiredDataLoad() (full refresh – rare)
```

**Result:** Most updates are deltas → no full refresh; only when delta apply fails does a full reload happen.

---

## 5. When a full refresh still happens (intentional, not on every click)

```
TRIGGER                        SYSTEM RESPONSE
─────────────────────────────────────────────────────────────────────────────
Realtime event cannot          retryRequiredDataLoad() → refreshProjects() + route refetch
be applied as delta

Polling tick (after            retryRequiredDataLoad() (when not already loading)
realtime disconnect)

User saves in Activity Log     onClientPanelSaveComplete() → retryRequiredDataLoad()
panel

Workflow after project         refreshWarRoomFromApi() / retryRequiredDataLoad()
mutation
```

**Result:** Full refresh only in these cases; **not** on view toggle, Panels, Expand, Tactical, or map pan/zoom.

---

## Summary flow (after fix)

```
                    ┌─────────────────────────────────────┐
                    │  User on Fluorescence Map (e.g.     │
                    │  dashboard embed)                   │
                    └─────────────────┬───────────────────┘
                                      │
         ┌────────────────────────────┼────────────────────────────┐
         │                            │                            │
         ▼                            ▼                            ▼
  Click view buttons           Click Panels /              Pan / zoom / click
  (Project/Client/            Expand / Tactical           map
  Manufacturer)               View
         │                            │                            │
         ▼                            ▼                            ▼
  • Change mapViewMode          • Toggle UI state           • Cancel pending zoom
  • Recompute                   • No data reload            • Show "Return to view"
    projectRoutesForMap         • No refresh                  if needed
  • Re-render routes only                                     • No refresh
  • NO API call
  • NO full refresh
         │                            │                            │
         └────────────────────────────┴────────────────────────────┘
                                      │
                                      │  Realtime (background)
                                      ▼
                    ┌─────────────────────────────────────┐
                    │  Deltas applied → routes/state       │
                    │  updated; full refresh only when     │
                    │  delta apply fails or save/polling   │
                    └─────────────────────────────────────┘
```

---

## In one sentence

**After the fix:** View toggles and toolbar clicks only change UI or filter over existing data; the map stays realtime via deltas and does **not** do a full refresh every time the user interacts or clicks those buttons.
