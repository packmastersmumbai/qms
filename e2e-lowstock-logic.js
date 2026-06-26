// E2E (logic) — getLowStockItems algorithm verification against synthetic fixtures.
// The live suite (e2e-masters-kpi-warehouse.js) proves the RPC wiring + UI mount;
// this proves the filter/sort/shortBy math deterministically without touching the
// production MASTERS_Materials sheet (no reorder-level write path exists by design).
//
// Mirrors the exact algorithm in Warehouse.js getLowStockItems().

// --- algorithm under test (kept in sync with Warehouse.js) ---
function computeLowStock(summary, mats) {
  const onHand = {};
  summary.forEach(s => { const k = String(s.materialCode).trim(); onHand[k] = (onHand[k] || 0) + (Number(s.balance) || 0); });
  const low = [];
  mats.forEach(m => {
    const reorder = Number(m.reorderLevel) || 0;
    if (reorder <= 0) return;
    const have = onHand[m.code] || 0;
    if (have <= reorder) low.push({ code: m.code, desc: m.desc || m.code, unit: m.unit || '', onHand: have, reorderLevel: reorder, shortBy: reorder - have });
  });
  low.sort((a, b) => b.shortBy - a.shortBy);
  return low;
}

let pass = 0, total = 0;
function check(name, cond) { total++; const ok = cond === true; console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (ok ? '' : '  — ' + cond)); if (ok) pass++; }

// Fixtures: 4 materials, varied stock vs reorder.
const mats = [
  { code: 'RM-001', desc: 'Resin',     unit: 'kg',  reorderLevel: 100 }, // stock 40  → LOW, short 60
  { code: 'RM-002', desc: 'Colorant',  unit: 'kg',  reorderLevel: 20  }, // stock 50  → ok
  { code: 'RM-003', desc: 'Additive',  unit: 'kg',  reorderLevel: 30  }, // stock 30  → LOW (boundary, short 0)
  { code: 'RM-004', desc: 'Masterbatch',unit:'kg',  reorderLevel: 0   }, // no threshold → never alerts
  { code: 'RM-005', desc: 'NoStockItem',unit:'pcs', reorderLevel: 10  }, // no ledger rows → onHand 0, LOW short 10
];
const summary = [
  { materialCode: 'RM-001', balance: 25 }, { materialCode: 'RM-001', balance: 15 }, // sums to 40 across lots
  { materialCode: 'RM-002', balance: 50 },
  { materialCode: 'RM-003', balance: 30 },
  { materialCode: 'RM-004', balance: 5  },
];

const r = computeLowStock(summary, mats);
const byCode = Object.fromEntries(r.map(x => [x.code, x]));

check('sums on-hand across multiple lots (RM-001 = 40)', byCode['RM-001'] && byCode['RM-001'].onHand === 40 || 'onHand=' + (byCode['RM-001'] || {}).onHand);
check('flags item below reorder (RM-001 short 60)', byCode['RM-001'] && byCode['RM-001'].shortBy === 60 || 'shortBy=' + (byCode['RM-001'] || {}).shortBy);
check('excludes item above reorder (RM-002 absent)', !byCode['RM-002'] || 'RM-002 should not appear');
check('includes boundary item at exactly reorder (RM-003, short 0)', byCode['RM-003'] && byCode['RM-003'].shortBy === 0 || 'RM-003 missing or wrong shortBy');
check('excludes item with reorderLevel 0 (RM-004 absent)', !byCode['RM-004'] || 'RM-004 with no threshold leaked');
check('includes item with no ledger rows (RM-005 onHand 0, short 10)', byCode['RM-005'] && byCode['RM-005'].onHand === 0 && byCode['RM-005'].shortBy === 10 || 'RM-005 wrong');
check('result sorted by shortBy descending', (() => { for (let i = 1; i < r.length; i++) if (r[i].shortBy > r[i - 1].shortBy) return 'unsorted at ' + i; return true; })());
check('only low items returned (count = 3)', r.length === 3 || 'count=' + r.length + ' codes=' + r.map(x => x.code).join(','));

console.log('----- ' + pass + '/' + total + ' passed -----');
process.exit(pass === total ? 0 : 1);
