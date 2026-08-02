const { launch, openApp, nav } = require('./e2e-lib');
const out=process.argv[2];
(async () => {
  const b = await launch();
  for (const mod of ["NCR","GRN"]) {
    const { ctx, page, app } = await openApp(b);
    await nav(app, page, mod); await page.waitForTimeout(11000);
    await page.screenshot({ path: `${out}/shot-${mod}.png`, fullPage:false });
    console.log('shot', mod);
    await ctx.close();
  }
  await b.close();
})();
