# BusPulse Map Feature Documentation

## Read-Only Functional Scope

This document explains the BusPulse map feature from a product and user-behavior perspective only.

It is intentionally limited to read-only behavior.

It does not cover:

- Creating records
- Editing records
- Deleting records
- Developer implementation details
- Source code structure

The goal of this document is to clearly explain what the map feature does, how it behaves, what information it shows, and where its boundaries are.

## 1. What the Map Feature Is

The map feature is a fleet-visibility workspace for understanding relationships between:

- Projects
- Clients
- Manufacturers
- Locations

It is not just a static map.

It is a combined operational view that includes:

- A live interactive map
- Project, client, and manufacturer perspectives
- Filter controls
- Route visualization
- A supporting data panel
- Realtime status awareness
- Loading, empty, warning, and error states

In practical terms, the feature helps a user answer questions like:

- Which projects are active?
- Which client is linked to which manufacturer location?
- Where are the related locations on the map?
- Which filtered results are currently visible?
- Is the view live, reconnecting, or in fallback mode?

## 2. Where the Feature Appears

The same map feature can appear in more than one product context.

### Full map page

In its main form, the feature appears as a complete operational screen with:

- Header controls
- Mode tabs
- Summary metrics
- Advanced filters
- Full map canvas
- Data panel

### Dashboard widget

The feature can also be embedded inside dashboards.

In that mode, it can be pre-filtered by a host page, such as showing only one selected project from a surrounding dashboard filter.

### Data-only view

The broader feature can also run in a table-only format without the map canvas.

That view is still part of the same feature family, but it behaves as a read-only data panel rather than a geographic workspace.

## 3. Main Business Purpose

The feature is designed to make operational relationships visible.

Its main purpose is to show:

- Which clients are connected to which project routes
- Which manufacturers and locations are linked to those projects
- Which map entities match the currently applied filters
- Whether the screen is showing fresh live data or a fallback state

The feature is especially useful for narrowing a large operational dataset down to a smaller decision set without losing geographic context.

## 4. User Access and Role Behavior

The map does not behave identically for every user.

### Admin or unrestricted users

Unrestricted users can:

- Switch between `Projects`, `Clients`, and `Manufacturers`
- Filter across multiple entities
- Open the full data panel
- Browse across the full visible dataset

### Restricted client or user accounts

Restricted accounts are intentionally narrowed.

For those users:

- The experience is pinned to their own client context
- The map will not expose the general client browsing view
- Client filtering is automatically locked to the signed-in client
- The feature avoids showing other clients outside that scope

This means the map becomes more of a client-specific tracking view than a global operations view.

## 5. High-Level Screen Structure

When shown as a full map screen, the feature is organized into these areas:

### Top header

The header contains:

- Product branding
- Connection status pill
- Main mode tabs
- Quick toolbar buttons

### Summary cards

The summary area shows:

- Total Projects
- Total Shipped
- Under Inspection

These counts are derived from the current project dataset.

### Quick actions row

This row provides:

- Filters button
- Table toggle
- Clear filters action
- At-a-glance filter chips

### Advanced filters overlay

This is the detailed filter workspace where users prepare a filter draft and then apply it.

### Map stage

This is the main canvas where nodes, routes, tooltips, zoom controls, loading states, and warnings appear.

### Data panel

This is the supporting panel used to browse projects, clients, manufacturers, and locations in table form.

## 6. Main View Modes

The feature exposes three main user-facing map modes.

Each mode answers a different business question.

### 6.1 Project mode

Project mode is the most route-driven mode.

It is used when the user wants to understand:

- Which clients connect to which manufacturer locations
- Which project routes are active or inactive
- How filters affect operational connections

In this mode:

- Project routes are drawn on the map
- Clients and manufacturer-side nodes can both appear
- Selecting a project can focus the map on its related location or client

This is the most visually connected mode because it shows relationship lines, not just points.

### 6.2 Client mode

Client mode is the client-centric perspective.

It is used when the user wants to understand:

- Which clients exist in the visible result set
- Which client markers match the current filtering context

In this mode:

- Only client-side map nodes are intended to be shown
- Project route lines are not rendered
- Manufacturer-side relationship lines are hidden

This is a simplified point-based view rather than a connection-line view.

### 6.3 Manufacturer mode

Manufacturer mode is used to understand:

- Which manufacturers or manufacturer locations are relevant
- Which sites remain visible after applying project-related filters

In this mode:

- Manufacturer-side nodes are shown
- Project route lines are not rendered
- The map becomes a manufacturer/location visibility view

Important logic:

- Client, project, project type, and status filters can still narrow the visible manufacturer set
- The user sees the manufacturer results of those filters, not the route lines themselves

