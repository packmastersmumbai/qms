/**
 * Run ONCE — launches real Chrome (headed), you sign in with Google,
 * then Playwright saves the session to e2e-storageState.json.
 * All future test runs (e2e-lib.js / e2e-*.js) use that saved state (no sign-in needed).
 *
 * Usage: node e2e-auth-capture.js
 *   1. A Chrome window opens at the live QMS app.
 *   2. Sign in as packmasters.mumbai@gmail.com (only needed when state expires).
 *   3. Once the dashboard loads, the session is saved automatically.
 */
const PW = 'C:/Users/Appex/AppData/Roaming/npm/node_modules/@playwright/cli/node_modules/playwright';
const { chromium } = require(PW);
const path = require('path');
const fs   = require('fs');
const os   = require('os');

// Sign in on the GAS /exec URL directly — Google OAuth renders on its own top-level
// domain there (inside the GitHub Pages wrapper the nested iframe makes sign-in fail).
// The session cookies captured here are the same ones the wrapper-based harness uses.
const APP_URL    = 'https://script.google.com/macros/s/AKfycbxMFpeJOqF5_iARRCo7aHLg0Pw_XlqKdAzmDVck8DUdDfgr1nIIjbvTgrlyc0XtYRuaVQ/exec';
const STATE_FILE = path.join(__dirname, 'e2e-storageState.json');
const ARTIFACTS  = path.join(__dirname, 'test-artifacts/e2e-auth');
// Fixed dir so cookies survive across runs
const PROFILE_DIR = path.join(os.homedir(), 'pw-pmqms-profile');

fs.mkdirSync(ARTIFACTS, { recursive: true });
fs.mkdirSync(PROFILE_DIR, { recursive: true });

// The app is ready when the SPA frame defines navigateTo (same signal e2e-lib.js uses).
async function appReady(page) {
  for (const frame of page.frames()) {
    const ok = await frame.evaluate(() => typeof window.navigateTo === 'function').catch(() => false);
    if (ok) return true;
  }
  return false;
}

(async () => {
  console.log('Launching real Chrome (headed) — sign in when the browser opens.');
  console.log('Profile dir (reused on every run):', PROFILE_DIR, '\n');

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: 'chrome',
    headless: false,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    viewport: { width: 1280, height: 800 },
    args: ['--no-first-run', '--no-default-browser-check', '--disable-sync'],
  });

  const page = await context.newPage();
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

  console.log('>>> Browser open. Sign in with packmasters.mumbai@gmail.com if prompted.');
  console.log('>>> Waiting up to 5 minutes for the QMS dashboard (navigateTo) to load...\n');

  const deadline = Date.now() + 300000;
  let found = false;
  let tick = 0;
  while (Date.now() < deadline) {
    await page.waitForTimeout(2000);
    tick++;
    if (await appReady(page)) {
      console.log('\n>>> QMS app detected (navigateTo present).');
      await page.screenshot({ path: path.join(ARTIFACTS, 'auth-success.png') });
      await context.storageState({ path: STATE_FILE });
      console.log('Saved:', STATE_FILE);
      found = true;
      break;
    }
    if (tick % 5 === 0) {
      console.log(`[${tick * 2}s] ${page.url().slice(0, 80)} | frames=${page.frames().length}`);
    }
  }

  if (!found) {
    console.log('\n>>> Timed out — saving state anyway (cookies may still be valid).');
    await page.screenshot({ path: path.join(ARTIFACTS, 'auth-timeout.png') });
    await context.storageState({ path: STATE_FILE });
    console.log('Saved:', STATE_FILE);
  }

  await context.close();
  console.log('\nDone. Now run: node e2e-production.js');
})();
