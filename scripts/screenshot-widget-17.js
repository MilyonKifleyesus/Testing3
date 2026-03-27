/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

async function run() {
  const rootDir = path.resolve(__dirname, '..');
  const baseURL = process.env.BASE_URL || 'http://localhost:4200';
  const storagePath = path.join(rootDir, 'output', 'playwright', 'auth-state.json');
  const outDir = path.join(rootDir, 'output', 'playwright', 'widget-17-test');
  fs.mkdirSync(outDir, { recursive: true });

  if (!fs.existsSync(storagePath)) {
    throw new Error(`Missing storage state: ${storagePath}`);
  }

  const baseStorageState = JSON.parse(fs.readFileSync(storagePath, 'utf8'));
  const themes = ['light', 'dark'];

  for (const theme of themes) {
    console.log(`\n=== Theme: ${theme} ===`);
    const storageState = JSON.parse(JSON.stringify(baseStorageState));

    const origin = storageState.origins?.[0];
    if (!origin) throw new Error('auth-state.json has no origins[0]');
    if (!Array.isArray(origin.localStorage)) origin.localStorage = [];

    // Remove layout persistence so default widgets are present
    origin.localStorage = origin.localStorage.filter(
      (ls) => ls?.name !== 'buspulse_common_dashboard_layout_client',
    );

    // Update theme localStorage
    for (const ls of origin.localStorage) {
      if (ls?.name === 'buspulse-theme') ls.value = theme;
      if (ls?.name === 'rixzo-ng') {
        try {
          const parsed = JSON.parse(ls.value);
          parsed.theme = theme;
          ls.value = JSON.stringify(parsed);
        } catch { /* leave as-is */ }
      }
    }
    if (!origin.localStorage.some((ls) => ls?.name === 'buspulse-theme')) {
      origin.localStorage.push({ name: 'buspulse-theme', value: theme });
    }

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      storageState,
      viewport: { width: 1600, height: 900 },
    });
    const page = await context.newPage();

    try {
      await page.goto(`${baseURL}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 60000 });

      if (!page.url().includes('dashboard')) {
        console.warn(`[${theme}] Not on dashboard. URL: ${page.url()}`);
        const loginPath = path.join(outDir, `login-redirect-${theme}.png`);
        await page.screenshot({ path: loginPath, fullPage: false });
        continue;
      }

      console.log(`[${theme}] On dashboard. Waiting for widget-17...`);

      // Wait for widget-17 card to appear
      const widgetCard = page.locator(".widget-card[data-widget-id='widget-17']").first();
      await widgetCard.waitFor({ state: 'visible', timeout: 30000 });

      // Scroll it into view
      await widgetCard.scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);

      // Screenshot immediately (may show skeleton/loading)
      const loadingPath = path.join(outDir, `widget-17-${theme}-loading.png`);
      await widgetCard.screenshot({ path: loadingPath });
      console.log(`[${theme}] Loading screenshot saved`);

      // Wait for the TBV list or empty state to appear (data loaded)
      const tbvList = widgetCard.locator('.tbv-list, .tbv-empty').first();
      const loaded = await tbvList.waitFor({ state: 'visible', timeout: 60000 }).then(() => true).catch(() => false);

      if (loaded) {
        await page.waitForTimeout(800); // let bar animations finish
        const normalPath = path.join(outDir, `widget-17-${theme}-loaded.png`);
        await widgetCard.screenshot({ path: normalPath });
        console.log(`[${theme}] Loaded screenshot saved`);

        // Check KPI pills
        const kpiCount = await widgetCard.locator('.tbv-kpi-pill').count();
        console.log(`[${theme}] KPI pills found: ${kpiCount}`);

        // Check rows
        const rowCount = await widgetCard.locator('.tbv-row').count();
        console.log(`[${theme}] Rows on page: ${rowCount}`);

        // Hover over first row to see tooltip
        const firstRow = widgetCard.locator('.tbv-row').first();
        if (await firstRow.isVisible().catch(() => false)) {
          await firstRow.hover();
          await page.waitForTimeout(400);
          const hoverPath = path.join(outDir, `widget-17-${theme}-hover.png`);
          await widgetCard.screenshot({ path: hoverPath });
          console.log(`[${theme}] Hover tooltip screenshot saved`);
        }

        // Try next page
        const nextBtn = widgetCard.locator('button').filter({ hasText: /next/i }).first();
        const canNext = await nextBtn.isVisible().then(async (v) => v ? nextBtn.isEnabled() : false).catch(() => false);
        if (canNext) {
          await nextBtn.click();
          await page.waitForTimeout(600);
          const page2Path = path.join(outDir, `widget-17-${theme}-page2.png`);
          await widgetCard.screenshot({ path: page2Path });
          console.log(`[${theme}] Page 2 screenshot saved`);
        } else {
          console.log(`[${theme}] Next button not available`);
        }

        // Try fullscreen
        const fullscreenBtn = widgetCard.locator('button[title="Toggle fullscreen"]').first();
        const canFullscreen = await fullscreenBtn.isVisible().catch(() => false);
        if (canFullscreen) {
          await fullscreenBtn.click();
          await page.waitForTimeout(600);
          const fsPath = path.join(outDir, `widget-17-${theme}-fullscreen.png`);
          await page.screenshot({ path: fsPath });
          console.log(`[${theme}] Fullscreen screenshot saved`);

          // Exit fullscreen
          const exitBtn = page.locator('button[title="Exit fullscreen"]').first();
          if (await exitBtn.isVisible().catch(() => false)) {
            await exitBtn.click();
            await page.waitForTimeout(400);
          }
        }
      } else {
        console.log(`[${theme}] TBV list/empty did not appear within timeout`);
        const timeoutPath = path.join(outDir, `widget-17-${theme}-timeout.png`);
        await widgetCard.screenshot({ path: timeoutPath });
      }

      // Wide dashboard context screenshot (widget in context of the page)
      const contextPath = path.join(outDir, `widget-17-${theme}-dashboard-context.png`);
      await page.screenshot({ path: contextPath, fullPage: false });
      console.log(`[${theme}] Dashboard context screenshot saved`);

    } finally {
      await context.close();
      await browser.close();
    }
  }

  console.log(`\nAll screenshots saved to: ${outDir}`);
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
