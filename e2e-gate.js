// e2e-gate.js — the blocking pre-deploy gate.
//
// Runs the render suite AND the save-path regression as one pass/fail. Kept as a
// runner that chains two child processes rather than merging savepaths into
// e2e-suite: savepaths opens a fresh browser context per form and installs a
// google.script.run shim, which must not leak into the render checks. Each file
// also stays independently runnable for debugging.
//
// WHY THIS EXISTS: the suite was 153/153 green while GRN's save was reported
// dead, because the suite only proves forms RENDER. A form can render perfectly
// and still never dispatch its write. Those are different claims and the gate
// needs both.
//
// Preconditions: the Phase 3A fixture must be seeded, or savepaths silently
// degrades to fewer tested forms instead of failing. The gate checks that FIRST
// and refuses to report a pass on reduced coverage.
//
//   node e2e-gate.js            → run the gate
//   node e2e-gate.js --no-fix   → skip the fixture precondition check
const { execFileSync, spawnSync } = require('child_process');
const path = require('path');

// Coverage floor. savepaths drives ALL NINE write forms. If coverage DROPS
// below this, the gate fails even when every tested form passes — a shrinking
// denominator is exactly how "3 -> 1 -> 2 tested" went unnoticed for a session.
const MIN_TESTED = 9;

function run(file, args) {
  const r = spawnSync(process.execPath, [path.join(__dirname, file)].concat(args || []), {
    encoding: 'utf8', timeout: 20 * 60 * 1000, maxBuffer: 32 * 1024 * 1024,
  });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

(async () => {
  const results = [];

  // ── Precondition: fixture present and IQC-selectable ──────────────────────
  if (!process.argv.includes('--no-fix')) {
    let fx = '';
    try {
      fx = execFileSync(process.execPath, [path.join(__dirname, 'e2e-diag.js'), 'fixtures'],
        { encoding: 'utf8', timeout: 5 * 60 * 1000 });
    } catch (e) { fx = 'FAILED: ' + e.message; }
    const selectable = /selectable in IQC/.test(fx);
    console.log('── precondition: e2e fixture ──');
    console.log(selectable
      ? '  OK — fixture GRN present and IQC-selectable'
      : '  MISSING — run:  node e2e-diag.js "fixtureseed&confirm=YES"');
    if (!selectable) {
      console.log('\nGATE: FAIL — fixture precondition unmet, coverage would silently shrink.');
      process.exit(1);
    }
  }

  // ── 1. render suite ────────────────────────────────────────────────────────
  console.log('\n── e2e-suite (render) ──');
  const suite = run('e2e-suite.js');
  const suiteLine = (suite.out.match(/-{5} (\d+)\/(\d+) passed -{5}/) || [])[0] || '(no summary)';
  console.log('  ' + suiteLine);
  results.push({ name: 'render suite', ok: suite.code === 0, detail: suiteLine });

  // ── 2. save paths ──────────────────────────────────────────────────────────
  console.log('\n── e2e-savepaths (writes) ──');
  const sp = run('e2e-savepaths.js');
  const m = sp.out.match(/-{5} (\d+) tested, (\d+) skipped, (\d+) total -{5}/);
  const tested = m ? Number(m[1]) : 0;
  const dbl = (sp.out.match(/DOUBLE-DISPATCH on rapid double-tap: (.+)/) || [])[1] || '?';
  const noTxn = (sp.out.match(/NO clientTxnId-like idempotency key:\s+(.+)/) || [])[1] || '?';

  sp.out.split('\n')
    .filter(l => /^(GRN|IQC|Gatepass|OQC|IPQC|Dispatch|CustomerReturn|PO|Rework)\s/.test(l))
    .forEach(l => console.log('  ' + l.trim().slice(0, 110)));

  const coverageOk = tested >= MIN_TESTED;
  console.log('\n  tested=' + tested + ' (floor ' + MIN_TESTED + ')  ' + (coverageOk ? 'OK' : 'BELOW FLOOR'));
  console.log('  double-dispatch: ' + dbl.trim());
  console.log('  missing txn key: ' + noTxn.trim());

  results.push({ name: 'save paths', ok: sp.code === 0, detail: m ? m[0] : '(no summary)' });
  results.push({ name: 'coverage floor', ok: coverageOk, detail: tested + ' >= ' + MIN_TESTED });

  // ── verdict ────────────────────────────────────────────────────────────────
  console.log('\n===== GATE =====');
  results.forEach(r => console.log((r.ok ? 'PASS  ' : 'FAIL  ') + r.name.padEnd(16) + r.detail));
  const allOk = results.every(r => r.ok);
  console.log(allOk ? '\nGATE: PASS' : '\nGATE: FAIL');
  process.exit(allOk ? 0 : 1);
})();
