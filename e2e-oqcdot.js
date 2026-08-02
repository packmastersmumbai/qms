const { launch, openApp, nav } = require('./e2e-lib');
(async () => {
  const b = await launch();
  const { ctx, page, app } = await openApp(b);
  await nav(app, page, 'OQC'); await page.waitForTimeout(11000);
  let fr=null,len=0;
  for (const f of page.frames()){try{const n=await f.evaluate(()=>(document.body.innerText||'').length);if(n>len){len=n;fr=f;}}catch(_){}}
  console.log(JSON.stringify(await fr.evaluate(()=>{
    const e=document.querySelector('.req-dot'); if(!e) return 'none';
    const cs=getComputedStyle(e), r=e.getBoundingClientRect();
    const p=e.parentElement, pcs=getComputedStyle(p), pr=p.getBoundingClientRect();
    return {display:cs.display,width:cs.width,height:cs.height,
      boxSizing:cs.boxSizing, position:cs.position, float:cs.cssFloat,
      rect:{w:r.width,h:r.height,top:Math.round(r.top)},
      parent:{tag:p.tagName,cls:String(p.className).slice(0,50),display:pcs.display,
              visible:pr.width>0&&pr.height>0, h:Math.round(pr.height)},
      // is an ancestor hidden?
      hiddenAncestor:(()=>{for(let n=e;n;n=n.parentElement){const c=getComputedStyle(n);
        if(c.display==='none'||c.visibility==='hidden')return n.tagName+'.'+String(n.className).slice(0,30);}return null;})()};
  }),null,1));
  await ctx.close(); await b.close();
})();
