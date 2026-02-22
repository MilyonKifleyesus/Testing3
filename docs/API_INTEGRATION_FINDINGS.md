# Fluorescence Map - Backend API Findings

**Date:** February 19, 2026  
**Source:** Live API fetch from `https://api.fleetpulse.net`

---

## Summary

The backend API was fetched and analyzed. Below is what the API currently returns vs what the Fluorescence Map needs for full integration.

---

## 1. Projects - `GET /api/projects?includeClosed=true`

### Current Response (verified)

```json
{
  "items": [
    {
      "id": 69,
      "name": "SR-3049",
      "clientId": 10,
      "closed": false,
      "lastUpdate": "2025-12-11T00:43:11.513"
    }
  ],
  "total": 57,
  "page": null,
  "pageSize": null
}
```

### Swagger Schema: `ProjectListItemDto`

| Field | Type | Returned |
|---|---|---|
| id | int32 | Yes |
| name | string | Yes |
| clientId | int32 | Yes |
| closed | boolean | Yes |
| lastUpdate | string | Yes |

### Missing for Fluorescence Map

| Field | Purpose | Priority |
|---|---|---|
| **locationId** | Link project -> manufacturer location for route drawing | **CRITICAL** |
| **assessmentType** | Project type filter, HUD display | **HIGH** |

**Canonical naming decision (February 19, 2026):**
- Canonical contract fields are `locationId` and `assessmentType`.
- `assessmentType` is a `string` containing the type name (for example: `"New Build"`), not a numeric/UUID identifier.
- During migration, frontend may accept legacy inbound fields `manufacturerLocationId` and `projectTypeName`, then normalize them to canonical names.
- Backend should prefer canonical names in responses; if legacy fields are temporarily included, values must match canonical fields.

**Note:** Swagger shows `CreateProjectRequest` and `UpdateProjectRequest` include `locationId` and `projectTypeId` for write operations, but read DTOs should return canonical `assessmentType` (string type name) plus `locationId`.

---

## 2. Clients - `GET /api/Clients`

### Current Response (verified)

```json
{
  "items": [
    {
      "id": 22,
      "clientName": "54 Davies",
      "clientLogo": null,
      "clientLogoName": null,
      "locationId": 0,
      "latitude": 0.0,
      "longitude": 0.0
    }
  ],
  "total": 17,
  "page": null,
  "pageSize": null
}
```

### Swagger Schema: `ClientListItemDto`

| Field | Type | Returned | Issue |
|---|---|---|---|
| id | int32 | Yes | - |
| clientName | string | Yes | - |
| locationId | int32 | Yes | All return `0` |
| latitude | double | Yes | All return `0.0` |
| longitude | double | Yes | All return `0.0` |

### Gap

- Coordinates are not resolved. All clients return `latitude: 0`, `longitude: 0`, `locationId: 0`.
- Per proposal, coordinates should be projected from the `Locations` table into the DTO.
- Without valid coordinates, client markers cannot be placed on the map.

---

## 3. Manufacturers - `GET /api/Manufacturers`

### Current Response (verified)

```json
{
  "items": [
    {
      "id": 6,
      "manufacturerName": "BYD",
      "manufacturerLogo": "...",
      "manufacturerLogoName": "...",
      "locationId": 14,
      "latitude": 0.0,
      "longitude": 0.0
    }
  ],
  "total": 7,
  "page": null,
  "pageSize": null
}
```

### Swagger Schema: `ManufacturerListItemDto`

| Field | Type | Returned | Issue |
|---|---|---|---|
| id | int32 | Yes | - |
| manufacturerName | string | Yes | - |
| locationId | int32 | Yes | Populated (e.g. 14, 21, 19) |
| latitude | double | Yes | All return `0.0` |
| longitude | double | Yes | All return `0.0` |

### Gap

- Coordinates are not resolved. All manufacturers return `latitude: 0`, `longitude: 0`.
- `locationId` is populated, but coordinates are not projected from the `Locations` table.

