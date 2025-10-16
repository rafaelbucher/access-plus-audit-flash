// src/export-summary-pdf.js
// Rend reports/summary.html en PDF (reports/summary.pdf) via Puppeteer.

import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';

const summaryHtml = path.resolve('reports', 'summary.html');
const summaryPdf  = path.resolve('reports', 'summary.pdf');

function ensureExists(p) {
  if (!fs.existsSync(p)) {
    console.error(`❌ Fichier introuvable : ${p}\nAssure-toi d'avoir exécuté build-summary avant.`);
    process.exit(1);
  }
}

ensureExists(summaryHtml);

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage();

  // Ouvre le fichier local
  const fileUrl = 'file://' + summaryHtml;
  await page.goto(fileUrl, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.emulateMediaType('screen');

  // PDF A4 avec fonds, marges fines
  const pdf = await page.pdf({
    path: summaryPdf,
    printBackground: true,
    preferCSSPageSize: true, // respecte @page si défini
    margin: { top: '12mm', right: '10mm', bottom: '12mm', left: '10mm' }
  });

  await browser.close();
  console.log(`📄 PDF généré : ${summaryPdf}`);
})();
