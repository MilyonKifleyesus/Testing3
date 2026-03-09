import fs from 'node:fs';
import https from 'node:https';

function parseArgs(argv) {
  const args = {
    baseUrl: 'https://api.fleetpulse.net/api',
    inputFile: 'scripts/client-updates.by-id.json',
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

function normalizeArray(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object' && Array.isArray(raw.items)) return raw.items;
  if (raw && typeof raw === 'object' && Array.isArray(raw.clients)) return raw.clients;
  return [];
}

function pickSingleClient(raw, id) {
  if (Array.isArray(raw)) {
    return raw.find((x) => String(x?.clientId ?? x?.id ?? '') === String(id)) ?? raw[0] ?? null;
  }
  if (raw && typeof raw === 'object') {
    if (Array.isArray(raw.items)) {
      return raw.items.find((x) => String(x?.clientId ?? x?.id ?? '') === String(id)) ?? raw.items[0] ?? null;
    }
    if (Array.isArray(raw.clients)) {
      return raw.clients.find((x) => String(x?.clientId ?? x?.id ?? '') === String(id)) ?? raw.clients[0] ?? null;
    }
    if (raw.item) return raw.item;
    if (raw.client) return raw.client;
    return raw;
  }
  return null;
}

function pickSingleLocation(raw, id) {
  if (Array.isArray(raw)) {
    return raw.find((x) => String(x?.id ?? '') === String(id)) ?? raw[0] ?? null;
  }
  if (raw && typeof raw === 'object') {
    if (Array.isArray(raw.items)) {
      return raw.items.find((x) => String(x?.id ?? '') === String(id)) ?? raw.items[0] ?? null;
    }
    if (raw.item) return raw.item;
    if (raw.location) return raw.location;
    return raw;
  }
  return null;
}

function findClientInList(raw, id) {
  const items = normalizeArray(raw);
  return items.find((x) => String(x?.clientId ?? x?.id ?? '') === String(id)) ?? null;
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

async function getExistingClient(baseUrl, clientId, token, timeoutMs) {
  const singleUrl = `${baseUrl}/Clients/${clientId}`;
  try {
    const r = await requestJson({ method: 'GET', url: singleUrl, token, timeoutMs });
    if (r.status >= 200 && r.status < 300) {
      return pickSingleClient(r.body, clientId);
    }
  } catch {}

  const listUrl = `${baseUrl}/Clients`;
  const r = await requestJson({ method: 'GET', url: listUrl, token, timeoutMs });
  if (r.status < 200 || r.status >= 300) {
    throw new Error(`GET ${listUrl} failed (${r.status})`);
  }
  return findClientInList(r.body, clientId);
}

async function getExistingLocation(baseUrl, locationId, token, timeoutMs) {
  const singleUrl = `${baseUrl}/Locations/${locationId}`;
  const r = await requestJson({ method: 'GET', url: singleUrl, token, timeoutMs });
  if (r.status < 200 || r.status >= 300) {
    throw new Error(`GET ${singleUrl} failed (${r.status})`);
  }
  return pickSingleLocation(r.body, locationId);
}

function buildPutPayload(existing, update) {
  const base = existing && typeof existing === 'object' ? { ...existing } : {};
  const incomingName = String(update.customerName ?? '').trim();
  const existingCustomerName = base.customerName ?? base.clientName ?? base.name ?? incomingName;
  const payload = {
    id: base.id ?? update.id,
    clientId: base.clientId ?? update.id,
    customerName: incomingName || existingCustomerName,
    customerLogo: base.customerLogo ?? null,
    customerLogoName: base.customerLogoName ?? null,
    locationId: base.locationId ?? base.LocationId ?? null,
    latitude: Number(update.latitude),
    longitude: Number(update.longitude),
  };
  return payload;
}

function buildLocationPutPayload(existingLocation, update) {
  const base = existingLocation && typeof existingLocation === 'object' ? { ...existingLocation } : {};
  return {
    name: String(base.name ?? base.locationName ?? '').trim(),
    latitude: Number(update.latitude),
    longitude: Number(update.longitude),
  };
}

function matchesExpected(actual, expected) {
  const actualName = String(actual?.customerName ?? actual?.clientName ?? actual?.name ?? '').trim();
  const actualLat = Number(actual?.latitude ?? actual?.lat);
  const actualLng = Number(actual?.longitude ?? actual?.lng);
  const expectedName = String(expected.customerName ?? '').trim();
  const expectedLat = Number(expected.latitude);
  const expectedLng = Number(expected.longitude);
  const nameOk = actualName === expectedName;
  const latOk = Number.isFinite(actualLat) && Math.abs(actualLat - expectedLat) < 1e-6;
  const lngOk = Number.isFinite(actualLng) && Math.abs(actualLng - expectedLng) < 1e-6;
  return { ok: nameOk && latOk && lngOk, nameOk, latOk, lngOk, actualName, actualLat, actualLng };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = process.env.BP_API_TOKEN;
  if (!token) {
    throw new Error('Missing BP_API_TOKEN environment variable.');
  }

  const updates = JSON.parse(fs.readFileSync(args.inputFile, 'utf8'));
  if (!Array.isArray(updates)) {
    throw new Error('Input file must contain a JSON array.');
  }

  const rows = [];
  const baseUrl = args.baseUrl.replace(/\/+$/, '');

  for (const update of updates) {
    const id = String(update.id ?? '').trim();
    if (!id) {
      rows.push({ id: '', customerName: update.customerName ?? '', status: 'failed', error: 'Missing id' });
      continue;
    }

    try {
      const before = await getExistingClient(baseUrl, id, token, args.timeoutMs);
      if (!before) {
        throw new Error('Client not found');
      }

      const beforeMatch = matchesExpected(before, update);
      let after = before;
      let locationAction = 'not_needed';

      if (args.apply && !args.verifyOnly && !beforeMatch.ok) {
        const payload = buildPutPayload(before, update);
        const put = await requestJson({
          method: 'PUT',
          url: `${baseUrl}/Clients/${id}`,
          token,
          timeoutMs: args.timeoutMs,
          body: payload,
        });
        if (put.status < 200 || put.status >= 300) {
          throw new Error(`PUT failed (${put.status}) ${typeof put.body === 'string' ? put.body : JSON.stringify(put.body)}`);
        }
        after = (await getExistingClient(baseUrl, id, token, args.timeoutMs)) ?? after;

        // Some backends expose client coordinates from the linked location record and ignore
        // latitude/longitude fields on Clients PUT. Update the linked location as a fallback.
        const interim = matchesExpected(after, update);
        const linkedLocationId = after?.locationId ?? before?.locationId ?? null;
        const needsCoordsOnly = !interim.ok && interim.nameOk && (!interim.latOk || !interim.lngOk);
        if (needsCoordsOnly && linkedLocationId != null) {
          const location = await getExistingLocation(baseUrl, linkedLocationId, token, args.timeoutMs);
          if (!location) {
            throw new Error(`Linked location ${linkedLocationId} not found`);
          }
          const locPut = await requestJson({
            method: 'PUT',
            url: `${baseUrl}/Locations/${linkedLocationId}`,
            token,
            timeoutMs: args.timeoutMs,
            body: buildLocationPutPayload(location, update),
          });
          if (locPut.status < 200 || locPut.status >= 300) {
            throw new Error(
              `PUT /Locations/${linkedLocationId} failed (${locPut.status}) ${typeof locPut.body === 'string' ? locPut.body : JSON.stringify(locPut.body)}`
            );
          }
          locationAction = `updated:${linkedLocationId}`;
          after = (await getExistingClient(baseUrl, id, token, args.timeoutMs)) ?? after;
        } else if (linkedLocationId != null) {
          locationAction = `skipped:${linkedLocationId}`;
        }
      }

      const afterMatch = matchesExpected(after, update);
      rows.push({
        id,
        customerName: update.customerName,
        status: afterMatch.ok ? 'ok' : 'mismatch',
        action:
          args.apply && !args.verifyOnly
            ? (beforeMatch.ok ? 'unchanged' : (afterMatch.ok ? 'updated' : 'update_failed_verify'))
            : 'checked',
        locationAction,
        beforeOk: beforeMatch.ok,
        afterOk: afterMatch.ok,
        actualName: afterMatch.actualName,
        actualLat: afterMatch.actualLat,
        actualLng: afterMatch.actualLng,
      });
    } catch (error) {
      rows.push({
        id,
        customerName: update.customerName,
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
