const { chromium } = require('playwright');
const GAS_URL = 'https://script.google.com/macros/s/AKfycbz-TYeVtSrCFLcs32IeGpNPwTFx3_rdYSd42_Y9EAu5v2h9cDCjAEgl_w75Tk8ZA90JNA/exec';
const CHROME_PROFILE = 'C:\Users\Appex\AppData\Local\Google\Chrome\User Data';

const results = [];
const check = (name, passed, detail = '') => {
  results.push({ name, passed, detail });
  console.log(`${passed ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
};

// Get the frame that has actual app content (has buttons)
const getAppFrame = async (page) => {
  for (const f of page.frames()) {
    try {
      const count = await f.evaluate(() => document.querySelectorAll('button').length);
      if (count > 2) return f;
    } catch(e) {}
  }
  return null;
};

const goto = async (page) => {
  await page.goto(GAS_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(4000);
  return getAppFrame(page);
};

(async () => {
  const browser = await chromium.launchPersistentContext(CHROME_PROFILE, {
    headless: false, channel: 'chrome', args: ['--no-first-run', '--no-default-browser-check']
  });
  const page = await browser.newPage();

  try {
    console.log('\n=== PM QMS E2E — Live GAS ===\n');

    // --- Landing ---
    let frame = await goto(page);
    await page.screenshot({ path: '_e2e_01_landing.png', fullPage: true });
    check('Landing frame loads', !!frame);

    const landingText = await frame.evaluate(() => document.body.innerText);
    check('App title visible', /Pack Masters QMS/i.test(landingText));
    check('Action buttons present', /New GRN.*New IQC.*New OQC/s.test(landingText));
    check('Nav items present', /Records.*KPI.*Masters/s.test(landingText));
    check('Date/shift shown', /Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday/i.test(landingText));

    // --- GRN ---
    console.log('\n-- GRN Form --');
    await frame.locator('button').filter({ hasText: /New GRN/i }).first().click();
    await page.waitForTimeout(4000);
    await page.screenshot({ path: '_e2e_02_grn.png', fullPage: true });
    frame = await getAppFrame(page);
    const grnText = await frame.evaluate(() => document.body.innerText);
    check('GRN form title', /GRN|Goods Receipt/i.test(grnText));
    check('GRN Supplier field', /Supplier/i.test(grnText));
    check('GRN PO field', /Purchase Order|PO/i.test(grnText));
    check('GRN Items section', /Item|Material/i.test(grnText));

    // --- IQC ---
    console.log('\n-- IQC Form --');
    frame = await goto(page);
    await frame.locator('button').filter({ hasText: /New IQC/i }).first().click();
    await page.waitForTimeout(4000);
    await page.screenshot({ path: '_e2e_03_iqc.png', fullPage: true });
    frame = await getAppFrame(page);
    const iqcText = await frame.evaluate(() => document.body.innerText);
    check('IQC form title', /IQC|Incoming Quality/i.test(iqcText));
    check('IQC Inspector field', /Inspector/i.test(iqcText));
    check('IQC AQL field', /AQL/i.test(iqcText));
    check('IQC GRN selector', /GRN/i.test(iqcText));

    // --- OQC ---
    console.log('\n-- OQC Form --');
    frame = await goto(page);
    await frame.locator('button').filter({ hasText: /New OQC/i }).first().click();
    await page.waitForTimeout(4000);
    await page.screenshot({ path: '_e2e_04_oqc.png', fullPage: true });
    frame = await getAppFrame(page);
    const oqcText = await frame.evaluate(() => document.body.innerText);
    check('OQC form opens', /OQC|Outgoing Quality|Batch|Dispatch/i.test(oqcText));

    // --- Dispatch/Gatepass ---
    console.log('\n-- Dispatch/Gatepass --');
    frame = await goto(page);
    await frame.locator('button').filter({ hasText: /Dispatch/i }).first().click();
    await page.waitForTimeout(4000);
    await page.screenshot({ path: '_e2e_05_dispatch.png', fullPage: true });
    frame = await getAppFrame(page);
    const dpText = await frame.evaluate(() => document.body.innerText);
    check('Dispatch/Gatepass opens', /Gatepass|Dispatch|Delivery/i.test(dpText));

    // --- NCR ---
    console.log('\n-- NCR --');
    frame = await goto(page);
    await frame.locator('button').filter({ hasText: /NCR/i }).first().click();
    await page.waitForTimeout(4000);
    await page.screenshot({ path: '_e2e_06_ncr.png', fullPage: true });
    frame = await getAppFrame(page);
    const ncrText = await frame.evaluate(() => document.body.innerText);
    check('NCR form opens', /NCR|Non.Conformance|Defect/i.test(ncrText));

    // --- Purchase Order ---
    console.log('\n-- Purchase Order --');
    frame = await goto(page);
    await frame.locator('button').filter({ hasText: /Purchase Order/i }).first().click();
    await page.waitForTimeout(4000);
    await page.screenshot({ path: '_e2e_07_po.png', fullPage: true });
    frame = await getAppFrame(page);
    const poText = await frame.evaluate(() => document.body.innerText);
    check('PO form opens', /Purchase Order|PO|Supplier/i.test(poText));

  } catch (err) {
    console.error('\nE2E error:', err.message);
    await page.screenshot({ path: '_e2e_error.png', fullPage: true }).catch(() => {});
  } finally {
    console.log('\n=== SUMMARY ===');
    const passed = results.filter(r => r.passed).length;
    console.log(`Passed: ${passed}/${results.length}`);
    results.filter(r => !r.passed).forEach(r => console.log(`  ❌ ${r.name}${r.detail ? ': ' + r.detail : ''}`));
    await browser.close();
  }
})();
