const { chromium } = require('playwright');
const GAS_URL = 'https://script.google.com/macros/s/AKfycbz-TYeVtSrCFLcs32IeGpNPwTFx3_rdYSd42_Y9EAu5v2h9cDCjAEgl_w75Tk8ZA90JNA/exec';
const CHROME_PROFILE = 'C:\Users\Appex\AppData\Local\Google\Chrome\User Data';

const results = [];
const check = (name, passed, detail = '') => {
  results.push({ name, passed, detail });
  console.log(`${passed ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
};

const getAppFrame = async (page) => {
  for (const f of page.frames()) {
    try { const c = await f.evaluate(() => document.querySelectorAll('button').length); if (c > 2) return f; } catch(e) {}
  }
  return null;
};

const goHome = async (page) => {
  await page.goto(GAS_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(4000);
  return getAppFrame(page);
};

const testModule = async (page, btnText, checks, screenshotName) => {
  let frame = await goHome(page);
  const btn = frame.locator('button').filter({ hasText: new RegExp(btnText, 'i') }).first();
  const found = await btn.count() > 0;
  if (!found) { check(`${btnText} button found`, false); return; }
  await btn.click();
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `_e2e_final_${screenshotName}.png`, fullPage: true });
  frame = await getAppFrame(page);
  const text = await frame.evaluate(() => document.body.innerText);
  for (const [label, pattern] of checks) check(`${btnText}: ${label}`, pattern.test(text));
};

(async () => {
  const browser = await chromium.launchPersistentContext(CHROME_PROFILE, {
    headless: false, channel: 'chrome', args: ['--no-first-run', '--no-default-browser-check']
  });
  const page = await browser.newPage();

  try {
    console.log('\n=== PM QMS Full E2E @146 ===\n');

    await testModule(page, 'New OQC',        [['opens', /OQC|Outgoing|Batch|Disposition/i], ['has navy bar', /Pack Masters/i]], 'oqc');
    await testModule(page, 'NCR',            [['opens', /NCR|Non.Conform|Defect/i]], 'ncr');
    await testModule(page, 'Purchase Order', [['opens', /Purchase Order|PO|Supplier/i], ['has line items', /Item|Material|Qty/i]], 'po');
    await testModule(page, 'Dispatch',       [['opens', /Gatepass|Dispatch|Delivery/i]], 'dispatch');

    // Nav-based modules (bottom nav or More menu)
    let frame = await goHome(page);
    const moreBtn = frame.locator('button').filter({ hasText: /More/i }).first();
    if (await moreBtn.count() > 0) {
      await moreBtn.click();
      await page.waitForTimeout(2000);
      frame = await getAppFrame(page);
      await page.screenshot({ path: '_e2e_final_more.png', fullPage: true });
      const moreText = await frame.evaluate(() => document.body.innerText);
      check('More menu: IPQC visible', /IPQC/i.test(moreText));
      check('More menu: KPI visible', /KPI/i.test(moreText));
      check('More menu: Warehouse visible', /Warehouse/i.test(moreText));
      check('More menu: Masters visible', /Masters/i.test(moreText));
      check('More menu: Returns visible', /Returns/i.test(moreText));
      check('More menu: Control Plan visible', /Control Plan/i.test(moreText));
    }

    // Records via bottom nav
    frame = await goHome(page);
    const recBtn = frame.locator('[role="button"], button, a').filter({ hasText: /Records/i }).first();
    if (await recBtn.count() > 0) {
      await recBtn.click();
      await page.waitForTimeout(4000);
      await page.screenshot({ path: '_e2e_final_records.png', fullPage: true });
      frame = await getAppFrame(page);
      const recText = await frame.evaluate(() => document.body.innerText);
      check('Records: opens', /Records|GRN|IQC|History/i.test(recText));
    }

  } catch (err) {
    console.error('\nE2E error:', err.message);
    await page.screenshot({ path: '_e2e_final_error.png', fullPage: true }).catch(() => {});
  } finally {
    console.log('\n=== SUMMARY ===');
    const passed = results.filter(r => r.passed).length;
    console.log(`Passed: ${passed}/${results.length}`);
    results.filter(r => !r.passed).forEach(r => console.log(`  ❌ ${r.name}`));
    await browser.close();
  }
})();
