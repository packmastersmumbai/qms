/* Do the converted collapses still open, and do they now animate to real height? */
const { launch, openApp, nav } = require('./e2e-lib');
(async () => {
  const b = await launch();
  const { ctx, page, app } = await openApp(b);
  await nav(app, page, 'Records'); await page.waitForTimeout(11000);
  let fr=null,len=0;
  for (const f of page.frames()){try{const n=await f.evaluate(()=>(document.body.innerText||'').length);if(n>len){len=n;fr=f;}}catch(_){}}
  console.log(JSON.stringify(await fr.evaluate(()=>{
    const out={};
    const de=document.querySelector('.date-expander');
    if(de){const cs=getComputedStyle(de);
      out.dateExpander={display:cs.display,rows:cs.gridTemplateRows,
        closedH:Math.round(de.getBoundingClientRect().height)};
      de.classList.add('is-open');
      out.dateExpander.openRows=getComputedStyle(de).gridTemplateRows;
      out.dateExpander.openH=Math.round(de.getBoundingClientRect().height);
      de.classList.remove('is-open');}
    const di=document.querySelector('.detail-inner');
    if(di){const cs=getComputedStyle(di);
      out.detailInner={display:cs.display,rows:cs.gridTemplateRows,
        closedH:Math.round(di.getBoundingClientRect().height)};
      di.classList.add('open');
      out.detailInner.openH=Math.round(di.getBoundingClientRect().height);
      di.classList.remove('open');}
    return out;
  }),null,1));
  await ctx.close(); await b.close();
})();
