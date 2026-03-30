# Backend Request: Add Client Support to Time Logs

## 1) Purpose
Add `Client` support in the Time Log domain so frontend can:
- Filter Time Logs by client on the main Time Log page.
- Select a client when creating a new Time Log (manual and import flow).

This request covers backend API contract, validation, and acceptance criteria.

## 2) Frontend Context (Current State)
- Time Log list filters currently support `projectId`, `vehicleId`, `userId`, `typeOfTime`, `fromDate`, `toDate`, `searchTerm` only.
- Time Log create/update payload currently sends `projectId`, `vehicleId`, `userId`, `typeOfTimeId`, `timeSpent`, `description`, `dateStarted`.
- No `clientId` is available in `TimeLogFilter`, `TimeLogPayload`, or `TimeLog` response model today.

Current frontend files:
- `src/app/shared/models/time-log.model.ts`
- `src/app/shared/services/time-log.service.ts`
- `src/app/components/admin/timesheet/timesheet/timesheet.component.ts`
- `src/app/components/admin/timesheet/new-time-log/new-time-log.component.ts`

## 3) Requested API Changes

## 3.1 GET `/timelogs` (List)
### Add query parameter
- `clientId` (string/number)

### Response changes (per item)
Include:
- `clientId`
- `clientName` (optional but strongly recommended)

### Behavior
- When `clientId` is provided, only return logs for that client.
- `clientId` filter should combine with existing filters (project, vehicle, user, type, date range, search).

---

## 3.2 GET `/timelogs/{id}` (Detail)
Include in response:
- `clientId`
- `clientName` (optional but strongly recommended)

---

## 3.3 POST `/timelogs` (Create)
Allow request body to include:
- `clientId` (new)

Keep existing fields:
- `projectId`, `vehicleId`, `userId`, `typeOfTimeId`, `timeSpent`, `description`, `dateStarted`

### Validation rules
- If `clientId` is provided, validate it matches `project.clientId`.
- If `clientId` is omitted, backend may derive from `projectId` and persist it.
- Return 400 with clear message when client/project mismatch occurs.

---

## 3.4 PUT `/timelogs/{id}` (Update)
Allow `clientId` in update payload and apply same validation rules as create.

---

## 3.5 POST `/timelogs/bulk` (Bulk Create)
Allow each row payload to include `clientId` and apply the same validation per row.
Error format should identify row index on validation failure.

## 4) Suggested Request/Response Examples

## 4.1 List with client filter
`GET /timelogs?page=1&pageSize=25&sortBy=dateStarted&sortDirection=desc&clientId=12`

Example item:
```json
{
  "id": 9842,
  "dateStarted": "2026-03-04T09:30:00",
  "timeSpent": 2.5,
  "description": "Road test",
  "projectId": 331,
  "projectName": "Nova Q2 Retrofit",
  "clientId": 12,
  "clientName": "Metrolinx",
  "vehicleId": 7215,
  "vehicleFleetNumber": "7215",
  "typeOfTimeId": 5,
  "userId": 77,
  "userName": "John Doe"
}
```

## 4.2 Create
```json
{
  "projectId": 331,
  "clientId": 12,
  "vehicleId": 7215,
  "userId": 77,
  "typeOfTimeId": 5,
  "timeSpent": 2.5,
  "description": "Road test",
  "dateStarted": "2026-03-04T09:30"
}
```

## 5) Data and Performance Requirements
- Ensure `clientId` can be filtered efficiently on list endpoint.
- If stored on `TimeLog`, add/confirm index on `clientId`.
- If derived via join from `Project`, ensure list query remains performant for paging and sorting.

## 6) Backward Compatibility
- Existing clients that do not send `clientId` must continue to work.
- Existing responses should remain valid; new fields can be additive.

## 7) Acceptance Criteria
1. List endpoint accepts `clientId` and returns only matching records.
2. List/detail responses include `clientId` (and `clientName` when available).
3. Create/update/bulk endpoints accept `clientId`.
4. Backend rejects mismatched `clientId` vs `projectId` with clear validation message.
5. Existing clients (without `clientId`) remain unaffected.

## 8) Frontend Dependency After Backend Is Ready
After API is released, frontend will:
1. Add Client dropdown to Time Log filters.
2. Add Client dropdown to New Time Log (manual and staging/import).
3. Send `clientId` in create/update/bulk payloads.
4. Display client in view/list where needed.
