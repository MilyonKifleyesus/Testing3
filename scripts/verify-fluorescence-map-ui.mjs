import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { chromium } from 'playwright';

function parseArgs(argv) {
  const parsed = new Map();
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      parsed.set(key, 'true');
      continue;
    }
    parsed.set(key, next);
    index += 1;
  }
  return parsed;
}

function ensureArg(args, key) {
  const value = args.get(key);
  if (!value) {
    throw new Error(`Missing required argument --${key}`);
  }
  return value;
}

function getArg(args, key, fallback = null) {
  return args.get(key) ?? fallback;
}

function waitForPort(hostName, port, timeoutMs = 180000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = new net.Socket();
      socket.setTimeout(500);
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      const onFailure = () => {
        socket.destroy();
        if (Date.now() - started >= timeoutMs) {
          reject(new Error(`Dev server did not become ready on ${hostName}:${port} within ${timeoutMs}ms`));
          return;
        }
        setTimeout(attempt, 1000);
      };
      socket.once('error', onFailure);
      socket.once('timeout', onFailure);
      socket.connect(port, hostName);
    };
    attempt();
  });
}

async function startDevServerIfNeeded(projectPath, hostName, port) {
  const isAlreadyRunning = await waitForPort(hostName, port, 1000).then(() => true).catch(() => false);
  if (isAlreadyRunning) {
    return null;
  }

  const child =
    process.platform === 'win32'
      ? spawn(
          'cmd.exe',
          ['/d', '/s', '/c', `npm.cmd start -- --host ${hostName} --port ${String(port)}`],
          {
            cwd: projectPath,
            stdio: 'ignore',
            windowsHide: true,
          },
        )
      : spawn('npm', ['start', '--', '--host', hostName, '--port', String(port)], {
          cwd: projectPath,
          stdio: 'ignore',
        });
  await waitForPort(hostName, port);
  return child;
}

function stopDevServer(child) {
  if (!child || child.killed) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    return;
  }
  child.kill('SIGTERM');
}

function runBuild(projectPath) {
  const result = spawnSync('npm.cmd', ['run', 'build'], {
    cwd: projectPath,
    encoding: 'utf8',
    shell: true,
    windowsHide: true,
  });
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  return result;
}

function shouldIgnoreRequestFailure(url, errorText = '') {
  return (
    url.includes('/@fs/') ||
    url.includes('/@vite/') ||
    errorText === 'net::ERR_ABORTED' ||
    url.includes('basemaps.cartocdn.com') ||
    url.includes('/vectortiles/')
  );
}

