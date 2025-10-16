// src/build-summary.js
import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, parseArg } from './utils.js';

const url = process.env.URL || parseArg('url') || '';
const outDir = 'reports';
ensureDir(outDir);

const readJSON = p => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const exists = p => fs.existsSync(p);

// Entrées
const P = {
  axeDesktop: path.join(outDir, 'axe-desktop.json'),
  axeMobile:  path.join(outDir, 'axe-mobile.json'),
  lhDesktop:  path.join(outDir, 'lighthouse-desktop.report.json'),
  lhMobile:   path.join(outDir, 'lighthouse-mobile.report.json'),
  lhAny:      path.join(outDir, 'lighthouse.report.json'),
  pa11y:      path.join(outDir, 'pa11y.json')
};

// Chargement
const axeD = readJSON(P.axeDesktop);
const axeM = readJSON(P.axeMobile);
const lhD  = readJSON(P.lhDesktop);
let   lhM  = readJSON(P.lhMobile) || null;
const lhAny= readJSON(P.lhAny);
if (!lhM && lhAny?.categories?.accessibility?.score != null) lhM = lhAny;
const pa11y= readJSON(P.pa11y);

// Scores LH -> donut global
const score = r => (r?.categories?.accessibility?.score != null ? Math.round(r.categories.accessibility.score * 100) : null);
const sD = score(lhD);
const sM = score(lhM);
const parts = [sD, sM].filter(v => typeof v === 'number');
const overall = parts.length ? Math.round(parts.reduce((a,b)=>a+b,0)/parts.length) : null;

// Simplification FR pour messages
function frExplain(id = '', msg = '') {
  const lowId = (id||'').toLowerCase();
  const low   = (msg||'').toLowerCase();
  if (lowId.includes('color-contrast') || low.includes('contrast')) {
    return { p:'Contraste insuffisant', f:'Augmenter le contraste (texte plus foncé / fond plus clair) jusqu’à être lisible.' };
  }
  if (lowId.includes('image-alt') || (low.includes('image') && low.includes('alt'))) {
    return { p:'Image sans description', f:'Ajouter un texte alternatif (alt) court et descriptif ou alt="" si décorative.' };
  }
  if (lowId.includes('link-name') || (low.includes('link') && (low.includes('name')||low.includes('text')))) {
    return { p:'Lien non explicite', f:'Donner un libellé clair (ou aria-label) ex. « Télécharger le guide ».' };
  }
  if (low.includes('button') && (low.includes('name')||low.includes('text'))) {
    return { p:'Bouton sans libellé', f:'Ajouter un texte visible ou aria-label décrivant l’action.' };
  }
  if (lowId.includes('label') || (low.includes('form') && low.includes('label'))) {
    return { p:'Champ sans étiquette', f:'Associer un <label> clair (ou aria-label si label visible impossible).' };
  }
  if (lowId.includes('document-title') || low.includes('document title')) {
    return { p:'Titre de page manquant', f:'Ajouter un titre court et descriptif.' };
  }
  if (lowId.includes('html-has-lang') || low.includes('lang attribute')) {
    return { p:'Langue non définie', f:'Indiquer la langue principale (ex. lang="fr").' };
  }
  if (lowId.includes('focus-visible') || (low.includes('focus') && low.includes('visible'))) {
    return { p:'Repère de focus invisible', f:'Afficher un contour net au focus clavier.' };
  }
  if (lowId.includes('heading') || lowId.includes('landmark') || low.includes('structure')) {
    return { p:'Structure confuse', f:'Utiliser une hiérarchie de titres logique et des zones (header, nav, main, footer).' };
  }
  if (lowId.includes('aria')) {
    return { p:'ARIA incorrecte', f:'Limiter ARIA au nécessaire, privilégier le HTML sémantique valide.' };
  }
  return { p:'Problème d’accessibilité', f:'Appliquer la bonne pratique indiquée par la règle.' };
}

// Regroupement AXE par règle (id) + limite 10
function groupAxe(axeJson) {
  if (!axeJson?.violations) return [];
  const byRule = new Map();
  for (const v of axeJson.violations) {
    const id = v.id || 'rule';
    const cur = byRule.get(id) || { id, count:0, msg:v.help || v.description || '' , tags:(v.tags||[]) };
    cur.count += (v.nodes?.length || 1);
    byRule.set(id, cur);
  }
  // trie par fréquence desc, prend 10
  return Array.from(byRule.values())
    .sort((a,b)=>b.count - a.count)
    .slice(0, 10)
    .map(x => {
      const { p, f } = frExplain(x.id, x.msg);
      return { rule:x.id, count:x.count, problem:p, fix:f, tags:x.tags||[] };
    });
}

