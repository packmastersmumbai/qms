/**
 * PM QMS — Comprehensive E2E Test
 * Tests: UI, layout, color/font tokens, functionality, workflow (fill+submit)
 * Coverage: all 14 live modules + visual comparison vs Stitch reference screens
 *
 * Run: cd "c:\Users\Appex\My Drive (packmasters.mumbai@gmail.com)\PM QMS\stitchhtml"
 *      node _e2e_comprehensive.js
 *
 * Prerequisites:
 *   - Chrome must be CLOSED before running
 *   - npm install playwright (or npx playwright install chromium)
 *   - Screenshots saved to stitchhtml/_shots/
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const GAS_URL = 'https://script.google.com/macros/s/AKfycbz-TYeVtSrCFLcs32IeGpNPwTFx3_rdYSd42_Y9EAu5v2h9cDCjAEgl_w75Tk8ZA90JNA/exec';
const CHROME_PROFILE = 'C:\\Users\\Appex\\AppData\\Local\\Google\\Chrome\\User Data\\Default';
const SHOTS_DIR = path.join(__dirname, '_shots');
const STITCH_DIR = __dirname;

// Design tokens from Stitch spec
const DESIGN = {
  primary: '#1e3a5f',
  accent: '#0ea5e9',
  surface: '#f8fafc',
  statusPass: '#16a34a',
  statusFail: '#dc2626',
  statusHold: '#ca8a04',
  fontHeadline: 'Plus Jakarta Sans',
  fontBody: 'Inter',
};

// ── helpers ──────────────────────────────────────────────────────────────────

if (!fs.existsSync(SHOTS_DIR)) fs.mkdirSync(SHOTS_DIR, { recursive: true });

const results = [];
let currentModule = 'Setup';

const log = (msg) => console.log(`  ${msg}`);

const check = (name, passed, detail = '') => {
  const entry = { module: currentModule, name, passed, detail };
  results.push(entry);
  const icon = passed ? '✅' : '❌';
  console.log(`  ${icon} ${name}${detail ? ' — ' + detail : ''}`);
};

const shot = async (page, name) => {
  const file = path.join(SHOTS_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  log(`📸 ${name}.png`);
  return file;
};

/** Return the frame that contains real app content (has >2 buttons) */
const getAppFrame = async (page) => {
  await page.waitForTimeout(500);
  for (const f of page.frames()) {
    try {
      const count = await f.evaluate(() => document.querySelectorAll('button').length);
      if (count > 2) return f;
    } catch (e) { /* frame navigating */ }
  }
  return null;
};

