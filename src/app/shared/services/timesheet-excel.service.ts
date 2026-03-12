/**
 * Excel/CSV parsing and staging validation for time-log import.
 * Uses dynamic import of xlsx so the library loads only when Import tab is used.
 */
import {
  RowStatus,
  StagingRow,
  TIME_OF_TIME_OPTIONS,
  TimeLogUser,
  TimeLogProject,
  TimeLogVehicle,
} from '../models/time-log.model';

export const MAX_IMPORT_ROWS = 2000;

export const IMPORT_TEMPLATE_HEADERS = [
  'Start Date',
  'Spent Time',
  'Description',
  'Project',
  'Vehicle',
  'Type of Time',
  'User',
] as const;

export interface ParsedRow {
  startDate: string;
  spentTimeHours: number | '';
  description: string;
  project: string;
  vehicle: string;
  typeOfTime: string;
  user: string;
}

export interface ParseFileResult {
  rows: ParsedRow[];
  warnings: string[];
  skippedRows: number;
  totalRows: number;
  sheetName: string;
}

export interface DownloadTemplateOptions {
  fileName?: string;
  rows?: Partial<ParsedRow>[];
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

function normalizeVehicleToken(s: string): string {
  return normalize(s).replace(/[^a-z0-9]/g, '');
}

function fuzzyMatch(value: string, candidates: { id: string; label: string }[]): string | null {
  const nv = normalize(value);
  const exact = candidates.find((c) => normalize(c.label) === nv);
  if (exact) return exact.id;
  const startsWith = candidates.find(
    (c) => normalize(c.label).startsWith(nv) || nv.startsWith(normalize(c.label))
  );
  if (startsWith) return startsWith.id;
  const contains = candidates.find(
    (c) => normalize(c.label).includes(nv) || nv.includes(normalize(c.label))
  );
  return contains ? contains.id : null;
}

function fuzzyMatchVehicle(
  value: string,
  candidates: { id: string; label: string }[]
): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const fuzzy = fuzzyMatch(raw, candidates);
  if (fuzzy) return fuzzy;

  // Accept common formatting variants for fleet numbers, e.g. LF76-104 vs LF76 104.
  const compact = normalizeVehicleToken(raw);
  if (!compact) return null;

  const exact = candidates.find((candidate) => normalizeVehicleToken(candidate.label) === compact);
  if (exact) return exact.id;
  const startsWith = candidates.find((candidate) => {
    const normalizedCandidate = normalizeVehicleToken(candidate.label);
    return normalizedCandidate.startsWith(compact) || compact.startsWith(normalizedCandidate);
  });
  if (startsWith) return startsWith.id;
  const contains = candidates.find((candidate) => {
    const normalizedCandidate = normalizeVehicleToken(candidate.label);
    return normalizedCandidate.includes(compact) || compact.includes(normalizedCandidate);
  });
  return contains ? contains.id : null;
}