## 7. What the Map Actually Displays

The map visualizes several different object types.

## 7.1 Nodes

Nodes are the main map markers.

Depending on mode and data availability, a node may represent:

- A client
- A manufacturer location
- A higher-level operational point

Node appearance adapts to context:

- It can show a company logo when available
- It falls back to initials when a logo is unavailable
- It changes visual detail based on zoom level
- It can show labels above the marker at higher zoom levels

### Marker meaning

Markers communicate multiple states:

- Selection state
- Hover state
- Pinned state
- Operational status styling

Selected and hovered markers are visually emphasized.

### Zoom-based detail behavior

Markers do not remain visually identical at every zoom level.

The feature reduces visual clutter by simplifying markers when zoomed out and showing richer labels and details when zoomed in.

This means the user sees:

- Simpler visual identities from far away
- More readable names and sublabels when closer in

## 7.2 Project routes

Project routes are the visual lines connecting one side of a project relationship to the other.

They represent the link between:

- A client-side endpoint
- A manufacturer/location-side endpoint

Project routes are only rendered in project mode.

### Route behavior

Routes can:

- Be animated
- Be highlighted
- Be clicked
- Reflect status through styling

Open routes are treated as active.

Inactive or delayed routes are styled differently so the user can distinguish active movement from non-active relationships.

### Route selection

When a route is selected:

- The route becomes the current focus
- Its related project can become the selected project
- The map and supporting panel can react to that selection

## 7.3 Optional transit-style connections

The feature also supports additional non-project connector lines when they exist in the data.

These behave like supporting network overlays rather than the main project-route layer.

They are secondary to the project routes and are not the primary business focus of the screen.

## 8. Tooltip Behavior

Tooltips give the user quick context without leaving the map.

A tooltip can appear when the user:

- Hovers a marker
- Pins a marker through selection

The tooltip can show:

- Company or entity name
- Operational type
- Status
- Location text
- Description
- Full address, when available
- Notes, when available

This makes the map useful for inspection without requiring immediate table navigation.

## 9. Selection Behavior

Selection is central to how the feature works.

The map is not only for viewing. It is also for narrowing attention.

### Marker selection

Clicking a marker can:

- Select the related entity
- Focus supporting content around that entity
- Open or keep the data panel visible
- Trigger a map zoom to the selected entity

Clicking the same marker again can clear that selection.

### Route selection

Clicking a route can:

- Select that route
- Associate the current focus with its project

### Table-to-map selection

The data panel is tightly linked with the map.

Using `View` from the panel can cause the map to:

- Switch to the appropriate view mode
- Select the related entity
- Zoom directly to it

### Hover synchronization

In the projects table, row hover can influence the map by highlighting the related entity context.

This gives the user a lightweight preview before committing to a full selection.

## 10. Automatic Map Movement Logic

The map does not only move when the user manually pans or zooms.

It also has programmatic movement rules.

### Auto-zoom to selected entity

When the user selects a relevant entity, the map can automatically zoom to it.

This is used for:

- Project selection
- Client selection
- Manufacturer selection
- Location selection

### Fit to selected client routes

When a client is selected and matching routes exist, the map can fit its bounds to that client's related routes.

This helps the user immediately see the full project spread for that client.

### Fit to small filtered result sets

When filters reduce the visible set to a manageable number of results, the map can auto-fit to those visible nodes.

This prevents the user from applying filters and then being left looking at the wrong part of the world.

### Return to previous view

After an automatic zoom or pan, the feature can temporarily show a `Return to previous view` control.

This lets the user go back to the earlier camera position without manually reconstructing it.

### User interaction has priority

If the user starts manually moving the map while a delayed automatic zoom is pending, the user's action wins.

This prevents the map from feeling like it is fighting the user.

## 11. Filters

Filtering is one of the core strengths of the feature.

The filter system supports both quick filtering and deliberate filtering.

## 11.1 Filter categories

The advanced filter overlay supports:

- Client
- Manufacturer
- Project Type
- Project
- Project Status
- Region

## 11.2 Draft versus applied filters

The filter overlay does not instantly apply every change.

Instead, it works in two stages:

- Draft state while the user is making choices
- Applied state after the user presses `Apply`

This means:

- `Cancel` discards temporary filter changes
- `Apply` commits the selected filter set
- `Reset All` resets the draft inside the overlay

## 11.3 Quick filter summary

Outside the overlay, the user also sees compact filter pills showing the current state, such as:

- Number of selected clients
- Number of selected projects
- Number of selected manufacturers
- Number of selected regions
- Current status filter

## 11.4 Active filter chips

After filters are applied, each active filter can appear as a removable chip.

Removing one chip updates the live applied state immediately.

