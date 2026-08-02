/* Visual critique evidence + interaction-state audit. READ-ONLY, no saves.
 * Measures the RENDERED DOM (this codebase punishes static CSS reading) across the
 * seven critique dimensions, and enumerates the real state surface of the save flow. */
const { launch, openApp, nav } = require('./e2e-lib');

const SHOTS = ['GRN', 'IQC', 'OQC', 'Records'];

async function biggest(page) {
  let best = null, len = 0;
  for (const f of page.frames()) {
    try { const n = await f.evaluate(() => (document.body.innerText || '').length); if (n > len) { len = n; best = f; } } catch (_) {}
  }
  return best;
}

// ---- contrast maths (WCAG 2.1) ----
const CONTRAST_FN = `
function _lum(c){const s=c.map(v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)});
  return 0.2126*s[0]+0.7152*s[1]+0.0722*s[2];}
function _rgb(str){const m=String(str).match(/\\d+(\\.\\d+)?/g);return m?m.slice(0,3).map(Number):null;}
function _ratio(fg,bg){const a=_rgb(fg),b=_rgb(bg);if(!a||!b)return null;
  const l1=_lum(a),l2=_lum(b);return +(((Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05))).toFixed(2);}
`;

async function critique(fr) {
  return fr.evaluate(new Function(CONTRAST_FN + `
    const vis = el => { const r = el.getBoundingClientRect();
      if(!(r.width>0&&r.height>0)) return false;
      for(let n=el;n&&n!==document.documentElement;n=n.parentElement){
        const cs=getComputedStyle(n);
        if(cs.visibility==='hidden'||cs.display==='none'||parseFloat(cs.opacity)===0) return false;}
      return true; };

    // resolve the real painted background behind an element
    const bgOf = el => { for(let n=el;n;n=n.parentElement){ const b=getComputedStyle(n).backgroundColor;
      if(b && !/rgba\\(0, 0, 0, 0\\)|transparent/.test(b)) return b; } return 'rgb(255,255,255)'; };

    const texts = [...document.querySelectorAll('body *')].filter(e=>e.children.length===0&&vis(e)&&e.textContent.trim());

    // ---- TYPOGRAPHY: how many distinct sizes/weights are actually painted? ----
    const sizes={}, weights={}, families={};
    texts.forEach(e=>{const cs=getComputedStyle(e);
      sizes[parseFloat(cs.fontSize)]=(sizes[parseFloat(cs.fontSize)]||0)+1;
      weights[cs.fontWeight]=(weights[cs.fontWeight]||0)+1;
      families[cs.fontFamily.split(',')[0].replace(/["']/g,'')]=1;});

    // ---- COLOUR: contrast failures ----
    const contrast=[];
    texts.forEach(e=>{const cs=getComputedStyle(e);
      const r=_ratio(cs.color,bgOf(e)); if(r===null) return;
      const px=parseFloat(cs.fontSize), bold=parseInt(cs.fontWeight)>=700;
      const large = px>=24 || (px>=18.66&&bold);
      const min = large?3:4.5;
      if(r<min) contrast.push({t:e.textContent.trim().slice(0,26),px,ratio:r,need:min,
        fg:cs.color,bg:bgOf(e)});});

    // distinct ink colours in use
    const inks={}; texts.forEach(e=>{inks[getComputedStyle(e).color]=(inks[getComputedStyle(e).color]||0)+1;});

    // ---- AFFORDANCE: do interactive things look interactive? ----
    const acts=[...document.querySelectorAll('button,a,[role=button],[onclick]')].filter(vis);
    const affordance = acts.map(e=>{const cs=getComputedStyle(e); const r=e.getBoundingClientRect();
      return {label:(e.textContent||'').trim().slice(0,22)||e.id||e.tagName,
        cursor:cs.cursor, h:Math.round(r.height), w:Math.round(r.width),
        hasBg:!/rgba\\(0, 0, 0, 0\\)|transparent/.test(cs.backgroundColor),
        hasBorder:parseFloat(cs.borderTopWidth)>0, radius:parseFloat(cs.borderTopLeftRadius)||0,
        disabled: e.disabled===true || cs.pointerEvents==='none'};});
    const noCursor = affordance.filter(a=>a.cursor!=='pointer'&&!a.disabled);
    const tiny = affordance.filter(a=>a.h>0&&a.h<48);
    const flat = affordance.filter(a=>!a.hasBg&&!a.hasBorder);

    // ---- DENSITY / COMPOSITION ----
    const inputs=[...document.querySelectorAll('input,select,textarea')].filter(vis);
    const cards=[...document.querySelectorAll('[class*=card],[class*=fk-card],section')].filter(vis);
    // vertical rhythm: distinct gaps between stacked blocks
    const gaps={};
    for(let i=1;i<cards.length;i++){
      const g=Math.round(cards[i].getBoundingClientRect().top-cards[i-1].getBoundingClientRect().bottom);
      if(g>=0&&g<200) gaps[g]=(gaps[g]||0)+1;}

    // ---- HIERARCHY: is there a single clear entry point? ----
    const ranked = texts.map(e=>{const cs=getComputedStyle(e);
      return {t:e.textContent.trim().slice(0,30),px:parseFloat(cs.fontSize),w:parseInt(cs.fontWeight),
        top:Math.round(e.getBoundingClientRect().top)};})
      .sort((a,b)=>(b.px*10+b.w/100)-(a.px*10+a.w/100)).slice(0,5);

    return {
      typography:{sizes,weights,families:Object.keys(families),distinctSizes:Object.keys(sizes).length},
      colour:{contrastFails:contrast.slice(0,10),failCount:contrast.length,distinctInks:Object.keys(inks).length},
      affordance:{total:acts.length,noPointerCursor:noCursor.slice(0,6),noCursorCount:noCursor.length,
        sub48:tiny.length,sub48Sample:tiny.slice(0,5),flatCount:flat.length},
      density:{inputs:inputs.length,cards:cards.length,textNodes:texts.length,
        rhythmGaps:gaps,distinctGaps:Object.keys(gaps).length},
      hierarchy:{topByWeight:ranked},
    };
  `));
}