function formatLocalDateTime(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function excelSerialToDate(serial: number): string {
  const ms = (serial - 25569) * 86400 * 1000;
  const d = new Date(ms);
  return formatLocalDateTime(d);
}

function parseDate(raw: unknown): string {
  if (!raw) return '';
  if (typeof raw === 'number') return excelSerialToDate(raw);
  const s = String(raw).trim();
  if (!s) return '';

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return s.slice(0, 16);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T00:00`;

  const d = new Date(s);
  if (!isNaN(d.getTime())) return formatLocalDateTime(d);
  return s;
}

function parseSpentTime(raw: unknown): number | '' {
  if (raw === null || raw === undefined || raw === '') return '';
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : '';
  }

  const s = String(raw)
    .replace(/hr\(?s?\)?/gi, '')
    .replace(/hours?/gi, '')
    .trim();
  if (!s) return '';

  if (/^\d{1,2}:\d{2}$/.test(s)) {
    const [h, m] = s.split(':').map((x) => Number(x));
    if (!Number.isFinite(h) || !Number.isFinite(m)) return '';
    return Number((h + m / 60).toFixed(2));
  }

  const normalized = s.replace(',', '.');
  const n = parseFloat(normalized);
  return isNaN(n) ? '' : n;
}

function buildTemplateRow(row: Partial<ParsedRow>, index: number): (string | number)[] {
  const base = new Date();
  base.setSeconds(0, 0);
  base.setHours(8 + index * 2, index === 0 ? 0 : 30, 0, 0);

  return [
    row.startDate ?? formatLocalDateTime(base),
    row.spentTimeHours === '' || row.spentTimeHours === undefined
      ? index === 0
        ? 2.5
        : 1.25
      : row.spentTimeHours,
    row.description ?? (index === 0 ? 'Inspection and road test' : 'Follow-up work'),
    row.project ?? 'Project Name',
    row.vehicle ?? (index === 0 ? 'LF76-104' : '7215'),
    row.typeOfTime ?? TIME_OF_TIME_OPTIONS[0],
    row.user ?? 'User Name',
  ];
}

export async function downloadTimesheetImportTemplate(
  options: DownloadTemplateOptions = {}
): Promise<void> {
  const XLSX = await import('xlsx');
  const rows =
    options.rows && options.rows.length > 0 ? options.rows : [{}, {}];
  const aoa: (string | number)[][] = [
    [...IMPORT_TEMPLATE_HEADERS],
    ...rows.map((row, index) => buildTemplateRow(row, index)),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  sheet['!cols'] = [
    { wch: 18 },
    { wch: 12 },
    { wch: 32 },
    { wch: 24 },
    { wch: 14 },
    { wch: 20 },
    { wch: 20 },
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Import Template');
  const fileName = options.fileName?.trim() || 'time-log-import-template.xlsx';
  const safeFileName = fileName.toLowerCase().endsWith('.xlsx') ? fileName : `${fileName}.xlsx`;
  XLSX.writeFile(workbook, safeFileName);
}

// Re-validate a single row (single validation path for Manual + Excel)
export function revalidateRow(
  row: StagingRow,
  projects: TimeLogProject[],
  vehicles: TimeLogVehicle[]
): StagingRow {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!row.projectId) errors.push('Project is required');
  if (!row.vehicleId) errors.push('Vehicle is required');
  if (!row.userId) errors.push('User is required');
  if (!row.typeOfTime) errors.push('Type of Time is required');
  if (!row.startDate) errors.push('Start Date is required');
  if (row.spentTimeHours === '' || row.spentTimeHours === undefined) {
    errors.push('Spent Time is required');
  } else if (Number(row.spentTimeHours) <= 0) {
    errors.push('Spent Time must be > 0');
  }
  if (!row.description) warnings.push('Description is empty');

  if (row.projectId && row.vehicleId) {
    const project = projects.find((p) => p.id === row.projectId);
    const vehicle = vehicles.find((v) => v.id === row.vehicleId);
    if (project && vehicle && vehicle.clientId && project.clientId !== vehicle.clientId) {
      errors.push('Vehicle does not belong to selected project');
    }
  }

  const status: RowStatus =
    errors.length > 0 ? 'error' : warnings.length > 0 ? 'warning' : 'matched';

  return { ...row, _status: status, _errors: errors, _warnings: warnings };
}

// Match and validate parsed rows (Import tab)
export function matchAndValidate(
  parsed: ParsedRow[],
  projects: TimeLogProject[],
  vehicles: TimeLogVehicle[],
  users: TimeLogUser[]
): StagingRow[] {
  const projectsById = new Map(projects.map((project) => [project.id, project]));
  const projectCandidates = projects.map((p) => ({ id: p.id, label: p.name }));
  const vehicleCandidates = vehicles.map((v) => ({ id: v.id, label: v.fleetNumber }));
  const userCandidates = users.map((u) => ({ id: u.id, label: u.name }));

  return parsed.map((row, idx) => {
    const errors: string[] = [];
    const warnings: string[] = [];

    let projectId = '';
    if (row.project) {
      const pid = fuzzyMatch(row.project, projectCandidates);
      if (pid) projectId = pid;
      else errors.push(`Project "${row.project}" not found`);
    } else {
      errors.push('Project is required');
    }

    let vehicleId = '';
    if (row.vehicle) {
      const project = projectId ? projectsById.get(projectId) : undefined;
      const projectScopedVehicles =
        projectId && project
          ? vehicles.filter((vehicle) => {
              if (vehicle.projectId) return vehicle.projectId === projectId;
              if (vehicle.clientId) return vehicle.clientId === project.clientId;
              return true;
            })
          : [];
      const prioritizedVehicles =
        projectScopedVehicles.length > 0 ? projectScopedVehicles : vehicles;
      const prioritizedCandidates = prioritizedVehicles.flatMap((vehicle) => {
        const candidates: { id: string; label: string }[] = [];
        if (vehicle.fleetNumber) {
          candidates.push({ id: vehicle.id, label: vehicle.fleetNumber });
        }
        // Keep ID as fallback for compatibility with older import sheets.
        candidates.push({ id: vehicle.id, label: vehicle.id });
        return candidates;
      });
      const vid = fuzzyMatchVehicle(
        row.vehicle,
        prioritizedCandidates.length > 0 ? prioritizedCandidates : vehicleCandidates
      );
      if (vid) vehicleId = vid;
      else errors.push(`Vehicle "${row.vehicle}" not found`);
    } else {
      errors.push('Vehicle is required');
    }

    if (projectId && vehicleId) {
      const project = projects.find((p) => p.id === projectId);
      const vehicle = vehicles.find((v) => v.id === vehicleId);
      if (project && vehicle && vehicle.clientId && project.clientId !== vehicle.clientId) {
        errors.push(`Vehicle "${row.vehicle}" does not belong to project "${row.project}"`);
        vehicleId = '';
      }
    }

    let userId = '';
    if (row.user) {
      const uid = fuzzyMatch(row.user, userCandidates);
      if (uid) userId = uid;
      else errors.push(`User "${row.user}" not found`);
    } else {
      errors.push('User is required');
    }

    let typeOfTime = '';
    if (row.typeOfTime) {
      const ntt = normalize(row.typeOfTime);
      const match = TIME_OF_TIME_OPTIONS.find(
        (t) => normalize(t) === ntt || normalize(t).includes(ntt) || ntt.includes(normalize(t))
      );
      if (match) typeOfTime = match;
      else errors.push(`Type of Time "${row.typeOfTime}" not recognised`);
    } else {
      errors.push('Type of Time is required');
    }

    if (!row.startDate) errors.push('Start Date is required');
    if (row.spentTimeHours === '') errors.push('Spent Time is required');
    else if (Number(row.spentTimeHours) <= 0) errors.push('Spent Time must be > 0');
    if (!row.description) warnings.push('Description is empty');

    const status: RowStatus =
      errors.length > 0 ? 'error' : warnings.length > 0 ? 'warning' : 'matched';

    return {
      _id: `import-${idx}-${Date.now()}`,
      _status: status,
      _source: 'excel' as const,
      _errors: errors,
      _warnings: warnings,
      _rawProject: row.project,
      _rawVehicle: row.vehicle,
      _rawUser: row.user,
      _rawTypeOfTime: row.typeOfTime,
      startDate: row.startDate,
      spentTimeHours: row.spentTimeHours,
      description: row.description,
      projectId,
      vehicleId,
      typeOfTime,
      userId,
    };
  });
}

const HEADER_MAP: Record<string, string> = {
  'start date': 'startDate',
  startdate: 'startDate',
  date: 'startDate',
  'spent time': 'spentTimeHours',
  spenttime: 'spentTimeHours',
  'spent time (hours)': 'spentTimeHours',
  hours: 'spentTimeHours',
  'time (hours)': 'spentTimeHours',
  description: 'description',
  notes: 'description',
  project: 'project',
  'project name': 'project',
  vehicle: 'vehicle',
  'fleet number': 'vehicle',
  fleetnumber: 'vehicle',
  'type of time': 'typeOfTime',
  type: 'typeOfTime',
  'time type': 'typeOfTime',
  user: 'user',
  'user name': 'user',
  inspector: 'user',
  'inspector name': 'user',
};

export async function parseFileDetailed(
  file: File,
  maxRows: number = MAX_IMPORT_ROWS
): Promise<ParseFileResult> {
  const XLSX = await import('xlsx');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const wb = XLSX.read(data, { type: 'binary' });
        const warnings: string[] = [];

        if (!wb.SheetNames?.length) {
          reject(new Error('No worksheet found in file.'));
          return;
        }

        const nonEmptySheets = wb.SheetNames.filter((sheetName) => {
          const ws = wb.Sheets[sheetName];
          const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][];
          return rows.some((cells) =>
            Array.isArray(cells) && cells.some((cell) => String(cell ?? '').trim() !== '')
          );
        });
        const selectedSheetName = nonEmptySheets[0] ?? wb.SheetNames[0];
        if (nonEmptySheets.length > 1) {
          warnings.push(
            `Multiple sheets detected. Imported only from "${selectedSheetName}".`
          );
        }

        const ws = wb.Sheets[selectedSheetName];
        const raw: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, { defval: '' });
        const duplicateMappedHeaders = new Set<string>();

        if (raw.length === 0) {
          reject(new Error('No data rows found in the selected sheet.'));
          return;
        }

        const rows: ParsedRow[] = [];
        let skippedRows = 0;
        for (const row of raw) {
          const normalizedRow: Record<string, unknown> = {};
          for (const key of Object.keys(row)) {
            const headerWithoutSuffix = key.replace(/_\d+$/, '');
            const mapped = HEADER_MAP[normalize(headerWithoutSuffix)];
            if (!mapped) continue;
            if (normalizedRow[mapped] !== undefined) {
              duplicateMappedHeaders.add(mapped);
              continue; // first recognized header wins
            }
            normalizedRow[mapped] = row[key];
          }

          const parsedRow: ParsedRow = {
            startDate: parseDate(normalizedRow['startDate']),
            spentTimeHours: parseSpentTime(normalizedRow['spentTimeHours']),
            description: String(normalizedRow['description'] ?? '').trim(),
            project: String(normalizedRow['project'] ?? '').trim(),
            vehicle: String(normalizedRow['vehicle'] ?? '').trim(),
            typeOfTime: String(normalizedRow['typeOfTime'] ?? '').trim(),
            user: String(normalizedRow['user'] ?? '').trim(),
          };

          const isEmpty =
            !parsedRow.project &&
            !parsedRow.vehicle &&
            !parsedRow.description &&
            !parsedRow.startDate &&
            parsedRow.spentTimeHours === '' &&
            !parsedRow.typeOfTime &&
            !parsedRow.user;
          if (isEmpty) {
            skippedRows += 1;
            continue;
          }

          rows.push(parsedRow);
        }

        if (duplicateMappedHeaders.size > 0) {
          warnings.push(
            `Duplicate headers detected (${Array.from(duplicateMappedHeaders).join(', ')}). First recognized header was used.`
          );
        }

        if (rows.length === 0) {
          reject(new Error('No importable data rows found after normalization.'));
          return;
        }
        if (rows.length > maxRows) {
          reject(new Error(`File contains ${rows.length} rows; limit is ${maxRows}.`));
          return;
        }

        resolve({
          rows,
          warnings,
          skippedRows,
          totalRows: raw.length,
          sheetName: selectedSheetName,
        });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsBinaryString(file);
  });
}

/**
 * Backward-compatible parser helper. Use parseFileDetailed when warnings/metrics are needed.
 */
export async function parseFile(file: File): Promise<ParsedRow[]> {
  const result = await parseFileDetailed(file, MAX_IMPORT_ROWS);
  return result.rows;
}
