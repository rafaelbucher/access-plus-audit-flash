// src/audit-axe-static.js
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { fetch } from 'undici';
import axe from 'axe-core';
import { ensureDir, parseArg } from './utils.js';
import { createHtmlReport } from 'axe-html-reporter';

const urlIn = process.env.URL || parseArg('url') || '';
if (!urlIn) { console.error('❌ Fournis URL=https://…'); process.exit(1); }

const outDir = 'reports';
ensureDir(outDir);

// Configs
const FETCH_TIMEOUT_MS = parseInt(process.env.FETCH_TIMEOUT_MS || '20000', 10); // 20s
const MAX_BYTES = 3_000_000; // 3MB, évite de charger d’énormes HTML

function toHttps(u){ try{const x=new URL(u); x.protocol='https:'; return x.toString();}catch{return u;} }
function toHttp(u){ try{const x=new URL(u); x.protocol='http:' ; return x.toString();}catch{return u;} }

async function fetchWithTimeout(u){
  const ctrl = new AbortController();
  const t = setTimeout(()=>ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(u, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: {
        'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
        'Accept':'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // stream -> cap à MAX_BYTES
    const reader = res.body.getReader();
    let received = 0;
    let chunks = [];
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      received += value.length;
      if (received > MAX_BYTES) break;
      chunks.push(value);
    }
    const html = new TextDecoder('utf-8').decode(Buffer.concat(chunks));
    return html;
  } finally {
    clearTimeout(t);
  }
}

console.log(`▶️  AXE static (sans navigateur) sur ${urlIn}`);
let finalUrl = urlIn;
let html = '';
try {
  html = await fetchWithTimeout(finalUrl);
} catch (e1) {
  const alt = /^https:/i.test(finalUrl) ? toHttp(finalUrl) : toHttps(finalUrl);
  console.warn(`⚠️  fetch a échoué sur ${finalUrl} (${e1?.message}). Tentative : ${alt}`);
  try {
    html = await fetchWithTimeout(alt);
    finalUrl = alt;
  } catch (e2) {
    console.error(`❌ fetch a échoué à nouveau (${e2?.message}). Abandon.`);
    // Écrit un JSON minimal pour ne pas bloquer la suite
    fs.writeFileSync(path.join(outDir, 'axe-static.json'),
      JSON.stringify({ url: finalUrl, error: e2?.message || String(e2) }, null, 2));
    process.exit(1);
  }
}

// JSDOM
const dom = new JSDOM(html, {
  url: finalUrl,
  pretendToBeVisual: true,
  resources: 'usable',
  runScripts: 'outside-only'
});
const { window } = dom;

// Injecte axe-core
window.eval(axe.source);

// Exécute avec tags WCAG
const results = await window.axe.run(window.document, {
  runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa'] },
  reporter: 'v2'
});

// Sauvegarde
fs.writeFileSync(path.join(outDir, 'axe-static.json'), JSON.stringify(results, null, 2), 'utf8');
createHtmlReport({
  results,
  options: { projectKey: 'Audit Flash A11Y (static)', outputDir: outDir, reportFileName: 'axe-static.html' }
});
console.log('✅ AXE static : reports/axe-static.json & axe-static.html');
