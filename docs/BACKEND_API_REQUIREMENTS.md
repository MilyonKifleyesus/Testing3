# Fluorescence Map â€” Backend API Requirements

**Version:** 1.0  
**Date:** February 2026  
**For:** Backend Engineering Team

---

## Purpose

The Fluorescence Map displays client locations, project routes (client â†’ manufacturer), and project filters. This document defines the API changes required for full integration.

---

## Endpoint Specifications â€” How We Want Them

### 1. Projects List

**URL:** `GET /api/projects`  
**Query params:** `includeClosed=true` (required for full map coverage)

**Response shape:** `{ items: Project[], total: number, page?: number, pageSize?: number }`

**Each item must include:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | number | âœ… | Project ID |
| `name` | string | âœ… | Project display name |
| `clientId` | number | âœ… | Links to client (route start) |
| `closed` | boolean | âœ… | `false` = Active, `true` = Inactive |
| `lastUpdate` | string (ISO) | âœ… | For recency |
| `uniqueId` | string | Optional | External system identifier for deduplication/lookup. Emit when available; omit when not applicable. |
| `locationId` | number | âœ… **NEW** | Links to manufacturer location (route end). Must match a Location.id. |
| `assessmentType` | string | âœ… **NEW** | Allowed values include "New Build", "Retrofit", "Condition Assessment". |

**Example item:**
```json
{
  "id": 69,
  "name": "SR-3049",
  "clientId": 10,
  "closed": false,
  "locationId": 12,
  "assessmentType": "New Build",
  "lastUpdate": "2025-12-11T00:43:11.513"
}
```

---

### 2. Projects Detail

**URL:** `GET /api/projects/{id}`

**Same fields as list item above**, plus `uniqueId` if applicable.

---

### 3. Clients List

**URL:** `GET /api/Clients`

**Response shape:** `{ items: Client[], total: number, page?: number, pageSize?: number }`

**Each item must include:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | number | âœ… | Client ID |
| `clientName` | string | âœ… | Display label on map |
| `locationId` | number | ✔ | Numeric foreign key to `Locations.id` for coordinate resolution. |
| `latitude` | number | âœ… | Map marker position (must be resolved, not 0) |
| `longitude` | number | âœ… | Map marker position (must be resolved, not 0) |

**Example item:**
```json
{
  "id": 10,
  "clientName": "DRT",
  "locationId": 123,
  "latitude": 43.8828,
  "longitude": -79.4403
}
```

**Important:** Coordinates must be projected from the Location table. The frontend must not make extra calls to resolve them.

---

### 4. Manufacturers List

**URL:** `GET /api/Manufacturers`

**Response shape:** `{ items: Manufacturer[], total: number, page?: number, pageSize?: number }`

**Each item must include:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | number | âœ… | Manufacturer ID |
| `manufacturerName` | string | âœ… | Display label |
| `locationId` | number | âœ… | Links to Location |
| `latitude` | number | âœ… | Route endpoint (must be resolved, not 0) |
| `longitude` | number | âœ… | Route endpoint (must be resolved, not 0) |

**Example item:**
```json
{
  "id": 2,
  "manufacturerName": "New Flyer",
  "locationId": 12,
  "latitude": 49.8951,
  "longitude": -97.1384
}
```

---

### 5. Locations List

**URL:** `GET /api/Locations`

**Response shape:** `{ items: Location[], total: number, page?: number, pageSize?: number }`

**Each item must include:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | number | âœ… | Location ID (used by Project.locationId) |
| `name` | string | âœ… | Display name |
| `latitude` | number | âœ… | Must be populated |
| `longitude` | number | âœ… | Must be populated |

**Example item:**
```json
{
  "id": 12,
  "name": "Winnipeg (New Flyer)",
  "latitude": 49.8951,
  "longitude": -97.1384
}
```

---

### How the Frontend Uses These Endpoints

1. **Clients** â†’ `latitude`/`longitude` for client markers on the map.  
2. **Projects** â†’ `clientId` + `locationId` to draw routes.  
3. **Route drawing (backend resolution logic):**
   `Projects.clientId` -> `Clients.locationId` -> `Locations` and `Projects.locationId` -> `Locations`.
   Backend DTO projection must include resolved coordinates in the **Clients DTO** and in **Manufacturer/Projects DTOs** so the frontend consumes coordinates directly from `GET /api/Clients` and from locations already projected into project/manufacturer responses, without extra join calls.
