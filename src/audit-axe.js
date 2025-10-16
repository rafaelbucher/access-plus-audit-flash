// src/audit-axe.js
import fs from 'node:fs';
import path from 'node:path';
import { chromium, devices } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { createHtmlReport } from 'axe-html-reporter';
import { ensureDir, parseArg } from './utils.js';

const url = process.env.URL || parseArg('url') || '';
if (!url) { console.error('❌ Fournis URL=https://exemple.com (ou --url=...)'); process.exit(1); }

const modeArg = (parseArg('mode') || '').toLowerCase();
const mode = modeArg === 'mobile' ? 'mobile' : 'desktop';

const outDir = 'reports';
ensureDir(outDir);

const headless = process.env.HEADLESS !== 'false';
const OUT_JSON = path.join(outDir, `axe-${mode}.json`);
const OUT_HTML = path.join(outDir, `axe-${mode}.html`);

// Profil mobile explicite (plus robuste que le défaut)
const MOBILE_PROFILE = {
  ...devices['Pixel 5'],
  userAgent:
    'Mozilla/5.0 (Linux; Android 12; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  viewport: { width: 393, height: 851 },
  deviceScaleFactor: 2.75,
  isMobile: true,
  hasTouch: true,
  locale: 'fr-FR',
  colorScheme: 'light'
};

(async () => {
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    ...(mode === 'mobile' ? MOBILE_PROFILE : { locale: 'fr-FR', colorScheme: 'light' }),
    ignoreHTTPSErrors: true
  });

  // UA forcé aussi au niveau contexte (certains sites sniffent)
  await context.setExtraHTTPHeaders({
    'User-Agent':
      mode === 'mobile'
        ? MOBILE_PROFILE.userAgent
        : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
    'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8'
  });
  context.setDefaultNavigationTimeout(45000);

  const page = await context.newPage();
  console.log(`▶️  AXE (${mode}) → ${url}`);

  // Navigation robuste : networkidle -> load
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
  } catch (e) {
    console.warn(`⚠️  goto(networkidle) a échoué (${e?.message}). Tentative 'load'…`);
    await page.goto(url, { waitUntil: 'load', timeout: 45000 });
  }
  await page.waitForTimeout(1200);

  // Axe avec tags WCAG (pas de withRules pour éviter les break de versions)
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();

  fs.writeFileSync(OUT_JSON, JSON.stringify(results, null, 2), 'utf8');
  createHtmlReport({
    results,
    options: { projectKey: `AXE ${mode.toUpperCase()}`, outputDir: outDir, reportFileName: `axe-${mode}.html` }
  });

  console.log(`✅ AXE ${mode} : ${OUT_JSON} & ${OUT_HTML}`);
  await browser.close();
})().catch(err => {
  console.error('❌ AXE a échoué :', err?.stack || err);
  process.exit(1);
});
