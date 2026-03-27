/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const rootDir = path.resolve(__dirname, '..');
const baseURL = process.env.BASE_URL || 'http://127.0.0.1:4311';
const outDir = path.join(rootDir, 'output', 'playwright', 'project-activities-analysis');
const authStatePath = path.join(rootDir, 'output', 'playwright', 'auth-state.json');

fs.mkdirSync(outDir, { recursive: true });

function nowIso() {
  return new Date().toISOString();
}

function normalizeEndpoint(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.pathname;
  } catch {
    return rawUrl;
  }
}

function safeFilename(input) {
  return input.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase();
}

async function main() {
  if (!fs.existsSync(authStatePath)) {
    throw new Error(`Missing auth state: ${authStatePath}`);
  }

  const storageState = JSON.parse(fs.readFileSync(authStatePath, 'utf8'));
  const clientOrigin = storageState.origins?.find((origin) => origin.origin.includes('127.0.0.1') || origin.origin.includes('localhost'));
  if (clientOrigin?.localStorage) {
    clientOrigin.origin = baseURL;
    clientOrigin.localStorage = clientOrigin.localStorage.filter((entry) => entry?.name !== 'buspulse_common_dashboard_layout_client');
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState,
    viewport: { width: 1440, height: 1100 },
  });
  const page = await context.newPage();

  try {
    capturing: false,
    pending: 0,
    lastActivityAt: 0,
    entries: [],
  };

  page.on('request', (request) => {
    const url = request.url();
    if (!tracker.capturing || !url.includes('/api/')) {
      return;
    }

    tracker.pending += 1;
    tracker.lastActivityAt = Date.now();
    tracker.entries.push({
      phase: 'request',
      ts: nowIso(),
      url,
      endpoint: normalizeEndpoint(url),
      method: request.method(),
      requestBodyBytes: request.postDataBuffer()?.length ?? 0,
      queryBytes: new URL(url).search.length,
    });
  });

  page.on('response', async (response) => {
    const url = response.url();
    if (!tracker.capturing || !url.includes('/api/')) {
      return;
    }

    tracker.lastActivityAt = Date.now();
    let sizes = null;
    try {
      const req = response.request();
      if (typeof req.sizes === 'function') {
        sizes = await req.sizes();
      }
    } catch {
      sizes = null;
    }

    if (!tracker.capturing) return;

    tracker.entries.push({
      phase: 'response',
      ts: nowIso(),
      url,
      endpoint: normalizeEndpoint(url),
      method: response.request().method(),
      status: response.status(),
      statusText: response.statusText(),
      sizes,
      contentLength: Number(response.headers()['content-length'] ?? 0) || 0,
    });
  });

  page.on('requestfailed', (request) => {
    const url = request.url();
    if (!tracker.capturing || !url.includes('/api/')) {
      return;
    }

    tracker.lastActivityAt = Date.now();
    tracker.entries.push({
      phase: 'failed',
      ts: nowIso(),
      url,
      endpoint: normalizeEndpoint(url),
      method: request.method(),
      failure: request.failure()?.errorText ?? 'unknown',
    });
  });

  page.on('requestfinished', (request) => {
    const url = request.url();
    if (!tracker.capturing || !url.includes('/api/')) {
      return;
    }

    tracker.pending = Math.max(0, tracker.pending - 1);
    tracker.lastActivityAt = Date.now();
  });

  await page.goto(`${baseURL}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector(".widget-card[data-widget-id='widget-project-activities']", { timeout: 120000 });

  const results = {
    baseURL,
    capturedAt: nowIso(),
    steps: [],
    notes: {
      search: 'No dedicated search input found on the dashboard/project-activities widget.',
      sorting: 'No sortable headers were found on the project-activities table.',
    },
  };

  async function sampleWidgetState() {
    return page.evaluate(() => {
      const widget = document.querySelector(".widget-card[data-widget-id='widget-project-activities']");
      if (!widget) {
        return {
          present: false,
          skeletonRows: 0,
          dataRows: 0,
          pageLabel: '',
          summaryVisible: false,
        };
      }

      const skeletonRows = widget.querySelectorAll('.pa-tr--skeleton').length;
      const bodyRows = Array.from(widget.querySelectorAll('.pa-table tbody tr'))
        .filter((row) => !row.classList.contains('pa-tr--skeleton')).length;
      const pageLabel = widget.querySelector('.pa-page-label')?.textContent?.trim() ?? '';

      return {
        present: true,
        skeletonRows,
        dataRows: bodyRows,
        pageLabel,
        summaryVisible: !!widget.querySelector('.pa-summary-bar'),
      };
    });
  }

  async function runStep(name, action) {
    const stepKey = safeFilename(name);
    tracker.capturing = true;
    tracker.pending = 0;
    tracker.lastActivityAt = Date.now();
    tracker.entries = [];
    await page.evaluate(() => performance.clearResourceTimings());

    const samples = [];
    const startedAt = Date.now();
    await action();

    let idleFor = 0;
    while (Date.now() - startedAt < 45000) {
      samples.push({
        t: Date.now() - startedAt,
        ...(await sampleWidgetState()),
      });

      const now = Date.now();
      idleFor = tracker.pending === 0 ? now - tracker.lastActivityAt : 0;
      if (idleFor >= 1000 && now - startedAt >= 1000) {
        break;
      }

      await page.waitForTimeout(120);
    }

    await page.waitForTimeout(250);
    const resourceEntries = await page.evaluate(() =>
      performance.getEntriesByType('resource')
        .filter((entry) => entry.name.includes('/api/'))
        .map((entry) => ({
          name: entry.name,
          initiatorType: entry.initiatorType,
          duration: Number(entry.duration.toFixed(2)),
          transferSize: entry.transferSize,
          encodedBodySize: entry.encodedBodySize,
          decodedBodySize: entry.decodedBodySize,
          startTime: Number(entry.startTime.toFixed(2)),
        })),
    );
    tracker.capturing = false;

    const requestRecords = tracker.entries.filter((entry) => entry.phase === 'request');
    const responseRecords = tracker.entries.filter((entry) => entry.phase === 'response');
    const failedRecords = tracker.entries.filter((entry) => entry.phase === 'failed');
    const endpointCounts = {};

    for (const entry of requestRecords) {
      endpointCounts[entry.endpoint] = (endpointCounts[entry.endpoint] ?? 0) + 1;
    }

    const duplicates = Object.entries(endpointCounts)
      .filter(([, count]) => count > 1)
      .sort((left, right) => right[1] - left[1])
      .map(([endpoint, count]) => ({ endpoint, count }));

    const totalTransferSize = resourceEntries.reduce((sum, entry) => sum + (entry.transferSize || 0), 0);
    const totalEncodedBodySize = resourceEntries.reduce((sum, entry) => sum + (entry.encodedBodySize || 0), 0);
    const totalRequestBodyBytes = requestRecords.reduce((sum, entry) => sum + (entry.requestBodyBytes || 0) + (entry.queryBytes || 0), 0);

    const stepResult = {
      name,
      screenshot: path.join('output', 'playwright', 'project-activities-analysis', `${stepKey}.png`),
      durationMs: Date.now() - startedAt,
      requestCount: requestRecords.length,
      responseCount: responseRecords.length,
      failedCount: failedRecords.length,
      duplicates,
      totalTransferSize,
      totalEncodedBodySize,
      totalRequestBodyBytes,
      skeletonSeen: samples.some((sample) => sample.skeletonRows > 0),
      maxSkeletonRows: Math.max(0, ...samples.map((sample) => sample.skeletonRows)),
      minDataRows: Math.min(...samples.map((sample) => sample.dataRows)),
      maxDataRows: Math.max(...samples.map((sample) => sample.dataRows)),
      firstPageLabel: samples[0]?.pageLabel ?? '',
      lastPageLabel: samples[samples.length - 1]?.pageLabel ?? '',
      resourceEntries,
      requestRecords,
      responseRecords,
      failedRecords,
      samples,
    };

    await page.screenshot({ path: path.join(outDir, `${stepKey}.png`), fullPage: true });
    results.steps.push(stepResult);
    console.log(`[${name}] ${stepResult.requestCount} requests, ${stepResult.totalTransferSize}B transfer, skeletonSeen=${stepResult.skeletonSeen}`);
  }

  await runStep('initial-load-settle', async () => {
    await page.waitForTimeout(100);
  });

  const nextButton = page.locator(".widget-card[data-widget-id='widget-project-activities'] .pa-page-btn:has-text('Next')").first();
  if (await nextButton.isVisible().catch(() => false) && await nextButton.isEnabled().catch(() => false)) {
    await runStep('pagination-next', async () => {
      await nextButton.click();
    });
  } else {
    results.steps.push({ name: 'pagination-next', skipped: true, reason: 'Next pagination button was not enabled.' });
  }

  const projectOptions = await page.$$eval('#projectFilter option', (options) =>
    options.map((option) => ({ value: option.value, label: option.textContent?.trim() ?? '' })),
  );
  const firstProject = projectOptions.find((option) => option.value && option.value !== 'all');
  if (firstProject) {
    await runStep('filter-project', async () => {
      await page.selectOption('#projectFilter', firstProject.value);
    });
  } else {
    results.steps.push({ name: 'filter-project', skipped: true, reason: 'No concrete project option was available.' });
  }

  const vehicleOptions = await page.$$eval('#vehicleFilter option', (options) =>
    options.map((option) => ({ value: option.value, label: option.textContent?.trim() ?? '' })),
  );
  const firstVehicle = vehicleOptions.find((option) => option.value && option.value !== 'all');
  if (firstVehicle) {
    await runStep('filter-vehicle', async () => {
      await page.selectOption('#vehicleFilter', firstVehicle.value);
    });
  } else {
    results.steps.push({ name: 'filter-vehicle', skipped: true, reason: 'No concrete vehicle option was available.' });
  }

  const hasAllOption = projectOptions.some((option) => option.value === 'all');
  if (hasAllOption) {
    await runStep('repeat-project-filter', async () => {
      await page.selectOption('#projectFilter', 'all');
    });
  } else {
    results.steps.push({ name: 'repeat-project-filter', skipped: true, reason: 'No "all" option was available in project filter.' });
  }

  const summaryPath = path.join(outDir, 'summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(results, null, 2));
  console.log(`Saved analysis to ${summaryPath}`);

  } finally {
    if (context) await context.close();
    if (browser) await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
