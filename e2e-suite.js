/*
 * PM QMS — functional E2E suite over every module in Code.js pageMap.
 *
 * Drives the real SPA (nav -> render -> probe live DOM). Does NOT save:
 * every check is load / populate / interact only, so no records are written.
 *
 * Usage:
 *   node e2e-suite.js              all modules
 *   node e2e-suite.js IQC GRN      only the named ones
 *   node e2e-suite.js --headed     watch it run
 *
 * Lessons baked in from the 2026-08-02 session:
 *  - forms need ~11s before data lands (IQC ~7.5s); probing earlier gives FALSE failures
 *  - never assume an element id — every id below was read out of the form source
 *  - Settings/MastersCrud legitimately throw 'Owner mode required' when ownerMode is off
 */
const { launch, openApp, nav, frameWith, makeRunner } = require('./e2e-lib');

// Per-module expectations. `selects` are ids that must end up with >0 real options;
// `must` are ids that must simply exist once the form has settled.
// admin:true  => a thrown 'Owner mode required' is a PASS, not a failure.
const MODULES = [
  // ids below are read out of the form source, never guessed
  { name: 'GRN',            wait: 11000, must: ['btnSubmit', 'btnAddItem', 'extra-items-list'] },
  { name: 'IQC',            wait: 13000, must: ['iqcForm', 'iqcDocNo'] },
  { name: 'OQC',            wait: 11000 },
  { name: 'IPQC',           wait: 11000 },
  { name: 'Production',     wait: 11000 },
  { name: 'Dispatch',       wait: 11000 },
  { name: 'Gatepass',       wait: 11000 },
  { name: 'NCR',            wait: 11000 },
  { name: 'CustomerReturn', wait: 11000 },
  { name: 'Rework',         wait: 11000 },
  { name: 'Records',        wait: 11000 },
  { name: 'Trace',          wait: 11000 },
  { name: 'Warehouse',      wait: 11000 },
  { name: 'ControlPlan',    wait: 11000 },
  { name: 'PO',             wait: 11000 },
  { name: 'KPI',            wait: 11000 },
  { name: 'Masters',        wait: 11000 },
  // Scan opens on an operator-identity gate ("Who are you?" + Continue) before any
  // scanning UI exists. ~39 chars of visible text is the whole correct screen.
  { name: 'Scan',           wait: 9000, gate: true, must: ['opSelect'] },
  { name: 'ImportCSV',      wait: 9000  },
  { name: 'MastersCrud',    wait: 9000, admin: true },
  { name: 'Settings',       wait: 9000, admin: true },
];

// Find the frame that actually rendered the form (deepest one with real body text).
async function formFrame(page) {
  let best = null, bestLen = 0;
  for (const f of page.frames()) {
    try {
      const len = await f.evaluate(() => (document.body && document.body.innerText || '').length);
      if (len > bestLen) { bestLen = len; best = f; }
    } catch (_) {}
  }
  return bestLen > 40 ? best : null;
}

// Everything we can learn about a rendered form in one round trip.
async function probe(fr) {
  return fr.evaluate(() => {
    // Effective visibility: a box with size is NOT enough. IPQC's loading overlay is
    // dismissed via `opacity:0; pointer-events:none` and stays 1280x800 in the layout
    // forever — visible by box, invisible to the user. Walk ancestors for faded parents.
    const vis = el => {
      const r = el.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0)) return false;
      for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) return false;
      }
      return true;
    };
    const selects = [...document.querySelectorAll('select')].map(s => {
      const opts = [...s.options].map(o => o.textContent.trim());
      const real = opts.filter(t => t && !/^[—–-]?\s*(select|loading|pick|choose|all)\b/i.test(t) && !/^[—–-]+$/.test(t));
      // A select whose only option says "pick X first" / "select a job first" is a CASCADE
      // child waiting on its parent — correct behaviour, not an unpopulated select.
      const cascade = opts.length <= 1 && /\b(first|select (a|client|job)|pick)\b/i.test(opts[0] || '');
      return { id: s.id || '(anon)', total: opts.length, real: real.length,
               disabled: s.disabled, visible: vis(s), cascade };
    });
    const body = document.body.innerText || '';
    // Only count text the user can actually SEE: innerText picks up <script> bodies and
    // hidden tab panels, which produced five false failures on the first run.
    const visibleText = [...document.querySelectorAll('body *')]
      .filter(e => e.children.length === 0 && vis(e))
      .map(e => e.textContent.trim()).filter(Boolean);
    const seen = visibleText.join('\n');
    // Material Icons render their ligature name as text ("error", "warning"), so an icon
    // named error is NOT an error message. Require a real sentence around it.
    const errLine = visibleText.find(t =>
      /(failed|could not|not a function|undefined is not|unexpected token)/i.test(t) ||
      /\berror\b/i.test(t) && t.split(/\s+/).length > 2);
    return {
      title: (document.title || '').slice(0, 40),
      textLen: seen.length,
      loadingStuck: visibleText.filter(t => /^loading/i.test(t)).length,
      errorText: errLine ? errLine.slice(0, 90) : '',
      selects,
      inputs: document.querySelectorAll('input,textarea').length,
      buttons: [...document.querySelectorAll('button')].filter(vis).length,
      // horizontal overflow = layout regression
      overflowX: document.documentElement.scrollWidth > window.innerWidth + 2,
      scrollW: document.documentElement.scrollWidth,
      innerW: window.innerWidth,
      ids: [...document.querySelectorAll('[id]')].map(e => e.id).slice(0, 400),
    };
  });
}

