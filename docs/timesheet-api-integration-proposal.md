# Timesheet API Integration Proposal (Frontend -> Backend)

Date: 2026-03-04  
Owner: Frontend (BusPulseV2)  
Audience: Backend API team

## 1) Goal
Connect the Timesheet UI delete action (and related timesheet flows) to stable backend APIs with clear request/response contracts, error handling, and acceptance criteria.

This proposal focuses on the `Delete` action from the Timesheet list and includes all supporting endpoints the page depends on.

## 2) Current Frontend Behavior
The UI already triggers delete from the Timesheet list row action:

- User clicks row action `Delete`.
- Frontend opens confirmation modal.
- On confirm, frontend calls:
  - `DELETE {apiBaseUrl}/timelogs/{id}`
- On success:
  - Modal closes.
  - List is reloaded (`GET /timelogs` with current filters/pagination/sort).
- On error:
  - Toast is shown using backend `message`/`title` when available.

Important runtime behavior:

- `Authorization: Bearer <token>` is sent for API calls.
- `401` responses on API calls trigger client logout.
- Frontend expects lowercase time-log routes (`/timelogs`, `/timelogs/{id}`).

## 3) Required Endpoints (Timesheet Domain)
These are required for full Timesheet functionality (list/view/new/edit/delete):

1. `GET /api/timelogs`
2. `GET /api/timelogs/{id}`
3. `POST /api/timelogs`
4. `PUT /api/timelogs/{id}`
5. `DELETE /api/timelogs/{id}`
6. `POST /api/timelogs/bulk` (optional but recommended; frontend has fallback)
7. `GET /api/projects` (lookup)
8. `GET /api/vehicles` (lookup)
9. `POST /api/vehicles/by-project-ids` (lookup optimization; optional but recommended)
10. `GET /api/projects/{projectId}/vehicles` (lookup fallback)
11. `GET /api/users?page=1&pageSize=1000` (lookup)
12. `GET /api/users/{id}` (user name hydration)
13. `GET /api/user/{id}` (legacy fallback alias; optional but currently used as fallback)

## 4) Priority Item: Delete Endpoint Contract
### Request
Method: `DELETE`  
Path: `/api/timelogs/{id}`  
Headers:

- `Authorization: Bearer <jwt>`
- `Content-Type: application/json` (not required for empty body)

Body: none

### Success response
Preferred:

- `204 No Content`

Also acceptable:

- `200 OK` with optional payload:
```json
{ "deleted": true, "id": "10563" }
```

### Error responses
Use consistent JSON error payload:
```json
{
  "message": "Human-readable message",
  "code": "TIMELOG_NOT_FOUND",
  "details": {}
}
```

Recommended status mapping:

- `400` invalid id format
- `401` unauthenticated
- `403` authenticated but not authorized to delete
- `404` time log not found
- `409` business rule conflict (for example locked/invoiced log)
- `500` unexpected server error

## 5) Data Contract Notes from Frontend
### Time log response fields accepted by frontend
Frontend can consume these fields (aliases supported):

- `id`
- `dateStarted` or `startDate`
- `timeSpent` or `spentTimeHours`
- `description`
- `projectId`, optional `projectName`
- `vehicleId`, optional `vehicleFleetNumber` or `fleetNumber`
- `typeOfTime` or `typeOfTimeId`
- `userId`, optional `userName` or `username`
- `createdAt` or `dateUpdated`

### Create/Update payload expected by backend
Frontend sends:
```json
{
  "projectId": 46,
  "vehicleId": 1723,
  "userId": 1004,
  "typeOfTimeId": 5,
  "timeSpent": 3.5,
  "description": "Updated",
  "dateStarted": "2026-01-13T09:52:20"
}
```

Important:

- `projectId`, `vehicleId`, and `userId` are currently sent as numeric values.
- `typeOfTimeId` is numeric.
- `dateStarted` is sent as ISO-like datetime string from `datetime-local`.

## 6) Query Contract for List Endpoint
Frontend sends this shape to `GET /api/timelogs`:

- `page` (number)
- `pageSize` (number)
- `sortBy` (mapped values, for example `dateStarted`, `timeSpent`, `userId`, `typeOfTimeId`)
- `sortDirection` (`asc` | `desc`)
- optional `projectId`
- optional `vehicleId`
- optional `userId`
- optional `typeOfTimeId`
- optional `fromDate`
- optional `toDate`
- optional `searchTerm`

Accepted response shapes:

1. Object shape:
```json
{
  "items": [ { "...": "..." } ],
  "total": 123
}
```
2. Array shape (frontend can still render, but object shape with `total` is preferred for paging accuracy).

## 7) Auth and Authorization Expectations
1. Endpoint must require authenticated user context.
2. Delete should enforce permission checks (role/ownership/business rules).
3. If delete is forbidden, return `403` with clear `message`.
4. Avoid returning `401` for valid sessions unless token truly invalid, because frontend will force logout on `401`.

## 8) Non-Functional Requirements
1. Route casing compatibility:
   - Frontend currently uses lowercase (`/api/timelogs`).
   - Backend should support lowercase routes (or route aliasing) in all environments.
2. CORS:
   - If frontend and API are on different origins, allow `Authorization` header and expected methods.
3. Observability:
   - Log `DELETE /timelogs/{id}` with correlation id and actor id.
   - Include request id in error responses if available.

## 9) Definition of Done (Backend)
1. `DELETE /api/timelogs/{id}` implemented and deployed.
2. Successful delete returns `204` (or `200`) and removed log no longer appears in list queries.
3. Error status codes and JSON payload follow section 4.
4. API accepts current frontend routes and payloads without requiring frontend hotfix.
5. Tested with real auth token and real dataset (including unauthorized and not-found cases).

## 10) Suggested Backend Test Matrix
1. Delete existing id with valid permissions -> `204`.
2. Delete same id again -> `404`.
3. Delete with invalid id format -> `400`.
4. Delete without token -> `401`.
5. Delete with token but insufficient permissions -> `403`.
6. Delete blocked by business rule -> `409` with clear message.
7. Confirm list endpoint no longer returns deleted id after success.

## 11) Open Questions for Backend Team
1. Is delete hard delete or soft delete?
2. If soft delete, should deleted records be excluded by default from `GET /timelogs`?
3. Are there business locks (approved/invoiced/exported) that should return `409`?
4. Can we standardize error payload across all timesheet endpoints (`message`, `code`, `details`)?
5. Can legacy `GET /api/user/{id}` be kept as alias until frontend cleanup is scheduled?

## 12) Frontend References (for traceability)
Primary integration points in this repo:

- `src/app/components/admin/timesheet/timesheet/timesheet.component.ts`
- `src/app/shared/services/time-log.service.ts`
- `src/app/shared/services/time-log-lookup-adapter.service.ts`
- `src/app/shared/constants/time-log-api.constants.ts`
- `src/app/shared/interceptors/auth.interceptor.ts`

