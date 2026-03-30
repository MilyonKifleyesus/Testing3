import fs from 'node:fs';
import https from 'node:https';

function parseArgs(argv) {
  const args = {
    baseUrl: 'https://api.fleetpulse.net/api',
    inputFile: 'scripts/manufacturer-updates.by-id.json',
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
  if (!Array.isArray(raw)) return [];
  if (raw.length === 1 && Array.isArray(raw[0])) return raw[0];
  return raw;
}

function normalizeArray(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object' && Array.isArray(raw.items)) return raw.items;
  if (raw && typeof raw === 'object' && Array.isArray(raw.manufacturers)) return raw.manufacturers;
  return [];
}

function pickSingleManufacturer(raw, id) {
  if (Array.isArray(raw)) {
    return raw.find((x) => String(x?.id ?? '') === String(id)) ?? raw[0] ?? null;
  }
  if (raw && typeof raw === 'object') {
    if (Array.isArray(raw.items)) {
      return raw.items.find((x) => String(x?.id ?? '') === String(id)) ?? raw.items[0] ?? null;
    }
    if (Array.isArray(raw.manufacturers)) {
      return raw.manufacturers.find((x) => String(x?.id ?? '') === String(id)) ?? raw.manufacturers[0] ?? null;
    }
    if (raw.item) return raw.item;
    if (raw.manufacturer) return raw.manufacturer;
    return raw;
  }
  return null;
}

function findManufacturerInList(raw, id) {
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

async function getExistingManufacturer(baseUrl, manufacturerId, token, timeoutMs) {
  const singleUrl = `${baseUrl}/Manufacturers/${manufacturerId}`;
  try {
    const r = await requestJson({ method: 'GET', url: singleUrl, token, timeoutMs });
    if (r.status >= 200 && r.status < 300) {
      return pickSingleManufacturer(r.body, manufacturerId);
    }
  } catch {}

  const listUrl = `${baseUrl}/Manufacturers`;
  const r = await requestJson({ method: 'GET', url: listUrl, token, timeoutMs });
  if (r.status < 200 || r.status >= 300) {
    throw new Error(`GET ${listUrl} failed (${r.status})`);
  }
  return findManufacturerInList(r.body, manufacturerId);
}

function buildPutPayload(existing, update) {
  const base = existing && typeof existing === 'object' ? { ...existing } : {};
  const incomingName = normalizeMaybeString(update.manufacturerName);
  const existingName = normalizeMaybeString(getValue(base, ['manufacturerName', 'customerName', 'name']));
  const nextName = incomingName ?? existingName;
  const incomingLogo = normalizeMaybeString(getValue(update, ['manufacturerLogo', 'customerLogo']));
  const incomingLogoName = normalizeMaybeString(getValue(update, ['manufacturerLogoName', 'customerLogoName']));
  const existingLogo = normalizeMaybeString(getValue(base, ['manufacturerLogo', 'customerLogo']));
  const existingLogoName = normalizeMaybeString(getValue(base, ['manufacturerLogoName', 'customerLogoName']));
  const nextLogo = incomingLogo ?? existingLogo;
  const nextLogoName = incomingLogoName ?? existingLogoName;
  const locationId = getValue(base, ['locationId', 'LocationId'], getValue(update, ['locationId', 'LocationId'], 0));
  const latitude = normalizeMaybeNumber(getValue(update, ['latitude'], getValue(base, ['latitude'])));
  const longitude = normalizeMaybeNumber(getValue(update, ['longitude'], getValue(base, ['longitude'])));

  const payload = {
    id: getValue(base, ['id'], update.id),
    manufacturerName: nextName ?? '',
    manufacturerLogo: nextLogo,
    manufacturerLogoName: nextLogoName,
    customerLogo: nextLogo,
    customerLogoName: nextLogoName,
    locationId: locationId ?? 0,
    ...(latitude != null ? { latitude } : {}),
    ...(longitude != null ? { longitude } : {}),
  };
  return payload;
}

function matchesExpected(actual, expected) {
  const actualName = normalizeMaybeString(getValue(actual, ['manufacturerName', 'customerName', 'name'], '')) ?? '';
  const actualLogo = normalizeMaybeString(getValue(actual, ['manufacturerLogo', 'customerLogo']));
  const actualLogoName = normalizeMaybeString(getValue(actual, ['manufacturerLogoName', 'customerLogoName']));
  const expectedName = normalizeMaybeString(expected.manufacturerName);
  const expectedLogo = normalizeMaybeString(getValue(expected, ['manufacturerLogo', 'customerLogo']));
  const expectedLogoName = normalizeMaybeString(getValue(expected, ['manufacturerLogoName', 'customerLogoName']));
  const nameOk = expectedName == null ? true : actualName === expectedName;
  const logoOk = expectedLogo == null ? true : actualLogo === expectedLogo;
  const logoNameOk = expectedLogoName == null ? true : actualLogoName === expectedLogoName;
  return { ok: nameOk && logoOk && logoNameOk, nameOk, logoOk, logoNameOk, actualName, actualLogo, actualLogoName };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = process.env.BP_API_TOKEN;
  if (!token) {
    throw new Error('Missing BP_API_TOKEN environment variable.');
  }

  const rawUpdates = JSON.parse(fs.readFileSync(args.inputFile, 'utf8'));
  const updates = normalizeUpdates(rawUpdates);
  if (!Array.isArray(updates)) {
    throw new Error('Input file must contain a JSON array.');
  }

  const rows = [];
  const baseUrl = args.baseUrl.replace(/\/+$/, '');

  for (const update of updates) {
    const id = String(update.id ?? '').trim();
    if (!id) {
      rows.push({ id: '', manufacturerName: update.manufacturerName ?? '', status: 'failed', error: 'Missing id' });
      continue;
    }

    try {
      const before = await getExistingManufacturer(baseUrl, id, token, args.timeoutMs);
      if (!before) {
        throw new Error('Manufacturer not found');
      }

      const beforeMatch = matchesExpected(before, update);
      let after = before;

      if (args.apply && !args.verifyOnly && !beforeMatch.ok) {
        const payload = buildPutPayload(before, update);
        const put = await requestJson({
          method: 'PUT',
          url: `${baseUrl}/Manufacturers/${id}`,
          token,
          timeoutMs: args.timeoutMs,
          body: payload,
        });
        if (put.status < 200 || put.status >= 300) {
          throw new Error(`PUT failed (${put.status}) ${typeof put.body === 'string' ? put.body : JSON.stringify(put.body)}`);
        }
        after = (await getExistingManufacturer(baseUrl, id, token, args.timeoutMs)) ?? after;
      }

      const afterMatch = matchesExpected(after, update);
      rows.push({
        id,
        manufacturerName: update.manufacturerName,
        status: afterMatch.ok ? 'ok' : 'mismatch',
        action:
          args.apply && !args.verifyOnly
            ? (beforeMatch.ok ? 'unchanged' : (afterMatch.ok ? 'updated' : 'update_failed_verify'))
            : 'checked',
        beforeOk: beforeMatch.ok,
        afterOk: afterMatch.ok,
        actualName: afterMatch.actualName,
        actualLogo: afterMatch.actualLogo,
        actualLogoName: afterMatch.actualLogoName,
      });
    } catch (error) {
      rows.push({
        id,
        manufacturerName: update.manufacturerName,
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
