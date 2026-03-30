import fs from 'node:fs';
import https from 'node:https';

function parseArgs(argv) {
  const args = {
    baseUrl: 'https://api.fleetpulse.net/api',
    inputFile: 'scripts/project-updates.by-id.json',
    apply: false,
    verifyOnly: false,
    timeoutMs: 30000,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--base-url') args.baseUrl = argv[++i];
    else if (a === '--input') args.inputFile = argv[++i];
    else if (a === '--apply') args.apply = true;
    else if (a === '--verify-only') args.verifyOnly = true;
    else if (a === '--timeout-ms') args.timeoutMs = Number(argv[++i] ?? args.timeoutMs);
    else throw new Error(`Unknown arg: ${a}`);
  }

  return args;
}

function normalizeUpdates(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object' && Array.isArray(raw.items)) return raw.items;
  if (raw && typeof raw === 'object' && Array.isArray(raw.projects)) return raw.projects;
  return [];
}

function normalizeArray(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object' && Array.isArray(raw.items)) return raw.items;
  if (raw && typeof raw === 'object' && Array.isArray(raw.projects)) return raw.projects;
  return [];
}

function pickSingleProject(raw, id) {
  if (Array.isArray(raw)) {
    return raw.find((x) => String(x?.id ?? x?.project_id ?? '') === String(id)) ?? raw[0] ?? null;
  }
  if (raw && typeof raw === 'object') {
    if (Array.isArray(raw.items)) {
      return raw.items.find((x) => String(x?.id ?? x?.project_id ?? '') === String(id)) ?? raw.items[0] ?? null;
    }
    if (Array.isArray(raw.projects)) {
      return raw.projects.find((x) => String(x?.id ?? x?.project_id ?? '') === String(id)) ?? raw.projects[0] ?? null;
    }
    if (raw.item) return raw.item;
    if (raw.project) return raw.project;
    return raw;
  }
  return null;
}

function findProjectInList(raw, id) {
  const items = normalizeArray(raw);
  return items.find((x) => String(x?.id ?? x?.project_id ?? '') === String(id)) ?? null;
}

function requestJson({ method, url, token, timeoutMs, body }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = body == null ? null : JSON.stringify(body);
    const req = https.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || 443,
        path: `${u.pathname}${u.search}`,
        method,
        timeout: timeoutMs,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          ...(data
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data),
              }
            : {}),
        },
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          text += chunk;
        });
        res.on('end', () => {
          let parsed = null;
          if (text.trim()) {
            try {
              parsed = JSON.parse(text);
            } catch {
              parsed = text;
            }
          }
          resolve({ status: res.statusCode ?? 0, body: parsed, rawText: text });
        });
      }
    );

    req.on('timeout', () => req.destroy(new Error(`Request timeout after ${timeoutMs}ms`)));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function getValue(obj, keys, defaultValue = null) {
  for (const key of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, key) && obj[key] != null) {
      return obj[key];
    }
  }
  return defaultValue;
}

function normalizeMaybeString(value) {
  if (value == null) return null;
  const out = String(value).trim();
  return out || null;
}

function normalizeMaybeNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeMaybeBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (value == null || value === '') return null;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  return null;
}

async function getExistingProject(baseUrl, projectId, token, timeoutMs) {
  const singleUrl = `${baseUrl}/Projects/${projectId}`;
  try {
    const r = await requestJson({ method: 'GET', url: singleUrl, token, timeoutMs });
    if (r.status >= 200 && r.status < 300) {
      return pickSingleProject(r.body, projectId);
    }
  } catch {}

  const listUrl = `${baseUrl}/Projects`;
  const r = await requestJson({ method: 'GET', url: listUrl, token, timeoutMs });
  if (r.status < 200 || r.status >= 300) {
    throw new Error(`GET ${listUrl} failed (${r.status})`);
  }
  return findProjectInList(r.body, projectId);
}