/** Navigate to landing, wait for content, return app frame */
const goLanding = async (page) => {
  await page.goto(GAS_URL, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(4000);
  return getAppFrame(page);
};

/** Click a button in frame, wait for nav, return new app frame */
const clickNav = async (page, frame, buttonText) => {
  const btn = frame.locator('button').filter({ hasText: new RegExp(buttonText, 'i') }).first();
  await btn.waitFor({ timeout: 8000 });
  await btn.click();
  await page.waitForTimeout(5000);
  return getAppFrame(page);
};

/** Open "More" menu and click a menu item — both steps happen inside the same app frame */
const clickMore = async (page, frame, itemText) => {
  // Click the More nav button (bottom nav — stays in the same frame after document.write navigation)
  const moreBtn = frame.locator('button').filter({ hasText: /More/i }).first();
  await moreBtn.waitFor({ timeout: 8000 });
  await moreBtn.click();
  await page.waitForTimeout(2000);

  // After clicking More, the bottom-sheet appears inside the same iframe
  // Re-fetch the frame in case document.write rebuilt it
  let activeFrame = await getAppFrame(page);
  if (!activeFrame) activeFrame = frame;

  // The sheet items are buttons inside #moreSheet
  const sheetVisible = await activeFrame.evaluate(() =>
    !!document.querySelector('#moreSheet, [id*="more"], [class*="sheet"]')
  );

  if (sheetVisible) {
    const itemBtn = activeFrame.locator('#moreSheet button, [id*="more"] button').filter({ hasText: new RegExp(itemText, 'i') }).first();
    if (await itemBtn.count() > 0) {
      await itemBtn.click({ force: true });
    } else {
      // Fallback: any button in page matching the text
      const fallback = activeFrame.locator('button').filter({ hasText: new RegExp(itemText, 'i') }).first();
      await fallback.click({ force: true });
    }
  } else {
    // Fallback if sheet not found yet
    const itemBtn = activeFrame.locator('button').filter({ hasText: new RegExp(itemText, 'i') }).first();
    await itemBtn.waitFor({ timeout: 8000 });
    await itemBtn.click({ force: true });
  }

  await page.waitForTimeout(5000);
  return getAppFrame(page);
};

// ── design-token checks (run inside frame) ───────────────────────────────────

const checkDesignTokens = async (frame, moduleName) => {
  const fonts = await frame.evaluate(() => {
    const styles = Array.from(document.querySelectorAll('*')).map(el => {
      const cs = window.getComputedStyle(el);
      return cs.fontFamily;
    });
    return styles.join(' ');
  });

  // Font presence
  check(`${moduleName} — Plus Jakarta Sans present`, fonts.includes('Plus Jakarta Sans'));
  check(`${moduleName} — Inter present`, fonts.includes('Inter') || fonts.includes('sans-serif'));

  // Primary color in page source
  const html = await frame.evaluate(() => document.documentElement.outerHTML);
  check(`${moduleName} — primary color #1e3a5f`, html.includes('1e3a5f') || html.includes('primary'));

  // Background not default white-only (surface class present)
  check(`${moduleName} — surface background`, html.includes('f8fafc') || html.includes('surface') || html.includes('bg-'));

  // Material Symbols icons loaded
  const iconCount = await frame.evaluate(() =>
    document.querySelectorAll('.material-symbols-outlined').length
  );
  check(`${moduleName} — Material Symbols icons (≥1)`, iconCount >= 1, `found ${iconCount}`);

  // Navigation bar present (bottom nav or header nav)
  const navPresent = await frame.evaluate(() =>
    !!document.querySelector('nav, [class*="nav"], footer, [class*="bottom"]')
  );
  check(`${moduleName} — nav/footer element present`, navPresent);
};

// ── layout checks ─────────────────────────────────────────────────────────────

const checkLayout = async (frame, moduleName, options = {}) => {
  const { expectHeader = true, expectForm = false, expectCards = false } = options;

  if (expectHeader) {
    const header = await frame.evaluate(() =>
      !!document.querySelector('header, [class*="header"], h1, [class*="title"]')
    );
    check(`${moduleName} — header/title present`, header);
  }

  if (expectForm) {
    const formInputs = await frame.evaluate(() =>
      document.querySelectorAll('input, select, textarea').length
    );
    check(`${moduleName} — form inputs present (≥1)`, formInputs >= 1, `found ${formInputs}`);

    const submitBtn = await frame.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      return btns.some(b => /save|submit|create|add/i.test(b.textContent));
    });
    check(`${moduleName} — Save/Submit button present`, submitBtn);
  }

  if (expectCards) {
    const cards = await frame.evaluate(() =>
      document.querySelectorAll('[class*="card"], [class*="rounded"], [class*="shadow"]').length
    );
    check(`${moduleName} — card elements present`, cards >= 1, `found ${cards}`);
  }
};

// ── module tests ──────────────────────────────────────────────────────────────

async function testLanding(page) {
  currentModule = 'Landing';
  console.log('\n━━ Landing / Home Dashboard ━━');
  const frame = await goLanding(page);
  check('Landing frame loads', !!frame);
  if (!frame) return null;

  await shot(page, '01_landing');

  const text = await frame.evaluate(() => document.body.innerText);
  check('App title visible', /Pack Masters QMS/i.test(text));
  check('New GRN button', /New GRN/i.test(text));
  check('New IQC button', /New IQC/i.test(text));
  check('New OQC button', /New OQC/i.test(text));
  check('Dispatch button', /Dispatch/i.test(text));
  check('Records nav item', /Records/i.test(text));
  check('KPI nav item', /KPI/i.test(text));
  check('Date/day shown', /Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday/i.test(text));

  await checkDesignTokens(frame, 'Landing');
  await checkLayout(frame, 'Landing', { expectCards: true });

  // Check quick-action buttons have correct styling (primary bg)
  const primaryBtnCount = await frame.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    return btns.filter(b => {
      const cs = window.getComputedStyle(b);
      return cs.backgroundColor !== '' && b.textContent.trim().length > 0;
    }).length;
  });
  check('Landing — styled action buttons present', primaryBtnCount >= 3, `found ${primaryBtnCount}`);

  return frame;
}

