// src/build-report.js
import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, parseArg, CRITERIA } from './utils.js';

const url = process.env.URL || parseArg('url') || '';
const outDir = 'reports';
ensureDir(outDir);

const readJSON = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const exists = (p) => fs.existsSync(p);
const statOrNull = (p) => { try { return fs.statSync(p); } catch { return null; } };

// ---- Sources
const axeDesktopPath = path.join(outDir, 'axe-desktop.json');
const axeMobilePath  = path.join(outDir, 'axe-mobile.json');

const axeDesktop = readJSON(axeDesktopPath);
const axeMobile  = readJSON(axeMobilePath);

const pa11y = readJSON(path.join(outDir, 'pa11y.json'));
const qw = readJSON(path.join(outDir, 'qualweb.json'));
const lhMobile = readJSON(path.join(outDir, 'lighthouse-mobile.report.json')) || readJSON(path.join(outDir, 'lighthouse.report.json'));
const lhDesktop = readJSON(path.join(outDir, 'lighthouse-desktop.report.json'));

// ---- Mapping Top 10
const ruleToBucket = (ruleId) => {
  if (!ruleId) return null;
  if (/contrast/i.test(ruleId)) return 'contrast';
  if (/image-alt|input-image-alt|aria-input-field-name/i.test(ruleId)) return 'alt';
  if (/focus-order|tabindex|focus-traps?/i.test(ruleId)) return 'keyboard';
  if (/focus-visible|focus-styles/i.test(ruleId)) return 'focus';
  if (/landmark|region|document-title|page-has-heading-one|heading-order/i.test(ruleId)) return 'structure';
  if (/link-name|link-in-text-block/i.test(ruleId)) return 'links';
  if (/label|form-field|error|autocomplete/i.test(ruleId)) return 'forms';
  if (/html-has-lang|html-lang-valid/i.test(ruleId)) return 'lang';
  if (/aria/i.test(ruleId)) return 'aria';
  if (/video|audio|autoplay|media/i.test(ruleId)) return 'media';
  return null;
};

// Buckets séparés Desktop / Mobile
const makeBuckets = () => Object.fromEntries(CRITERIA.map(c => [c.key, []]));
const bucketsDesktop = makeBuckets();
const bucketsMobile  = makeBuckets();

const pushIssue = (buckets, bucket, src, id, msg, selector) => {
  if (bucket && buckets[bucket]) buckets[bucket].push({ src, id, msg, selector });
};

// Agrégation axe Desktop
let axeDesktopCount = 0;
if (axeDesktop?.violations) {
  for (const v of axeDesktop.violations) {
    axeDesktopCount += v.nodes?.length || 0;
    const b = ruleToBucket(v.id);
    v.nodes.slice(0, 20).forEach(n => pushIssue(bucketsDesktop, b, 'axe', v.id, v.help, n.target?.[0] || ''));
  }
}

// Agrégation axe Mobile
let axeMobileCount = 0;
if (axeMobile?.violations) {
  for (const v of axeMobile.violations) {
    axeMobileCount += v.nodes?.length || 0;
    const b = ruleToBucket(v.id);
    v.nodes.slice(0, 20).forEach(n => pushIssue(bucketsMobile, b, 'axe', v.id, v.help, n.target?.[0] || ''));
  }
}

// Pa11y
const pa11yCount = Array.isArray(pa11y?.issues) ? pa11y.issues.length : 0;

// QualWeb (fail uniquement)
let qwFailedCount = 0;
if (Array.isArray(qw?.reports)) {
  qw.reports.forEach(r => {
    const assertions = r.assertions ? Object.values(r.assertions) : [];
    assertions.forEach(a => {
      const verdict = a?.metadata?.verdict || a?.verdict || '';
      if (/fail/i.test(verdict)) {
        qwFailedCount++;
        const b = ruleToBucket(a.code || a.rule || a.name || '');
        const target = a?.metadata?.target?.[0] || '';
        // On n’affiche pas QualWeb dans les sections Desktop/Mobile pour éviter l’ambiguïté device
        // (il reste visible en synthèse; tu peux l’intégrer si tu veux)
      }
    });
  });
}

