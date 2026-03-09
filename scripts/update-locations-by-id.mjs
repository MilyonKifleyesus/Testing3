import fs from 'node:fs';
import https from 'node:https';

function parseArgs(argv) {
  const args = {
    baseUrl: 'https://api.fleetpulse.net/api',
    inputFile: 'scripts/location-updates.by-id.json',
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
  return [];
}

function normalizeArray(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object' && Array.isArray(raw.items)) return raw.items;
  if (raw && typeof raw === 'object' && Array.isArray(raw.locations)) return raw.locations;
  return [];
}

function pickSingleLocation(raw, id) {
  if (Array.isArray(raw)) {
    return raw.find((x) => String(x?.id ?? '') === String(id)) ?? raw[0] ?? null;
  }
  if (raw && typeof raw === 'object') {
    if (Array.isArray(raw.items)) {
      return raw.items.find((x) => String(x?.id ?? '') === String(id)) ?? raw.items[0] ?? null;
    }
    if (Array.isArray(raw.locations)) {
      return raw.locations.find((x) => String(x?.id ?? '') === String(id)) ?? raw.locations[0] ?? null;
    }
    if (raw.item) return raw.item;
    if (raw.location) return raw.location;
    return raw;
  }
  return null;
}

function findLocationInList(raw, id) {
  const items = normalizeArray(raw);
  return items.find((x) => String(x?.id ?? '') === String(id)) ?? null;
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

function normalizeName(value) {
  return String(value ?? '').trim();
}

function normalizeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function getExistingLocation(baseUrl, locationId, token, timeoutMs) {
  const singleUrl = `${baseUrl}/Locations/${locationId}`;
  try {
    const r = await requestJson({ method: 'GET', url: singleUrl, token, timeoutMs });
    if (r.status >= 200 && r.status < 300) {
      return pickSingleLocation(r.body, locationId);
    }
  } catch {}

  const listUrl = `${baseUrl}/Locations`;
  const r = await requestJson({ method: 'GET', url: listUrl, token, timeoutMs });
  if (r.status < 200 || r.status >= 300) {
    throw new Error(`GET ${listUrl} failed (${r.status})`);
  }
  return findLocationInList(r.body, locationId);
}

function buildPutPayload(existing, update) {
  const base = existing && typeof existing === 'object' ? { ...existing } : {};
  const incomingName = normalizeName(update.name);
  const existingName = normalizeName(base.name ?? base.locationName);
  const payload = {
    name: incomingName || existingName,
  };

  const lat = normalizeNumber(base.latitude ?? base.lat);
  const lng = normalizeNumber(base.longitude ?? base.lng);
  if (lat != null) payload.latitude = lat;
  if (lng != null) payload.longitude = lng;

  return payload;
}

function matchesExpected(actual, expected) {
  const actualName = normalizeName(actual?.name ?? actual?.locationName);
  const expectedName = normalizeName(expected?.name);
  const nameOk = actualName === expectedName;
  return { ok: nameOk, nameOk, actualName };
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
      const before = await getExistingLocation(baseUrl, id, token, args.timeoutMs);
      if (!before) {
        throw new Error('Location not found');
      }

      const beforeMatch = matchesExpected(before, update);
      let after = before;

      if (args.apply && !args.verifyOnly && !beforeMatch.ok) {
        const put = await requestJson({
          method: 'PUT',
          url: `${baseUrl}/Locations/${id}`,
          token,
          timeoutMs: args.timeoutMs,
          body: buildPutPayload(before, update),
        });
        if (put.status < 200 || put.status >= 300) {
          throw new Error(`PUT failed (${put.status}) ${typeof put.body === 'string' ? put.body : JSON.stringify(put.body)}`);
        }
        after = (await getExistingLocation(baseUrl, id, token, args.timeoutMs)) ?? after;
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