(async () => {
  const only = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const list = only.length ? MODULES.filter(m => only.includes(m.name)) : MODULES;

  const browser = await launch();
  const R = makeRunner('PM QMS form suite');
  const detail = [];

  for (const mod of list) {
    // Fresh context per module: navigateTo does document.write, which destroys the SPA,
    // so reusing one page would need a reload anyway and leaks console errors between forms.
    let ctx;
    try {
      const s = await openApp(browser);
      ctx = s.ctx;
      const { page, app, errors } = s;

      const navRes = await nav(app, page, mod.name);
      await page.waitForTimeout(mod.wait);

      const fr = await formFrame(page);
      const pageErrs = errors.filter(e => e.startsWith('PAGEERR'));
      const ownerGuard = errors.some(e => /Owner mode required/i.test(e)) ||
                         (navRes !== true && /Owner mode/i.test(String(navRes)));

      if (mod.admin && ownerGuard) {
        await R.check(mod.name + ' — admin guard holds', async () => true);
        detail.push({ mod: mod.name, note: 'owner-gated (expected)' });
        await ctx.close();
        continue;
      }

      if (!fr) {
        await R.check(mod.name + ' — renders', async () => 'no frame with content');
        detail.push({ mod: mod.name, note: 'NO RENDER' });
        await ctx.close();
        continue;
      }

      const p = await probe(fr);

      // 60 chars, not 120: list screens with a legitimate empty state (CustomerReturn shows
      // "No open returns. All triaged.") are correct at ~98 chars of visible text.
      // Gate screens (Scan's operator login) are smaller still — they only have to render
      // something interactive, which the `must` ids and control-count checks already assert.
      const floor = mod.gate ? 20 : 60;
      await R.check(mod.name + ' — renders content', async () =>
        p.textLen > floor || `only ${p.textLen} chars of visible text`);

      await R.check(mod.name + ' — no page errors', async () =>
        pageErrs.length === 0 || pageErrs[0].slice(0, 100));

      await R.check(mod.name + ' — no error text on screen', async () =>
        !p.errorText || p.errorText);

      await R.check(mod.name + ' — no stuck loading placeholder', async () =>
        p.loadingStuck === 0 || `${p.loadingStuck} "Loading…" left on screen`);

      await R.check(mod.name + ' — no horizontal overflow', async () =>
        !p.overflowX || `scrollW ${p.scrollW} > viewport ${p.innerW}`);

      await R.check(mod.name + ' — interactive controls present', async () =>
        (p.inputs + p.buttons + p.selects.length) > 0 || 'no inputs/buttons/selects');

      // Every VISIBLE, non-cascade select should have been populated by its server call.
      // Hidden ones live in inactive tabs; cascade children wait on a parent selection.
      const empty = p.selects.filter(s => s.real === 0 && !s.disabled && s.visible && !s.cascade);
      await R.check(mod.name + ' — all selects populated', async () =>
        empty.length === 0 || 'empty: ' + empty.map(s => s.id).join(','));

      for (const id of (mod.must || [])) {
        await R.check(mod.name + ' — #' + id + ' exists', async () =>
          p.ids.includes(id) || 'missing');
      }

      detail.push({
        mod: mod.name,
        selects: p.selects.map(s => `${s.id}:${s.real}/${s.total}`).join(' '),
        inputs: p.inputs, buttons: p.buttons, text: p.textLen,
      });

      await ctx.close();
    } catch (e) {
      await R.check(mod.name + ' — drives without throwing', async () => 'THREW: ' + e.message.slice(0, 90));
      detail.push({ mod: mod.name, note: 'THREW ' + e.message.slice(0, 60) });
      try { if (ctx) await ctx.close(); } catch (_) {}
    }
  }

  const sum = R.report();
  console.log('\n===== per-form detail =====');
  detail.forEach(d => console.log(
    d.mod.padEnd(16) + (d.note ? d.note :
      `in=${String(d.inputs).padStart(3)} btn=${String(d.buttons).padStart(3)} txt=${String(d.text).padStart(5)}  ${d.selects || '(no selects)'}`)));

  await browser.close();
  process.exit(sum.pass === sum.total ? 0 : 1);
})();