This gives the user a fast way to back out of specific filters without reopening the entire overlay.

## 11.5 Clear all filters

The feature supports a full filter reset.

This clears the active filter set back to the default state.

For restricted client-scoped users, the client pin remains enforced even after clearing filters.

## 11.6 Filter search inside long lists

When a filter option list becomes long enough, the interface can expose a search input inside that filter section.

This improves usability for:

- Long client lists
- Long manufacturer lists
- Long project lists
- Long project type lists

## 11.7 Unavailable filter options

The filter overlay can hide currently unavailable options by default and allow the user to reveal them on demand.

This helps the list stay focused on meaningful choices while still allowing broader discovery.

## 12. How Filtering Affects Each Mode

The same filters do not behave identically in every map mode.

### In project mode

Filters affect:

- Visible routes
- Visible clients
- Visible manufacturer-side nodes

This is the most complete filtering mode.

### In client mode

The result is simplified to client-side visibility.

Project routes are not shown.

### In manufacturer mode

The map shows manufacturer-side results only, but those results can still be narrowed using project-oriented filters.

In other words:

- The user can filter by project logic
- The screen then shows the manufacturer locations that survive that logic

## 13. Region Logic

The feature includes region-based filtering.

Region values are derived from location context and then used to narrow nodes and routes.

The interface also presents a preferred order for major regions so the filter list feels more deliberate instead of purely alphabetical.

## 14. Status Logic

The feature supports three status filter states:

- All
- Active
- Inactive

### Summary metrics

The summary cards also reflect status-derived counts:

- `Total Projects`
- `Total Shipped`
- `Under Inspection`

### Route-level effect

Status filtering affects which project routes are shown and how they are visually emphasized.

### Node-level effect

Status filtering can also affect which nodes remain visible, depending on the current mode and whether route-backed filtering is active.

## 15. Data Panel

The lower data panel is not separate from the map. It is part of the feature's logic.

It gives a non-geographic way to inspect the same operational dataset.

### 15.1 Main tabs

The panel has four primary tabs:

- Projects
- Clients
- Manufacturers
- Locations

### 15.2 What each tab shows

#### Projects tab

The projects tab shows:

- Project name
- Client
- Linked locations
- Manufacturer
- Status

This is the most map-connected table because project rows directly reflect route relationships.

#### Clients tab

The clients tab shows:

- Client name
- Linked locations
- Linked project count

#### Manufacturers tab

The manufacturers tab shows:

- Manufacturer name
- Linked locations

#### Locations tab

The locations tab shows:

- Location name
- Latitude
- Longitude

### 15.3 Search

The panel supports search within the currently active tab.

This means the user can quickly narrow table results without changing the map filter state.

### 15.4 View action

Each table row includes a `View` action.

In read-only terms, this is one of the most important actions because it connects the table back to the map.

Using `View` can:

- Select the underlying item
- Switch map perspective if needed
- Zoom to the related entity

### 15.5 Collapse and expand

The entire panel can be collapsed or reopened.

This lets the user choose between:

- More map space
- More tabular browsing space

### 15.6 Adjustable presentation

The panel supports display preferences such as:

- Different row density options
- Adjustable panel height in overlay-style usage

These are usability features rather than business features, but they materially affect daily use.

## 16. Theme and Display Controls

The map screen includes several presentation controls.

### Theme toggle

The user can switch the feature between light and dark themed styling.

This affects both:

- The surrounding screen presentation
- The underlying basemap style

### Fullscreen behavior

The feature supports fullscreen-style viewing.

Depending on where the feature is embedded, this can mean:

- Browser fullscreen
- Host-managed fullscreen inside a dashboard overlay

### Zoom controls

The map includes:

- Zoom slider
- Zoom in button
- Zoom out button

These sit alongside manual mouse or touch map interaction.

## 17. Realtime Behavior

The feature is designed to stay current without requiring constant manual refreshes.

### Realtime connection states

The status pill can communicate states such as:

- Connected
- Connecting
- Reconnecting
- Polling fallback
- Realtime offline

### Background updates

When realtime updates are available, the map can update in the background as entity changes arrive.

The intended behavior is:

- Small updates are merged into the existing visible state
- Route refreshes happen when route-affecting data changes
- Full reloads are avoided unless necessary

### Polling fallback

If realtime becomes unavailable, the feature does not immediately give up.

After a short grace period, it can move into polling fallback mode.

That means the screen continues refreshing through timed background checks instead of live push events.

### Important user-facing result

Normal actions like:

- Switching tabs
- Opening filters
- Opening the table
- Panning the map
- Zooming the map

do not inherently mean a full page refresh.

The feature is designed to keep those interactions lightweight.

## 18. Data Loading Logic

The map depends on several business datasets being available together.

