const { chromium } = require('playwright');
const GAS_URL = 'https://script.google.com/macros/s/AKfycbz-TYeVtSrCFLcs32IeGpNPwTFx3_rdYSd42_Y9EAu5v2h9cDCjAEgl_w75Tk8ZA90JNA/exec';
const CHROME_PROFILE = 'C:\Users\Appex\AppData\Local\Google\Chrome\User Data';

(async () => {
  const browser = await chromium.launchPersistentContext(CHROME_PROFILE, {
    headless: false, channel: 'chrome',
    args: ['--no-first-run', '--no-default-browser-check']
  });
  const page = await browser.newPage();
  await page.goto(GAS_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(4000);

  // List all frames
  const frames = page.frames();
  console.log(`Total frames: ${frames.length}`);
  for (const f of frames) {
    console.log(`  Frame URL: ${f.url().slice(0, 100)}`);
    try {
      const btns = await f.evaluate(() => {
        const els = [...document.querySelectorAll('button, a, [role="button"], [onclick]')];
        return els.map(e => e.textContent.trim().slice(0, 60)).filter(t => t.length > 0);
      });
      if (btns.length) console.log(`    Buttons: ${btns.join(' | ')}`);
      const bodySnip = await f.evaluate(() => document.body?.textContent?.trim().slice(0, 200));
      if (bodySnip) console.log(`    Body: ${bodySnip}`);
    } catch(e) { console.log(`    (cross-origin or error: ${e.message.slice(0,50)})`); }
  }

  await browser.close();
})();