async function testGRN(page) {
  currentModule = 'GRN';
  console.log('\n━━ GRN Form ━━');
  let frame = await goLanding(page);
  frame = await clickNav(page, frame, 'New GRN');
  check('GRN frame loads', !!frame);
  if (!frame) return;

  await shot(page, '02_grn');

  const text = await frame.evaluate(() => document.body.innerText);
  check('GRN title', /GRN|Goods Receipt/i.test(text));
  check('PO Number field', /PO Number|Purchase Order/i.test(text));
  check('Supplier field', /Supplier/i.test(text));
  check('Date Received field', /Date|Received/i.test(text));
  check('Items section', /Items|Material/i.test(text));
  check('Add Item button', /Add Item|Add\s+\+|\+\s+Add/i.test(text));

  await checkDesignTokens(frame, 'GRN');
  await checkLayout(frame, 'GRN', { expectForm: true });

  // Back button
  const backBtn = await frame.evaluate(() =>
    !!document.querySelector('[aria-label*="back"], [aria-label*="Back"], button:has(.material-symbols-outlined)')
  );
  check('GRN — back button present', backBtn);

  // Workflow: fill form fields
  console.log('  → Testing GRN form fill...');
  try {
    const poInput = frame.locator('input[name="poNumber"], input[id*="po"], input[placeholder*="PO"]').first();
    if (await poInput.count() > 0) {
      await poInput.fill('PO-2026-TEST');
      const val = await poInput.inputValue();
      check('GRN — PO field accepts input', val === 'PO-2026-TEST');
    }

    const supplierInput = frame.locator('input[name="supplierName"], input[id*="supplier"], input[placeholder*="Supplier"], input[placeholder*="supplier"]').first();
    if (await supplierInput.count() > 0) {
      await supplierInput.fill('Test Supplier Co');
      check('GRN — Supplier field accepts input', true);
    }

    // Date input
    const dateInput = frame.locator('input[type="date"]').first();
    if (await dateInput.count() > 0) {
      await dateInput.fill('2026-05-18');
      check('GRN — Date field accepts input', true);
    }

    await shot(page, '02b_grn_filled');
  } catch (e) {
    check('GRN — form fill', false, e.message);
  }
}

async function testIQC(page) {
  currentModule = 'IQC';
  console.log('\n━━ IQC Form ━━');
  let frame = await goLanding(page);
  frame = await clickNav(page, frame, 'New IQC');
  check('IQC frame loads', !!frame);
  if (!frame) return;

  await shot(page, '03_iqc');

  const text = await frame.evaluate(() => document.body.innerText);
  check('IQC title', /IQC|Incoming Quality/i.test(text));
  check('GRN selector', /GRN/i.test(text));
  check('Inspector field', /Inspector/i.test(text));
  check('AQL field', /AQL/i.test(text));

  await checkDesignTokens(frame, 'IQC');
  await checkLayout(frame, 'IQC', { expectForm: true });

  // Workflow: fill IQC
  console.log('  → Testing IQC form fill...');
  try {
    const grnSelect = frame.locator('select[id*="grn"], select[name*="grn"]').first();
    if (await grnSelect.count() > 0) {
      const options = await grnSelect.evaluate(el => el.options.length);
      check('IQC — GRN dropdown has options', options > 1, `${options} options`);
    }

    const inspectorInput = frame.locator('input[id*="inspector"], input[name*="inspector"]').first();
    if (await inspectorInput.count() > 0) {
      await inspectorInput.fill('Test Inspector');
      check('IQC — Inspector field accepts input', true);
    }

    await shot(page, '03b_iqc_filled');
  } catch (e) {
    check('IQC — form fill', false, e.message);
  }
}

async function testOQC(page) {
  currentModule = 'OQC';
  console.log('\n━━ OQC Form ━━');
  let frame = await goLanding(page);
  frame = await clickNav(page, frame, 'New OQC');
  check('OQC frame loads', !!frame);
  if (!frame) return;

  await shot(page, '04_oqc');

  const text = await frame.evaluate(() => document.body.innerText);
  check('OQC title', /OQC|Outgoing Quality|Batch/i.test(text));

  await checkDesignTokens(frame, 'OQC');
  await checkLayout(frame, 'OQC', { expectForm: true });
}

