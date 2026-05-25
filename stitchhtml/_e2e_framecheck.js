const { chromium } = require('playwright');
const GAS_URL = 'https://script.google.com/macros/s/AKfycbz-TYeVtSrCFLcs32IeGpNPwTFx3_rdYSd42_Y9EAu5v2h9cDCjAEgl_w75Tk8ZA90JNA/exec';
const CHROME_PROFILE = 'C:\Users\Appex\AppData\Local\Google\Chrome\User Data';

(async () => {
  const browser = await chromium.launchPersistentContext(CHROME_PROFILE, {
    headless: false, channel: 'chrome', args: ['--no-first-run']
  });
  const page = await browser.newPage();
  await page.goto(GAS_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(5000);

  for (const f of page.frames()) {
    try {
      const snippet = await f.evaluate(() => document.body?.innerText?.trim().slice(0, 100));
      const btns = await f.evaluate(() => [...document.querySelectorAll('button')].map(b => b.innerText.trim()).slice(0,10));
      console.log(`FRAME: ${f.url().slice(0,80)}`);
      console.log(`  text: ${snippet}`);
      console.log(`  buttons: ${JSON.stringify(btns)}`);
    } catch(e) { console.log(`FRAME: ${f.url().slice(0,60)} — error: ${e.message.slice(0,40)}`); }
  }

  await browser.close();
})();
