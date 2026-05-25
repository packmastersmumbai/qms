const { chromium } = require('playwright');
const GAS_URL = 'https://script.google.com/macros/s/AKfycbz-TYeVtSrCFLcs32IeGpNPwTFx3_rdYSd42_Y9EAu5v2h9cDCjAEgl_w75Tk8ZA90JNA/exec';
const CHROME_PROFILE = 'C:\Users\Appex\AppData\Local\Google\Chrome\User Data';

const results = [];
const check = (name, passed, detail = '') => {
  results.push({ name, passed, detail });
  console.log(`${passed ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
};

const getAppFrame = (page) => page.frames().find(f => f.url().includes('googleusercontent.com/userCodeAppPanel'));

(async () => {
  const browser = await chromium.launchPersistentContext(CHROME_PROFILE, {
    headless: false, channel: 'chrome',
    args: ['--no-first-run', '--no-default-browser-check']
  });
  const page = await browser.newPage();

  try {
    console.log('\n=== PM QMS E2E — Live GAS ===\n');

    // --- Landing ---
    await page.goto(GAS_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(4000);
    await page.screenshot({ path: '_e2e_01_landing.png', fullPage: true });

    let frame = getAppFrame(page);
    check('Landing frame loads', !!frame, frame?.url().slice(0,60) || 'no frame');

    const landingText = await frame.evaluate(() => document.body.textContent);
    check('Landing shows app title', /Pack Masters QMS/i.test(landingText));
    check('Landing shows module buttons', /New GRN|New IQC|New OQC/i.test(landingText));
    check('Landing shows dashboard tiles', /GRN|IQC|OQC|IPQC/i.test(landingText));

    // --- GRN Form ---
    console.log('\n-- GRN Form --');
    const grnBtn = frame.locator('button').filter({ hasText: /New GRN/i }).first();
    await grnBtn.click();
    await page.waitForTimeout(4000);
    await page.screenshot({ path: '_e2e_02_grn.png', fullPage: true });
    frame = getAppFrame(page);
    const grnText = await frame.evaluate(() => document.body.textContent);
    check('GRN form opens', /GRN|Goods Receipt|Supplier/i.test(grnText));
    check('GRN has Supplier field', /Supplier/i.test(grnText));
    check('GRN has PO field', /Purchase Order|PO/i.test(grnText));

    // --- Back to Landing ---
    await page.goto(GAS_URL, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(3000);
    frame = getAppFrame(page);

    // --- IQC Form ---
    console.log('\n-- IQC Form --');
    const iqcBtn = frame.locator('button').filter({ hasText: /New IQC/i }).first();
    await iqcBtn.click();
    await page.waitForTimeout(4000);
    await page.screenshot({ path: '_e2e_03_iqc.png', fullPage: true });
    frame = getAppFrame(page);
    const iqcText = await frame.evaluate(() => document.body.textContent);
    check('IQC form opens', /IQC|Incoming Quality|Inspector|AQL/i.test(iqcText));
    check('IQC has Inspector field', /Inspector/i.test(iqcText));
    check('IQC has AQL field', /AQL/i.test(iqcText));

    // --- Back + OQC ---
    await page.goto(GAS_URL, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(3000);
    frame = getAppFrame(page);

    console.log('\n-- OQC Form --');
    const oqcBtn = frame.locator('button').filter({ hasText: /New OQC/i }).first();
    await oqcBtn.click();
    await page.waitForTimeout(4000);
    await page.screenshot({ path: '_e2e_04_oqc.png', fullPage: true });
    frame = getAppFrame(page);
    const oqcText = await frame.evaluate(() => document.body.textContent);
    check('OQC form opens', /OQC|Outgoing Quality|Batch|Dispatch/i.test(oqcText));

    // --- Navigation links ---
    await page.goto(GAS_URL, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(3000);
    frame = getAppFrame(page);
    console.log('\n-- Bottom Nav --');
    const navText = await frame.evaluate(() => document.body.textContent);
    check('Records nav present', /Records/i.test(navText));
    check('KPIs nav present', /KPI/i.test(navText));
    check('Masters nav present', /Masters/i.test(navText));

  } catch (err) {
    console.error('\nE2E error:', err.message);
    await page.screenshot({ path: '_e2e_error.png', fullPage: true }).catch(() => {});
  } finally {
    console.log('\n=== SUMMARY ===');
    const passed = results.filter(r => r.passed).length;
    console.log(`Passed: ${passed}/${results.length}`);
    const failed = results.filter(r => !r.passed);
    if (failed.length) { console.log('Failed:'); failed.forEach(r => console.log(`  ❌ ${r.name}${r.detail ? ': ' + r.detail : ''}`)); }
    await browser.close();
  }
})();
