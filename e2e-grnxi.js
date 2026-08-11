const { launch, openApp, nav } = require('./e2e-lib');
(async()=>{
  const b=await launch(); const { page, app }=await openApp(b);
  await page.setViewportSize({width:960,height:1000});
  await nav(app,page,'GRN'); await page.waitForTimeout(14000);
  let fr=null;
  for(const f of page.frames()){ try{ if(await f.evaluate(()=>!!document.getElementById('formWrap'))) fr=f; }catch(_){} }
  if(!fr){ console.log('NO FRAME'); await b.close(); return; }
  // open the Additional Items disclosure and add a row
  await fr.evaluate(()=>{
    const d=document.querySelector('#extra-items-section details'); if(d) d.open=true;
    window.addExtraItem();
  });
  await page.waitForTimeout(900);
  const r=await fr.evaluate(()=>{
    const card=document.querySelector('#extra-items-list > .xi-card');
    if(!card) return {err:'no card'};
    const labels=[...card.querySelectorAll('.fk-label')].map(l=>l.textContent.replace(/\s+/g,' ').trim());
    const rows={};
    [...card.querySelector('.fk-grid').children].forEach(c=>{
      const bb=c.getBoundingClientRect();
      if(bb.width<2) return;
      const t=Math.round(bb.top);
      (rows[t]=rows[t]||[]).push((c.querySelector('.fk-label')||{}).textContent
        ? c.querySelector('.fk-label').textContent.replace(/\s+/g,' ').trim().slice(0,16) : '?');
    });
    const cb=card.getBoundingClientRect();
    let maxR=0;
    card.querySelectorAll('input,select').forEach(e=>{const q=e.getBoundingClientRect();
      if(q.width>2) maxR=Math.max(maxR,q.right);});
    return {labels, hasAcc:!!card.querySelector('.xi-acc'),
      rows:Object.keys(rows).sort((a,b)=>a-b).map(k=>rows[k].join(' | ')),
      h:Math.round(cb.height), usedPct:Math.round((maxR-cb.left)/cb.width*100)};
  });
  console.log('labels   : '+JSON.stringify(r.labels));
  console.log('.xi-acc  : '+(r.hasAcc?'STILL PRESENT':'gone'));
  console.log('card h   : '+r.h+'px   width used: '+r.usedPct+'%');
  (r.rows||[]).forEach((x,i)=>console.log('  row'+(i+1)+': '+x));
  // page errors?
  await b.close();
})();
