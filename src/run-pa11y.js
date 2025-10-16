// src/run-pa11y.js
// Lance Pa11y en Node API, filtre errors+warnings, gère les certificats douteux et le fallback http↔https.
// Sorties : reports/pa11y.json & reports/pa11y.html

import fs from 'node:fs';
import path from 'node:path';
import pa11y from 'pa11y';
import { ensureDir, parseArg } from './utils.js';
import htmlReporter from 'pa11y-reporter-html';

const inputUrl = process.env.URL || parseArg('url') || '';
if (!inputUrl) {
  console.error('❌ Fournis URL=https://exemple.com (ou --url=...)');
  process.exit(1);
}

const outDir = 'reports';
ensureDir(outDir);

const OUT_JSON = path.join(outDir, 'pa11y.json');
const OUT_HTML = path.join(outDir, 'pa11y.html');

// Permettre de changer le standard via env si besoin (par défaut WCAG2AA)
const STANDARD = (process.env.PA11Y_STANDARD || 'WCAG2AA').toUpperCase(); // 'WCAG2A' | 'WCAG2AA' | 'WCAG2AAA'

// Options Pa11y stables (éviter standard: null)
const baseOpts = {
  timeout: 60000,
  wait: 1000,
  standard: STANDARD, // ✅ Fix: standard explicite
  chromeLaunchConfig: {
    ignoreHTTPSErrors: true,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--ignore-certificate-errors'
    ]
  },
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36', // évite certains blocs
  log: { debug: () => {}, error: console.error, info: () => {} }
};

function toHttps(u) { try { const x = new URL(u); x.protocol = 'https:'; return x.toString(); } catch { return u; } }
function toHttp(u) { try { const x = new URL(u); x.protocol = 'http:';  return x.toString(); } catch { return u; } }

async function runOnce(u) { return await pa11y(u, baseOpts); }

(async () => {
  let url = inputUrl;
  console.log(`▶️  Pa11y (${STANDARD}) → ${url}`);

  let results;
  try {
    results = await runOnce(url);
  } catch (e1) {
    const isHttps = /^https:/i.test(url);
    const alt = isHttps ? toHttp(url) : toHttps(url);
    console.warn(`⚠️  Pa11y a échoué sur ${url}. Tentative sur ${alt}. Motif: ${e1?.message || e1}`);
    try {
      results = await runOnce(alt);
      url = alt;
    } catch (e2) {
      console.error(`❌ Pa11y a rencontré une erreur bloquante: ${e2?.message || e2}`);
      // On écrit un JSON minimal pour ne pas bloquer la synthèse
      fs.writeFileSync(OUT_JSON, JSON.stringify({ url, error: e2?.message || String(e2), standard: STANDARD }, null, 2), 'utf8');
      process.exit(1);
    }
  }

  // Filtre: uniquement errors + warnings (ignore notices)
  const filtered = {
    url,
    standard: STANDARD,
    issues: (results.issues || []).filter(i => /^(error|warning)$/i.test(i.type || '')),
    documentTitle: results.documentTitle || '',
    pageUrl: results.pageUrl || url,
    timestamp: new Date().toISOString()
  };

  fs.writeFileSync(OUT_JSON, JSON.stringify(filtered, null, 2), 'utf8');

  // HTML via reporter officiel
  const html = await htmlReporter.results(filtered);
  fs.writeFileSync(OUT_HTML, html, 'utf8');

  console.log(`✅ Pa11y : ${OUT_JSON} & ${OUT_HTML}`);
})().catch(err => {
  console.error('❌ Pa11y a échoué :', err?.stack || err);
  process.exit(1);
});
