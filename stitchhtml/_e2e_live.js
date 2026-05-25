const { chromium } = require('playwright');

const GAS_URL = 'https://script.google.com/macros/s/AKfycbz-TYeVtSrCFLcs32IeGpNPwTFx3_rdYSd42_Y9EAu5v2h9cDCjAEgl_w75Tk8ZA90JNA/exec';
const CHROME_PROFILE = 'C:\Users\Appex\AppData\Local\Google\Chrome\User Data';

(async () => {
  const browser = await chromium.launchPersistentContext(CHROME_PROFILE, {
    headless: false,
    channel: 'chrome',
    args: ['--no-first-run', '--no-default-browser-check']
  });

  const page = await browser.newPage();
  const results = [];

  const check = (name, passed, detail = '') => {
    results.push({ name, passed, detail });
    console.log(`${passed ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
  };

  try {
    console.log('\n=== PM QMS E2E — Live GAS ===\n');

    // 1. Landing page loads
    await page.goto(GAS_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'stitchhtml/_e2e_landing.png', fullPage: true });
    const title = await page.title();
    check('Landing page loads', !title.includes('Error'), `title="${title}"`);

    const landingText = await page.textContent('body');
    check('Landing has nav buttons', /GRN|IQC|OQC|IPQC/i.test(landingText), 'module buttons present');

    // 2. GRN Form
    const grnBtn = page.locator('button, a').filter({ hasText: /GRN/i }).first();
    if (await grnBtn.count() > 0) {
      await grnBtn.click();
      await page.waitForTimeout(4000);
      await page.screenshot({ path: 'stitchhtml/_e2e_grn.png', fullPage: true });
      const grnText = await page.textContent('body');
      check('GRN form loads', /GRN|Supplier|Purchase Order/i.test(grnText), '');
      check('GRN has supplier field', /Supplier/i.test(grnText), '');
    } else {
      check('GRN button found', false, 'button not found on landing');
    }

    // 3. Navigate back, try IQC
    await page.goto(GAS_URL, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(2000);
    const iqcBtn = page.locator('button, a').filter({ hasText: /IQC/i }).first();
    if (await iqcBtn.count() > 0) {
      await iqcBtn.click();
      await page.waitForTimeout(4000);
      await page.screenshot({ path: 'stitchhtml/_e2e_iqc.png', fullPage: true });
      const iqcText = await page.textContent('body');
      check('IQC form loads', /IQC|Inspector|AQL/i.test(iqcText), '');
    } else {
      check('IQC button found', false, 'button not found on landing');
    }

    // Summary
    console.log('\n=== SUMMARY ===');
    const passed = results.filter(r => r.passed).length;
    console.log(`Passed: ${passed}/${results.length}`);
    if (results.some(r => !r.passed)) {
      console.log('Failed:');
      results.filter(r => !r.passed).forEach(r => console.log(`  ❌ ${r.name}: ${r.detail}`));
    }

  } catch (err) {
    console.error('E2E error:', err.message);
  } finally {
    await page.screenshot({ path: 'stitchhtml/_e2e_final.png', fullPage: true });
    await browser.close();
  }
})();
