const { chromium } = require('playwright');
const GAS_URL = 'https://script.google.com/macros/s/AKfycbz-TYeVtSrCFLcs32IeGpNPwTFx3_rdYSd42_Y9EAu5v2h9cDCjAEgl_w75Tk8ZA90JNA/exec';
const CHROME_PROFILE = 'C:\Users\Appex\AppData\Local\Google\Chrome\User Data';
const getAppFrame = async (page) => { for (const f of page.frames()) { try { const c = await f.evaluate(() => document.querySelectorAll('button').length); if (c > 2) return f; } catch(e) {} } return null; };

(async () => {
  const browser = await chromium.launchPersistentContext(CHROME_PROFILE, { headless: false, channel: 'chrome', args: ['--no-first-run'] });
  const page = await browser.newPage();
  await page.goto(GAS_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(4000);
  let frame = await getAppFrame(page);
  await frame.locator('button').filter({ hasText: /NCR/i }).first().click();
  await page.waitForTimeout(5000);
  frame = await getAppFrame(page);
  const text = await frame.evaluate(() => document.body.innerText.slice(0, 500));
  console.log('NCR page text:\n', text);
  await page.screenshot({ path: '_e2e_ncr_debug.png', fullPage: true });
  await browser.close();
})();
