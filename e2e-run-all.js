// Run every E2E suite in sequence, aggregate pass/fail, exit non-zero on any failure.
// Usage: node e2e-run-all.js   (requires a fresh e2e-storageState.json — see e2e-README.md)
const { spawnSync } = require('child_process');

const SUITES = [
  'e2e-landing.js',
  'e2e-grn.js',
  'e2e-grn-iqc.js',
  'e2e-oqc-dispatch.js',
  'e2e-production.js',
  'e2e-ncr-records-trace.js',
  'e2e-masters-kpi-warehouse.js',
  'e2e-lowstock-logic.js',
  'e2e-qmsv2.js',
];
let allOk = true;

for (const suite of SUITES) {
  console.log('\n\n################# RUN ' + suite + ' #################');
  const r = spawnSync(process.execPath, [suite], { stdio: 'inherit' });
  if (r.status !== 0) { allOk = false; console.log('!!! ' + suite + ' FAILED (exit ' + r.status + ')'); }
}

console.log('\n================ ' + (allOk ? 'ALL SUITES PASSED' : 'SOME SUITES FAILED') + ' ================');
process.exit(allOk ? 0 : 1);