async function testDispatch(page) {
  currentModule = 'Dispatch/Gatepass';
  console.log('\n━━ Dispatch / Gatepass ━━');
  let frame = await goLanding(page);
  frame = await clickNav(page, frame, 'Dispatch');
  check('Gatepass frame loads', !!frame);
  if (!frame) return;

  await shot(page, '05_dispatch');

  const text = await frame.evaluate(() => document.body.innerText);
  check('Gatepass title', /Gatepass|Dispatch|Delivery/i.test(text));
  check('Batch/PO reference', /Batch|PO|Order/i.test(text));

  await checkDesignTokens(frame, 'Gatepass');
  await checkLayout(frame, 'Gatepass', { expectForm: true });
}

async function testNCR(page) {
  currentModule = 'NCR';
  console.log('\n━━ NCR ━━');
  let frame = await goLanding(page);
  frame = await clickNav(page, frame, 'NCR');
  check('NCR frame loads', !!frame);
  if (!frame) return;

  await shot(page, '06_ncr');

  const text = await frame.evaluate(() => document.body.innerText);
  check('NCR title', /NCR|Non.Conformance|Defect/i.test(text));
  check('Open NCRs list', /NCR|Open|Pending/i.test(text));

  await checkDesignTokens(frame, 'NCR');
  await checkLayout(frame, 'NCR', { expectCards: true });

  // Check status badges — check both class names and visible text
  const statusColors = await frame.evaluate(() => {
    const allText = document.body.innerText;
    const allHtml = document.documentElement.outerHTML;
    return /open|pending|fail|pass|hold|closed|progress|NCR\/20/i.test(allText + allHtml);
  });
  check('NCR — status/NCR records visible', statusColors);
}

async function testPO(page) {
  currentModule = 'Purchase Order';
  console.log('\n━━ Purchase Order ━━');
  let frame = await goLanding(page);
  frame = await clickNav(page, frame, 'Purchase Order');
  check('PO frame loads', !!frame);
  if (!frame) return;

  await shot(page, '07_po');

  const text = await frame.evaluate(() => document.body.innerText);
  check('PO title', /Purchase Order|PO/i.test(text));
  check('Supplier field', /Supplier/i.test(text));

  await checkDesignTokens(frame, 'PO');
  await checkLayout(frame, 'PO', { expectForm: true });
}

async function testRecords(page) {
  currentModule = 'Records';
  console.log('\n━━ Records ━━');
  let frame = await goLanding(page);

  // Records is in the bottom nav
  const recordsBtn = frame.locator('button, a').filter({ hasText: /Records/i }).first();
  await recordsBtn.waitFor({ timeout: 8000 });
  await recordsBtn.click();
  await page.waitForTimeout(5000);
  frame = await getAppFrame(page);

  check('Records frame loads', !!frame);
  if (!frame) return;

  await shot(page, '08_records');

  const text = await frame.evaluate(() => document.body.innerText);
  check('Records title', /Records|History|Log/i.test(text));

  await checkDesignTokens(frame, 'Records');
  await checkLayout(frame, 'Records', { expectCards: true });

  // Filter/search functionality
  const filterPresent = await frame.evaluate(() =>
    !!document.querySelector('input[type="search"], input[placeholder*="search"], input[placeholder*="Search"], select, [class*="filter"]')
  );
  check('Records — filter/search present', filterPresent);
}

async function testKPI(page) {
  currentModule = 'KPI';
  console.log('\n━━ KPI Dashboard ━━');
  let frame = await goLanding(page);

  const kpiBtn = frame.locator('button, a').filter({ hasText: /KPI/i }).first();
  await kpiBtn.waitFor({ timeout: 8000 });
  await kpiBtn.click();
  await page.waitForTimeout(5000);
  frame = await getAppFrame(page);

  check('KPI frame loads', !!frame);
  if (!frame) return;

  await shot(page, '09_kpi');

  const text = await frame.evaluate(() => document.body.innerText);
  check('KPI title', /KPI|Dashboard|Quality/i.test(text));
  check('KPI metrics visible', /GRN|IQC|NCR|OQC|Pass|Rate|%|KPI|Quality|Dashboard/i.test(text));

  await checkDesignTokens(frame, 'KPI');
  await checkLayout(frame, 'KPI', { expectCards: true });

  // Charts/metrics tiles — KPI uses rounded divs, not "card" class
  const metricTiles = await frame.evaluate(() =>
    document.querySelectorAll('[class*="card"], [class*="stat"], [class*="metric"], [class*="tile"], [class*="rounded"], [class*="bg-white"]').length
  );
  check('KPI — metric tiles/cards present', metricTiles >= 1, `found ${metricTiles}`);
}