// Scores Lighthouse
const lhScore = (r) => (r?.categories?.accessibility?.score != null ? Math.round(r.categories.accessibility.score * 100) : null);
const scoreMobile = lhScore(lhMobile);
const scoreDesktop = lhScore(lhDesktop);
const scoreParts = [scoreMobile, scoreDesktop].filter(s => typeof s === 'number');
const overallScore = scoreParts.length ? Math.round(scoreParts.reduce((a,b)=>a+b,0) / scoreParts.length) : null;

// Durée approx (fenêtre min/max des fichiers)
const candidateFiles = [
  axeDesktopPath, axeMobilePath,
  path.join(outDir, 'pa11y.json'),
  path.join(outDir, 'qualweb.json'),
  path.join(outDir, 'lighthouse.report.json'),
  path.join(outDir, 'lighthouse-mobile.report.json'),
  path.join(outDir, 'lighthouse-desktop.report.json')
].filter(exists);
const stats = candidateFiles.map(statOrNull).filter(Boolean);
let approxDurationSec = null, windowStart = null, windowEnd = null;
if (stats.length) {
  const times = stats.flatMap(s => [s.ctimeMs, s.mtimeMs].filter(Boolean));
  const minT = Math.min(...times), maxT = Math.max(...times);
  approxDurationSec = Math.max(0, Math.round((maxT - minT) / 1000));
  windowStart = new Date(minT); windowEnd = new Date(maxT);
}

// Helpers UI
const sevClass = (n) => n === 0 ? 'ok' : n < 5 ? 'avg' : n < 15 ? 'warn' : 'fail';
const fmtNb = (n) => (typeof n === 'number' ? new Intl.NumberFormat('fr-FR').format(n) : '—');
const fmtDate = (d) => d ? d.toISOString().replace('T',' ').replace('Z',' UTC') : '—';
const gaugeColor = (s) => s>=90 ? 'var(--lh-green)' : s>=50 ? 'var(--lh-orange)' : 'var(--lh-red)';
const gauge = (label, score) => {
  const val = typeof score === 'number' ? Math.max(0, Math.min(score, 100)) : 0;
  const color = typeof score === 'number' ? gaugeColor(val) : '#e0e3e7';
  return `
  <div class="gauge">
    <div class="ring" style="--val:${val};--col:${color}"></div>
    <div class="num">${typeof score==='number'?score:'—'}</div>
    <div class="lbl">${label}</div>
  </div>`;
};

// Générateur d’une section critères (accordéon)
const renderCriteriaSection = (title, buckets, sectionId) => `
  <h2>${title}</h2>
  <div class="toolbar" role="toolbar" aria-label="Contrôles accordéon ${title}">
    <button class="btn" data-scope="${sectionId}" data-action="open-all" type="button">Tout ouvrir</button>
    <button class="btn" data-scope="${sectionId}" data-action="close-all" type="button">Tout fermer</button>
  </div>
  <section class="criteria" id="${sectionId}">
    ${CRITERIA.map((c, idx) => {
      const items = buckets[c.key];
      const sev = sevClass(items.length);
      const panelId = `${sectionId}-panel-${idx}`;
      const expanded = items.length > 0 ? 'true' : 'false'; // ouvert s'il y a des défauts
      return `
      <div class="crit">
        <div class="crit-header">
          <button class="crit-btn" aria-expanded="${expanded}" aria-controls="${panelId}">
            <span class="crit-title">
              <strong>${c.label}</strong>
              <span class="badge ${sev}">${items.length} défaut${items.length>1?'s':''}</span>
            </span>
            <span class="chev" aria-hidden="true">▶</span>
          </button>
        </div>
        <div id="${panelId}" class="crit-panel" role="region" aria-labelledby="${panelId}-label" ${items.length === 0 ? 'hidden' : ''}>
          <table>
            <thead><tr><th style="width:28%">Règle</th><th>Description</th><th>CSS cible</th></tr></thead>
            <tbody>
              ${items.slice(0,8).map(x => `
                <tr>
                  <td><span class="src">${x.src}</span>${x.id || ''}</td>
                  <td>${x.msg || ''}</td>
                  <td><code>${(x.selector || '').toString().slice(0,160)}</code></td>
                </tr>
              `).join('')}
              ${items.length === 0 ? '<tr><td colspan="3" style="color:#5f6368">RAS</td></tr>' : ''}
            </tbody>
          </table>
        </div>
      </div>`;
    }).join('')}
  </section>
`;

