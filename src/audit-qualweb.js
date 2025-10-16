// src/audit-qualweb.js
// Exécute QualWeb (WCAG techniques + ACT rules) en headless et écrit reports/qualweb.json
// Note : QualWeb utilise Puppeteer en interne ; on force ignoreHTTPSErrors pour tolérer des certifs douteux.

import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, parseArg } from './utils.js';
import puppeteer from 'puppeteer';

// L’API de @qualweb/core est CJS ; on passe par createRequire pour éviter les soucis d’exports en ESM.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { QualWeb } = require('@qualweb/core');

const url = process.env.URL || parseArg('url') || '';
if (!url) {
  console.error('❌ Fournis URL=https://exemple.com (ou --url=...)');
  process.exit(1);
}

const outDir = 'reports';
ensureDir(outDir);

const OUT_JSON = path.join(outDir, 'qualweb.json');

(async () => {
  console.log(`▶️  QualWeb → ${url}`);

  // Lance Puppeteer à la main pour contrôler les flags
  const browser = await puppeteer.launch({
    headless: true,
    ignoreHTTPSErrors: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors']
  });

  const qaw = new QualWeb({
    // maxParallelEvaluations: 1  // tu peux ajuster en CI
  });

  await qaw.start({ browser });

  // Modules à activer (WCAG techniques + ACT rules)
  const modules = {
    'act-rules': true,
    'wcag-techniques': true
  };

  // Options d’exécution : on limite à une URL
  const opts = {
    execute: modules,
    // Timeout par page (ms)
    maxPages: 1,
    timeout: 60000
  };

  // Évalue l’URL
  const reports = await qaw.evaluate({ url }, opts).catch(e => {
    console.warn(`⚠️  evaluate() a rencontré un problème: ${e?.message || e}`);
    return null;
  });

  await qaw.stop();
  await browser.close();

  const payload = {
    url,
    generatedAt: new Date().toISOString(),
    reports: reports ? Object.values(reports) : []
  };

  fs.writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`✅ QualWeb : ${OUT_JSON}`);
})().catch(err => {
  console.error('❌ QualWeb a échoué :', err?.stack || err);
  process.exit(1);
});
