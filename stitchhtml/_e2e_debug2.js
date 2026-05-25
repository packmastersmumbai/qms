const { chromium } = require('playwright');
const GAS_URL = 'https://script.google.com/macros/s/AKfycbz-TYeVtSrCFLcs32IeGpNPwTFx3_rdYSd42_Y9EAu5v2h9cDCjAEgl_w75Tk8ZA90JNA/exec';
const CHROME_PROFILE = 'C:\Users\Appex\AppData\Local\Google\Chrome\User Data';
const getAppFrame = async (page) => { for (const f of page.frames()) { try { const c = await f.evaluate(() => document.querySelectorAll('button').length); if (c > 2) return f; } catch(e) {} } return null; };

(async () => {
  const browser = await chromium.launchPersistentContext(CHROME_PROFILE, { headless: false, channel: 'chrome', args: ['--no-first-run'] });
  const page = await browser.newPage();

  // Check OQC text
  await page.goto(GAS_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(4000);
  let frame = await getAppFrame(page);
  await frame.locator('button').filter({ hasText: /New OQC/i }).first().click();
  await page.waitForTimeout(4000);
  frame = await getAppFrame(page);
  const oqcSnip = await frame.evaluate(() => document.body.innerText.slice(0, 300));
  console.log('OQC text:\n', oqcSnip);

  // Check NCR — try clicking from More menu
  await page.goto(GAS_URL, { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(3000);
  frame = await getAppFrame(page);
  const allBtns = await frame.evaluate(() => [...document.querySelectorAll('button')].map(b => b.innerText.trim().slice(0,40)));
  console.log('\nAll landing buttons:', allBtns);

  await browser.close();
})();
