// Fetch a ?diag= JSON/text endpoint from the deployed GAS web app using the stored
// Google session. Usage: node e2e-diag.js folderlist
const path = require('path'), fs = require('fs');
const { chromium } = require('playwright');
const STATE = path.join(__dirname, 'e2e-storageState.json');
const EXEC = 'https://script.google.com/macros/s/AKfycbxMFpeJOqF5_iARRCo7aHLg0Pw_XlqKdAzmDVck8DUdDfgr1nIIjbvTgrlyc0XtYRuaVQ/exec';

(async () => {
  const q = process.argv.slice(2).join('&');
  if (!q) { console.log('usage: node e2e-diag.js folderlist   |   foldermigrate&confirm=YES'); process.exit(1); }
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ storageState: fs.existsSync(STATE) ? STATE : undefined });
  const page = await ctx.newPage();
  const url = EXEC + '?diag=' + q;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);
  // GAS text output renders inside a nested frame; grab the largest body text.
  let best = '';
  for (const f of page.frames()) {
    try { const t = await f.evaluate(() => document.body ? document.body.innerText : ''); if (t && t.length > best.length) best = t; } catch (_) {}
  }
  console.log(best || '(empty response)');
  await b.close();
})();
