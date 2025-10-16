// src/clean.js
import fs from 'node:fs';

try { fs.rmSync('reports', { recursive: true, force: true }); } catch {}
fs.mkdirSync('reports', { recursive: true });
console.log('🧹 Dossier reports/ purgé et recréé.');