// Pa11y : ne garder que errors|warnings, regrouper par code (type d’erreur), max 10 groupes, max 5 exemples comptés
const paAll = Array.isArray(pa11y?.issues) ? pa11y.issues.filter(i => /^(error|warning)$/i.test(i.type||'')) : [];
const paByCode = new Map();
for (const it of paAll) {
  const code = it.code || '__unknown__';
  const entry = paByCode.get(code) || { code, type: it.type || 'error', msg: it.message || '', examples:0 };
  if (entry.examples < 5) entry.examples += 1; // max 5 par type
  paByCode.set(code, entry);
}
const paGroups = Array.from(paByCode.values())
  .sort((a,b)=> b.examples - a.examples)
  .slice(0, 10) // max 10 groupes
  .map(g => {
    const { p, f } = frExplain(g.code, g.msg);
    return { code:g.code, type:g.type, examples:g.examples, problem:p, fix:f };
  });

// Estimation du niveau WCAG (A/AA/AAA) depuis AXE (tags)
function estimateWcagLevel(axeList = []) {
  const hasA  = axeList.some(v => (v.tags||[]).some(t => /wcag(2|21|22)?a(\b|$)/i.test(t) && !/aa|aaa/i.test(t)));
  const hasAA = axeList.some(v => (v.tags||[]).some(t => /wcag(2|21|22)?aa(\b|$)/i.test(t)));
  const hasAAA= axeList.some(v => (v.tags||[]).some(t => /wcag(2|21|22)?aaa(\b|$)/i.test(t)));
  if (hasA)   return { level:'Non conforme A', detail:'Des critères de niveau A échouent (minimum non atteint).' };
  if (hasAA)  return { level:'Niveau A', detail:'Les critères A semblent respectés, mais des critères AA échouent.' };
  if (hasAAA) return { level:'Niveau AA', detail:'A et AA semblent respectés, des critères AAA échouent.' };
  return { level:'Niveau AAA (estimé)', detail:'Aucune violation WCAG détectée par les outils sur A/AA/AAA.' };
}

// Calcul niveau à partir des deux contextes AXE
const axeTopD = groupAxe(axeD);
const axeTopM = groupAxe(axeM);
const wcagEst = estimateWcagLevel([...(axeTopD||[]), ...(axeTopM||[])]);

// ---------- HTML (donut + sections + page 2 Do/Don't) ----------
const SIZE = 180, CX = 90, CY = 90, R = 70, STROKE = 18;
const C = 2 * Math.PI * R;
const val = (typeof overall === 'number') ? Math.max(0, Math.min(overall, 100)) : null;
const color = val == null ? '#cbd5e1' : (val >= 90 ? '#0cce6b' : val >= 50 ? '#ffa400' : '#ff4e42');
const targetDash = val == null ? 0 : (C * val) / 100;

