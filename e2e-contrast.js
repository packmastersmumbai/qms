/* Verify contrast against the ACTUAL painted pixel, not a walked-up ancestor.
 * Uses elementsFromPoint at the text's own centre so fixed/translucent headers resolve. */
const { launch, openApp, nav } = require('./e2e-lib');
(async () => {
  const b = await launch();
  for (const mod of ['Records','GRN','OQC']) {
    const { ctx, page, app } = await openApp(b);
    await nav(app, page, mod); await page.waitForTimeout(11000);
    let fr=null,len=0;
    for (const f of page.frames()) { try{const n=await f.evaluate(()=>(document.body.innerText||'').length); if(n>len){len=n;fr=f;}}catch(_){}}
    const out = await fr.evaluate(() => {
      const lum=c=>{const s=c.map(v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)});return .2126*s[0]+.7152*s[1]+.0722*s[2];};
      const rgb=s=>{const m=String(s).match(/[\d.]+/g);return m?m.slice(0,3).map(Number):null;};
      const alpha=s=>{const m=String(s).match(/[\d.]+/g);return m&&m.length>3?parseFloat(m[3]):1;};
      const ratio=(f,bg)=>{const a=rgb(f),c=rgb(bg);if(!a||!c)return null;const l1=lum(a),l2=lum(c);return +(((Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05))).toFixed(2);};
      const vis=el=>{const r=el.getBoundingClientRect();if(!(r.width>0&&r.height>0))return false;
        for(let n=el;n&&n!==document.documentElement;n=n.parentElement){const cs=getComputedStyle(n);
          if(cs.visibility==='hidden'||cs.display==='none'||parseFloat(cs.opacity)===0)return false;}return true;};
      // composite the real stack under this point
      const paintedBg=(el)=>{const r=el.getBoundingClientRect();
        const x=Math.min(innerWidth-1,Math.max(1,r.left+r.width/2)), y=Math.min(innerHeight-1,Math.max(1,r.top+r.height/2));
        const stack=document.elementsFromPoint(x,y);
        for(const n of stack){ if(n===el||el.contains(n))continue;
          const bc=getComputedStyle(n).backgroundColor;
          if(bc&&alpha(bc)>=0.95&&!/transparent/.test(bc)) return bc; }
        return getComputedStyle(document.body).backgroundColor||'rgb(255,255,255)';};
      const texts=[...document.querySelectorAll('body *')].filter(e=>e.children.length===0&&vis(e)&&e.textContent.trim());
      const fails=[];
      texts.forEach(e=>{const cs=getComputedStyle(e);
        if(alpha(cs.color)<0.95) return;            // translucent ink: report separately
        const bg=paintedBg(e); const r=ratio(cs.color,bg); if(r===null)return;
        const px=parseFloat(cs.fontSize),bold=parseInt(cs.fontWeight)>=700;
        const need=(px>=24||(px>=18.66&&bold))?3:4.5;
        if(r<need) fails.push({t:e.textContent.trim().slice(0,24),px,r,need,fg:cs.color,bg});});
      const translucent=texts.filter(e=>alpha(getComputedStyle(e).color)<0.95).length;
      const uniq={}; fails.forEach(f=>{const k=f.fg+'|'+f.bg+'|'+f.px; if(!uniq[k])uniq[k]=f;});
      return {total:texts.length,failCount:fails.length,translucentInk:translucent,unique:Object.values(uniq).slice(0,10)};
    });
    console.log('\n== '+mod+' ==  texts='+out.total+' fails='+out.failCount+' translucentInk='+out.translucentInk);
    out.unique.forEach(f=>console.log(`   ${String(f.r).padStart(5)} (need ${f.need}) ${String(f.px).padStart(4)}px  ${f.t.padEnd(26)} ${f.fg} on ${f.bg}`));
    await ctx.close();
  }
  await b.close();
})();