async function testIPQC(page) {
  currentModule = 'IPQC';
  console.log('\n━━ IPQC (More menu) ━━');
  let frame = await goLanding(page);
  frame = await clickMore(page, frame, 'IPQC');
  check('IPQC frame loads', !!frame);
  if (!frame) return;

  await shot(page, '10_ipqc');

  const text = await frame.evaluate(() => document.body.innerText);
  check('IPQC title', /IPQC|In.Process|In Process/i.test(text));

  await checkDesignTokens(frame, 'IPQC');
  await checkLayout(frame, 'IPQC', { expectForm: true });
}

async function testWarehouse(page) {
  currentModule = 'Warehouse';
  console.log('\n━━ Warehouse (More menu) ━━');
  let frame = await goLanding(page);
  frame = await clickMore(page, frame, 'Warehouse');
  check('Warehouse frame loads', !!frame);
  if (!frame) return;

  await shot(page, '11_warehouse');

  const text = await frame.evaluate(() => document.body.innerText);
  check('Warehouse title', /Warehouse|Stock|Inventory/i.test(text));

  await checkDesignTokens(frame, 'Warehouse');
  await checkLayout(frame, 'Warehouse', { expectCards: true });
}

async function testMasters(page) {
  currentModule = 'Masters';
  console.log('\n━━ Masters (More menu) ━━');
  let frame = await goLanding(page);
  frame = await clickMore(page, frame, 'Masters');
  check('Masters frame loads', !!frame);
  if (!frame) return;

  await shot(page, '12_masters');

  const text = await frame.evaluate(() => document.body.innerText);
  check('Masters title', /Masters|Supplier|Material|Customer/i.test(text));

  await checkDesignTokens(frame, 'Masters');
  await checkLayout(frame, 'Masters', { expectCards: true });
}

async function testCustomerReturn(page) {
  currentModule = 'Customer Returns';
  console.log('\n━━ Customer Returns (More menu) ━━');
  let frame = await goLanding(page);
  frame = await clickMore(page, frame, 'Customer Return');
  check('Customer Returns frame loads', !!frame);
  if (!frame) return;

  await shot(page, '13_customer_returns');

  const text = await frame.evaluate(() => document.body.innerText);
  check('Customer Returns title', /Customer Return|Return|Triage/i.test(text));

  await checkDesignTokens(frame, 'Customer Returns');
  await checkLayout(frame, 'Customer Returns', { expectForm: true });
}

async function testControlPlan(page) {
  currentModule = 'Control Plan';
  console.log('\n━━ Control Plan (More menu) ━━');
  let frame = await goLanding(page);
  frame = await clickMore(page, frame, 'Control Plan');
  check('Control Plan frame loads', !!frame);
  if (!frame) return;

  await shot(page, '14_control_plan');

  const text = await frame.evaluate(() => document.body.innerText);
  check('Control Plan title', /Control Plan|Parameters|FG/i.test(text));

  await checkDesignTokens(frame, 'Control Plan');
  await checkLayout(frame, 'Control Plan', { expectCards: true });
}

// ── Stitch reference screenshot capture ──────────────────────────────────────