const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Résumé accessibilité</title>
<style>
  :root{ --bg:#f6f7f9; --text:#1f2937; --panel:#ffffff; --line:#e5e7eb; --ring:#e6e6e6; }
  body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,Arial}
  .container{max-width:980px;margin:0 auto;padding:24px}
  .header{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:20px}
  .title{margin:0;font-size:22px;font-weight:800}
  .meta{font-size:12px;color:#475569;margin-top:6px}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:20px;display:flex;align-items:center;justify-content:center}
  .gauge__label{font:800 32px/1 system-ui,-apple-system,Segoe UI,Roboto,Arial; fill:#111}
  .gauge__arc{transition:stroke-dashoffset .9s cubic-bezier(.2,0,0,1)}
  .wcag{margin-top:10px;text-align:center;font-weight:600}
  h2{font-size:16px;margin:26px 0 10px}
  .panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px}
  .list{margin:8px 0 0 18px}
  .list li{margin:6px 0}
  .muted{color:#64748b}
  .badge{display:inline-block;background:#eef2ff;border:1px solid #c7d2fe;color:#1e293b;border-radius:999px;padding:2px 8px;margin-left:8px;font-size:12px}

  /* --- Do & Don't (page dédiée pour PDF) --- */
  .page-break{page-break-before:always;margin-top:24px}
  .dodont{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:8px}
  .card-dd{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:14px}
  h2 small{color:#64748b;font-weight:400}
  .do-title,.dont-title{font-size:13px;font-weight:800;margin:0 0 8px}
  .badge-do,.badge-dont{display:inline-block;border-radius:999px;padding:2px 8px;font-size:12px}
  .badge-do{background:#e6f4ea;color:#0f5132;border:1px solid #b7e0c2}
  .badge-dont{background:#fde7e9;color:#842029;border:1px solid #f5c2c7}
  pre.code{background:#0b1222;color:#e2e8f0;border-radius:10px;padding:10px;overflow:auto}
  pre.ok{background:#0b2216}
  pre.bad{background:#2a0e0e}
  .note{font-size:12px;color:#475569;margin-top:6px}
  @media print{
    .page-break{page-break-before:always}
  }
</style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div>
        <h1 class="title">Résumé accessibilité</h1>
        <div class="meta">${url ? `${url} • ` : ''}Généré le ${new Date().toISOString().replace('T',' ').replace('Z',' UTC')}</div>
      </div>
    </div>

    <div class="card">
      <div>
        <svg viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}" aria-hidden="true">
          <circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="var(--ring)" stroke-width="${STROKE}"/>
          <g transform="rotate(-90 ${CX} ${CY})">
            <circle class="gauge__arc" data-val="${targetDash.toFixed(3)}"
              cx="${CX}" cy="${CY}" r="${R}" fill="none"
              stroke="${color}" stroke-width="${STROKE}" stroke-linecap="round"
              stroke-dasharray="${C.toFixed(3)} ${C.toFixed(3)}" stroke-dashoffset="${C.toFixed(3)}"/>
          </g>
          <text x="${CX}" y="${CY}" class="gauge__label" text-anchor="middle" dominant-baseline="middle">
            ${val != null ? val : '—'}
          </text>
        </svg>
        <div class="wcag">${wcagEst.level} <span class="muted">— ${wcagEst.detail}</span></div>
      </div>
    </div>

    <h2>AXE — Desktop<span class="badge">${axeTopD.length} règles (max 10)</span></h2>
    <div class="panel">
      ${axeTopD.length ? `<ul class="list">
        ${axeTopD.map(x => `<li><strong>${x.problem}</strong> — ${x.fix} <span class="muted">(règle : ${x.rule}, occurrences : ${x.count})</span></li>`).join('')}
      </ul>` : `<div class="muted">Aucune violation détectée.</div>`}
    </div>

    <h2>AXE — Mobile<span class="badge">${axeTopM.length} règles (max 10)</span></h2>
    <div class="panel">
      ${axeTopM.length ? `<ul class="list">
        ${axeTopM.map(x => `<li><strong>${x.problem}</strong> — ${x.fix} <span class="muted">(règle : ${x.rule}, occurrences : ${x.count})</span></li>`).join('')}
      </ul>` : `<div class="muted">Aucune violation détectée.</div>`}
    </div>

    <h2>Pa11y — erreurs & avertissements<span class="badge">${paGroups.length} groupes (max 10, 5 ex./groupe)</span></h2>
    <div class="panel">
      ${paGroups.length ? `<ul class="list">
        ${paGroups.map(g => `<li><strong>${g.problem}</strong> — ${g.fix} <span class="muted">(code : ${g.code}, exemples : ${g.examples})</span></li>`).join('')}
      </ul>` : `<div class="muted">Aucun problème rapporté.</div>`}
    </div>
  </div>

  <!-- Nouvelle page PDF : Do & Don't accessibilité -->
  <section class="page-break container">
    <h2>Do & Don’t — 5 bonnes pratiques principales <small>(snippets)</small></h2>

    <div class="dodont">
      <!-- 1. Textes alternatifs des images -->
      <div class="card-dd">
        <div class="do-title"><span class="badge-do">Do</span> Images informatives avec <code>alt</code> descriptif</div>
        <pre class="code ok"><code>&lt;img src="produit.jpg" alt="Robe rouge en lin, modèle été 2025"&gt;</code></pre>
        <div class="note">Les lecteurs d’écran annoncent l’image correctement.</div>
      </div>
      <div class="card-dd">
        <div class="dont-title"><span class="badge-dont">Don’t</span> Oublier l’<code>alt</code> ou mettre un texte vague</div>
        <pre class="code bad"><code>&lt;img src="produit.jpg"&gt;
&lt;!-- ou --&gt;
&lt;img src="produit.jpg" alt="image"&gt;</code></pre>
        <div class="note">Sans description, l’information visuelle n’est pas transmise.</div>
      </div>

      <!-- 2. Labels de formulaire -->
      <div class="card-dd">
        <div class="do-title"><span class="badge-do">Do</span> Associer les labels aux champs</div>
        <pre class="code ok"><code>&lt;label for="email"&gt;Adresse e-mail&lt;/label&gt;
&lt;input id="email" type="email" autocomplete="email"&gt;</code></pre>
        <div class="note">Le champ a un nom clair ; la saisie est facilitée.</div>
      </div>
      <div class="card-dd">
        <div class="dont-title"><span class="badge-dont">Don’t</span> Compter seulement sur le placeholder</div>
        <pre class="code bad"><code>&lt;input type="email" placeholder="Votre email"&gt;</code></pre>
        <div class="note">Le placeholder disparaît et n’est pas lu comme nom du champ.</div>
      </div>

      <!-- 3. Liens explicites -->
      <div class="card-dd">
        <div class="do-title"><span class="badge-do">Do</span> Libellés de lien explicites</div>
        <pre class="code ok"><code>&lt;a href="/guide-accessibilite.pdf"&gt;Télécharger le guide d’accessibilité (PDF)&lt;/a&gt;</code></pre>
        <div class="note">Le but du lien est compris hors contexte.</div>
      </div>
      <div class="card-dd">
        <div class="dont-title"><span class="badge-dont">Don’t</span> Liens vagues ou vides</div>
        <pre class="code bad"><code>&lt;a href="/guide-accessibilite.pdf"&gt;Cliquez ici&lt;/a&gt;
&lt;!-- ou un lien icône sans nom accessible --&gt;
&lt;a href="/pdf"&gt;&lt;svg …&gt;&lt;/svg&gt;&lt;/a&gt;</code></pre>
        <div class="note">“Cliquez ici” n’est pas compréhensible pour tous.</div>
      </div>

      <!-- 4. Focus visible -->
      <div class="card-dd">
        <div class="do-title"><span class="badge-do">Do</span> Afficher un focus clavier bien visible</div>
        <pre class="code ok"><code>/* Style de focus */
:focus-visible{
  outline: 3px solid #0cce6b;
  outline-offset: 2px;
}</code></pre>
        <div class="note">La navigation au clavier est possible et visible.</div>
      </div>
      <div class="card-dd">
        <div class="dont-title"><span class="badge-dont">Don’t</span> Supprimer le focus</div>
        <pre class="code bad"><code>*:focus{ outline: none !important; }</code></pre>
        <div class="note">Sans repère, on se perd facilement au clavier.</div>
      </div>

      <!-- 5. Structure et titres -->
      <div class="card-dd">
        <div class="do-title"><span class="badge-do">Do</span> Hiérarchie de titres logique</div>
        <pre class="code ok"><code>&lt;h1&gt;Titre de la page&lt;/h1&gt;
&lt;h2&gt;Section 1&lt;/h2&gt;
&lt;h3&gt;Sous-section&lt;/h3&gt;</code></pre>
        <div class="note">Aide à la compréhension et à la navigation rapide.</div>
      </div>
      <div class="card-dd">
        <div class="dont-title"><span class="badge-dont">Don’t</span> Utiliser des &lt;div&gt; comme titres</div>
        <pre class="code bad"><code>&lt;div class="title-xl"&gt;Titre principal&lt;/div&gt;</code></pre>
        <div class="note">Les aides techniques n’y voient pas un véritable titre.</div>
      </div>
    </div>
  </section>

  <script>
    // Anime le donut
    const arc = document.querySelector('.gauge__arc');
    if (arc) {
      const target = parseFloat(arc.getAttribute('data-val') || '0');
      const r = parseFloat(arc.getAttribute('r'));
      const C = 2 * Math.PI * r;
      const dur = 900, t0 = performance.now();
      const from = C, to = C - target;
      const ease = t => (1 - Math.pow(1 - t, 3));
      const step = (now) => {
        const p = Math.min(1, (now - t0) / dur);
        arc.style.strokeDashoffset = (from + (to - from) * ease(p)).toFixed(3);
        if (p < 1) requestAnimationFrame(step);
      };
      arc.style.strokeDashoffset = C.toFixed(3);
      requestAnimationFrame(step);
    }
  </script>
</body>
</html>`;

// Exports JSON minimal pour réutilisation éventuelle
const jsonOut = path.join(outDir, 'summary.json');
fs.writeFileSync(jsonOut, JSON.stringify({
  meta: { url: url || null, generatedAt: new Date().toISOString() },
  scores: { overall, desktop: sD, mobile: sM },
  wcagEstimatedLevel: wcagEst.level
}, null, 2), 'utf8');

const htmlOut = path.join(outDir, 'summary.html');
fs.writeFileSync(htmlOut, html, 'utf8');

console.log(`✅ Summary JSON : ${jsonOut}`);
console.log(`✅ Summary HTML : ${htmlOut}`);
