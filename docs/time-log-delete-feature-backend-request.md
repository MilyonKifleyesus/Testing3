# Backend Request: Enable Time Log Delete Feature

## Request Summary
Please enable/support the Time Log delete option from the new BusPulse V2 Timesheet screen.

Requested by: **Naeem**

Business context:
- The old Buses system already had a working delete feature for time logs.
- We need parity in BusPulse V2 so users can remove incorrect/duplicate time logs directly from the list.

## Frontend Context
Delete button location:
- Time Log list table row action button (`Delete`)
- Current UI already shows a delete icon button and confirmation modal.

Current frontend call:
- `DELETE /timelogs/{id}`
- File: `src/app/shared/services/time-log.service.ts` (`deleteTimeLog(id: string)`)

## Backend Requirements
1. Support `DELETE /timelogs/{id}` for active records.
2. Return success response when deletion is completed.
3. Return clear 4xx error when:
- `id` does not exist
- user is unauthorized
- record cannot be deleted due to business rules
4. If soft-delete is used, ensure deleted records are excluded from `GET /timelogs` by default.
5. Keep response format consistent with existing API error envelope.

## Suggested Responses
Success:
- `204 No Content` (preferred) or `200 OK`

Not found:
- `404 Not Found` with message: `Time log not found`

Validation/business rule block:
- `409 Conflict` or `400 Bad Request` with descriptive message

## Acceptance Criteria
1. User can delete a time log from the list and it disappears after refresh.
2. Deleting an already deleted/non-existent ID returns a clear not-found response.
3. Unauthorized users cannot delete and receive proper authorization error.
4. Deleted records do not appear in normal time log listing.

## Note for Backend Team
This request is specifically for feature parity with the legacy Buses flow and was requested by **Naeem**.
