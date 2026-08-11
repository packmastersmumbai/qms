const { launch, openApp, nav } = require('./e2e-lib');
(async()=>{
  const b=await launch(); const { page, app }=await openApp(b);
  const errs=[]; page.on('pageerror',e=>errs.push(String(e&&e.message||e).slice(0,140)));
  await page.setViewportSize({width:390,height:844});
  await nav(app,page,'GRN');
  await page.waitForTimeout(15000);
  let fr=null;
  for(const f of page.frames()){
    try{ if(await f.evaluate(()=>!!document.getElementById('btnSubmit'))) fr=f; }catch(_){}
  }
  if(!fr){ console.log('NO FRAME'); await b.close(); return; }
  console.log('btn disabled (untouched form):', await fr.evaluate(()=>document.getElementById('btnSubmit').disabled));
  // Real user tap on the DISABLED button, via mouse at its coordinates.
  const box = await fr.evaluate(()=>{
    const r=document.getElementById('btnSubmit').getBoundingClientRect();
    return {x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2)};
  });
  await page.mouse.click(box.x, box.y);
  await page.waitForTimeout(900);
  console.log('after REAL tap:', await fr.evaluate(()=>{
    const t=document.getElementById('toast');
    return 'hasShowClass='+t.classList.contains('show')+
      ' top='+Math.round(t.getBoundingClientRect().top)+
      ' msg="'+t.textContent.trim().slice(0,60)+'"'+
      ' invalidFields='+document.querySelectorAll('#formWrap .fk-field.is-invalid').length;
  }));
  await page.waitForTimeout(4000);
  console.log('after 4s (should have faded):', await fr.evaluate(()=>{
    const t=document.getElementById('toast');
    return 'hasShowClass='+t.classList.contains('show')+' opacity='+getComputedStyle(t).opacity;
  }));
  console.log('page errors:', errs.length?errs:'NONE');
  await b.close();
})();
