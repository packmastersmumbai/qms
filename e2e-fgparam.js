/* What do FG products get today from IPQC + Control Plan? READ-ONLY. */
const { launch, openApp, call } = require('./e2e-lib');
(async () => {
  const b = await launch();
  const { ctx, rpc } = await openApp(b);
  const cp = await call(rpc, 'getControlPlan', ['fg']);
  const keys = cp && !cp.__err ? Object.keys(cp) : [];
  console.log('getControlPlan(fg) keys:', keys.slice(0,8).join(','));
  const j = JSON.stringify(cp);
  console.log('enabled rows / shape:', j.slice(0, 320));
  // what does IPQC hand an FG product right now?
  for (const code of ['2967583','3050437']) {
    const p = await call(rpc, 'getIpqcParamsForProduct', [code]).catch(()=>null);
    console.log('IPQC '+code+': '+(p && !p.__err ? JSON.stringify(p).slice(0,200) : 'n/a '+(p&&p.__err||'')));
  }
  await ctx.close(); await b.close();
})();