At a high level, it needs coordinated access to:

- Clients
- Projects
- Manufacturers
- Locations

The feature waits for those required sources before considering the screen fully ready.

### During loading

The user sees a blocking loading state explaining that backend data is being loaded.

### If required data fails

The user sees:

- An error banner
- A summary of affected sources
- A retry action

This makes backend failure visible without leaving the user in a silent blank state.

## 19. Coordinate and Visibility Logic

A map feature is only as good as its coordinate handling.

This feature uses several strategies to determine whether something can be shown.

### Direct coordinates

If an entity already has valid coordinates, those are used directly.

### Client coordinate fallback

If a client does not have direct coordinates, the feature can try to resolve them from a linked location.

This is important because it allows some clients to appear on the map even when their own record is incomplete.

### Location-text fallback

For some nodes, if direct coordinates are missing, the feature can attempt to resolve a display position from location text such as city and country.

This is a fallback behavior, not a guarantee.

### Visibility consequence

If no usable coordinates can be established, that entity or route may not appear on the map even if it exists in the data tables.

This is one of the most important practical limits of the feature.

## 20. Empty State Logic

The map does not simply go blank when filters produce no usable visual result.

Instead, it can show an explicit empty state message.

Typical meaning:

- No routes match the selected filters
- Filtered results have no visible map entities

This is useful because it tells the user the system is working, but the result set is empty.

## 21. Selection-Out-of-Filter Logic

A user can end up with a selection that no longer matches the active filters.

When that happens, the feature can surface a notice indicating that the current selection is outside the applied filters.

This helps prevent confusion when:

- An item was selected first
- Filters were changed afterward
- The selected item is no longer part of the visible result set

If the selection becomes invalid enough, the feature can clear it.

## 22. Error and Warning Handling

The feature has several layers of protection when map display problems occur.

### Map loading error

If the map itself cannot initialize, the user gets a full map error overlay with:

- A clear title
- A human-readable message
- Guidance to refresh or try a different browser
- Retry when recovery is possible
- Dismiss when the user wants to continue without the map

### WebGL or hardware acceleration problems

If the browser environment cannot support the map engine properly, the feature treats that as a serious map limitation.

In those cases, retry may not help until the browser or device environment changes.

### Basemap fallback

If the normal basemap style fails to load, the feature can fall back to a simplified background style instead of failing completely.

That means the user may still get:

- Markers
- Routes
- Selection behavior

but on top of a simpler background.

### Runtime warning

If a recoverable map issue occurs after the map has already loaded, the feature can show a warning instead of fully crashing the experience.

## 23. Persistence and Remembered State

The feature remembers some user state across visits.

This includes:

- Applied filters
- Last selected main view mode
- Whether the data panel was open

The data panel also remembers presentation preferences such as:

- Row density
- Panel height

This makes the feature feel continuous rather than resetting everything every time the user returns.

## 24. Embedded Host Behavior

When the feature is embedded inside a dashboard or another screen, the host can influence it.

Examples include:

- Passing in an externally selected project
- Deciding whether fullscreen is browser-based or host-based
- Showing the map inside a smaller card rather than a dedicated page

This means the user experience can be slightly different depending on where the same map feature is being used.

## 25. What the Feature Does Well

From a functional perspective, the strongest capabilities are:

- Showing project-to-client-to-manufacturer relationships visually
- Supporting multiple operational perspectives
- Combining map and table workflows
- Supporting meaningful filter combinations
- Keeping interaction lightweight during normal use
- Handling degraded states more gracefully than a simple blank map

## 26. What the Feature Does Not Do

This section is intentionally explicit.

The feature does not currently function as:

- A freeform map editor
- A drawing tool
- A route design tool
- A marker drag-and-drop placement tool
- A general GIS analytics platform
- A guaranteed display for entities that lack usable coordinate data

It also does not show everything in every mode.

Important current limits:

- Project routes are not shown in client mode
- Project routes are not shown in manufacturer mode
- Client browsing is restricted for client-scoped accounts
- Results with missing or unresolved coordinates may be absent from the map
- Filtering can legitimately produce a visible empty state
- Some deeper internal behaviors exist behind the scenes, but the current end-user interface is centered on the three visible modes: Projects, Clients, and Manufacturers

## 27. Read-Only Summary

If this feature is described in one sentence:

It is a read-oriented operational map workspace that lets users explore projects, clients, manufacturers, and locations through coordinated map, filter, route, and table behaviors.

If it is described in one longer statement:

It is a multi-mode fleet visibility feature that combines geographic context, entity relationships, live status awareness, and table-based inspection into a single screen, while deliberately depending on valid coordinate data and while limiting what is shown based on the current mode, filters, and user role.
