// ============================================================
// e2e-health.js — one command that answers "is the whole app healthy?"
//
//   node e2e-health.js            all pages
//   node e2e-health.js GRN IQC    named pages only
//
// Replaces reaching for six ad-hoc probes. For every page it measures the four
// things that actually decide whether the floor can use it:
//
//   shell     ms until the page's own DOM exists
//   usable    ms until the data the operator needs is populated (not just the
//             skeleton — a fast empty form is not a usable form)
//   errors    page errors and console errors, which the render suite misses
//             once a page is served live rather than from disk
//   responsive  layout at 390px: horizontal overflow, touch targets under 44px,
//             inputs under 16px (iOS zooms on focus below that)
//
// Why measured this way: reading source proves nothing here — the GAS double
// iframe changes timings by 5-20s, and several past conclusions in this repo
// were wrong because they were read rather than measured.
// ============================================================

const PW = 'C:/Users/Appex/AppData/Roaming/npm/node_modules/@playwright/cli/node_modules/playwright';
const { chromium } = require(PW);
const fs = require('fs');
const path = require('path');

const WRAP  = 'https://packmastersmumbai.github.io/qms';
const STATE = path.join(__dirname, 'e2e-storageState.json');

// readySelector: the element proving the page's own shell rendered.
// dataProbe: returns true only when real DATA has arrived, not just markup.
const PAGES = [
  { name: 'Landing',        nav: null,
    ready: () => !!document.querySelector('.pm-tile'),
    data:  () => [...document.querySelectorAll('.pm-tile-count')].some(e => /^\d+$/.test(e.textContent.trim())) },
  { name: 'GRN',            nav: 'GRN',
    ready: () => !!document.getElementById('formWrap'),
    data:  () => { const s = document.getElementById('supplier'); return !!s && s.options.length > 1; } },
  // IQC renders #iqcForm / #screen1, NOT #formWrap — the first version of this
  // probe guessed and reported a healthy page as "shell never rendered".
  { name: 'IQC',            nav: 'IQC',
    ready: () => !!document.getElementById('iqcForm') || !!document.getElementById('screen1'),
    data:  () => document.querySelectorAll('select option, .grn-card, [data-grn], button').length > 3 },
  { name: 'OQC',            nav: 'OQC',
    ready: () => !!document.getElementById('formWrap') || !!document.getElementById('screen1'),
    data:  () => document.querySelectorAll('select option').length > 1 },
  { name: 'IPQC',           nav: 'IPQC',
    ready: () => document.body.innerText.length > 50,
    data:  () => document.querySelectorAll('button, select option').length > 3 },
  { name: 'Production',     nav: 'Production',
    ready: () => document.body.innerText.length > 50,
    data:  () => document.querySelectorAll('select option, .job-card, tr').length > 2 },
  { name: 'Dispatch',       nav: 'Dispatch',
    ready: () => !!document.querySelector('.dsp-wrap, #formPane'),
    data:  () => document.querySelectorAll('select option').length > 1 },
  { name: 'Gatepass',       nav: 'Gatepass',
    ready: () => document.body.innerText.length > 50,
    data:  () => document.querySelectorAll('select option, input').length > 2 },
  { name: 'CustomerReturn', nav: 'CustomerReturn',
    ready: () => document.body.innerText.length > 50,
    data:  () => document.querySelectorAll('button, .rtn-card, input').length > 2 },
  { name: 'PO',             nav: 'PO',
    ready: () => document.body.innerText.length > 50,
    data:  () => document.querySelectorAll('select option, input').length > 2 },
  { name: 'Rework',         nav: 'Rework',
    ready: () => document.body.innerText.length > 50,
    data:  () => document.querySelectorAll('button, .rw-card, tr').length > 1 },
  { name: 'Records',        nav: 'Records',
    ready: () => !!document.querySelector('.tab-btn'),
    data:  () => document.querySelectorAll('.tab-btn').length > 3 },
  { name: 'Trace',          nav: 'Trace',
    ready: () => document.body.innerText.length > 40,
    data:  () => document.querySelectorAll('input, button').length > 1 },
];

const BUDGET = { shell: 5000, usable: 8000 };   // what the floor should tolerate

function fmt(n, w) { return String(n).padEnd(w); }

// Layout checks that matter on a factory phone. Run in-page.
function responsiveAudit() {
  const out = { overflow: 0, smallTargets: 0, smallFonts: 0, worstTarget: '' };
  const de = document.documentElement;
  out.overflow = Math.max(0, de.scrollWidth - de.clientWidth);
  let worst = 999;
  document.querySelectorAll('button, a[href], select, input:not([type=hidden]), [role=button]')
    .forEach(el => {
      let r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;           // hidden

      // A visually-hidden input inside a <label> is not the touch target — the
      // label is. GRN's coaReceived reported "2px" for exactly this reason and
      // is really a compliant 48px row, so the probe was manufacturing a defect
      // and would have sent someone to "fix" a correct control. Credit the
      // nearest wrapping label instead. Detect by opacity/clip rather than by a
      // class name so it holds for any form's own switch markup.
      const cs = getComputedStyle(el);
      const visuallyHidden = cs.opacity === '0' || cs.clip !== 'auto' ||
                             r.width < 8 || r.height < 8;
      if (visuallyHidden) {
        const lab = el.closest('label');
        if (!lab) return;                                // truly invisible
        r = lab.getBoundingClientRect();
        if (r.height < 2) return;
      }

      if (r.height < 44) {
        out.smallTargets++;
        if (r.height < worst) {
          worst = r.height;
          out.worstTarget = (el.id || el.className || el.tagName).toString().slice(0, 24)
                            + ' @' + Math.round(r.height) + 'px';
        }
      }
      const fs = parseFloat(getComputedStyle(el).fontSize) || 16;
      if (/INPUT|SELECT|TEXTAREA/.test(el.tagName) && fs < 16) out.smallFonts++;
    });
  return out;
}

