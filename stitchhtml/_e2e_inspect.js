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
  await page.waitForTimeout(3000);

  // Dump all buttons and links
  const elements = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button, a, [role="button"]')];
    return btns.map(el => ({ tag: el.tagName, text: el.textContent.trim().slice(0, 80), id: el.id, cls: el.className.slice(0, 60) }));
  });
  console.log('Clickable elements on landing:');
  elements.forEach(e => console.log(`  <${e.tag}> "${e.text}" id="${e.id}"`));

  await browser.close();
})();
