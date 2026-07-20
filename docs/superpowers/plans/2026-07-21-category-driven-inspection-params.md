# Category-Driven Inspection Parameters — Implementation Plan (single-sheet)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** IQC/IPQC show inspection parameters per product category (HDPE bottle/label/paper/carton/bulk), with an ⓘ operator tooltip, replacing IQC's hardcoded 12-param list.

**Architecture (lazy version):** Extend the EXISTING `MASTERS_Parameters` sheet with `category`, `ccp`, `sort` columns — the dictionary IS the mapping. One filter-by-category resolver. Material gets ONE new field (`inspectionCategory`). IQC param values move to a new `IQC_PARAM_LOG` (EAV, needed because variable params can't fit fixed cols 11-22). No mapping sheet, no material-spec sheet, no join. Additive; legacy-12 fallback for un-categorized materials.

**Tech Stack:** Google Apps Script, Sheets, `?diag=` smoke tests via `node e2e-diag.js` (clasp run does NOT work here).

**Deliberately skipped (YAGNI — add when the need is real):**
- `CATEGORY_PARAMS` mapping sheet — dictionary column covers it. Add only if a param's per-category spec override must diverge from its dictionary default.
- `MATERIAL_SPECS` per-material spec sheet — no per-material specs exist today; category spec covers it. Add when one material needs a spec its category can't express.
- `coaRequired` / `specDocRef` material fields — nothing reads them. Add when GRN/IQC branches on COA.
- MastersCrud registration — the param sheet is already editable directly.
- Separate `InspectionParams.js` / `SeedInspectionParams.js` files — resolver + seed fold into `IQC.js`.

## Global Constraints

- Deploy: `clasp push -f` → `clasp deploy --deploymentId AKfycbxMFpeJOqF5_iARRCo7aHLg0Pw_XlqKdAzmDVck8DUdDfgr1nIIjbvTgrlyc0XtYRuaVQ --description "..."`. On form-HTML change bump `getFormHtml` key in `Code.js` (currently `v87`) + `HtmlCache.html` PFX (currently `v18`).
- Test via `?diag=<name>` + `node e2e-diag.js <name>`. `clasp run` FAILS — never use it. Heavy smokes (>60s) via a temp `e2e-diag-long.js` copy with `timeout:300000`.
- Test/seed writes gated by `CONFIG._TESTING_ENABLED` (true). Smokes set `_QMS_SUPPRESS_NOTIFY=true` (reset in finally).
- git: stage explicitly (no `git add -A`). Trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Do NOT touch `AqlSampling.js`.

## Sheet contracts (0-based)

- `MASTERS_Materials`: existing A–L (0–11); NEW `INSP_CATEGORY=12`; `MAT_WIDTH=13`.
- `MASTERS_Parameters`: existing `code=0,name=1,unit=2,std=3,tolMin=4,tolMax=5,method=6,check_brief=7,tools=8,doc_ref=9,doc_number=10`; NEW `category=11,ccp=12,sort=13`.
- `IQC_PARAM_LOG` (new): `iqcDocNo=0,timestamp=1,paramCode=2,paramName=3,unit=4,stdValue=5,actualValue=6,result=7,remark=8`.

---

### Task 1: Material `inspectionCategory` + `MASTERS_Parameters` category columns + resolver

**Files:**
- Modify: `Masters.js` (`MAT_COL` ~20-24, `getMaterials()` ~56-82, `_upsertMaterialRow_` ~482-498)
- Modify: `IQC.js` (add `getCategoryParams`, `ensureIqcParamLogSheet_`)
- Create: `_SmokeInspectionParams.js`
- Modify: `Code.js` (add `?diag=smokeinspparams`)

**Interfaces:**
- Produces: `MAT_COL.INSP_CATEGORY=12`, `MAT_WIDTH=13`; `getMaterials()` objects include `inspectionCategory`. `getCategoryParams(category, flow)` → `[{paramCode,label,unit,std,tolMin,tolMax,ccp,method,checkBrief,tools,docRef,sort}]` filtered by `category` (col 11) and sorted by `sort` (col 13). `flow` is accepted for signature parity but the single sheet has no per-flow column in v1 — all category params apply to both IQC and IPQC. `ensureIqcParamLogSheet_()` → Sheet.

- [ ] **Step 1: Write the failing test** — create `_SmokeInspectionParams.js`:

```javascript
// _SmokeInspectionParams.gs — regression smoke for category-driven inspection params.
function smokeInspectionParams() {
  if (!CONFIG._TESTING_ENABLED) return { success:false, error:'testing disabled' };
  if (typeof _QMS_SUPPRESS_NOTIFY!=='undefined') _QMS_SUPPRESS_NOTIFY=true;
  var log=[], pass=0, fail=0, ss=getSpreadsheet();
  function assert(n,c,d){ if(c){pass++;log.push('  PASS '+n+(d?' — '+d:''));} else {fail++;log.push('  FAIL '+n+(d?' — '+d:''));} }
  var stamp=Utilities.formatDate(new Date(),'Asia/Kolkata','HHmmss');
  try {
    assert('MAT_COL.INSP_CATEGORY=12', MAT_COL.INSP_CATEGORY===12, 'got '+MAT_COL.INSP_CATEGORY);
    assert('MAT_WIDTH=13', MAT_WIDTH===13, 'got '+MAT_WIDTH);
    ensureIqcParamLogSheet_();
    assert('IQC_PARAM_LOG exists', !!ss.getSheetByName('IQC_PARAM_LOG'));
    // seed a param row in the dictionary tagged to a test category
    var pc='TIP-WT-'+stamp;
    ss.getSheetByName('MASTERS_Parameters').appendRow([pc,'Test Weight','g',24.5,24,25,'Gravimetric','Weigh on balance','Balance 0.01g','PM/FRM/IQC-02','','TIP_CAT','Y',1]);
    var cp=getCategoryParams('TIP_CAT','IQC');
    assert('getCategoryParams returns seeded param', cp.some(function(p){return p.paramCode===pc;}));
    var got=cp.filter(function(p){return p.paramCode===pc;})[0]||{};
    assert('param carries ccp + guidance', got.ccp===true && !!got.checkBrief && !!got.tools, JSON.stringify(got));
    _tipArchivePrefix_('MASTERS_Parameters',0,pc);
  } catch(e){ log.push('EXCEPTION: '+e.message+' '+(e.stack||'')); fail++; }
  finally { if (typeof _QMS_SUPPRESS_NOTIFY!=='undefined') _QMS_SUPPRESS_NOTIFY=false; }
  log.push(''); log.push('RESULT: '+pass+' passed, '+fail+' failed.');
  return { success: fail===0, pass:pass, fail:fail, report: log.join('\n') };
}
function _tipArchivePrefix_(sheet,col,prefix){
  var ss=getSpreadsheet(), ws=ss.getSheetByName(sheet); if(!ws||ws.getLastRow()<2) return 0;
  var arch=ss.getSheetByName('_TEST_ARCHIVE')||ss.insertSheet('_TEST_ARCHIVE');
  var d=ws.getDataRange().getValues(),m=0;
  for(var i=d.length-1;i>=1;i--){ if(String(d[i][col]||'').indexOf(prefix)===0){arch.appendRow([sheet].concat(d[i]));ws.deleteRow(i+1);m++;} }
  return m;
}
```

- [ ] **Step 2: Add diag route + run to verify it fails** — in `Code.js` doGet after the `smokeprod` route:

```javascript
  if (diag === 'smokeinspparams') {
    var sip; try { sip=(typeof smokeInspectionParams==='function')?smokeInspectionParams():{error:'missing'}; }
    catch(er7){ sip={error:er7.message,stack:er7.stack}; }
    return ContentService.createTextOutput(sip&&sip.report?sip.report:JSON.stringify(sip,null,2)).setMimeType(ContentService.MimeType.TEXT);
  }
```

Run: `clasp push -f && clasp deploy --deploymentId AKfycbxMFpeJOqF5_iARRCo7aHLg0Pw_XlqKdAzmDVck8DUdDfgr1nIIjbvTgrlyc0XtYRuaVQ --description "test: inspparams" && node e2e-diag.js smokeinspparams`
Expected: FAIL — `MAT_COL.INSP_CATEGORY` undefined / `ensureIqcParamLogSheet_` missing.

- [ ] **Step 3: Extend Masters.js** — `MAT_COL` gains `INSP_CATEGORY:12`, `MAT_WIDTH=13`; `getMaterials()` returns `inspectionCategory: String(r[MAT_COL.INSP_CATEGORY]||'')`; `_upsertMaterialRow_` pads to `MAT_WIDTH` and preserves col 12 on update.

```javascript
var MAT_COL = { CODE:0, DESC:1, UNIT:2, CATEGORY:3, DEFAULT_LOCATION:4, REORDER_LEVEL:5,
  EACH_L:6, EACH_W:7, EACH_H:8, EACH_WEIGHT:9, PER_PALLET:10, FIT_CLASS:11, INSP_CATEGORY:12 };
var MAT_WIDTH = 13;
```

- [ ] **Step 4: Add resolver + sheet-ensure to IQC.js**

```javascript
// ponytail: dictionary IS the mapping — filter MASTERS_Parameters by category col.
// No CATEGORY_PARAMS sheet, no join. Add a mapping sheet only if a param's per-category
// spec must diverge from its dictionary default.
function getCategoryParams(category, flow) {
  var ws = getSpreadsheet().getSheetByName('MASTERS_Parameters');
  if (!ws || ws.getLastRow() < 2) return [];
  var cat = String(category||'').trim(); if(!cat) return [];
  return ws.getDataRange().getValues().slice(1)
    .filter(function(r){ return String(r[11]||'').trim() === cat; })
    .map(function(r){ return { paramCode:String(r[0]||''), label:String(r[1]||r[0]||''), unit:String(r[2]||''),
      std:r[3], tolMin:r[4], tolMax:r[5], method:String(r[6]||''), checkBrief:String(r[7]||''),
      tools:String(r[8]||''), docRef:String(r[9]||''), ccp:String(r[12]||'').toUpperCase()==='Y', sort:Number(r[13])||0 }; })
    .sort(function(a,b){ return a.sort - b.sort; });
}
var IQCPARAMLOG_HEADERS_ = ['iqcDocNo','timestamp','paramCode','paramName','unit','stdValue','actualValue','result','remark'];
function ensureIqcParamLogSheet_() {
  var ss=getSpreadsheet(), ws=ss.getSheetByName('IQC_PARAM_LOG');
  if(!ws){ ws=ss.insertSheet('IQC_PARAM_LOG'); ws.getRange(1,1,1,IQCPARAMLOG_HEADERS_.length).setValues([IQCPARAMLOG_HEADERS_]); ws.setFrozenRows(1); }
  return ws;
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `clasp push -f && clasp deploy --deploymentId ... --description "feat: category params resolver + material inspectionCategory" && node e2e-diag.js smokeinspparams`
Expected: PASS — all Task-1 asserts.

- [ ] **Step 6: Commit**

```bash
git add Masters.js IQC.js _SmokeInspectionParams.js Code.js
git commit -m "feat: material inspectionCategory + MASTERS_Parameters category cols + resolver"
```

---

### Task 2: Seed the 5 categories into MASTERS_Parameters

**Files:**
- Modify: `IQC.js` (add `seedInspectionParams`)
- Modify: `Code.js` (add `?diag=seedcategoryparams`)
- Modify: `_SmokeInspectionParams.js`

**Interfaces:**
- Consumes: `getCategoryParams` (Task 1).
- Produces: `seedInspectionParams()` → `{success, added}`. Idempotent — dedupes by `code`. Appends param rows (with `category,ccp,sort`) for the 5 categories.

- [ ] **Step 1: Write the failing test** — add to `smokeInspectionParams()` before RESULT:

```javascript
    var s1=seedInspectionParams(), s2=seedInspectionParams();
    assert('seed run 1 ok', s1&&s1.success);
    assert('seed idempotent (run 2 adds 0)', s2&&s2.added===0, JSON.stringify(s2));
    ['HDPE_BOTTLE','LABEL','PAPER','CARTON','BULK'].forEach(function(cat){
      assert(cat+' has params', getCategoryParams(cat,'IQC').length>0);
    });
```

- [ ] **Step 2: Add diag route + run to verify it fails** — in `Code.js`:

```javascript
  if (diag === 'seedcategoryparams') {
    var sd; try { sd=(typeof seedInspectionParams==='function')?seedInspectionParams():{error:'missing'}; }
    catch(er8){ sd={error:er8.message,stack:er8.stack}; }
    return ContentService.createTextOutput(JSON.stringify(sd,null,2)).setMimeType(ContentService.MimeType.TEXT);
  }
```

Run: `clasp push -f && clasp deploy --deploymentId ... --description "test" && node e2e-diag.js smokeinspparams`
Expected: FAIL — `seedInspectionParams` not defined.

- [ ] **Step 3: Implement seedInspectionParams in IQC.js** — one flat list; each row `[code,name,unit,std,tolMin,tolMax,method,check_brief,tools,doc_ref,doc_number,category,ccp,sort]`. Dedupe by `code` (a param used in 2 categories = 2 rows with distinct codes, e.g. `DIMENSIONS_LBL` — keep codes category-unique to avoid the "one code, two categories" ambiguity).

```javascript
function seedInspectionParams() {
  if (!CONFIG._TESTING_ENABLED) return { success:false, error:'testing disabled' };
  // code, name, unit, method, check_brief, tools, doc_ref, category, ccp, sort
  var ROWS = [
    ['HB_WEIGHT','Weight','g','Gravimetric','Weigh a unit on a calibrated balance; record grams.','Balance 0.01 g','PM/FRM/IQC-02','HDPE_BOTTLE','Y',1],
    ['HB_DIM','Dimensions','mm','Dimensional','Measure L/W/H per drawing with vernier vs spec.','Vernier caliper','PM/FRM/IQC-02','HDPE_BOTTLE','N',2],
    ['HB_NECK','Neck / Thread Ø','mm','Dimensional','Measure neck OD across thread crest, 2 points 90° apart.','Vernier / thread gauge','PM/FRM/IQC-02','HDPE_BOTTLE','N',3],
    ['HB_WALL','Wall Thickness','mm','Dimensional','Section mid-body; measure 4 points 90° apart; record minimum.','Dial thickness gauge','PM/FRM/IQC-02','HDPE_BOTTLE','N',4],
    ['HB_LEAK','Leak Test','','Functional','Pressurise/immerse per method; watch for bubbles / pressure drop.','Leak tester','PM/FRM/IQC-02','HDPE_BOTTLE','Y',5],
    ['HB_DROP','Drop Test','','Functional','Drop a filled unit from spec height; inspect for crack/leak.','Drop rig','PM/FRM/IQC-02','HDPE_BOTTLE','N',6],
    ['HB_COLOUR','Colour / Match','','Visual','Compare to approved colour standard under D65 light.','Colour std / light box','PM/FRM/IQC-02','HDPE_BOTTLE','N',7],
    ['HB_CLARITY','Clarity','','Visual','Inspect haze/opacity against a contrast card.','Contrast card','PM/FRM/IQC-02','HDPE_BOTTLE','N',8],

    ['LB_DIM','Dimensions','mm','Dimensional','Measure label L×W vs artwork spec.','Vernier / ruler','PM/FRM/IQC-02','LABEL','N',1],
    ['LB_PRINT','Print Quality','','Visual','Check registration, smudge, missing text vs proof.','Loupe / proof','PM/FRM/IQC-02','LABEL','Y',2],
    ['LB_DE','Colour ΔE','','Instrumental','Read ΔE vs approved proof; ≤ tolerance.','Spectrophotometer','PM/FRM/IQC-02','LABEL','N',3],
    ['LB_ADH','Adhesion / Peel','N/25mm','Mechanical','Peel a strip at 180°; record peel force per 25 mm.','Peel tester','PM/FRM/IQC-02','LABEL','N',4],
    ['LB_BARCODE','Barcode Scan','','Functional','Scan; must read first attempt, verifier grade ≥ C.','Barcode verifier','PM/FRM/IQC-02','LABEL','Y',5],
    ['LB_GSM','Material / GSM','gsm','Gravimetric','Cut known area; weigh; compute grams per m².','GSM cutter + balance','PM/FRM/IQC-02','LABEL','N',6],

    ['PP_GSM','GSM / Grammage','gsm','Gravimetric','Cut known area; weigh; compute grams per m².','GSM cutter + balance','PM/FRM/IQC-02','PAPER','N',1],
    ['PP_MOIST','Moisture','%','Instrumental','Measure moisture with a meter per method.','Moisture meter','PM/FRM/IQC-02','PAPER','N',2],
    ['PP_DIM','Dimensions','mm','Dimensional','Measure sheet/reel size vs spec.','Ruler / tape','PM/FRM/IQC-02','PAPER','N',3],
    ['PP_BRIGHT','Brightness','%','Instrumental','Read brightness vs standard tile.','Brightness meter','PM/FRM/IQC-02','PAPER','N',4],
    ['PP_TENSILE','Tensile Strength','N','Mechanical','Pull a strip to break; record peak force.','Tensile tester','PM/FRM/IQC-02','PAPER','N',5],

    ['CT_DIM','Dimensions','mm','Dimensional','Measure carton L×W×H vs spec.','Tape / ruler','PM/FRM/IQC-02','CARTON','N',1],
    ['CT_GSM','GSM / Ply','gsm','Gravimetric','Weigh a known area; confirm board GSM / ply.','GSM cutter + balance','PM/FRM/IQC-02','CARTON','N',2],
    ['CT_BURST','Bursting Strength','kPa','Mechanical','Clamp; apply pressure to burst; record kPa.','Burst tester','PM/FRM/IQC-02','CARTON','Y',3],
    ['CT_ECT','Edge Crush (ECT)','kN/m','Mechanical','Crush an edge specimen; record kN/m.','ECT tester','PM/FRM/IQC-02','CARTON','N',4],
    ['CT_PRINT','Print Quality','','Visual','Check print registration/smudge vs proof.','Loupe / proof','PM/FRM/IQC-02','CARTON','N',5],
    ['CT_PLY','Ply Bond','','Mechanical','Attempt to separate plies; must not delaminate under load.','Ply bond tester','PM/FRM/IQC-02','CARTON','N',6],

    ['BK_NETWT','Net Weight','kg','Gravimetric','Weigh net of packaging; compare to declared.','Platform scale','PM/FRM/IQC-02','BULK','N',1],
    ['BK_MOIST','Moisture','%','Instrumental','Measure moisture per method.','Moisture meter','PM/FRM/IQC-02','BULK','N',2],
    ['BK_CONTAM','Contamination','','Visual','Spread a sample; count black specks / foreign matter.','Light table / loupe','PM/FRM/IQC-02','BULK','Y',3],
    ['BK_MFI','MFI / Melt Index','g/10min','Instrumental','Run melt flow at spec temp/load; record g/10 min.','Melt flow indexer','PM/FRM/IQC-02','BULK','N',4],
    ['BK_COLOUR','Colour','','Visual','Compare granule colour to standard under D65.','Colour std','PM/FRM/IQC-02','BULK','N',5],
    ['BK_GRAN','Granule Size','mm','Dimensional','Sieve / measure granule size per method.','Sieve set','PM/FRM/IQC-02','BULK','N',6]
  ];
  var ws = getSpreadsheet().getSheetByName('MASTERS_Parameters');
  if (!ws) return { success:false, error:'MASTERS_Parameters missing' };
  var existing = {};
  if (ws.getLastRow()>1) ws.getRange(2,1,ws.getLastRow()-1,1).getValues().forEach(function(r){ if(r[0]) existing[String(r[0]).trim()]=true; });
  var added=0;
  ROWS.forEach(function(x){
    if (existing[x[0]]) return;
    // sheet cols: code,name,unit,std,tolMin,tolMax,method,check_brief,tools,doc_ref,doc_number,category,ccp,sort
    ws.appendRow([x[0],x[1],x[2],'','','',x[3],x[4],x[5],x[6],'',x[7],x[8],x[9]]);
    added++;
  });
  return { success:true, added:added };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `clasp push -f && clasp deploy --deploymentId ... --description "feat: seed category params" && node e2e-diag.js smokeinspparams`
Expected: PASS — 5 categories populated, seed idempotent.

- [ ] **Step 5: Commit**

```bash
git add IQC.js Code.js _SmokeInspectionParams.js
git commit -m "feat: seed 5 inspection categories into MASTERS_Parameters"
```

---

### Task 3: IQC server — resolve by category, write IQC_PARAM_LOG, legacy fallback

**Files:**
- Modify: `IQC.js` (add `getIqcParamsForProduct`; `saveIQC` writes IQC_PARAM_LOG ~103-160)
- Modify: `_SmokeInspectionParams.js`

**Interfaces:**
- Consumes: `getCategoryParams` (Task 1), `getMaterials` (Task 1), `ensureIqcParamLogSheet_` (Task 1).
- Produces: `getIqcParamsForProduct(materialCode)` → `{category, params:[...same shape as getCategoryParams...], fallback:bool}`. No category or empty set → legacy 12 `IQC_PARAMS` in the same shape, `fallback:true`. `saveIQC` accepts `item.paramResults:[{paramCode,paramName,actualValue,result,remark}]` and writes one IQC_PARAM_LOG row each.

- [ ] **Step 1: Write the failing test** — add to `smokeInspectionParams()` (depends on Task 2 seed):

```javascript
    var mCode='TIP-BTL-'+stamp;
    var mW=ss.getSheetByName('MASTERS_Materials');
    var mrow=new Array(MAT_WIDTH).fill(''); mrow[0]=mCode; mrow[1]='Test bottle'; mrow[2]='NOS'; mrow[3]='RM'; mrow[MAT_COL.INSP_CATEGORY]='HDPE_BOTTLE'; mW.appendRow(mrow);
    var r5=getIqcParamsForProduct(mCode);
    assert('IQC resolves HDPE_BOTTLE (not fallback)', r5.category==='HDPE_BOTTLE'&&r5.fallback===false&&r5.params.length>=8, JSON.stringify({c:r5.category,n:r5.params.length,f:r5.fallback}));
    var r5b=getIqcParamsForProduct('TIP-NOCAT-'+stamp);
    assert('IQC falls back to legacy 12', r5b.fallback===true&&r5b.params.length===12, 'n='+r5b.params.length);
    var grn5=createTestGRN_({materialCode:mCode,batchNo:'TIPB-'+stamp,qtyReceived:50,locationId:'RM-STORE-A',unit:'NOS'});
    var iq5=saveIQC({grnNo:grn5.docNo,date:new Date(),inspector:'claude-smoke',disposition:'ACCEPTED',lotSize:50,aqlLevel:'2.5',inspLevel:'II',severity:'Normal',
      items:[{materialCode:mCode,materialDesc:'Test bottle',batchNo:grn5.batchNo,acceptedQty:50,rejectedQty:0,holdQty:0,sampleSize:8,params:{},
        paramResults:[{paramCode:'HB_WEIGHT',paramName:'Weight',actualValue:'24.6',result:'PASS',remark:''},{paramCode:'HB_LEAK',paramName:'Leak Test',actualValue:'Pass',result:'PASS',remark:''}]}]});
    assert('saveIQC success', iq5&&iq5.success, iq5&&(iq5.error||''));
    var plog=ss.getSheetByName('IQC_PARAM_LOG').getDataRange().getValues().filter(function(r){return iq5.docNos&&String(r[0])===String(iq5.docNos[0]);});
    assert('IQC_PARAM_LOG got 2 rows', plog.length===2, 'rows='+plog.length);
    _tipArchivePrefix_('MASTERS_Materials',0,mCode);
    _tipArchivePrefix_('STOCK_LEDGER',3,mCode); _tipArchivePrefix_('GRN_LOG',6,mCode);
    _tipArchivePrefix_('IQC_LOG',4,'Test bottle');
    _tipArchivePrefix_('IQC_PARAM_LOG',2,'HB_WEIGHT'); _tipArchivePrefix_('IQC_PARAM_LOG',2,'HB_LEAK');
```

- [ ] **Step 2: Run to verify it fails** — use long-timeout runner (saveIQC heavy):

Run: `cp e2e-diag.js e2e-diag-long.js && sed -i 's/timeout: 60000/timeout: 300000/' e2e-diag-long.js && clasp push -f && clasp deploy --deploymentId ... --description "test" && node e2e-diag-long.js smokeinspparams`
Expected: FAIL — `getIqcParamsForProduct` not defined.

- [ ] **Step 3: Implement getIqcParamsForProduct + IQC_PARAM_LOG write in IQC.js**

```javascript
function getIqcParamsForProduct(materialCode) {
  var mc=String(materialCode||'').trim(), cat='';
  try { var mats=getMaterials(); for(var i=0;i<mats.length;i++){ if(String(mats[i].code||mats[i].itemCode||'').trim()===mc){ cat=String(mats[i].inspectionCategory||'').trim(); break; } } } catch(e){}
  if (cat) { var params=getCategoryParams(cat,'IQC'); if (params.length) return { category:cat, params:params, fallback:false }; }
  // fallback: legacy 12 → same shape
  var legacy=IQC_PARAMS.map(function(p,idx){ return { paramCode:p.id, label:p.label, unit:'', std:p.spec||'', tolMin:null, tolMax:null,
    ccp:!!p.ccp, method:'', checkBrief:p.hint||'', tools:'', docRef:'', sort:idx }; });
  return { category:cat||'', params:legacy, fallback:true };
}
```

In `saveIQC`, after each item's row append, add:

```javascript
      if (item.paramResults && item.paramResults.length) {
        var plW = ensureIqcParamLogSheet_();
        item.paramResults.forEach(function(pr){
          plW.appendRow([ docNo, new Date(), pr.paramCode||'', pr.paramName||'', pr.unit||'', pr.stdValue||'', pr.actualValue||'', pr.result||'', pr.remark||'' ]);
        });
      }
```

- [ ] **Step 4: Run to verify it passes**

Run: `clasp push -f && clasp deploy --deploymentId ... --description "feat: IQC category params + IQC_PARAM_LOG" && node e2e-diag-long.js smokeinspparams`
Expected: PASS — category resolution, fallback-12, 2 IQC_PARAM_LOG rows.

- [ ] **Step 5: Commit**

```bash
git add IQC.js _SmokeInspectionParams.js
git commit -m "feat: IQC resolves params by category + writes IQC_PARAM_LOG (legacy fallback)"
```

---

### Task 4: IQC form renders from server + ⓘ tooltip; IPQC category layer + tooltip; finalize

**Files:**
- Modify: `IQC_F.html` (delete hardcoded `IQC_PARAMS` ~503-516; param render ~882-921; product-select; save payload ~1265)
- Modify: `IPQC.js` (`getIPQCParams` ~31-108 — category layer), `IPQC_F.html` (ⓘ)
- Modify: `Code.js` (cache key), `HtmlCache.html` (PFX)
- Modify: `_SmokeInspectionParams.js` (IPQC assert), memory

**Interfaces:**
- Consumes: `getIqcParamsForProduct` (Task 3), `getCategoryParams` (Task 1).
- Produces: IQC form renders resolved rows with ⓘ tap-popover, sends `item.paramResults`. `getIPQCParams(productCode)` returns category params (existing `CONTROL_FG` override still wins for std/tol) each carrying `checkBrief/tools/docRef`.

- [ ] **Step 1: IQC_F.html — delete hardcoded `IQC_PARAMS`, add live holder + fetch on select**

Remove `var IQC_PARAMS=[...]` (~503-516). Add `var IQC_PARAMS_LIVE=[];`. In the product/GRN-select handler:

```javascript
google.script.run.withSuccessHandler(function(res){ IQC_PARAMS_LIVE=(res&&res.params)||[]; renderParamRows(); })
  .getIqcParamsForProduct(selectedMaterialCode);
```

- [ ] **Step 2: IQC_F.html — render rows from IQC_PARAMS_LIVE with ⓘ**

```javascript
function renderParamRows(){
  var host=document.getElementById('paramRows'); if(!host) return; host.innerHTML='';
  IQC_PARAMS_LIVE.forEach(function(p){
    var spec=p.specText||[p.std,(p.tolMin!=null||p.tolMax!=null)?('['+p.tolMin+'..'+p.tolMax+']'):''].filter(Boolean).join(' ');
    var row=document.createElement('div'); row.className='fk-param-row';
    row.innerHTML='<span class="pname">'+p.label+(p.ccp?' <b class="ccp">CCP</b>':'')+
      ' <button type="button" class="info-btn" data-pc="'+p.paramCode+'" aria-label="How to inspect">ⓘ</button></span>'+
      '<span class="pspec">'+(spec||'—')+'</span>'+
      '<input class="pactual" data-pc="'+p.paramCode+'" placeholder="value">'+
      '<select class="presult" data-pc="'+p.paramCode+'"><option value="">—</option><option>PASS</option><option>FAIL</option><option>NA</option></select>';
    host.appendChild(row);
  });
  bindInfoButtons();
}
```

- [ ] **Step 3: IQC_F.html — ⓘ tap-popover (GAS touch-safe, not hover-only) + CSS**

```javascript
function bindInfoButtons(){
  document.querySelectorAll('.info-btn').forEach(function(btn){
    btn.addEventListener('click', function(e){ e.stopPropagation(); closeInfoPopover();
      var p=IQC_PARAMS_LIVE.filter(function(x){return x.paramCode===btn.getAttribute('data-pc');})[0]; if(!p) return;
      var pop=document.createElement('div'); pop.className='info-pop'; pop.id='infoPop';
      pop.innerHTML='<b>'+p.label+'</b>'+(p.checkBrief?'<div><u>How</u>: '+p.checkBrief+'</div>':'')+
        (p.tools?'<div><u>Tool</u>: '+p.tools+'</div>':'')+((p.std!=null&&p.std!=='')?'<div><u>Accept</u>: '+p.std+'</div>':'')+
        (p.docRef?'<div><u>Ref</u>: '+p.docRef+(p.ccp?' · CCP':'')+'</div>':'');
      document.body.appendChild(pop); var r=btn.getBoundingClientRect();
      pop.style.top=(window.scrollY+r.bottom+4)+'px'; pop.style.left=Math.min(r.left,window.innerWidth-260)+'px';
    });
  });
}
function closeInfoPopover(){ var e=document.getElementById('infoPop'); if(e) e.remove(); }
document.addEventListener('click', closeInfoPopover);
```

CSS in the form `<style>`: `.info-pop{position:absolute;z-index:50;max-width:250px;background:#fff;border:1px solid #cbd5e1;border-radius:8px;padding:10px;font-size:12px;box-shadow:0 4px 16px rgba(0,0,0,.12)}.info-btn{background:none;border:none;cursor:pointer;color:#2563eb;font-size:14px}.ccp{color:#dc2626;font-size:10px}`.

- [ ] **Step 4: IQC_F.html — send paramResults** (save payload ~1265):

```javascript
      paramResults: IQC_PARAMS_LIVE.map(function(p){ return { paramCode:p.paramCode, paramName:p.label, unit:p.unit||'', stdValue:(p.std!=null?p.std:''),
        actualValue:(document.querySelector('.pactual[data-pc="'+p.paramCode+'"]')||{}).value||'',
        result:(document.querySelector('.presult[data-pc="'+p.paramCode+'"]')||{}).value||'', remark:'' }; }),
```

- [ ] **Step 5: IPQC category layer** — in `getIPQCParams(productCode)`, before/around the existing `CONTROL_FG` resolution, resolve the product's `inspectionCategory` and start from `getCategoryParams(cat,'IPQC')` (mapped to IPQC's field names `paramName/stdValue/tolMin/tolMax/methodType` + `checkBrief/tools/docRef/ccp`); merge `CONTROL_FG` on top (control std/tol wins). If category empty → keep exact existing behavior. Preserve return shape `{params:[...], warning?}`.

- [ ] **Step 6: IPQC_F.html ⓘ** — mirror Steps 2-3's ⓘ button + `.info-pop` in the IPQC param render, reading `checkBrief/tools/docRef` per param.

- [ ] **Step 7: IPQC smoke assert** — add to `smokeInspectionParams()`:

```javascript
    var fg7='TIP-FG-'+stamp; var r7=new Array(MAT_WIDTH).fill(''); r7[0]=fg7; r7[1]='Test FG'; r7[2]='NOS'; r7[3]='FG'; r7[MAT_COL.INSP_CATEGORY]='HDPE_BOTTLE'; ss.getSheetByName('MASTERS_Materials').appendRow(r7);
    var ip=getIPQCParams(fg7);
    assert('IPQC returns category params for FG', ip&&ip.params&&ip.params.length>0, JSON.stringify(ip&&(ip.warning||('n='+(ip.params&&ip.params.length)))));
    _tipArchivePrefix_('MASTERS_Materials',0,fg7);
```

- [ ] **Step 8: Bump cache keys** — `Code.js` `v87`→`v88` + flush list; `HtmlCache.html` PFX `v18`→`v19`.

- [ ] **Step 9: Deploy + run full smoke + visual check**

```bash
clasp push -f && clasp deploy --deploymentId AKfycbxMFpeJOqF5_iARRCo7aHLg0Pw_XlqKdAzmDVck8DUdDfgr1nIIjbvTgrlyc0XtYRuaVQ --description "feat: IQC form category params + info tooltip; IPQC category layer"
node e2e-diag-long.js smokeinspparams   # all PASS
node e2e-iqc-shot.js                     # visual: HDPE_BOTTLE → 8 rows + ⓘ; non-categorized → 12
```
Expected: smoke green; category rows + ⓘ render; fallback works.

- [ ] **Step 10: Seed live + record memory + finalize**

```bash
node e2e-diag.js seedcategoryparams      # {success:true, added:30} first run
rm -f e2e-diag-long.js
git add IQC_F.html IPQC.js IPQC_F.html Code.js HtmlCache.html _SmokeInspectionParams.js
git commit -m "feat: IQC/IPQC category-driven params rendered from server + info tooltip"
git push
```
Write a project memory: category-driven params live; MASTERS_Parameters holds category/ccp/sort; resolver getCategoryParams; seed via ?diag=seedcategoryparams; IQC_PARAM_LOG is EAV param values; legacy-12 fallback. Add MEMORY.md pointer.

---

## Self-Review

**Spec coverage:** inspectionCategory on material → T1. Category→param config → MASTERS_Parameters columns (T1) + seed (T2). Resolver → T1 (`getCategoryParams`). IQC render-from-server + kill hardcoded dupe + IQC_PARAM_LOG + fallback → T3, T4. ⓘ tooltip (IQC+IPQC) from existing param fields → T4. IPQC category layer → T4. Regression smoke → T1-T4 incremental. Additive + fallback → T3.

**Deliberately dropped vs the spec (ponytail, agreed):** MATERIAL_SPECS + 3-tier resolver, coaRequired/specDocRef, CATEGORY_PARAMS mapping sheet, MastersCrud registration, separate InspectionParams.js/SeedInspectionParams.js. Each is a real future feature, not this ask — noted at top with add-when triggers.

**Placeholder scan:** IPQC merge (T4 S5) is prose-described because it edits the existing `getIPQCParams` body the implementer has open; field-name mapping + merge rule (control wins) + return shape are explicit. All other code steps show real code.

**Type consistency:** `getCategoryParams` keys (`paramCode,label,unit,std,tolMin,tolMax,ccp,method,checkBrief,tools,docRef,sort`) consistent T1/T3/T4. `getIqcParamsForProduct` → `{category,params,fallback}` matches T4 fetch. `IQC_PARAM_LOG` column order matches write (T3) + header (T1). Seed row layout matches sheet cols (T2).
