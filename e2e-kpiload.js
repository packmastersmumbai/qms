/* Why does KPI leave "Loading…" on screen under full-suite load but not alone?
   Watch the placeholders over time and capture what the server actually returns. */
const { launch, openApp, nav } = require('./e2e-lib');
(async()=>{
  const b=await launch();
  const {ctx,page,app,errors}=await openApp(b);
  await nav(app,page,'KPI');
  let fr=null;
  for(let t=0;t<8;t++){
    await page.waitForTimeout(4000);
    let len=0;
    for(const f of page.frames()){try{const n=await f.evaluate(()=>(document.body.innerText||'').length);if(n>len){len=n;fr=f;}}catch(_){}}
    if(!fr) continue;
    const r=await fr.evaluate(()=>{
      const vis=el=>{const b=el.getBoundingClientRect();
        if(!(b.width>0&&b.height>0))return false;
        for(let n=el;n&&n!==document.documentElement;n=n.parentElement){const c=getComputedStyle(n);
          if(c.display==='none'||c.visibility==='hidden'||parseFloat(c.opacity)===0)return false;}
        return true;};
      const loaders=[...document.querySelectorAll('body *')]
        .filter(e=>e.children.length===0&&vis(e)&&/^loading/i.test(e.textContent.trim()));
      return {n:loaders.length,
        ids:loaders.map(e=>e.id||e.parentElement&&e.parentElement.id||e.tagName).slice(0,4),
        txt:loaders.map(e=>e.textContent.trim().slice(0,20)).slice(0,4)};
    });
    console.log('t+'+((t+1)*4)+'s  loaders='+r.n+'  '+JSON.stringify(r.ids)+' '+JSON.stringify(r.txt));
    if(r.n===0) break;
  }
  console.log('PAGEERR:', errors.filter(e=>e.startsWith('PAGEERR')).slice(0,3));
  await ctx.close(); await b.close();
})();
