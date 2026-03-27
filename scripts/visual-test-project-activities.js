/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

async function run() {
  const rootDir = path.resolve(__dirname, '..');
  const baseURL = process.env.BASE_URL || 'http://localhost:4200';
  const storagePath = path.join(rootDir, 'output', 'playwright', 'auth-state.json');
  const outDir = path.join(rootDir, 'output', 'playwright', 'visual-test');
  fs.mkdirSync(outDir, { recursive: true });

  if (!fs.existsSync(storagePath)) {
    throw new Error(`Missing storage state: ${storagePath}`);
  }

  const baseStorageState = JSON.parse(fs.readFileSync(storagePath, 'utf8'));
  const themes = ['dark', 'light'];

  for (const theme of themes) {
    const storageState = JSON.parse(JSON.stringify(baseStorageState));

    const origin = storageState.origins?.[0];
    if (!origin) throw new Error('auth-state.json has no origins[0]');
    if (!Array.isArray(origin.localStorage)) origin.localStorage = [];

    // Remove layout persistence so widget set matches defaults (widget-project-activities should be present).
    origin.localStorage = origin.localStorage.filter((ls) => ls?.name !== 'buspulse_common_dashboard_layout_client');

    // Update theme-related localStorage.
    for (const ls of origin.localStorage) {
      if (ls?.name === 'buspulse-theme') ls.value = theme;
      if (ls?.name === 'rixzo-ng') {
        try {
          const parsed = JSON.parse(ls.value);
          parsed.theme = theme;
          // Keep theme in rixzo config consistent with buspulse-theme.
          ls.value = JSON.stringify(parsed);
        } catch {
          // If parsing fails, leave as-is.
        }
      }
    }

    // Ensure buspulse-theme exists even if not present in storage.
    if (!origin.localStorage.some((ls) => ls?.name === 'buspulse-theme')) {
      origin.localStorage.push({ name: 'buspulse-theme', value: theme });
    }

    const browser = await chromium.launch();
    const context = await browser.newContext({ storageState });
    const page = await context.newPage();

    try {
      await page.goto(`${baseURL}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 60000 });

      // If auth failed, we will screenshot the sign-in page and skip the rest.
      if (!page.url().includes('dashboard')) {
        console.warn(`[${theme}] Did not land on /dashboard. Current URL: ${page.url()}`);
      }

      const widgetCard = page.locator(".widget-card[data-widget-id='widget-project-activities']").first();
      await widgetCard.waitFor({ state: 'visible', timeout: 30000 });

      const normalPath = path.join(outDir, `project-activities-${theme}-normal.png`);
      await widgetCard.screenshot({ path: normalPath });

      // Confirm the "double card" fix: pa-widget surface + shadow should be removed when inside the dashboard widget.
      const doubleCardCheck = await widgetCard.locator('.pa-widget').evaluate((el) => {
        const cs = window.getComputedStyle(el);
        return {
          background: cs.backgroundColor,
          boxShadow: cs.boxShadow,
          borderRadius: cs.borderRadius,
        };
      });

      console.log(`[${theme}] pa-widget computed style inside dashboard:`, doubleCardCheck);

      // Toggle fullscreen for this widget.
      const fullscreenBtn = widgetCard.locator('button[title="Toggle fullscreen"]').first();
      await fullscreenBtn.click();

      const shell = page.locator('.project-activities-fullscreen-shell').first();
      await shell.waitFor({ state: 'visible', timeout: 30000 });

      const fullscreenPath = path.join(outDir, `project-activities-${theme}-fullscreen.png`);
      await shell.screenshot({ path: fullscreenPath });

      // Pagination test (only if "Next" is enabled).
      const nextBtn = shell.locator('button:has-text("Next")').first();
      const canClickNext = await nextBtn.isVisible().then(async (v) => (v ? nextBtn.isEnabled() : false)).catch(() => false);
      if (canClickNext) {
        await nextBtn.click();
        // Wait for UI update (pageChange emits and component updates range).
        await page.waitForTimeout(800);
        const paginationPath = path.join(outDir, `project-activities-${theme}-pagination.png`);
        await shell.screenshot({ path: paginationPath });
      } else {
        console.log(`[${theme}] Next button not clickable; pagination screenshot skipped.`);
      }

      // Exit fullscreen if possible.
      const exitBtn = page.locator('button[title="Exit fullscreen"]').first();
      if (await exitBtn.isVisible().catch(() => false)) {
        await exitBtn.click();
        await shell.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
      }
    } finally {
      await context.close();
      await browser.close();
    }
  }

  console.log(`Screenshots saved under: ${outDir}`);
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

