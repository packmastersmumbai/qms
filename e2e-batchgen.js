/* Exercise the live autoBatchNo_ in the deployed GRN form. */
const { launch, openApp, nav } = require('./e2e-lib');
(async()=>{
  const b=await launch();
  const {ctx,page,app}=await openApp(b);
  await nav(app,page,'GRN'); await page.waitForTimeout(11000);
  let fr=null,len=0;
  for(const f of page.frames()){try{const n=await f.evaluate(()=>(document.body.innerText||'').length);if(n>len){len=n;fr=f;}}catch(_){}}
  console.log(JSON.stringify(await fr.evaluate(()=>{
    if(typeof window.autoBatchNo_!=='function') return {missing:true, hasFn:typeof autoBatchNo_, keys:Object.keys(window).filter(k=>/auto|batch/i.test(k))};
    const gen=window.autoBatchNo_; const cases=[['1308119',1],['201106-000000',1],['552000-005015',1],['NGNGM05',1],['Code3',1],['3110343',12],['',1]];
    return cases.map(([c,s])=>{const v=gen(c,s);
      return {code:c||'(blank)',seq:s,batch:v,len:v.length,
              clean:/^[A-Z0-9]+$/.test(v),within15:v.length<=15};});
  }),null,1));
  await ctx.close(); await b.close();
})();
