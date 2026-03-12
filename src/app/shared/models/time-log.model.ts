/**
 * Time-log feature models.
 * Ported from React time-log; used by Timesheet list and New Time Log flows.
 */

// ─── Domain Types ───────────────────────────────────────────────────────────

export const TIME_OF_TIME_OPTIONS = [
  'Production',
  'First Property Inspection',
  'Buybacks',
  'Road/Water Test',
  'Sign Off',
  'Other',
] as const;

export type TypeOfTime = (typeof TIME_OF_TIME_OPTIONS)[number];

export interface TimeLogProject {
  id: string;
  name: string;
  clientId: string;
  clientName?: string;
}

export interface TimeLogVehicle {
  id: string;
  fleetNumber: string;
  clientId?: string;
  projectId?: string;
  description?: string;
}

/** Normalized user shape: id + name (optional email). */
export interface TimeLogUser {
  id: string;
  name: string;
  email?: string;
}

/** @deprecated Use TimeLogUser */
export type TimeLogInspector = TimeLogUser;

export interface TimeLog {
  id: string;
  startDate: string;
  spentTimeHours: number;
  description: string;
  projectId: string;
  projectName?: string;
  vehicleId: string;
  vehicleFleetNumber?: string;
  typeOfTime: TypeOfTime;
  userId: string;
  userName?: string;
  createdAt?: string;
}

// ─── List / Filter Types ─────────────────────────────────────────────────────

export interface TimeLogFilter {
  projectId?: string;
  vehicleId?: string;
  userId?: string;
  typeOfTime?: string;
  fromDate?: string;
  toDate?: string;
  searchTerm?: string;
}

export interface TimeLogListParams extends TimeLogFilter {
  page: number;
  pageSize: number;
  sortBy: string;
  sortDirection: 'asc' | 'desc';
}

export interface TimeLogListResponse {
  items: TimeLog[];
  total: number;
}

// ─── Staging Row Types ────────────────────────────────────────────────────────

export type RowStatus = 'matched' | 'warning' | 'error';
export type RowSource = 'excel' | 'manual';

export interface StagingRow {
  _id: string;
  _status: RowStatus;
  _source: RowSource;
  _errors: string[];
  _warnings: string[];

  _rawProject?: string;
  _rawVehicle?: string;
  _rawUser?: string;
  _rawTypeOfTime?: string;

  startDate: string;
  spentTimeHours: number | '';
  description: string;
  projectId: string;
  vehicleId: string;
  typeOfTime: string;
  userId: string;
}

// ─── Submit Payload ───────────────────────────────────────────────────────────

export interface TimeLogPayload {
  projectId: string;
  vehicleId: string;
  userId: string;
  typeOfTime: TypeOfTime;
  startDate: string;
  spentTimeHours: number;
  description: string;
}