function buildPutPayload(existing, update) {
  const base = existing && typeof existing === 'object' ? { ...existing } : {};

  const id = normalizeMaybeNumber(getValue(base, ['id', 'project_id'], update.id));
  const incomingName = normalizeMaybeString(update.name);
  const existingName = normalizeMaybeString(getValue(base, ['projectName', 'project_name', 'name']));
  const nextName = incomingName ?? existingName;
  const clientId = normalizeMaybeNumber(update.clientId ?? getValue(base, ['clientId']));
  const locationId = normalizeMaybeNumber(
    update.locationId ?? getValue(base, ['locationId', 'manufacturerLocationId', 'factory_id'])
  );
  const projectTypeId = normalizeMaybeNumber(getValue(base, ['projectTypeId', 'project_type_id']));
  const contract = normalizeMaybeString(getValue(base, ['contract'], ''));
  const hasRoadTest = normalizeMaybeBoolean(getValue(base, ['hasRoadTest'], false));

  if (nextName == null) {
    throw new Error('Unable to resolve project name for PUT payload.');
  }
  if (clientId == null || locationId == null || projectTypeId == null) {
    throw new Error('Missing required API fields: clientId, locationId, or projectTypeId.');
  }

  const payload = {
    ...(id != null ? { id } : {}),
    name: nextName,
    projectName: nextName,
    clientId,
    locationId,
    projectTypeId,
    ...(contract != null ? { contract } : {}),
    ...(hasRoadTest != null ? { hasRoadTest } : {}),
  };
  return payload;
}

function matchesExpected(actual, expected) {
  const actualName =
    normalizeMaybeString(getValue(actual, ['name', 'projectName', 'project_name'], '')) ?? '';
  const actualClientId = normalizeMaybeNumber(getValue(actual, ['clientId']));
  const actualLocationId = normalizeMaybeNumber(
    getValue(actual, ['locationId', 'manufacturerLocationId', 'factory_id'])
  );

  const expectedName = normalizeMaybeString(expected.name) ?? '';
  const expectedClientId = normalizeMaybeNumber(expected.clientId);
  const expectedLocationId = normalizeMaybeNumber(expected.locationId);

  const nameOk = actualName === expectedName;
  const clientOk = actualClientId != null && expectedClientId != null && actualClientId === expectedClientId;
  const locationOk = actualLocationId != null && expectedLocationId != null && actualLocationId === expectedLocationId;

  return {
    ok: nameOk && clientOk && locationOk,
    nameOk,
    clientOk,
    locationOk,
    actualName,
    actualClientId,
    actualLocationId,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = process.env.BP_API_TOKEN;
  if (!token) {
    throw new Error('Missing BP_API_TOKEN environment variable.');
  }

  const updates = normalizeUpdates(JSON.parse(fs.readFileSync(args.inputFile, 'utf8')));
  if (!Array.isArray(updates)) {
    throw new Error('Input file must contain a JSON array.');
  }

  const rows = [];
  const baseUrl = args.baseUrl.replace(/\/+$/, '');

  for (const update of updates) {
    const id = String(update.id ?? '').trim();
    if (!id) {
      rows.push({ id: '', name: update.name ?? '', status: 'failed', error: 'Missing id' });
      continue;
    }

    try {
      const before = await getExistingProject(baseUrl, id, token, args.timeoutMs);
      if (!before) {
        throw new Error('Project not found');
      }

      const beforeMatch = matchesExpected(before, update);
      let after = before;

      if (args.apply && !args.verifyOnly && !beforeMatch.ok) {
        const payload = buildPutPayload(before, update);
        const put = await requestJson({
          method: 'PUT',
          url: `${baseUrl}/Projects/${id}`,
          token,
          timeoutMs: args.timeoutMs,
          body: payload,
        });
        if (put.status < 200 || put.status >= 300) {
          throw new Error(`PUT failed (${put.status}) ${typeof put.body === 'string' ? put.body : JSON.stringify(put.body)}`);
        }
        after = (await getExistingProject(baseUrl, id, token, args.timeoutMs)) ?? after;
      }

      const afterMatch = matchesExpected(after, update);
      rows.push({
        id,
        name: update.name,
        status: afterMatch.ok ? 'ok' : 'mismatch',
        action:
          args.apply && !args.verifyOnly
            ? (beforeMatch.ok ? 'unchanged' : (afterMatch.ok ? 'updated' : 'update_failed_verify'))
            : 'checked',
        beforeOk: beforeMatch.ok,
        afterOk: afterMatch.ok,
        actualName: afterMatch.actualName,
        actualClientId: afterMatch.actualClientId,
        actualLocationId: afterMatch.actualLocationId,
      });
    } catch (error) {
      rows.push({
        id,
        name: update.name,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const okCount = rows.filter((r) => r.status === 'ok').length;
  const mismatchCount = rows.filter((r) => r.status === 'mismatch').length;
  const failCount = rows.filter((r) => r.status === 'failed').length;
  console.log(JSON.stringify(rows, null, 2));
  console.log(`SUMMARY ok=${okCount} mismatch=${mismatchCount} failed=${failCount} total=${rows.length}`);
  if (mismatchCount > 0 || failCount > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
