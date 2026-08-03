/* Verify: (1) GRN hint names the REAL missing fields, (2) zoom is unblocked. */
const { launch, openApp, nav } = require('./e2e-lib');
(async()=>{
  const b=await launch();
  for(const mod of ['GRN','IQC','Records']){
    const {ctx,page,app}=await openApp(b);
    await nav(app,page,mod); await page.waitForTimeout(mod==='IQC'?13000:11000);
    let fr=null,len=0;
    for(const f of page.frames()){try{const n=await f.evaluate(()=>(document.body.innerText||'').length);if(n>len){len=n;fr=f;}}catch(_){}}
    const r=await fr.evaluate(()=>{
      const vp=document.querySelector('meta[name=viewport]');
      const h=document.getElementById('submitHint');
      return {viewport:vp?vp.content:'(none)',
              zoomBlocked:vp?/user-scalable=no|maximum-scale=1/.test(vp.content):null,
              hint:h?h.textContent.trim():null,
              hintMentionsDisposition:h?/disposition/i.test(h.textContent):null};
    });
    console.log('\n== '+mod+' ==');
    console.log('  viewport: '+r.viewport);
    console.log('  zoomBlocked: '+r.zoomBlocked);
    if(r.hint!==null){console.log('  hint: "'+r.hint+'"');console.log('  mentionsRemovedControl: '+r.hintMentionsDisposition);}
    await ctx.close();
  }
  await b.close();
})();
