/* Time getQmsKpis directly — does it return at all, and how slowly? */
const { launch, openApp, call } = require('./e2e-lib');
(async()=>{
  const b=await launch();
  const {ctx,rpc}=await openApp(b);
  for(const label of ['LAST_90 (cold)','LAST_90 (warm)','THIS_FY (cold)']){
    const t0=Date.now();
    const r=await Promise.race([
      call(rpc,'getQmsKpis',['MANAGER',{preset:label.indexOf('THIS_FY')===0?'THIS_FY':'LAST_90'}]),
      new Promise(res=>setTimeout(()=>res({__timeout:true}),120000))
    ]);
    const ms=Date.now()-t0;
    if(r&&r.__timeout) console.log(label+': TIMED OUT after '+ms+'ms');
    else if(r&&r.__err) console.log(label+': ERROR after '+ms+'ms -> '+r.__err);
    else console.log(label+': ok in '+ms+'ms, '+(Array.isArray(r)?r.length+' kpis':typeof r));
  }
  await ctx.close(); await b.close();
})();