// ---- HTML (style Lighthouse + une colonne + deux sections)
const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Audit flash accessibilité</title>
<style>
  :root{
    --bg:#202124; --panel:#2b2b2f; --card:#fff;
    --text:#1f2937; --muted:#6b7280; --line:#e5e7eb;
    --lh-green:#0cce6b; --lh-orange:#ffa400; --lh-red:#ff4e42; --lh-blue:#1a73e8;
  }
  body{margin:0;background:#f6f7f9;color:var(--text);font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,Arial}
  header{background:linear-gradient(135deg,var(--bg),#1b2a4c); color:#e8eaed; padding:24px 28px}
  header .title{font-size:20px;font-weight:700}
  header .meta{opacity:.8;font-size:12px;margin-top:6px}
  .container{max-width:1120px;margin:0 auto;padding:20px}
  .panel{background:#fff;border:1px solid var(--line);border-radius:12px;box-shadow:0 2px 6px rgba(0,0,0,.06);padding:16px}
  /* Gauges */
  .gauges{display:flex;gap:18px;flex-wrap:wrap}
  .gauge{position:relative;width:120px;height:120px;display:flex;flex-direction:column;align-items:center;justify-content:center}
  .gauge .ring{width:100px;height:100px;border-radius:50%;
    background:conic-gradient(var(--col) calc(var(--val)*1%), #e0e3e7 0);
    mask:radial-gradient(circle 40px at 50% 50%, transparent 99%, #000 100%);
    -webkit-mask:radial-gradient(circle 40px at 50% 50%, transparent 99%, #000 100%);
    box-shadow:inset 0 0 0 8px #fff;
  }
  .gauge .num{position:absolute;font-size:22px;font-weight:800}
  .gauge .lbl{margin-top:8px;font-size:12px;color:#374151}
  /* Summary */
  .summary{display:grid;grid-template-columns:2fr 1fr;gap:16px;margin-top:16px}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
  .card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:14px}
  .k{font-size:12px;color:var(--muted);margin-bottom:4px}
  .v{font-size:20px;font-weight:700}
  h2{font-size:16px;margin:24px 0 12px}
  /* Criteria (1 colonne + accordéon) */
  .criteria{display:grid;grid-template-columns:1fr;gap:14px}
  .crit{background:#fff;border:1px solid var(--line);border-radius:12px;overflow:hidden}
  .crit-header{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:#fff}
  .crit-title{display:flex;align-items:center;gap:8px}
  .crit-btn{appearance:none;background:none;border:0;color:inherit;width:100%;text-align:left;padding:0;display:flex;align-items:center;justify-content:space-between;cursor:pointer}
  .chev{transition:transform .2s ease}
  .crit-btn[aria-expanded="true"] .chev{transform:rotate(90deg)}
  .crit-panel{padding:0 14px 12px 14px;display:block}
  .crit-panel[hidden]{display:none}
  .badge{display:inline-block;border-radius:999px;padding:2px 8px;font-size:12px;margin-left:8px;color:#111}
  .ok{background:#e6f4ea}.avg{background:#fff4e5}.warn{background:#fde7e9}.fail{background:#ffd6d1}
  table{width:100%;border-collapse:collapse;margin-top:8px}
  th,td{border-top:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top;font-size:13px}
  .src{font-size:11px;border:1px solid var(--line);border-radius:8px;padding:2px 6px;margin-right:6px;white-space:nowrap}
  code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  /* Toolbar accordéon */
  .toolbar{display:flex;gap:8px;margin:8px 0 12px}
  .btn{appearance:none;border:1px solid var(--line);background:#fff;border-radius:8px;padding:8px 10px;cursor:pointer}
  .btn:hover{background:#f1f5f9}
  footer{color:#5f6368;text-align:center;font-size:12px;margin:24px 0}
  @media (max-width: 860px){ .summary{grid-template-columns:1fr} }
</style>
</head>
<body>

<header>
  <div class="title">Audit flash accessibilité ${url ? `<span style="opacity:.85">— ${url}</span>` : ''}</div>
  <div class="meta">Généré le ${fmtDate(new Date())}</div>
</header>

<div class="container">
  <section class="panel">
    <div class="gauges">
      ${gauge('Score global', overallScore ?? '—')}
      ${gauge('LH Mobile', scoreMobile ?? '—')}
      ${gauge('LH Desktop', scoreDesktop ?? '—')}
    </div>

    <div class="summary">
      <div class="cards">
        <div class="card"><div class="k">Défauts axe (Desktop)</div><div class="v">${fmtNb(axeDesktopCount)}</div></div>
        <div class="card"><div class="k">Défauts axe (Mobile)</div><div class="v">${fmtNb(axeMobileCount)}</div></div>
        <div class="card"><div class="k">Issues Pa11y</div><div class="v">${fmtNb(pa11yCount)}</div></div>
        <div class="card"><div class="k">Échecs QualWeb</div><div class="v">${fmtNb(qwFailedCount)}</div></div>
      </div>
      <div class="cards">
        <div class="card"><div class="k">Durée approx.</div><div class="v">${approxDurationSec!=null ? (approxDurationSec<60 ? `${approxDurationSec}s` : `${Math.floor(approxDurationSec/60)}m ${approxDurationSec%60}s`) : '—'}</div></div>
        <div class="card"><div class="k">Fenêtre d'exécution</div><div class="v" style="font-size:12px;line-height:1.3">${(windowStart&&windowEnd)?`${fmtDate(windowStart)} → ${fmtDate(windowEnd)}`:'—'}</div></div>
      </div>
    </div>
  </section>

  ${renderCriteriaSection('Top 10 critères — Desktop', bucketsDesktop, 'criteria-desktop')}
  ${renderCriteriaSection('Top 10 critères — Mobile',  bucketsMobile,  'criteria-mobile')}

  <footer>Inspiré du design Lighthouse • Sources : axe-core (Desktop & Mobile), Pa11y, Lighthouse, QualWeb</footer>
</div>

<script>
  // Toggle individuel
  document.querySelectorAll('.crit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const expanded = btn.getAttribute('aria-expanded') === 'true';
      const panel = document.getElementById(btn.getAttribute('aria-controls'));
      btn.setAttribute('aria-expanded', String(!expanded));
      if (panel) panel.hidden = expanded;
    });
  });

  // Ouvrir / Fermer tous (scopé par section)
  const setAll = (scopeId, open) => {
    document.querySelectorAll('#'+scopeId+' .crit-btn').forEach(btn => {
      btn.setAttribute('aria-expanded', String(open));
      const panel = document.getElementById(btn.getAttribute('aria-controls'));
      if (panel) panel.hidden = !open;
    });
  };
  document.querySelectorAll('[data-action="open-all"]').forEach(b => {
    b.addEventListener('click', () => setAll(b.dataset.scope, true));
  });
  document.querySelectorAll('[data-action="close-all"]').forEach(b => {
    b.addEventListener('click', () => setAll(b.dataset.scope, false));
  });
</script>

</body>
</html>`;

// Écriture
const out = path.join(outDir, 'flash-report.html');
fs.writeFileSync(out, html, 'utf8');
console.log(`✅ Rapport agrégé : ${out}`);
