const { launch, openApp, nav } = require('./e2e-lib');
(async()=>{
  const b=await launch(); const { page, app }=await openApp(b);
  await page.setViewportSize({width:1200,height:1000});
  await nav(app,page,'GRN');
  await page.waitForTimeout(14000);
  let fr=null;
  for(const f of page.frames()){
    try{ if(await f.evaluate(()=>!!document.getElementById('formWrap'))) fr=f; }catch(_){}
  }
  if(!fr){ console.log('NO FRAME'); await b.close(); return; }
  console.log(await fr.evaluate(()=>{
    const s=document.querySelector('.fk-optional-strip');
    if(!s) return 'STRIP ELEMENT NOT FOUND';
    const cs=getComputedStyle(s);
    return 'strip found: display='+cs.display+' cols='+cs.gridTemplateColumns+
      ' children='+s.children.length+' width='+Math.round(s.getBoundingClientRect().width)+
      ' hasSupport(:has)='+CSS.supports('selector(:has(*))');
  }));
  await b.close();
})();