---

## 4. Locations - `GET /api/Locations`

### Current Response (verified)

```json
{
  "items": [
    {"id": 22, "name": "54 Davies", "latitude": 0.0, "longitude": 0.0},
    {"id": 12, "name": "Winnipeg (New Flyer)", "latitude": 0.0, "longitude": 0.0},
    {"id": 10, "name": "St. Eustache (Nova)", "latitude": 0.0, "longitude": 0.0}
  ],
  "total": 22,
  "page": null,
  "pageSize": null
}
```

### Gap

- Coordinates are not populated. All locations return `latitude: 0`, `longitude: 0`.
- Either the `Locations` table has no coordinates or they are not being returned.

### Verification Required Before Projection Changes

Before implementing DTO coordinate projection logic:
1. Query the `Locations` table and verify non-zero coordinate coverage (`latitude`, `longitude` not null and not `0`).
2. Verify the API read path selects coordinate columns in the handler/DAO for `GET /api/Locations` (and any shared location lookup used by Clients/Manufacturers DTO projection).
3. If coordinates are missing, document and execute a data population plan first:
   - source system(s) for coordinates,
   - ETL/backfill steps,
   - target schema and validation rules.

---

## 5. Manufacturer Locations - `GET /api/ManufacturerLocations`

### Status

| Endpoint | Status |
|---|---|
| `GET /api/ManufacturerLocations` | 404 Not Found |

- No `ManufacturerLocations` endpoint exists today.
- Current integration path uses `locationId` and `GET /api/Locations` as the canonical coordinate source.

---

## 6. API Endpoints Summary

| Endpoint | Status | Notes |
|---|---|---|
| GET /api/projects?includeClosed=true | Yes | Returns id, name, clientId, closed, lastUpdate. Missing locationId and assessmentType. |
| GET /api/projects/{id} | Yes | Same fields as list + uniqueId. |
| GET /api/Clients | Yes | Returns id, clientName, locationId, lat, lng. All coordinates are 0. |
| GET /api/Manufacturers | Yes | Returns id, manufacturerName, locationId, lat, lng. All coordinates are 0. |
| GET /api/Locations | Yes | Returns id, name, lat, lng. All coordinates are 0. |
| GET /api/ManufacturerLocations | No (404) | Not implemented. |

---

## 7. Backend Changes Needed

### Critical

| # | Change | Owner |
|---|---|---|
| 1 | Add **locationId** to Project DTO response | Backend |
| 2 | Ensure coordinates are projected into Client, Manufacturer, and Location DTOs (resolved from `Locations`) | Backend |

### High

| # | Change | Owner |
|---|---|---|
| 3 | Add **assessmentType** (string type name) to Project DTO response | Backend |
| 4 | Populate `Locations` with valid latitude/longitude for clients and manufacturers | Backend |

### Medium

| # | Change | Owner |
|---|---|---|
| 5 | Confirm whether manufacturer locations remain embedded via `locationId` or need a dedicated endpoint later | Backend |
| 6 | Confirm Clients endpoint stability and error handling | Backend |

---

## 8. Frontend Mapping for `locationId`

Once the backend returns `locationId` on projects:

- `Project.locationId` -> `Location.id` (e.g. 10 = St. Eustache, 12 = Winnipeg).
- `Location` provides coordinates (once populated).
- Frontend maps `locationId` to War Room factory node IDs through `factory-id-mapping.json` (e.g. Location 10 -> `nova-saint-eustache`).

---

## 9. Recommended Next Steps

1. Backend: Add `locationId` to `ProjectListItemDto` and `ProjectDetailDto`.
2. Backend: Add `assessmentType` to Project DTOs.
3. Backend: Populate and project coordinates into Client, Manufacturer, and Location DTOs.
4. Frontend/Backend: Keep `locationId` and `assessmentType` as canonical contract names; keep alias normalization only as a migration path.