function isFeatureApiUrl(url) {
  return url.includes('/api/');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function artifactFile(outputDir, prefix, name) {
  return path.join(outputDir, `${prefix}${name}`);
}

async function authenticateIfNeeded(page, username, password, routeUrl) {
  const hasLoginForm =
    (await page.locator('input[formcontrolname="username"]').count()) > 0 &&
    (await page.locator('input[formcontrolname="password"]').count()) > 0;

  if (!hasLoginForm && !page.url().includes('/custom/sign-in')) {
    return false;
  }

  await page.fill('input[formcontrolname="username"]', username);
  await page.fill('input[formcontrolname="password"]', password);
  await Promise.all([
    page.waitForLoadState('domcontentloaded'),
    page.locator('button[type="submit"]').click(),
  ]);
  await page.waitForTimeout(1500);
  await page.goto(routeUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  return true;
}

async function waitForFeatureReady(page) {
  await page.waitForSelector('app-fluorescence-map', { state: 'visible', timeout: 60000 });
  await page.waitForSelector('#war-room-map', { state: 'visible', timeout: 60000 });
  await page.waitForSelector('button[aria-label="Zoom in"]', { state: 'visible', timeout: 60000 });
  await page.waitForSelector('button[aria-label="Zoom out"]', { state: 'visible', timeout: 60000 });
  await page.waitForTimeout(1500);
}

async function ensureFeatureRouteLoaded(page, routeUrl, username, password) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if ((await page.locator('app-fluorescence-map').count()) > 0) {
      return;
    }
    await page.goto(routeUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    await authenticateIfNeeded(page, username, password, routeUrl);
    await page.waitForTimeout(1200);
  }
}

async function openFiltersPanel(page) {
  const filtersButton = page.locator('button[aria-label="Toggle filters"]').first();
  await filtersButton.evaluate((button) => button.click());
  await page.waitForSelector('#war-room-filters-panel', { state: 'visible', timeout: 30000 });
}

async function closeFiltersPanel(page) {
  const panel = page.locator('#war-room-filters-panel');
  if (!(await panel.isVisible().catch(() => false))) return;
  await panel.locator('.btn-close').evaluate((button) => button.click());
  await page.waitForSelector('#war-room-filters-panel', { state: 'hidden', timeout: 30000 });
}

async function applyFiltersPanel(page) {
  await page.locator('#war-room-filters-panel .btn.btn-primary', { hasText: 'Apply' }).evaluate((button) => button.click());
  await page.waitForSelector('#war-room-filters-panel', { state: 'hidden', timeout: 30000 });
  await page.waitForTimeout(1500);
}

async function resetDraftFilters(page) {
  const resetButton = page.locator('#war-room-filters-panel .btn.btn-link', { hasText: 'Reset All' }).first();
  if (await resetButton.isVisible().catch(() => false)) {
    await resetButton.evaluate((button) => button.click());
    await page.waitForTimeout(250);
  }
}

async function clearAppliedFilters(page) {
  const clearButton = page.locator('button', { hasText: 'Clear All Filters' }).first();
  if (await clearButton.isVisible().catch(() => false)) {
    await clearButton.evaluate((button) => button.click());
    await page.waitForTimeout(1500);
    return true;
  }
  const toolbarClear = page.locator('button', { hasText: /^Clear$/ }).first();
  if (await toolbarClear.isVisible().catch(() => false)) {
    await toolbarClear.evaluate((button) => button.click());
    await page.waitForTimeout(1200);
    return true;
  }
  return false;
}

async function ensureTableOpen(page) {
  const row = page.locator('.fleet-table tbody tr').first();
  if (await row.isVisible().catch(() => false)) {
    return;
  }
  const button = page.locator('button[aria-label="Toggle table"]').first();
  await button.evaluate((element) => element.click());
  await page.waitForTimeout(500);
}

async function ensureTableClosed(page) {
  const row = page.locator('.fleet-table tbody tr').first();
  if (!(await row.isVisible().catch(() => false))) {
    return;
  }
  const button = page.locator('button[aria-label="Toggle table"]').first();
  await button.evaluate((element) => element.click());
  await page.waitForTimeout(500);
}

async function ensureProjectMode(page) {
  const button = page.locator('.fleet-mode-tabs button', { hasText: 'Projects' }).first();
  if (await button.isVisible().catch(() => false)) {
    await button.click();
    await page.waitForTimeout(250);
  }
}

async function resetScenarioState(page) {
  const drawerClose = page.locator('.data-drawer .drawer-head button').first();
  if (await drawerClose.isVisible().catch(() => false)) {
    await drawerClose.click();
    await page.waitForSelector('.data-drawer', { state: 'hidden', timeout: 5000 }).catch(() => null);
  }
  await closeFiltersPanel(page);
  await clearAppliedFilters(page);
  await ensureProjectMode(page);
  await ensureTableClosed(page);
  await page.keyboard.press('Escape').catch(() => null);
  await page.waitForTimeout(500);
}

async function selectManufacturerDraft(page, manufacturerName) {
  const panel = page.locator('#war-room-filters-panel');
  const section = panel.locator('.fleet-filter-section-card').filter({
    has: page.locator('.form-label', { hasText: 'Manufacturer' }),
  }).first();
  const search = section.locator('input[aria-label="Search manufacturers"]').first();
  if (await search.isVisible().catch(() => false)) {
    await search.fill(manufacturerName);
    await page.waitForTimeout(250);
  }

  const option = section.locator('.filter-option-row').filter({
    has: page.locator('.option-label', { hasText: new RegExp(`^${escapeRegExp(manufacturerName)}$`, 'i') }),
  }).first();
  await option.click();
  await page.waitForTimeout(250);
}

async function selectProjectTypeDraft(page, projectTypeName = null) {
  const panel = page.locator('#war-room-filters-panel');
  const section = panel.locator('.fleet-filter-section-card').filter({
    has: page.locator('.form-label', { hasText: 'Project Type' }),
  }).first();
  const search = section.locator('input[aria-label="Search project types"]').first();
  if (projectTypeName && await search.isVisible().catch(() => false)) {
    await search.fill(projectTypeName);
    await page.waitForTimeout(250);
  }

  const candidate = projectTypeName
    ? section.locator('.filter-option-row').filter({
        has: page.locator('.option-label', { hasText: new RegExp(`^${escapeRegExp(projectTypeName)}$`, 'i') }),
      }).first()
    : section.locator('.filter-option-row').first();

  const label = await candidate.locator('.option-label').first().textContent().catch(() => null);
  await candidate.click();
  await page.waitForTimeout(250);
  return label?.trim() ?? null;
}

async function setStatusDraft(page, statusText) {
  const button = page.locator('#war-room-filters-panel .filter-status-option', { hasText: statusText }).first();
  await button.click();
  await page.waitForTimeout(200);
}

async function toggleRegionDraft(page, regionName) {
  const panel = page.locator('#war-room-filters-panel');
  const section = panel.locator('.fleet-filter-section-card').filter({
    has: page.locator('.form-label', { hasText: 'Regions' }),
  }).first();
  const option = section.locator('.filter-option-row').filter({
    has: page.locator('.option-label', { hasText: new RegExp(`^${escapeRegExp(regionName)}$`, 'i') }),
  }).first();
  await option.click();
  await page.waitForTimeout(250);
}

async function selectRegionDraft(page, regionName = null) {
  const panel = page.locator('#war-room-filters-panel');
  const section = panel.locator('.fleet-filter-section-card').filter({
    has: page.locator('.form-label', { hasText: 'Regions' }),
  }).first();
  const candidate = regionName
    ? section.locator('.filter-option-row').filter({
        has: page.locator('.option-label', { hasText: new RegExp(`^${escapeRegExp(regionName)}$`, 'i') }),
      }).first()
    : section.locator('.filter-option-row').first();
  const label = await candidate.locator('.option-label').first().textContent().catch(() => null);
  await candidate.click();
  await page.waitForTimeout(250);
  return label?.trim() ?? null;
}

async function probeFilterPanel(page) {
  await openFiltersPanel(page);
  const result = await page.locator('#war-room-filters-panel .fleet-filter-overlay-body').evaluate((element) => {
    const styles = getComputedStyle(element);
    const before = element.scrollTop;
    element.scrollTop = before + 120;
    const after = element.scrollTop;
    return {
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      overflowY: styles.overflowY,
      moved: after > before,
    };
  });
  await closeFiltersPanel(page);
  return result;
}

function summarizeAccessibilityNode(node, summary = { nodes: 0, buttons: 0, dialogs: 0, headings: 0, links: 0, images: 0 }) {
  if (!node) {
    return summary;
  }
  summary.nodes += 1;
  if (node.role === 'button') summary.buttons += 1;
  if (node.role === 'dialog') summary.dialogs += 1;
  if (node.role === 'heading') summary.headings += 1;
  if (node.role === 'link') summary.links += 1;
  if (node.role === 'img' || node.role === 'image') summary.images += 1;
  for (const child of node.children ?? []) {
    summarizeAccessibilityNode(child, summary);
  }
  return summary;
}

async function captureAccessibility(page, routePath, viewportLabel) {
  const tree = typeof page.accessibility?.snapshot === 'function'
    ? await page.accessibility.snapshot({ interestingOnly: false }).catch(() => null)
    : await page.evaluate(() => {
        const describeNode = (element) => {
          const role =
            element.getAttribute('role')
            || (element.tagName === 'BUTTON' ? 'button' : null)
            || (element.tagName === 'A' ? 'link' : null)
            || (element.tagName === 'INPUT' ? 'input' : null)
            || (element.tagName === 'IMG' ? 'image' : null)
            || (element.tagName.match(/^H[1-6]$/) ? 'heading' : null);
          const name =
            element.getAttribute('aria-label')
            || element.getAttribute('aria-labelledby')
            || element.textContent?.trim()
            || '';
          const children = Array.from(element.children ?? [])
            .slice(0, 25)
            .map((child) => describeNode(child));
          return {
            role: role || 'generic',
            name,
            children,
          };
        };
        return describeNode(document.body);
      });
  return {
    routePath,
    viewport: viewportLabel,
    summary: summarizeAccessibilityNode(tree),
    tree,
  };
}

function buildMarkdownReport({
  routeUrl,
  artifactPrefix,
  summary,
  domPath,
  consolePath,
  networkPath,
  accessibilityPath,
}) {
  const lines = [
    '# Fluorescence Map Verification Report',
    '',
    `- Route: ${routeUrl}`,
    `- Artifact prefix: ${artifactPrefix || '(none)'}`,
    '',
    '## What Changed',
    '',
    '- Verification harness captured the requested route and scenario artifacts for the current milestone prefix.',
    '',
    '## What Screenshots Prove',
    '',
    ...Object.entries(summary.desktopScenarioScreenshots ?? {}).map(([name, file]) => `- ${name}: ${file}`),
    `- tablet: ${summary.tabletScreenshot}`,
    ...(summary.mobileScreenshot ? [`- mobile: ${summary.mobileScreenshot}`] : []),
    `- basemap fallback: ${summary.basemapFallbackScreenshot}`,
    '',
    '## Fixed',
    '',
    `- Filter panel scroll probe moved: ${summary.desktop?.filterPanelProbe?.moved ? 'yes' : 'no'}`,
    `- Desktop overlap detected: ${summary.desktop?.overlapDetected ? 'yes' : 'no'}`,
    `- Tablet overlap detected: ${summary.tablet?.overlapDetected ? 'yes' : 'no'}`,
    `- Mobile overlap detected: ${summary.mobile?.overlapDetected ? 'yes' : 'no'}`,
    `- No-match empty state visible: ${summary.desktop?.noMatchOverlayVisible ? 'yes' : 'no'}`,
    `- Basemap fallback warning visible: ${String(summary.basemapFallback?.fallbackWarning ?? '').length > 0 ? 'yes' : 'no'}`,
    '',
    '## Still Fails',
    '',
    '- Review console/network/accessibility artifacts for any remaining runtime issues not promoted to verifier failures.',
    '',
    '## Deferred',
    '',
    '- Code-level root-cause analysis is outside the verifier report and should be summarized separately with the milestone implementation notes.',
    '',
    '## Artifact Index',
    '',
    `- Summary: ${summary.summaryPath}`,
    `- DOM: ${domPath}`,
    `- Console: ${consolePath}`,
    `- Network: ${networkPath}`,
    `- Accessibility: ${accessibilityPath}`,
    `- Video: ${summary.desktopVideo}`,
  ];
  return `${lines.join('\n')}\n`;
}

async function captureDesktopScenarioSet({
  browser,
  routeUrl,
  routePath,
  username,
  password,
  outputDir,
  artifactPrefix,
}) {
  const viewport = { width: 1440, height: 1200 };
  const context = await browser.newContext({
    viewport,
    recordVideo: {
      dir: outputDir,
      size: viewport,
    },
  });
  const page = await context.newPage();
  const consoleMessages = [];
  const requestFailures = [];
  const badResponses = [];
  const fatalMapErrors = [];

  page.on('console', (message) => {
    const entry = {
      type: message.type(),
      text: message.text(),
    };
    consoleMessages.push(entry);
    if (entry.text.includes('Map fatal error detail:')) {
      fatalMapErrors.push(entry);
    }
  });

  page.on('requestfailed', (request) => {
    const entry = {
      url: request.url(),
      method: request.method(),
      errorText: request.failure()?.errorText ?? 'requestfailed',
    };
    if (!shouldIgnoreRequestFailure(entry.url, entry.errorText)) {
      requestFailures.push(entry);
    }
  });

  page.on('response', (response) => {
    const entry = {
      url: response.url(),
      method: response.request().method(),
      status: response.status(),
    };
    if (entry.status >= 400 && !shouldIgnoreRequestFailure(entry.url)) {
      badResponses.push(entry);
    }
  });

  await page.goto(routeUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  const didLogin = await authenticateIfNeeded(page, username, password, routeUrl);
  if (didLogin) {
    consoleMessages.length = 0;
    requestFailures.length = 0;
    badResponses.length = 0;
    fatalMapErrors.length = 0;
  }

  await ensureFeatureRouteLoaded(page, routeUrl, username, password);
  await waitForFeatureReady(page);

  const defaultScreenshot = artifactFile(outputDir, artifactPrefix, 'verification.png');
  const filtersOpenScreenshot = artifactFile(outputDir, artifactPrefix, 'verification-filters-open.png');
  const tableCollapsedScreenshot = artifactFile(outputDir, artifactPrefix, 'verification-table-collapsed.png');
  const manufacturerScreenshot = artifactFile(outputDir, artifactPrefix, 'verification-manufacturer-arboc.png');
  const projectTypeScreenshot = artifactFile(outputDir, artifactPrefix, 'verification-project-type.png');
  const regionScreenshot = artifactFile(outputDir, artifactPrefix, 'verification-region.png');
  const statusScreenshot = artifactFile(outputDir, artifactPrefix, 'verification-status-active.png');
  const noMatchScreenshot = artifactFile(outputDir, artifactPrefix, 'verification-no-match.png');
  const rowSelectedScreenshot = artifactFile(outputDir, artifactPrefix, 'verification-row-selected.png');
  const markerSelectedScreenshot = artifactFile(outputDir, artifactPrefix, 'verification-marker-selected.png');
  const drawerOpenScreenshot = artifactFile(outputDir, artifactPrefix, 'verification-drawer-open.png');
  const videoPath = artifactFile(outputDir, artifactPrefix, 'verification-video.webm');

  await page.screenshot({ path: defaultScreenshot, fullPage: true });

  const projectButton = page.locator('.fleet-mode-tabs button', { hasText: 'Projects' }).first();
  const clientButton = page.locator('.fleet-mode-tabs button', { hasText: 'Clients' }).first();
  const manufacturerButton = page.locator('.fleet-mode-tabs button', { hasText: 'Manufacturers' }).first();
  if (await manufacturerButton.isVisible().catch(() => false)) {
    await manufacturerButton.evaluate((button) => button.click());
    await page.waitForTimeout(250);
  }
  if (await clientButton.isVisible().catch(() => false)) {
    await clientButton.evaluate((button) => button.click());
    await page.waitForTimeout(250);
  }
  await projectButton.evaluate((button) => button.click());
  await page.waitForTimeout(250);
  await page.locator('button[aria-label="Zoom in"]').first().evaluate((button) => button.click());
  await page.waitForTimeout(400);
  await page.locator('button[aria-label="Zoom out"]').first().evaluate((button) => button.click());
  await page.waitForTimeout(600);

  const filterPanelProbe = await probeFilterPanel(page);

  await openFiltersPanel(page);
  await page.screenshot({ path: filtersOpenScreenshot, fullPage: true });
  await closeFiltersPanel(page);

  const tableButton = page.locator('button[aria-label="Toggle table"]').first();
  await tableButton.evaluate((button) => button.click());
  await page.waitForTimeout(500);
  const tableCollapsed = await page.evaluate(
    () => document.querySelector('.fleet-shell')?.classList.contains('table-collapsed') ?? false
  );
  await page.screenshot({ path: tableCollapsedScreenshot, fullPage: true });
  await tableButton.evaluate((button) => button.click());
  await page.waitForTimeout(500);

  await resetScenarioState(page);
  await openFiltersPanel(page);
  await resetDraftFilters(page);
  await selectManufacturerDraft(page, 'Arboc');
  await applyFiltersPanel(page);
  await page.screenshot({ path: manufacturerScreenshot, fullPage: true });

  await resetScenarioState(page);
  await openFiltersPanel(page);
  await resetDraftFilters(page);
  const projectTypeLabel = await selectProjectTypeDraft(page);
  await applyFiltersPanel(page);
  await page.screenshot({ path: projectTypeScreenshot, fullPage: true });

  await resetScenarioState(page);
  await openFiltersPanel(page);
  await resetDraftFilters(page);
  const regionLabel = await selectRegionDraft(page);
  await applyFiltersPanel(page);
  await page.screenshot({ path: regionScreenshot, fullPage: true });

  await resetScenarioState(page);
  await openFiltersPanel(page);
  await resetDraftFilters(page);
  await setStatusDraft(page, 'Active');
  await applyFiltersPanel(page);
  await page.screenshot({ path: statusScreenshot, fullPage: true });

  await resetScenarioState(page);
  await openFiltersPanel(page);
  await resetDraftFilters(page);
  await selectManufacturerDraft(page, 'Arboc');
  await toggleRegionDraft(page, 'Europe');
  await applyFiltersPanel(page);
  await page.waitForSelector('.empty-state-overlay', { state: 'visible', timeout: 10000 }).catch(() => null);
  const noMatchOverlayVisible = await page.locator('.empty-state-overlay').isVisible().catch(() => false);
  await page.screenshot({ path: noMatchScreenshot, fullPage: true });

  await resetScenarioState(page);
  await ensureTableOpen(page);
  const firstRow = page.locator('.fleet-table tbody tr').first();
  const rowSelectedVisible = await firstRow.isVisible().catch(() => false);
  if (rowSelectedVisible) {
    await firstRow.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: rowSelectedScreenshot, fullPage: true });
  }

  await resetScenarioState(page);
  const firstMarker = page.locator('.markers-overlay .marker-container[role="button"]').first();
  const markerVisible = await firstMarker.isVisible().catch(() => false);
  if (markerVisible) {
    await firstMarker.evaluate((element) => element.click());
    await page.waitForTimeout(700);
    await page.screenshot({ path: markerSelectedScreenshot, fullPage: true });
  }

  await resetScenarioState(page);
  await ensureTableOpen(page);
  const firstEditButton = page.locator('.fleet-table tbody tr .row-actions button', { hasText: 'Edit' }).first();
  const drawerRelevant = await firstEditButton.isVisible().catch(() => false);
  if (drawerRelevant) {
    await firstEditButton.click();
    await page.waitForSelector('.data-drawer', { state: 'visible', timeout: 10000 }).catch(() => null);
    await page.screenshot({ path: drawerOpenScreenshot, fullPage: true });
  }

  await resetScenarioState(page);
  await waitForFeatureReady(page);

  const domSummary = await page.evaluate(({ routePathValue }) => {
    const rectFor = (selector) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    };

    const mapStage = document.querySelector('.fleet-shell-map-stage');
    const tableZone = document.querySelector('.fleet-shell-table-zone');
    const overlapDetected = (() => {
      if (!mapStage || !tableZone) return false;
      const mapRect = mapStage.getBoundingClientRect();
      const tableRect = tableZone.getBoundingClientRect();
      return !(mapRect.bottom <= tableRect.top || tableRect.bottom <= mapRect.top);
    })();

    return {
      viewport: 'desktop',
      routePath: routePathValue,
      currentUrl: location.pathname + location.search,
      shellVisible: !!document.querySelector('.fleet-shell'),
      mapVisible: !!document.querySelector('#war-room-map'),
      zoomInVisible: !!document.querySelector('button[aria-label="Zoom in"]'),
      zoomOutVisible: !!document.querySelector('button[aria-label="Zoom out"]'),
      tableZoneRect: rectFor('.fleet-shell-table-zone'),
      mapStageRect: rectFor('.fleet-shell-map-stage'),
      overlapDetected,
    };
  }, { routePathValue: routePath });
  const accessibility = await captureAccessibility(page, routePath, 'desktop');

  const video = page.video();
  await context.close();
  if (video) {
    await video.saveAs(videoPath);
  }

  return {
    viewport: 'desktop',
    didLogin,
    tableActivated: tableCollapsed,
    filterPanelProbe,
    domSummary,
    consoleMessages,
    requestFailures,
    badResponses,
    fatalMapErrors,
    noMatchOverlayVisible,
    accessibility,
    screenshots: {
      default: defaultScreenshot,
      filtersOpen: filtersOpenScreenshot,
      tableCollapsed: tableCollapsedScreenshot,
      manufacturer: manufacturerScreenshot,
      projectType: projectTypeScreenshot,
      region: regionScreenshot,
      statusActive: statusScreenshot,
      noMatch: noMatchScreenshot,
      rowSelected: rowSelectedVisible ? rowSelectedScreenshot : null,
      markerSelected: markerVisible ? markerSelectedScreenshot : null,
      drawerOpen: drawerRelevant ? drawerOpenScreenshot : null,
    },
    scenarioMeta: {
      projectTypeLabel,
      regionLabel,
      rowSelectedVisible,
      markerVisible,
      drawerRelevant,
    },
    videoPath,
  };
}

