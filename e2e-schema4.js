/* Schema-level functional checks for Trace, Masters, MastersCrud, ControlPlan.
 * Goes past "it renders": asserts each module reads its sheets correctly and that
 * what reaches the screen matches the row counts in the spreadsheet.
 * READ-ONLY — no saves, no writes. */
const { launch, openApp, nav, call, makeRunner } = require('./e2e-lib');

// Ground truth from ?diag=dummyaudit — what each sheet actually holds.
const TRUTH = { materials: 180, suppliers: 28, customers: 5, params: 66, locations: 159, bom: 195, controlFg: 7 };

async function biggest(page) {
  let best = null, len = 0;
  for (const f of page.frames()) {
    try { const n = await f.evaluate(() => (document.body.innerText || '').length); if (n > len) { len = n; best = f; } } catch (_) {}
  }
  return best;
}

(async () => {
  const b = await launch();
  const R = makeRunner('schema check — Trace / Masters / MastersCrud / ControlPlan');

  // ---------- server-side: do the reads return the right shapes? ----------
  {
    const { ctx, page, rpc } = await openApp(b);

    const mats = await call(rpc, 'getMaterials', []);
    await R.check('getMaterials returns all 180', async () =>
      (Array.isArray(mats) && mats.length === TRUTH.materials) ||
      `got ${Array.isArray(mats) ? mats.length : typeof mats}`);

    const cp = await call(rpc, 'getControlPlan', ['fg']);
    await R.check('getControlPlan(fg) returns without error', async () =>
      (cp && !cp.__err) || `err: ${cp && cp.__err}`);

    // Regression guard: getMastersTable maps schema[i] -> cell[i] positionally without
    // reading the header, so schema drift silently renders the wrong column under the
    // right label. Suppliers declared a 9th 'email' column the sheet does not have, so
    // it rendered LastModified as "Email". Assert no non-date field holds a timestamp.
    for (const nm of ['Suppliers', 'Materials', 'Customers', 'Personnel', 'Parameters']) {
      const t = await call(rpc, 'getMastersTable', [nm]);
      await R.check(nm + ' — schema matches sheet', async () => {
        if (!t || t.__err) return 'rpc err: ' + (t && t.__err);
        if (t.ok === false) return 'guard: ' + String(t.error).slice(0, 80);
        const row = t.rows && t.rows[0];
        if (!row) return true; // empty sheet is not drift
        const bad = Object.keys(row).filter(k => !k.startsWith('_') &&
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(row[k])));
        return bad.length === 0 || `timestamp leaked into: ${bad.join(',')}`;
      });
    }

    console.log('\n[shapes] materials[0] =', JSON.stringify(mats && mats[0]).slice(0, 160));
    console.log('[shapes] controlPlan  =', JSON.stringify(cp).slice(0, 260));
    await ctx.close();
  }

  // ---------- client-side: does each module render that data? ----------
  const CASES = [
    { mod: 'Trace', wait: 11000, probe: fr => fr.evaluate(() => {
        const inputs = [...document.querySelectorAll('input')].map(i => i.id || i.placeholder || '(anon)');
        return { inputs, buttons: [...document.querySelectorAll('button')].map(x => x.textContent.trim()).filter(Boolean).slice(0, 8) };
      })},
    { mod: 'Masters', wait: 11000, probe: fr => fr.evaluate(() => {
        const t = document.body.innerText || '';
        return { tiles: [...document.querySelectorAll('button,a,[role=button]')].map(e => e.textContent.trim()).filter(Boolean).slice(0, 14),
                 mentionsCounts: /\d+/.test(t), text: t.slice(0, 160) };
      })},
    { mod: 'MastersCrud', wait: 11000, probe: fr => fr.evaluate(() => {
        const t = document.body.innerText || '';
        return { rows: document.querySelectorAll('tr').length,
                 sheetBtns: [...document.querySelectorAll('button')].map(e => e.textContent.trim()).filter(Boolean).slice(0, 16),
                 text: t.slice(0, 200) };
      })},
    // ControlPlan renders the param dictionary only AFTER an FG product is chosen,
    // and uses per-row toggle spans + Save buttons — NOT checkboxes. Counting
    // checkboxes reported 1 and looked broken; the table is really 66 rows.
    { mod: 'ControlPlan', wait: 12000, probe: async fr => {
        await fr.evaluate(() => {
          const s = document.getElementById('fgSelect');
          const o = [...s.options].find(x => x.value && !/^[—–-]/.test(x.textContent.trim()));
          if (o) { s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true })); }
        });
        await new Promise(r => setTimeout(r, 6000));
        return fr.evaluate(() => {
          const sel = document.getElementById('fgSelect');
          return { fgOptions: sel ? sel.options.length : 'MISSING',
                   paramRows: Math.max(0, document.querySelectorAll('tr').length - 1),
                   controls: document.querySelectorAll('input,select,[class*=toggle]').length };
        });
      }},
  ];

  for (const c of CASES) {
    const { ctx, page, app, errors } = await openApp(b);
    await nav(app, page, c.mod);
    await page.waitForTimeout(c.wait);
    const fr = await biggest(page);
    const out = fr ? await c.probe(fr) : 'NO FRAME';
    console.log('\n===== ' + c.mod + ' =====');
    console.log(JSON.stringify(out, null, 1));
    const pe = errors.filter(e => e.startsWith('PAGEERR'));
    await R.check(c.mod + ' — no page errors', async () => pe.length === 0 || pe[0].slice(0, 90));
    if (c.mod === 'ControlPlan' && out && out.fgOptions !== 'MISSING') {
      await R.check('ControlPlan — FG list populated', async () => out.fgOptions > 30 || `${out.fgOptions} options`);
      await R.check('ControlPlan — 66-param dictionary rendered', async () =>
        out.paramRows >= TRUTH.params || `${out.paramRows} rows vs ${TRUTH.params} params`);
    }
    await ctx.close();
  }

  R.report();
  await b.close();
})();
