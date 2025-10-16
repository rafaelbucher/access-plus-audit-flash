// src/utils.js
import fs from 'node:fs';

export function ensureDir(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
}

export function parseArg(name) {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : null;
}

// Top 10 “buckets” utilisés pour regrouper les problèmes
export const CRITERIA = [
  { key: 'contrast',   label: 'Contraste' },
  { key: 'alt',        label: 'Alternatives textuelles' },
  { key: 'keyboard',   label: 'Navigation clavier / ordre du focus' },
  { key: 'focus',      label: 'Visibilité du focus' },
  { key: 'structure',  label: 'Structure sémantique (titres, landmarks)' },
  { key: 'links',      label: 'Liens (nom accessible, contexte)' },
  { key: 'forms',      label: 'Formulaires (labels, erreurs, autocomplete)' },
  { key: 'lang',       label: 'Langue du document' },
  { key: 'aria',       label: 'ARIA (rôles, attributs valides)' },
  { key: 'media',      label: 'Médias (vidéo/audio : sous-titres, auto-lecture)' }
];