// Skip the Landing frame unless Landing is what we are measuring.
//
// Several pages use a generic ready-predicate (body.innerText.length > 50).
// Landing stays mounted behind the SPA and satisfies that predicate FIRST, so
// the probe measured Landing and reported its numbers under IPQC, Rework,
// CustomerReturn and Trace — four identical "66px overflow / 49 tap targets"
// rows that were one page counted four times. The tell was the worst-target
// name: pm-tile-count is a Landing-only class. Probing the real frames directly
// showed Rework and Trace at zero overflow.
//
// Detected by a Landing-only marker rather than by URL: every GAS form is
// served from the same script.googleusercontent.com origin.
const LANDING_MARK = () => !!document.querySelector('.pm-tiles, .pm-tile-count');

async function findFrame(page, fn, allowLanding) {
  const candidates = [];
  for (const f of page.frames()) {
    try {
      if (!(await f.evaluate(fn))) continue;
      if (!allowLanding && (await f.evaluate(LANDING_MARK))) continue;  // wrong frame
      candidates.push(f);
    } catch (_) {}
  }
  return candidates.length ? candidates[candidates.length - 1] : null;
}

(async () => {
  const only = process.argv.slice(2).filter(a => !a.startsWith('-'));
  const pages = only.length ? PAGES.filter(p => only.includes(p.name)) : PAGES;

  const browser = await chromium.launch({ headless: true });
  const rows = [];

  for (const spec of pages) {
    // Fresh context per page: sessionStorage carries cached HTML between pages,
    // which would report a warm load as a cold one.
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      storageState: fs.existsSync(STATE) ? STATE : undefined,
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('PAGEERR ' + e.message.slice(0, 70)));
    page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text().slice(0, 70)); });

    const row = { name: spec.name, shell: -1, usable: -1, errors: 0, note: '', resp: null };
    const T = Date.now();
    try {
      await page.goto(WRAP + '?page=landing', { waitUntil: 'domcontentloaded', timeout: 60000 });
      let app = null;
      for (let i = 0; i < 60 && !app; i++) {
        app = await findFrame(page, () => typeof window.navigateTo === 'function', true);
        if (!app) await page.waitForTimeout(400);
      }
      if (!app) throw new Error('SPA frame never appeared (auth expired?)');

      if (spec.nav) {
        await page.waitForTimeout(2000);
        await app.evaluate(n => window.navigateTo(n), spec.nav);
      }

      const deadline = Date.now() + 90000;
      let fr = null;
      while (Date.now() < deadline && row.shell < 0) {
        fr = await findFrame(page, spec.ready, spec.name === 'Landing');
        if (fr) row.shell = Date.now() - T;
        else await page.waitForTimeout(250);
      }
      if (row.shell < 0) throw new Error('shell never rendered');

      while (Date.now() < deadline && row.usable < 0) {
        const ok = await fr.evaluate(spec.data).catch(() => false);
        if (ok) row.usable = Date.now() - T;
        else await page.waitForTimeout(250);
      }
      if (row.usable < 0) row.note = 'data never populated';

      row.resp = await fr.evaluate(responsiveAudit).catch(() => null);
    } catch (e) {
      row.note = e.message.slice(0, 50);
    }
    row.errors = errors.length;
    row.firstError = errors[0] || '';
    rows.push(row);
    await ctx.close();
  }
  await browser.close();

  // ── Report ────────────────────────────────────────────────────────
  console.log('\n===== PM QMS HEALTH =====\n');
  console.log(fmt('PAGE', 16) + fmt('SHELL', 10) + fmt('USABLE', 10) +
              fmt('ERR', 5) + fmt('OVERFLOW', 10) + fmt('<44px', 7) + '<16px');
  let fails = 0;
  rows.forEach(r => {
    const slow = r.usable > BUDGET.usable || r.usable < 0;
    const bad  = r.errors > 0 || (r.resp && r.resp.overflow > 0);
    if (slow || bad || r.note) fails++;
    console.log(
      fmt(r.name, 16) +
      fmt(r.shell < 0 ? '—' : r.shell + 'ms', 10) +
      fmt(r.usable < 0 ? 'NEVER' : r.usable + 'ms', 10) +
      fmt(r.errors, 5) +
      fmt(r.resp ? (r.resp.overflow ? r.resp.overflow + 'px' : 'ok') : '—', 10) +
      fmt(r.resp ? r.resp.smallTargets : '—', 7) +
      (r.resp ? r.resp.smallFonts : '—') +
      (r.note ? '   ' + r.note : ''));
  });

  console.log('\n--- detail ---');
  rows.forEach(r => {
    if (r.firstError) console.log('  ' + r.name + ': ' + r.firstError);
    if (r.resp && r.resp.worstTarget) console.log('  ' + r.name + ' smallest tap target: ' + r.resp.worstTarget);
  });

  const slowest = rows.filter(r => r.usable > 0).sort((a, b) => b.usable - a.usable)[0];
  console.log('\nbudget: shell <' + BUDGET.shell + 'ms, usable <' + BUDGET.usable + 'ms');
  if (slowest) console.log('slowest page: ' + slowest.name + ' at ' + slowest.usable + 'ms');
  console.log(fails ? `\n${fails} of ${rows.length} page(s) need attention.`
                    : `\nAll ${rows.length} pages healthy.`);
  process.exit(fails ? 1 : 0);
})();
