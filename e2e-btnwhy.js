/* Why are these buttons not visible? Measure the element and every ancestor. */
const { launch, openApp, nav } = require('./e2e-lib');
const T=[['IQC','saveBtn'],['IPQC','btnSaveRound'],['CustomerReturn','btnSave']];
(async()=>{
  const b=await launch();
  for(const [mod,id] of T){
    const {ctx,page,app}=await openApp(b);
    await page.setViewportSize({width:390,height:844});
    await nav(app,page,mod); await page.waitForTimeout(mod==='IQC'?13000:11000);
    let fr=null,len=0;
    for(const f of page.frames()){try{const n=await f.evaluate(()=>(document.body.innerText||'').length);if(n>len){len=n;fr=f;}}catch(_){}}
    console.log('\n== '+mod+' #'+id+' ==', JSON.stringify(await fr.evaluate((x)=>{
      const e=document.getElementById(x);
      if(!e) return 'ELEMENT MISSING';
      const cs=getComputedStyle(e), r=e.getBoundingClientRect();
      const chain=[];
      for(let n=e.parentElement;n&&chain.length<5;n=n.parentElement){
        const c=getComputedStyle(n), b=n.getBoundingClientRect();
        chain.push({id:n.id||n.tagName+'.'+String(n.className).slice(0,20),
          display:c.display,vis:c.visibility,op:c.opacity,h:Math.round(b.height),ov:c.overflow});
      }
      return {display:cs.display,visibility:cs.visibility,opacity:cs.opacity,
        rect:{t:Math.round(r.top),b:Math.round(r.bottom),w:Math.round(r.width),h:Math.round(r.height)},
        vh:innerHeight, text:(e.textContent||'').trim().slice(0,26), chain};
    },id),null,1));
    await ctx.close();
  }
  await b.close();
})();
