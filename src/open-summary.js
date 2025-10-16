// src/open-summary.js
import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';

const summaryPath = path.resolve('reports', 'summary.html');

function waitForFile(p, timeoutMs = 10000, intervalMs = 200) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => {
      if (fs.existsSync(p)) return resolve(true);
      if (Date.now() - t0 > timeoutMs) return reject(new Error('summary.html indisponible'));
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

function openFile(p) {
  const platform = process.platform;
  if (platform === 'darwin') {
    spawn('open', [p], { stdio: 'ignore', detached: true }).unref();
  } else if (platform === 'win32') {
    execFile('cmd', ['/c', 'start', '', p], { windowsHide: true });
  } else {
    spawn('xdg-open', [p], { stdio: 'ignore', detached: true }).unref();
  }
}

try {
  await waitForFile(summaryPath);
  openFile(summaryPath);
  console.log(`🌐 Ouverture du résumé : ${summaryPath}`);
} catch (e) {
  console.warn(`⚠️ Impossible d’ouvrir automatiquement ${summaryPath} : ${e.message}`);
}