async function captureBasemapFallbackScenario({
  browser,
  routeUrl,
  username,
  password,
  outputDir,
  artifactPrefix,
}) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1200 },
  });
  await context.route(/https:\/\/basemaps\.cartocdn\.com\/gl\/.*style\.json.*/i, (route) => route.abort());

  const page = await context.newPage();
  await page.goto(routeUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await authenticateIfNeeded(page, username, password, routeUrl);
  await ensureFeatureRouteLoaded(page, routeUrl, username, password);
  await waitForFeatureReady(page);
  await page.waitForFunction(
    () => document.body.innerText.includes('Primary basemap unavailable. Using simplified fallback map style.'),
    { timeout: 30000 }
  );
  const fallbackWarning = await page.evaluate(() => {
    const warning = document.querySelector('.map-runtime-warning');
    return warning?.textContent?.trim() ?? document.body.innerText;
  });
  const screenshotPath = artifactFile(outputDir, artifactPrefix, 'verification-basemap-fallback.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await context.close();
  return { screenshotPath, fallbackWarning };
}

async function captureViewport({
  browser,
  viewport,
  viewportName,
  routeUrl,
  routePath,
  username,
  password,
  screenshotPath,
  outputDir,
  artifactPrefix,
  recordVideo = false,
}) {
  const context = await browser.newContext({
    viewport,
    ...(recordVideo
      ? {
          recordVideo: {
            dir: outputDir,
            size: viewport,
          },
        }
      : {}),
  });
  const page = await context.newPage();
  const consoleMessages = [];
  const requestFailures = [];
  const badResponses = [];
  const fatalMapErrors = [];

  page.on('console', (message) => {
    const entry = {
      type: message.type(),
      text: message.text(),
    };
    consoleMessages.push(entry);
    if (entry.text.includes('Map fatal error detail:')) {
      fatalMapErrors.push(entry);
    }
  });

  page.on('requestfailed', (request) => {
    const entry = {
      url: request.url(),
      method: request.method(),
      errorText: request.failure()?.errorText ?? 'requestfailed',
    };
    if (!shouldIgnoreRequestFailure(entry.url, entry.errorText)) {
      requestFailures.push(entry);
    }
  });

  page.on('response', (response) => {
    const entry = {
      url: response.url(),
      method: response.request().method(),
      status: response.status(),
    };
    if (entry.status >= 400 && !shouldIgnoreRequestFailure(entry.url)) {
      badResponses.push(entry);
    }
  });

  await page.goto(routeUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  const didLogin = await authenticateIfNeeded(page, username, password, routeUrl);
  if (didLogin) {
    consoleMessages.length = 0;
    requestFailures.length = 0;
    badResponses.length = 0;
    fatalMapErrors.length = 0;
  }

  await ensureFeatureRouteLoaded(page, routeUrl, username, password);
  await waitForFeatureReady(page);

  const projectButton = page.locator('.fleet-mode-tabs button', { hasText: 'Projects' }).first();
  const clientButton = page.locator('.fleet-mode-tabs button', { hasText: 'Clients' }).first();
  const manufacturerButton = page.locator('.fleet-mode-tabs button', { hasText: 'Manufacturers' }).first();

  if (await manufacturerButton.isVisible().catch(() => false)) {
    await manufacturerButton.evaluate((button) => button.click());
    await page.waitForTimeout(250);
  }
  if (await clientButton.isVisible().catch(() => false)) {
    await clientButton.evaluate((button) => button.click());
    await page.waitForTimeout(250);
  }
  await projectButton.evaluate((button) => button.click());
  await page.waitForTimeout(250);

  const tableButton = page.locator('button[aria-label="Toggle table"]').first();
  await tableButton.evaluate((button) => button.click());
  await page.waitForTimeout(300);
  const tableActivated = await tableButton.evaluate((button) => button.classList.contains('active'));
  await tableButton.evaluate((button) => button.click());
  await page.waitForTimeout(300);

  const filterPanelProbe = await probeFilterPanel(page);

  await page.locator('button[aria-label="Zoom in"]').first().evaluate((button) => button.click());
  await page.waitForTimeout(500);
  await page.locator('button[aria-label="Zoom out"]').first().evaluate((button) => button.click());
  await page.waitForTimeout(700);

  const domSummary = await page.evaluate(({ routePathValue, viewportLabel }) => {
    const rectFor = (selector) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    };

    const mapStage = document.querySelector('.fleet-shell-map-stage');
    const tableZone = document.querySelector('.fleet-shell-table-zone');
    const overlapDetected = (() => {
      if (!mapStage || !tableZone) return false;
      const mapRect = mapStage.getBoundingClientRect();
      const tableRect = tableZone.getBoundingClientRect();
      return !(mapRect.bottom <= tableRect.top || tableRect.bottom <= mapRect.top);
    })();

    return {
      viewport: viewportLabel,
      routePath: routePathValue,
      currentUrl: location.pathname + location.search,
      shellVisible: !!document.querySelector('.fleet-shell'),
      mapVisible: !!document.querySelector('#war-room-map'),
      zoomInVisible: !!document.querySelector('button[aria-label="Zoom in"]'),
      zoomOutVisible: !!document.querySelector('button[aria-label="Zoom out"]'),
      tableZoneRect: rectFor('.fleet-shell-table-zone'),
      mapStageRect: rectFor('.fleet-shell-map-stage'),
      overlapDetected,
    };
  }, { routePathValue: routePath, viewportLabel: viewportName });
  const accessibility = await captureAccessibility(page, routePath, viewportName);

  await page.screenshot({ path: screenshotPath, fullPage: true });
  const video = page.video();
  await context.close();
  if (video) {
    await video.saveAs(artifactFile(outputDir, artifactPrefix, `verification-${viewportName}-video.webm`));
  }

  return {
    viewport: viewportName,
    didLogin,
    tableActivated,
    filterPanelProbe,
    domSummary,
    accessibility,
    consoleMessages,
    requestFailures,
    badResponses,
    fatalMapErrors,
  };
}

const args = parseArgs(process.argv);
const projectPath = process.cwd();
const hostName = getArg(args, 'hostName', '127.0.0.1');
const port = Number(getArg(args, 'port', '4200'));
const routePath = getArg(args, 'routePath', '/_dev/fluorescence-map');
const baseUrl = getArg(args, 'baseUrl', process.env.BP_BASE_URL?.trim() || `http://${hostName}:${port}`);
const routeUrl = getArg(args, 'routeUrl', `${baseUrl.replace(/\/$/, '')}${routePath}`);
const username = getArg(args, 'username', process.env.BP_TEST_USERNAME);
const password = getArg(args, 'password', process.env.BP_TEST_PASSWORD);
const outputDir = path.resolve(getArg(args, 'outputDir', path.join(projectPath, 'output', 'playwright')));
const artifactPrefixRaw = getArg(args, 'artifactPrefix', '').trim();
const artifactPrefix = artifactPrefixRaw ? `${artifactPrefixRaw.replace(/[^a-z0-9-_]+/gi, '-')}-` : '';
const skipMobile = args.get('skipMobile') === 'true';
const skipBuild = args.get('skipBuild') === 'true';

if (!username || !password) {
  throw new Error('Missing BP_TEST_USERNAME or BP_TEST_PASSWORD');
}

fs.mkdirSync(outputDir, { recursive: true });

const screenshotPaths = {
  desktop: artifactFile(outputDir, artifactPrefix, 'verification.png'),
  tablet: artifactFile(outputDir, artifactPrefix, 'verification-tablet.png'),
  mobile: artifactFile(outputDir, artifactPrefix, 'verification-mobile.png'),
};

if (!skipBuild) {
  let buildResult = runBuild(projectPath);
  const distPath = path.join(projectPath, 'dist', 'spruha');
  const buildOutput = `${buildResult.stdout ?? ''}\n${buildResult.stderr ?? ''}`;

  if (buildResult.status !== 0 && buildOutput.includes('EBUSY')) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    buildResult = runBuild(projectPath);
  }

  if (buildResult.status !== 0) {
    const retryOutput = `${buildResult.stdout ?? ''}\n${buildResult.stderr ?? ''}`;
    if (!(retryOutput.includes('EBUSY') && fs.existsSync(distPath))) {
      throw new Error(`npm run build failed with exit code ${buildResult.status}`);
    }
    process.stderr.write('[verify:fluorescence-map:ui] Build hit a locked asset; continuing with existing dist output.\n');
  }
}