4. **`closed`** â†’ Active/inactive filter.  
5. **`assessmentType`** â†’ Project type filter and HUD.

---

## Summary of Changes

| Priority | Endpoint | Change |
|----------|----------|--------|
| **Critical** | Projects | Add `locationId` to response |
| **Critical** | Clients, Manufacturers, Locations | Populate `latitude` / `longitude` |
| **High** | Projects | Add `assessmentType` |

---

## 1. Projects â€” `GET /api/projects` & `GET /api/projects/{id}`

### Current Response
```json
{
  "id": 69,
  "name": "SR-3049",
  "clientId": 10,
  "closed": false,
  "lastUpdate": "2025-12-11T00:43:11.513"
}
```

### Required Additions

| Field | Type | Purpose |
|-------|------|---------|
| `locationId` | int32 | Links project to manufacturer location for route drawing. Already accepted in Create/Update but not returned. |
| `assessmentType` | string | Project type filter and HUD display. |

### Example Target Response
```json
{
  "id": 69,
  "name": "SR-3049",
  "clientId": 10,
  "closed": false,
  "locationId": 12,
  "assessmentType": "New Build",
  "lastUpdate": "2025-12-11T00:43:11.513"
}
```

---

## 2. Clients â€” `GET /api/Clients`

### Current Issue
- All items return `latitude: 0`, `longitude: 0`, `locationId: 0`.

### Required
- Populate `latitude` and `longitude` from the Location table using `locationId`.
- `locationId` is required for each client item and must reference `Locations.id`.

### Example Target Response
```json
{
  "id": 10,
  "clientName": "DRT",
  "locationId": 123,
  "latitude": 43.8828,
  "longitude": -79.4403
}
```

---

## 3. Manufacturers â€” `GET /api/Manufacturers`

### Current Issue
- All items return `latitude: 0`, `longitude: 0`.
- `locationId` is populated but coordinates are not resolved.

### Required
- Project coordinates from the Location table into the Manufacturer DTO using `locationId`.

---

## 4. Locations â€” `GET /api/Locations`

### Current Issue
- All items return `latitude: 0`, `longitude: 0`.

### Required
- Populate `latitude` and `longitude` in the Location table, or ensure they are returned correctly.

---

## 5. Coordinate Resolution (Architecture)

**Agreed direction:** Coordinates are stored in the Location table. Related entities (Clients, Manufacturers) reference Location via `locationId`.

**Requirement:** The API must project resolved coordinates into DTOs. The frontend should not need additional join calls for normal map rendering.

---

## 6. Canonical Linking Key

For route rendering, the frontend links:
- **Project** â†’ **Client** (via `clientId`) â†’ client coordinates
- **Project** â†’ **Manufacturer Location** (via `locationId`) â†’ manufacturer coordinates

**Recommendation:** Use `locationId` as the canonical key in the Project DTO, since it aligns with the Location table and is already in Create/Update.

---

## 7. Endpoints Verified

GET /api/ManufacturerLocations is intentionally out of scope for this contract; manufacturer coordinates are resolved through Projects.locationId and GET /api/Locations.

| Endpoint | Status | Notes |
|---------|--------|-------|
| GET /api/projects?includeClosed=true | âœ… | Missing locationId, assessmentType |
| GET /api/Clients | âœ… | Coordinates all 0 |
| GET /api/Manufacturers | âœ… | Coordinates all 0 |
| GET /api/Locations | âœ… | Coordinates all 0 |

---

## 8. Acceptance Criteria

Integration is complete when:

- [ ] Client markers render from API-provided coordinates
- [ ] Project routes render from client to manufacturer location using `locationId`
- [ ] Active/inactive filters work (using `closed` with `includeClosed=true`)
- [ ] Project type filter works using `assessmentType`
- [ ] No additional coordinate-join calls needed for normal map rendering

---

## Contact

Questions: Frontend Team Lead