(async () => {
  const b = await launch();

  for (const mod of SHOTS) {
    const { ctx, page, app } = await openApp(b);
    await nav(app, page, mod);
    await page.waitForTimeout(mod === 'IQC' ? 13000 : 11000);
    const fr = await biggest(page);
    if (!fr) { console.log(mod + ': NO FRAME'); await ctx.close(); continue; }
    const c = await critique(fr);
    console.log('\n########## ' + mod + ' ##########');
    console.log(JSON.stringify(c, null, 1));
    await ctx.close();
  }

  // ---- INTERACTION: real state surface of the GRN save flow ----
  {
    const { ctx, page, app } = await openApp(b);
    await nav(app, page, 'GRN');
    await page.waitForTimeout(11000);
    const fr = await biggest(page);
    const states = await fr.evaluate(() => {
      const src = [...document.querySelectorAll('script')].map(s => s.textContent).join('\n');
      const has = re => new RegExp(re, 'i').test(src);
      return {
        // which states are actually implemented in the save path?
        saveInFlightLatch: has('_grnSaveInFlight'),
        disablesButtonOnSave: has('btnSubmit[\\s\\S]{0,120}disabled'),
        hasBusyText: has('Saving|Submitting'),
        hasToast: has('showToast|function toast'),
        hasAlert: has('\\balert\\('),
        hasConfirm: has('\\bconfirm\\('),
        hasRetry: has('retry|tryAgain'),
        hasFieldErrors: document.querySelectorAll('[id^=err-]').length,
        hasSuccessScreen: !!document.getElementById('confirmScreen'),
        hasOfflineHandling: has('navigator\\.onLine|offline'),
        hasTimeout: has('setTimeout[\\s\\S]{0,80}(watchdog|timeout)'),
        submitBtn: (() => { const b2 = document.getElementById('btnSubmit');
          if (!b2) return null; const cs = getComputedStyle(b2);
          return { text: b2.textContent.trim(), disabled: b2.disabled,
                   h: Math.round(b2.getBoundingClientRect().height), cursor: cs.cursor }; })(),
      };
    });
    console.log('\n########## GRN save-flow states ##########');
    console.log(JSON.stringify(states, null, 1));
    await ctx.close();
  }

  await b.close();
})();