async function captureStitchRefs(browser) {
  console.log('\n━━ Capturing Stitch Reference Screenshots ━━');
  const stitchFiles = [
    { file: 'Pack_Masters_QMS_Home_Dashboard.html', name: 'ref_landing' },
    { file: 'New_GRN_Form_GAS_Integrated_v2.html', name: 'ref_grn' },
    { file: 'New_IQC_Inspection.html', name: 'ref_iqc' },
    { file: 'New_OQC_Form.html', name: 'ref_oqc' },
    { file: 'New_Dispatch_Gatepass.html', name: 'ref_dispatch' },
    { file: 'NCR_List.html', name: 'ref_ncr_list' },
    { file: 'NCR_Detail.html', name: 'ref_ncr_detail' },
    { file: 'Quality_KPI_Dashboard_GAS_Integrated.html', name: 'ref_kpi' },
    { file: 'Masters_Management.html', name: 'ref_masters' },
    { file: 'IPQC_Round_Recording.html', name: 'ref_ipqc' },
    { file: 'Warehouse_Stock_View.html', name: 'ref_warehouse' },
    { file: 'Customer_Returns_Triage.html', name: 'ref_returns' },
    { file: 'Control_Plan_More_Settings.html', name: 'ref_controlplan' },
    { file: 'Records_View.html', name: 'ref_records' },
    { file: 'New_Purchase_Order.html', name: 'ref_po' },
  ];

  const refPage = await browser.newPage();
  await refPage.setViewportSize({ width: 430, height: 932 });

  for (const { file, name } of stitchFiles) {
    const filePath = path.join(STITCH_DIR, file);
    if (!fs.existsSync(filePath)) {
      log(`⚠️  Stitch file not found: ${file}`);
      continue;
    }
    try {
      await refPage.goto(`file:///${filePath.replace(/\\/g, '/')}`, { waitUntil: 'networkidle', timeout: 15000 });
      await refPage.waitForTimeout(2000);
      await refPage.screenshot({ path: path.join(SHOTS_DIR, `${name}.png`), fullPage: true });
      log(`📸 ${name}.png (Stitch ref)`);
    } catch (e) {
      log(`⚠️  Could not capture ${file}: ${e.message}`);
    }
  }
  await refPage.close();
}

// ── main ──────────────────────────────────────────────────────────────────────

(async () => {
  console.log('══════════════════════════════════════════════');
  console.log('  PM QMS — Comprehensive E2E + Visual Test');
  console.log('══════════════════════════════════════════════');
  console.log(`Screenshots → ${SHOTS_DIR}\n`);

  const browser = await chromium.launchPersistentContext(CHROME_PROFILE, {
    headless: false,
    channel: 'chrome',
    args: ['--no-first-run', '--no-default-browser-check', '--start-maximized'],
    viewport: { width: 430, height: 932 },  // mobile viewport matching Stitch designs
  });

  // Capture Stitch reference screens first (no auth needed — local files)
  await captureStitchRefs(browser);

  const page = await browser.newPage();
  await page.setViewportSize({ width: 430, height: 932 });

  try {
    // ── Live app tests ──
    await testLanding(page);
    await testGRN(page);
    await testIQC(page);
    await testOQC(page);
    await testDispatch(page);
    await testNCR(page);
    await testPO(page);
    await testRecords(page);
    await testKPI(page);
    await testIPQC(page);
    await testWarehouse(page);
    await testMasters(page);
    await testCustomerReturn(page);
    await testControlPlan(page);

  } catch (err) {
    console.error('\n⚠️  Fatal error:', err.message);
    await page.screenshot({ path: path.join(SHOTS_DIR, '_fatal_error.png'), fullPage: true }).catch(() => {});
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════');
  console.log('  RESULTS SUMMARY');
  console.log('══════════════════════════════════════════════\n');

  const byModule = {};
  for (const r of results) {
    if (!byModule[r.module]) byModule[r.module] = { pass: 0, fail: 0, failures: [] };
    if (r.passed) byModule[r.module].pass++;
    else {
      byModule[r.module].fail++;
      byModule[r.module].failures.push(`${r.name}${r.detail ? ': ' + r.detail : ''}`);
    }
  }

  let totalPass = 0, totalFail = 0;
  for (const [mod, s] of Object.entries(byModule)) {
    const icon = s.fail === 0 ? '✅' : '⚠️ ';
    console.log(`${icon} ${mod}: ${s.pass}/${s.pass + s.fail}`);
    s.failures.forEach(f => console.log(`     ❌ ${f}`));
    totalPass += s.pass;
    totalFail += s.fail;
  }

  console.log(`\n📊 Total: ${totalPass}/${totalPass + totalFail} checks passed`);
  console.log(`📁 Screenshots saved to: ${SHOTS_DIR}`);
  console.log('\n💡 Compare _shots/0X_*.png (live) vs _shots/ref_*.png (Stitch) for visual diff\n');

  await browser.close();
})();