let startedServer = null;
const browser = await chromium.launch({ headless: true });
try {
  startedServer = await startDevServerIfNeeded(projectPath, hostName, port);
  const desktop = await captureDesktopScenarioSet({
    browser,
    routeUrl,
    routePath,
    username,
    password,
    outputDir,
    artifactPrefix,
  });

  const tablet = await captureViewport({
    browser,
    viewport: { width: 1024, height: 1366 },
    viewportName: 'tablet',
    routeUrl,
    routePath,
    username,
    password,
    screenshotPath: screenshotPaths.tablet,
    outputDir,
    artifactPrefix,
  });

  const mobile = skipMobile
    ? null
    : await captureViewport({
        browser,
        viewport: { width: 390, height: 844 },
        viewportName: 'mobile',
        routeUrl,
        routePath,
        username,
        password,
        screenshotPath: screenshotPaths.mobile,
        outputDir,
        artifactPrefix,
      });

  const basemapFallback = await captureBasemapFallbackScenario({
    browser,
    routeUrl,
    username,
    password,
    outputDir,
    artifactPrefix,
  });

  const domSummary = { desktop: desktop.domSummary, tablet: tablet.domSummary, mobile: mobile?.domSummary ?? null };
  const accessibilitySummary = {
    desktop: desktop.accessibility,
    tablet: tablet.accessibility,
    mobile: mobile?.accessibility ?? null,
  };
  const consoleSummary = {
    desktop: desktop.consoleMessages,
    tablet: tablet.consoleMessages,
    mobile: mobile?.consoleMessages ?? [],
  };
  const networkSummary = {
    desktop: { requestFailures: desktop.requestFailures, badResponses: desktop.badResponses },
    tablet: { requestFailures: tablet.requestFailures, badResponses: tablet.badResponses },
    mobile: mobile ? { requestFailures: mobile.requestFailures, badResponses: mobile.badResponses } : null,
  };
  const summary = {
    routeUrl,
    desktopScreenshot: screenshotPaths.desktop,
    tabletScreenshot: screenshotPaths.tablet,
    mobileScreenshot: mobile ? screenshotPaths.mobile : null,
    desktopScenarioScreenshots: desktop.screenshots,
    desktopScenarioMeta: desktop.scenarioMeta,
    basemapFallbackScreenshot: basemapFallback.screenshotPath,
    desktopVideo: desktop.videoPath,
    desktop: {
      didLogin: desktop.didLogin,
      tableActivated: desktop.tableActivated,
      filterPanelProbe: desktop.filterPanelProbe,
      overlapDetected: desktop.domSummary.overlapDetected,
      noMatchOverlayVisible: desktop.noMatchOverlayVisible,
    },
    tablet: {
      didLogin: tablet.didLogin,
      tableActivated: tablet.tableActivated,
      filterPanelProbe: tablet.filterPanelProbe,
      overlapDetected: tablet.domSummary.overlapDetected,
    },
    mobile: mobile
      ? {
          didLogin: mobile.didLogin,
          tableActivated: mobile.tableActivated,
          filterPanelProbe: mobile.filterPanelProbe,
          overlapDetected: mobile.domSummary.overlapDetected,
        }
      : null,
    basemapFallback,
  };

  const domPath = artifactFile(outputDir, artifactPrefix, 'verification-dom.json');
  const consolePath = artifactFile(outputDir, artifactPrefix, 'verification-console.json');
  const networkPath = artifactFile(outputDir, artifactPrefix, 'verification-network.json');
  const accessibilityPath = artifactFile(outputDir, artifactPrefix, 'verification-accessibility.json');
  const summaryPath = artifactFile(outputDir, artifactPrefix, 'verification-summary.json');
  summary.summaryPath = summaryPath;

  fs.writeFileSync(domPath, JSON.stringify(domSummary, null, 2));
  fs.writeFileSync(consolePath, JSON.stringify(consoleSummary, null, 2));
  fs.writeFileSync(networkPath, JSON.stringify(networkSummary, null, 2));
  fs.writeFileSync(accessibilityPath, JSON.stringify(accessibilitySummary, null, 2));
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  const reportPath = artifactFile(outputDir, artifactPrefix, 'verification-report.md');
  fs.writeFileSync(reportPath, buildMarkdownReport({
    routeUrl,
    artifactPrefix: artifactPrefixRaw,
    summary,
    domPath,
    consolePath,
    networkPath,
    accessibilityPath,
  }));

  const hasFeatureApiFailures = [desktop, tablet, mobile]
    .filter(Boolean)
    .some((result) =>
      result.requestFailures.some((entry) => isFeatureApiUrl(entry.url)) ||
      result.badResponses.some((entry) => isFeatureApiUrl(entry.url))
    );
  const hasFatalMapErrors = [desktop, tablet, mobile]
    .filter(Boolean)
    .some((result) => result.fatalMapErrors.length > 0);
  const missingControls = [desktop, tablet, mobile]
    .filter(Boolean)
    .some((result) =>
      !result.domSummary.mapVisible || !result.domSummary.zoomInVisible || !result.domSummary.zoomOutVisible
    );
  const overlapDetected = [desktop, tablet, mobile]
    .filter(Boolean)
    .some((result) => result.viewport !== 'mobile' && result.domSummary.overlapDetected);

  if (hasFeatureApiFailures) {
    throw new Error(`Verification captured failed feature API calls. See ${networkPath}`);
  }
  if (hasFatalMapErrors) {
    throw new Error(`Verification captured fatal map errors. See ${consolePath}`);
  }
  if (missingControls) {
    throw new Error(`Verification did not find required map controls. See ${domPath}`);
  }
  if (overlapDetected) {
    throw new Error(`Verification detected overlap between the map stage and table zone. See ${domPath}`);
  }
  if (!desktop.noMatchOverlayVisible) {
    throw new Error(`Verification did not surface the no-match empty-state overlay. See ${desktop.screenshots.noMatch}`);
  }
  if (!basemapFallback.fallbackWarning.toLowerCase().includes('fallback')) {
    throw new Error(`Verification did not surface the basemap fallback warning. See ${basemapFallback.screenshotPath}`);
  }

  console.log(JSON.stringify(summary, null, 2));
} finally {
  await browser.close();
  stopDevServer(startedServer);
}
