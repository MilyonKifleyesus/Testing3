# War Room Feature Diagrams

Diagrams documenting each War Room feature for leadership review. Copy Mermaid blocks into [Mermaid Live Editor](https://mermaid.live) or any Markdown viewer that supports Mermaid.

---

## Diagram 1: Map View Feature

**Title: War Room - Map View Feature**

The map is the central visualization showing companies, clients, and routes on an interactive MapLibre GL map.

```mermaid
graph TB
    A[Map View Feature]
    B[Subsidiary View]
    C[Factory View]
    D[Zoom Slider]
    E[Zoom In and Out]
    F[Fullscreen Toggle]
    G[Company Markers]
    H[Transit Routes]
    I[Project Routes]
    J[Hover Tooltips]
    K[Click to Select Node]
    L[Low Zoom: Logo Only]
    M[High Zoom: Full Detail]

    A --> B
    A --> C
    A --> D
    A --> E
    A --> F
    A --> G
    A --> H
    A --> I
    A --> J
    A --> K
    A --> L
    A --> M
```

---

## Diagram 2: Filters Feature

**Title: War Room - Filters Feature**

Filters narrow the map and panel data by multiple criteria.

```mermaid
graph TB
    A[Filter Button]
    B[Filters Panel]
    C[Companies]
    D[Client]
    E[Manufacturer]
    F[Project Type]
    G[Status: All, Active, Inactive]
    H[Regions]
    I[Close Filters]
    J[Reset All]
    K[Active Filters Bar]
    L[Map and Panels Update]

    A --> B
    B --> C
    B --> D
    B --> E
    B --> F
    B --> G
    B --> H
    B --> I
    B --> J
    B --> K
    I --> L
```

---

## Diagram 3: Command Menu Feature

**Title: War Room - Command Menu Feature**

The floating action button provides quick access to six common actions.

```mermaid
graph TB
    A[Floating Action Button]
    B[Add Company - Opens Modal]
    C[Panels - Show or Hide Sidebar]
    D[Filters - Open or Close Filters Panel]
    E[Project List - Show HUD]
    F[Tactical - Map Only Mode]
    G[Expand Map - Full Width]

    A --> B
    A --> C
    A --> D
    A --> E
    A --> F
    A --> G
```

---

## Diagram 4: Sidebar Panels Feature

**Title: War Room - Sidebar Panels Feature**

The sidebar has two tabs and can be toggled on or off.

```mermaid
graph TB
    A[Panels Button]
    B[Overlay Panel]
    C[Activity Log Tab]
    D[Hub Status Tab]
    E[Client or Manufacturer Toggle]
    F[Edit Mode Toggle]
    G[Clients with Projects List]
    H[Manufacturer Hierarchy]
    I[Hubs for Selected Subsidiary]
    J[Quantum Chart]
    K[Add Company Button]

    A --> B
    B --> C
    B --> D
    C --> E
    C --> F
    C --> G
    C --> H
    D --> I
    D --> J
    D --> K
```

---

## Diagram 5: Clients Panel Feature

**Title: War Room - Clients Panel Feature**

Shows clients with projects. Edit Mode allows changing project status.

```mermaid
graph TB
    A[Client List]
    B[Expand Client]
    C[Projects for Client]
    D[View Project Details]
    E[Edit Project Status]
    F[Open, Closed, or Delayed]
    G[Save Changes]
    H[Cancel]
    I[Sync with Map Selection]
    J[Edit Mode]

    A --> B
    B --> C
    C --> D
    C --> E
    E --> F
    J --> E
    J --> G
    J --> H
    A --> I
```

---

## Diagram 6: Activity Log Manufacturer View

**Title: War Room - Activity Log Manufacturer View**

Parent Groups to Subsidiaries to Factories hierarchy with edit and batch update support.

```mermaid
graph TB
    A[Parent Groups]
    B[Subsidiaries]
    C[Factories]
    D[Edit Subsidiary Details]
    E[Edit Factory Details]
    F[Batch Update]
    G[Delete Subsidiary]
    H[Delete Factory]
    I[Save All Changes]
    J[Cancel]
    K[Selection Sync with Map]
    L[Edit Mode]

    A --> B
    B --> C
    L --> D
    L --> E
    L --> F
    L --> G
    L --> H
    L --> I
    L --> J
    A --> K
```

---

## Diagram 7: Add Company Feature

**Title: War Room - Add Company Feature**

Modal for adding new companies, optionally positioned over the map.

```mermaid
graph TB
    A[Add Company Action]
    B[Add Company Modal]
    C[Company Name]
    D[Location]
    E[Status: Active or Inactive]
    F[Source Company]
    G[Source Location]
    H[Description]
    I[Logo Upload]
    J[Sub-Locations]
    K[Submit]
    L[Cancel]
    M[Company Added - Toast]
    N[Map Refreshes]

    A --> B
    B --> C
    B --> D
    B --> E
    B --> F
    B --> G
    B --> H
    B --> I
    B --> J
    B --> K
    B --> L
    K --> M
    M --> N
```

---

## Diagram 8: Context Panel Feature

**Title: War Room - Context Panel Feature**

Shows details when a map node or project is selected.

```mermaid
graph TB
    A[Map Node or Project Selected]
    B[Context Panel]
    C[Project Selected]
    D[Factory Selected]
    E[Client Selected]
    F[Project Details, Client, Factory]
    G[Factory Details and Linked Projects]
    H[Client Details and Linked Projects]

    A --> B
    B --> C
    B --> D
    B --> E
    C --> F
    D --> G
    E --> H
```

---

## Diagram 9: Project List HUD Feature

**Title: War Room - Project List HUD Feature**

Floating project list filtered by active map filters.

```mermaid
graph TB
    A[Project List Command]
    B[Project HUD Overlay]
    C[Search Projects]
    D[Filtered by Active Map Filters]
    E[Scrollable Project List]
    F[Select Project]
    G[Highlight Project on Map]
    H[Close HUD]

    A --> B
    B --> C
    B --> D
    B --> E
    B --> F
    B --> H
    F --> G
```

---

## Diagram 10: Tactical Mode Feature

**Title: War Room - Tactical Mode Feature**

Map-only focused view for presentations.

```mermaid
graph TB
    A[Enter Tactical Mode]
    B[Map Only - No Sidebar, No Filters Bar]
    C[Bottom Bar]
    D[Subsidiary or Factory Toggle]
    E[Exit Tactical]
    F[Return to Normal View]

    A --> B
    A --> C
    C --> D
    C --> E
    E --> F
```

---

## Diagram 11: Hub Status Feature

**Title: War Room - Hub Status Feature**

Shows hub status for the selected subsidiary.

```mermaid
graph TB
    A[Hub Status Tab]
    B[Selected Subsidiary]
    C[Hubs List]
    D[Hub Status: ACTIVE or INACTIVE]
    E[Quantum Chart]
    F[Add Company Button]

    A --> B
    B --> C
    B --> D
    B --> E
    B --> F
```

---

## Diagram 12: OVERVIEW - All War Room Features

**Title: War Room - Complete Feature Overview**

```mermaid
graph TB
    subgraph MapArea [Map Area]
        M1[Map View]
        M2[Map Controls]
        M3[Markers and Routes]
        M4[Context Panel]
    end

    subgraph Toolbar [Toolbar]
        T1[Subsidiary or Factory View]
        T2[Filter Button]
        T3[Panels]
        T4[Expand Map]
        T5[Tactical]
    end

    subgraph Filters [Filters Panel]
        F1[Companies]
        F2[Client]
        F3[Manufacturer]
        F4[Project Type]
        F5[Status]
        F6[Regions]
    end

    subgraph Sidebar [Sidebar]
        S1[Activity Log]
        S2[Hub Status]
    end

    subgraph Overlays [Overlays]
        O1[Command Menu FAB]
        O2[Add Company Modal]
        O3[Project List HUD]
    end

    T2 --> Filters
    T3 --> Sidebar
```

---

## How to Use

1. **Render in GitHub or Notion** – Paste the Mermaid blocks into any Markdown viewer that supports Mermaid.
2. **Export as images** – Use [Mermaid Live Editor](https://mermaid.live) to export each diagram as PNG or SVG.
3. **Share as slides** – Create a presentation with one diagram per slide.
