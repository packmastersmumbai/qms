# Category-Driven Inspection Parameters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make IQC/IPQC inspection parameters configurable per product category, with per-material technical specs and an ⓘ operator-guidance tooltip, replacing IQC's hardcoded 12-param list.

**Architecture:** A category→param mapping sheet (`CATEGORY_PARAMS`) × the existing `MASTERS_Parameters` dictionary, resolved by a new material `inspectionCategory` field. Per-material specs live in a new EAV sheet (`MATERIAL_SPECS`); IQC param values move to a new EAV log (`IQC_PARAM_LOG`). A single resolver (`InspectionParams.js`) serves both flows with precedence material › category › dictionary. Fully additive; legacy fallback keeps un-categorized products on the current 12 params.

**Tech Stack:** Google Apps Script (server `.js`, client `.html`), Google Sheets as datastore, `MastersCrud.js` schema registry, `?diag=` smoke tests driven via `node e2e-diag.js` (clasp run does NOT work here).

## Global Constraints

- Deploy: `clasp push -f` → `clasp deploy --deploymentId AKfycbxMFpeJOqF5_iARRCo7aHLg0Pw_XlqKdAzmDVck8DUdDfgr1nIIjbvTgrlyc0XtYRuaVQ --description "..."`. Bump `getFormHtml` cache key in `Code.js` (currently `v87`) + `HtmlCache.html` PFX (currently `v18`) on any form HTML change.
- Server functions are tested via `?diag=<name>` routes in `Code.js` doGet + `node e2e-diag.js <name>` (stored auth). `clasp run` FAILS (permissions) — never use it. Smokes needing >60s run via a temporary `e2e-diag-long.js` copy with `timeout: 300000`.
- All test/seed writes gated by `CONFIG._TESTING_ENABLED` (currently `true`).
- Notifications: smokes set the module-global `_QMS_SUPPRESS_NOTIFY = true` (reset in finally) so synthetic NCRs don't fire real Telegram/DWM UrlFetch.
- git: stage files explicitly (never `git add -A` — tree carries unrelated M files). Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- `.claspignore`: new server `.js` files push by default. Files a diag route depends on must NOT be in `.claspignore` (test files `_SmokeReviewFixes.js`, `_SmokeFullChain.js`, `_TestHelpers.js` are already un-ignored).
- Reuse the per-request read-cache pattern (`ProductionReadCache.js`) only if resolver reads become hot — not required for v1.
- Do NOT touch `AqlSampling.js` (separate open item).

---

## File Structure

- Create `InspectionParams.js` — the resolver + sheet-ensure helpers (`getCategoryParams`, `getInspectionSpec`, `ensureCategoryParamsSheet_`, `ensureMaterialSpecsSheet_`, `ensureIqcParamLogSheet_`).
- Create `SeedInspectionParams.js` — idempotent seeder for `MASTERS_Parameters` + `CATEGORY_PARAMS`.
- Create `_SmokeInspectionParams.js` — regression smoke.
- Modify `Masters.js` — extend `MAT_COL` + material read/write for 3 new fields.
- Modify `MastersCrud.js` — register `CATEGORY_PARAMS` + `MATERIAL_SPECS` schemas.
- Modify `IQC.js` — new `getIqcParamsForProduct`, render-from-server, `saveIQC` writes `IQC_PARAM_LOG`, fallback.
- Modify `IQC_F.html` — render params from server payload, delete hardcoded `IQC_PARAMS`, add ⓘ tooltip.
- Modify `IPQC.js` — category layer above the existing product-code param resolution.
- Modify `IPQC_F.html` — add ⓘ tooltip to param rows.
- Modify `Code.js` — `?diag=seedcategoryparams` + `?diag=smokeinspparams` routes; cache-key bump.
- Modify `HtmlCache.html` — PFX bump.

Sheet column contracts (0-based indices), authoritative for all tasks:
- `MASTERS_Materials`: existing A–L (0–11); NEW `INSP_CATEGORY=12`, `COA_REQUIRED=13`, `SPEC_DOC_REF=14`; `MAT_WIDTH=15`.
- `MASTERS_Parameters` (existing): `code=0, name=1, unit=2, std_value=3, tol_min=4, tol_max=5, method_type=6, check_brief=7, tools=8, doc_ref=9, doc_number=10`.
- `CATEGORY_PARAMS` (new): `category=0, paramCode=1, appliesTo=2, enabled=3, ccp=4, specOverride=5, tolMinOverride=6, tolMaxOverride=7, sort=8`.
- `MATERIAL_SPECS` (new): `materialCode=0, paramCode=1, stdValue=2, tolMin=3, tolMax=4, unit=5, specText=6, sort=7`.
- `IQC_PARAM_LOG` (new): `iqcDocNo=0, timestamp=1, paramCode=2, paramName=3, unit=4, stdValue=5, actualValue=6, result=7, remark=8`.

---

### Task 1: Material master gains inspectionCategory / coaRequired / specDocRef

**Files:**
- Modify: `Masters.js` (`MAT_COL` block ~lines 20-24; `getMaterials()` ~56-82; `_upsertMaterialRow_` ~482-498)
- Test: `_SmokeInspectionParams.js` (created here, extended in Task 8)

**Interfaces:**
- Produces: `getMaterials()` objects now include `inspectionCategory`, `coaRequired`, `specDocRef` (strings). `MAT_COL.INSP_CATEGORY=12, COA_REQUIRED=13, SPEC_DOC_REF=14`, `MAT_WIDTH=15`.

- [ ] **Step 1: Write the failing test** — create `_SmokeInspectionParams.js` with a minimal probe:

```javascript
// _SmokeInspectionParams.gs — regression smoke for category-driven inspection params.
function smokeInspectionParams() {
  if (!CONFIG._TESTING_ENABLED) return { success:false, error:'testing disabled' };
  var log=[], pass=0, fail=0;
  function assert(n,c,d){ if(c){pass++;log.push('  PASS '+n+(d?' — '+d:''));} else {fail++;log.push('  FAIL '+n+(d?' — '+d:''));} }
  try {
    // Task 1: material master exposes the 3 new fields
    assert('MAT_COL has INSP_CATEGORY=12', MAT_COL.INSP_CATEGORY === 12, 'got '+MAT_COL.INSP_CATEGORY);
    assert('MAT_WIDTH is 15', MAT_WIDTH === 15, 'got '+MAT_WIDTH);
    var mats = getMaterials();
    assert('getMaterials returns rows', mats.length >= 0);
    if (mats.length) assert('material has inspectionCategory field', ('inspectionCategory' in mats[0]));
  } catch(e){ log.push('EXCEPTION: '+e.message); fail++; }
  log.push(''); log.push('RESULT: '+pass+' passed, '+fail+' failed.');
  return { success: fail===0, pass:pass, fail:fail, report: log.join('\n') };
}
```

- [ ] **Step 2: Add the diag route + run to verify it fails** — in `Code.js` doGet, after the `smokeprod` route, add:

```javascript
  if (diag === 'smokeinspparams') {
    var sip;
    try { sip = (typeof smokeInspectionParams === 'function') ? smokeInspectionParams() : { error:'smokeInspectionParams missing' }; }
    catch (er7) { sip = { error: er7.message, stack: er7.stack }; }
    return ContentService.createTextOutput(sip && sip.report ? sip.report : JSON.stringify(sip, null, 2)).setMimeType(ContentService.MimeType.TEXT);
  }
```

Run: `clasp push -f && clasp deploy --deploymentId AKfycbxMFpeJOqF5_iARRCo7aHLg0Pw_XlqKdAzmDVck8DUdDfgr1nIIjbvTgrlyc0XtYRuaVQ --description "test: inspparams smoke" && node e2e-diag.js smokeinspparams`
Expected: FAIL — `MAT_COL has INSP_CATEGORY=12` fails (field is undefined; MAT_WIDTH is 12).

- [ ] **Step 3: Extend MAT_COL and material read/write** — in `Masters.js`, update the `MAT_COL` object and width:

```javascript
var MAT_COL = { CODE:0, DESC:1, UNIT:2, CATEGORY:3, DEFAULT_LOCATION:4, REORDER_LEVEL:5,
  EACH_L:6, EACH_W:7, EACH_H:8, EACH_WEIGHT:9, PER_PALLET:10, FIT_CLASS:11,
  INSP_CATEGORY:12, COA_REQUIRED:13, SPEC_DOC_REF:14 };
var MAT_WIDTH = 15;
```

In `getMaterials()`, add to each returned object (after `fitClass`):

```javascript
    inspectionCategory: String(r[MAT_COL.INSP_CATEGORY] || ''),
    coaRequired:        String(r[MAT_COL.COA_REQUIRED] || ''),
    specDocRef:         String(r[MAT_COL.SPEC_DOC_REF] || ''),
```

In `_upsertMaterialRow_`, ensure the row array is padded to `MAT_WIDTH` and preserves cols 12-14 on update (mirror how it preserves F→L). If it builds a fixed-length array, extend it to length 15 and carry existing values for the 3 new indices.

- [ ] **Step 4: Run to verify it passes**

Run: `clasp push -f && clasp deploy --deploymentId ... --description "feat: material inspectionCategory/coaRequired/specDocRef" && node e2e-diag.js smokeinspparams`
Expected: PASS on all Task-1 asserts.

- [ ] **Step 5: Commit**

```bash
git add Masters.js _SmokeInspectionParams.js Code.js
git commit -m "feat: material master gains inspectionCategory/coaRequired/specDocRef"
```

---

### Task 2: New sheets + MastersCrud registration

**Files:**
- Create: `InspectionParams.js` (sheet-ensure helpers only in this task)
- Modify: `MastersCrud.js` (`MASTERS_SCHEMA_` ~line 9)
- Test: `_SmokeInspectionParams.js`

**Interfaces:**
- Produces: `ensureCategoryParamsSheet_()`, `ensureMaterialSpecsSheet_()`, `ensureIqcParamLogSheet_()` (each returns the Sheet). `MASTERS_SCHEMA_` registers `CategoryParams` (sheet `CATEGORY_PARAMS`) and `MaterialSpecs` (sheet `MATERIAL_SPECS`) for owner-gated CRUD.

- [ ] **Step 1: Write the failing test** — add to `smokeInspectionParams()` (before the RESULT line):

```javascript
    // Task 2: sheets ensured + CRUD registered
    ensureCategoryParamsSheet_(); ensureMaterialSpecsSheet_(); ensureIqcParamLogSheet_();
    var ss = getSpreadsheet();
    assert('CATEGORY_PARAMS sheet exists', !!ss.getSheetByName('CATEGORY_PARAMS'));
    assert('MATERIAL_SPECS sheet exists', !!ss.getSheetByName('MATERIAL_SPECS'));
    assert('IQC_PARAM_LOG sheet exists', !!ss.getSheetByName('IQC_PARAM_LOG'));
    var schema = getMastersSchema();
    assert('CategoryParams registered in MastersCrud', schema.some(function(s){return s.name==='CategoryParams';}));
    assert('MaterialSpecs registered in MastersCrud', schema.some(function(s){return s.name==='MaterialSpecs';}));
```

- [ ] **Step 2: Run to verify it fails**

Run: `clasp push -f && clasp deploy --deploymentId ... --description "test" && node e2e-diag.js smokeinspparams`
Expected: FAIL — `ensureCategoryParamsSheet_` not defined.

- [ ] **Step 3: Create InspectionParams.js sheet-ensure helpers**

```javascript
// InspectionParams.js — category-driven inspection parameter resolver + sheets.
var CATPARAM_HEADERS_ = ['category','paramCode','appliesTo','enabled','ccp','specOverride','tolMinOverride','tolMaxOverride','sort'];
var MATSPEC_HEADERS_  = ['materialCode','paramCode','stdValue','tolMin','tolMax','unit','specText','sort'];
var IQCPARAMLOG_HEADERS_ = ['iqcDocNo','timestamp','paramCode','paramName','unit','stdValue','actualValue','result','remark'];

function _ensureSheetWithHeaders_(name, headers) {
  var ss = getSpreadsheet();
  var ws = ss.getSheetByName(name);
  if (!ws) { ws = ss.insertSheet(name); ws.getRange(1,1,1,headers.length).setValues([headers]); ws.setFrozenRows(1); }
  return ws;
}
function ensureCategoryParamsSheet_() { return _ensureSheetWithHeaders_('CATEGORY_PARAMS', CATPARAM_HEADERS_); }
function ensureMaterialSpecsSheet_()  { return _ensureSheetWithHeaders_('MATERIAL_SPECS', MATSPEC_HEADERS_); }
function ensureIqcParamLogSheet_()    { return _ensureSheetWithHeaders_('IQC_PARAM_LOG', IQCPARAMLOG_HEADERS_); }
```

- [ ] **Step 4: Register schemas in MastersCrud.js** — inside `MASTERS_SCHEMA_` add two entries (match the existing entry shape: `{name, sheet, codeCol, columns:[{key,label,type}]}`):

```javascript
  CategoryParams: {
    sheet: 'CATEGORY_PARAMS', codeCol: 0,
    columns: [
      {key:'category',label:'Category',type:'text'},
      {key:'paramCode',label:'Param Code',type:'text'},
      {key:'appliesTo',label:'Applies To',type:'text'},
      {key:'enabled',label:'Enabled',type:'enum:Y/N'},
      {key:'ccp',label:'CCP',type:'enum:Y/N'},
      {key:'specOverride',label:'Spec Override',type:'text'},
      {key:'tolMinOverride',label:'Tol Min Override',type:'num'},
      {key:'tolMaxOverride',label:'Tol Max Override',type:'num'},
      {key:'sort',label:'Sort',type:'num'}
    ]
  },
  MaterialSpecs: {
    sheet: 'MATERIAL_SPECS', codeCol: 0,
    columns: [
      {key:'materialCode',label:'Material Code',type:'text'},
      {key:'paramCode',label:'Param Code',type:'text'},
      {key:'stdValue',label:'Std Value',type:'text'},
      {key:'tolMin',label:'Tol Min',type:'num'},
      {key:'tolMax',label:'Tol Max',type:'num'},
      {key:'unit',label:'Unit',type:'text'},
      {key:'specText',label:'Spec Text',type:'longtext'},
      {key:'sort',label:'Sort',type:'num'}
    ]
  },
```

(Note: these masters have composite natural keys; `codeCol:0` is nominal — CRUD row-matching for these two uses the first column. If `MastersCrud` upsert assumes a unique codeCol, document that duplicate first-column values are allowed here and rows are managed by full-row edit in the sheet; do NOT change the generic CRUD to enforce uniqueness.)

- [ ] **Step 5: Run to verify it passes**

Run: `clasp push -f && clasp deploy --deploymentId ... --description "feat: inspection param sheets + CRUD" && node e2e-diag.js smokeinspparams`
Expected: PASS on Task-2 asserts.

- [ ] **Step 6: Commit**

```bash
git add InspectionParams.js MastersCrud.js _SmokeInspectionParams.js
git commit -m "feat: CATEGORY_PARAMS/MATERIAL_SPECS/IQC_PARAM_LOG sheets + CRUD registration"
```

---

### Task 3: Resolver — getCategoryParams + getInspectionSpec

**Files:**
- Modify: `InspectionParams.js`
- Test: `_SmokeInspectionParams.js`

**Interfaces:**
- Consumes: sheet-ensure helpers (Task 2); `MASTERS_Parameters` dictionary reader (add a private `_paramDict_()` reading that sheet into `{code:{name,unit,std,tolMin,tolMax,method,checkBrief,tools,docRef}}`).
- Produces:
  - `getCategoryParams(category, flow)` → `[{paramCode,label,unit,std,tolMin,tolMax,ccp,method,checkBrief,tools,docRef,specText,sort}]` sorted by `sort`. `flow ∈ {'IQC','IPQC'}`; includes rows where `appliesTo ∈ {flow,'BOTH'}` and `enabled==='Y'`.
  - `getInspectionSpec(materialCode, category, paramCode)` → `{std,tolMin,tolMax,unit,specText,source}` with precedence material(`MATERIAL_SPECS`) › category(`CATEGORY_PARAMS` overrides) › dictionary(`MASTERS_Parameters`). `source ∈ {'material','category','dictionary'}`.

- [ ] **Step 1: Write the failing test** — add to `smokeInspectionParams()`. Seed two rows directly then assert resolution:

```javascript
    // Task 3: resolver. Seed a param + category row + material spec, then resolve.
    var pW = getSpreadsheet().getSheetByName('MASTERS_Parameters');
    var TCODE='TIP-WT-'+Utilities.formatDate(new Date(),'Asia/Kolkata','HHmmss');
    pW.appendRow([TCODE,'Test Weight','g',24.5,24.0,25.0,'measure','Weigh on balance','Balance 0.01g','PM/FRM/IQC-02','']);
    ensureCategoryParamsSheet_().appendRow(['TIP_CAT',TCODE,'IQC','Y','Y','',24.0,25.0,1]);
    ensureMaterialSpecsSheet_().appendRow(['TIP-MAT-1',TCODE,24.7,24.6,24.9,'g','Neck ø 28mm ±0.2',1]);
    var cp = getCategoryParams('TIP_CAT','IQC');
    assert('getCategoryParams returns the seeded param', cp.some(function(p){return p.paramCode===TCODE;}));
    var got = cp.filter(function(p){return p.paramCode===TCODE;})[0] || {};
    assert('param carries guidance fields (checkBrief/tools/docRef)', !!got.checkBrief && !!got.tools && !!got.docRef);
    var specMat = getInspectionSpec('TIP-MAT-1','TIP_CAT',TCODE);
    assert('material spec wins (source=material, std=24.7)', specMat.source==='material' && Number(specMat.std)===24.7, JSON.stringify(specMat));
    var specCat = getInspectionSpec('TIP-NOMAT','TIP_CAT',TCODE);
    assert('category override wins when no material spec', specCat.source==='category', JSON.stringify(specCat));
    // cleanup seeded rows
    _tipArchivePrefix_('MASTERS_Parameters',0,TCODE);
    _tipArchivePrefix_('CATEGORY_PARAMS',0,'TIP_CAT');
    _tipArchivePrefix_('MATERIAL_SPECS',0,'TIP-MAT-1');
```

Also add a cleanup helper at file end of `_SmokeInspectionParams.js`:

```javascript
function _tipArchivePrefix_(sheet,col,prefix){
  var ss=getSpreadsheet(), ws=ss.getSheetByName(sheet); if(!ws||ws.getLastRow()<2) return 0;
  var arch=ss.getSheetByName('_TEST_ARCHIVE')||ss.insertSheet('_TEST_ARCHIVE');
  var d=ws.getDataRange().getValues(),m=0;
  for(var i=d.length-1;i>=1;i--){ if(String(d[i][col]||'').indexOf(prefix)===0){arch.appendRow([sheet].concat(d[i]));ws.deleteRow(i+1);m++;} }
  return m;
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `clasp push -f && clasp deploy --deploymentId ... --description "test" && node e2e-diag.js smokeinspparams`
Expected: FAIL — `getCategoryParams` not defined.

- [ ] **Step 3: Implement the resolver in InspectionParams.js**

```javascript
function _paramDict_() {
  var ws = getSpreadsheet().getSheetByName('MASTERS_Parameters');
  var map = {};
  if (ws && ws.getLastRow() > 1) {
    var d = ws.getDataRange().getValues();
    for (var i=1;i<d.length;i++){
      var code=String(d[i][0]||'').trim(); if(!code) continue;
      map[code]={ name:String(d[i][1]||''), unit:String(d[i][2]||''), std:d[i][3], tolMin:d[i][4], tolMax:d[i][5],
        method:String(d[i][6]||''), checkBrief:String(d[i][7]||''), tools:String(d[i][8]||''), docRef:String(d[i][9]||'') };
    }
  }
  return map;
}

function getCategoryParams(category, flow) {
  var cat=String(category||'').trim(), fl=String(flow||'IQC').toUpperCase();
  if(!cat) return [];
  var dict=_paramDict_();
  var ws=ensureCategoryParamsSheet_(); var out=[];
  if(ws.getLastRow()>1){
    var d=ws.getDataRange().getValues();
    for(var i=1;i<d.length;i++){
      if(String(d[i][0]||'').trim()!==cat) continue;
      var applies=String(d[i][2]||'').toUpperCase();
      if(applies!==fl && applies!=='BOTH') continue;
      if(String(d[i][3]||'').toUpperCase()!=='Y') continue;
      var pc=String(d[i][1]||'').trim(); var def=dict[pc]||{};
      out.push({ paramCode:pc, label:def.name||pc, unit:def.unit||'',
        std:(d[i][5]!=='' && d[i][5]!=null)?d[i][5]:def.std,
        tolMin:(d[i][6]!=='' && d[i][6]!=null)?d[i][6]:def.tolMin,
        tolMax:(d[i][7]!=='' && d[i][7]!=null)?d[i][7]:def.tolMax,
        ccp:String(d[i][4]||'').toUpperCase()==='Y',
        method:def.method||'', checkBrief:def.checkBrief||'', tools:def.tools||'', docRef:def.docRef||'',
        specText:String(d[i][5]||''), sort:Number(d[i][8])||0 });
    }
  }
  out.sort(function(a,b){return a.sort-b.sort;});
  return out;
}

function getInspectionSpec(materialCode, category, paramCode) {
  var mc=String(materialCode||'').trim(), pc=String(paramCode||'').trim();
  // 1. material spec
  var msw=ensureMaterialSpecsSheet_();
  if(msw.getLastRow()>1){
    var md=msw.getDataRange().getValues();
    for(var i=1;i<md.length;i++){
      if(String(md[i][0]||'').trim()===mc && String(md[i][1]||'').trim()===pc){
        return { std:md[i][2], tolMin:md[i][3], tolMax:md[i][4], unit:String(md[i][5]||''), specText:String(md[i][6]||''), source:'material' };
      }
    }
  }
  // 2. category override
  var cps=getCategoryParams(category,'IQC').concat(getCategoryParams(category,'IPQC'));
  for(var j=0;j<cps.length;j++){
    if(cps[j].paramCode===pc){
      var hasOverride = (cps[j].specText!=='' || cps[j].tolMin!=null || cps[j].tolMax!=null);
      if(hasOverride) return { std:cps[j].std, tolMin:cps[j].tolMin, tolMax:cps[j].tolMax, unit:cps[j].unit, specText:cps[j].specText, source:'category' };
    }
  }
  // 3. dictionary default
  var def=_paramDict_()[pc]||{};
  return { std:def.std, tolMin:def.tolMin, tolMax:def.tolMax, unit:def.unit||'', specText:'', source:'dictionary' };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `clasp push -f && clasp deploy --deploymentId ... --description "feat: inspection param resolver" && node e2e-diag.js smokeinspparams`
Expected: PASS on Task-3 asserts (material wins, category fallback, guidance fields present).

- [ ] **Step 5: Commit**

```bash
git add InspectionParams.js _SmokeInspectionParams.js
git commit -m "feat: inspection param resolver (getCategoryParams + getInspectionSpec)"
```

---

### Task 4: Seeder — MASTERS_Parameters + CATEGORY_PARAMS for 5 categories

**Files:**
- Create: `SeedInspectionParams.js`
- Modify: `Code.js` (add `?diag=seedcategoryparams`)
- Test: `_SmokeInspectionParams.js`

**Interfaces:**
- Consumes: sheet-ensure helpers (Task 2), `getCategoryParams` (Task 3).
- Produces: `seedInspectionParams()` → `{success, paramsAdded, mappingsAdded}`. Idempotent: dedupes params by `code`, mappings by `category|paramCode`.

- [ ] **Step 1: Write the failing test** — add to `smokeInspectionParams()`:

```javascript
    // Task 4: seeder is idempotent and produces the 5 category sets
    var s1 = seedInspectionParams();
    var s2 = seedInspectionParams(); // second run = no-op
    assert('seed run 1 succeeds', s1 && s1.success);
    assert('seed run 2 adds nothing (idempotent)', s2 && s2.paramsAdded===0 && s2.mappingsAdded===0, JSON.stringify(s2));
    ['HDPE_BOTTLE','LABEL','PAPER','CARTON','BULK'].forEach(function(cat){
      assert('category '+cat+' has params', getCategoryParams(cat,'IQC').length > 0);
    });
```

- [ ] **Step 2: Add diag route + run to verify it fails** — in `Code.js` doGet:

```javascript
  if (diag === 'seedcategoryparams') {
    var sd; try { sd = (typeof seedInspectionParams==='function') ? seedInspectionParams() : {error:'seedInspectionParams missing'}; }
    catch(er8){ sd={error:er8.message, stack:er8.stack}; }
    return ContentService.createTextOutput(JSON.stringify(sd,null,2)).setMimeType(ContentService.MimeType.TEXT);
  }
```

Run: `clasp push -f && clasp deploy --deploymentId ... --description "test" && node e2e-diag.js smokeinspparams`
Expected: FAIL — `seedInspectionParams` not defined.

- [ ] **Step 3: Implement SeedInspectionParams.js** — param dictionary entries + category mappings. Each param: `[code,name,unit,std,tolMin,tolMax,method,checkBrief,tools,docRef,docNumber]`. Each mapping: `[category,paramCode,appliesTo,enabled,ccp,specOverride,tolMinOverride,tolMaxOverride,sort]`.

```javascript
// SeedInspectionParams.js — idempotent starter data for category-driven inspection.
function seedInspectionParams() {
  if (!CONFIG._TESTING_ENABLED) return { success:false, error:'testing disabled' };
  var PARAMS = [
    // code, name, unit, std, tolMin, tolMax, method, checkBrief, tools, docRef
    ['WEIGHT','Weight','g','','','','Gravimetric','Weigh a sample unit on a calibrated balance; record grams.','Balance 0.01 g','PM/FRM/IQC-02'],
    ['DIMENSIONS','Dimensions','mm','','','','Dimensional','Measure length/width/height per drawing with vernier; check against spec.','Vernier caliper','PM/FRM/IQC-02'],
    ['NECK_DIA','Neck / Thread Ø','mm','','','','Dimensional','Measure neck outer diameter across the thread crest at 2 points 90° apart.','Vernier / thread gauge','PM/FRM/IQC-02'],
    ['WALL_THK','Wall Thickness','mm','','','','Dimensional','Section mid-body; measure wall at 4 points 90° apart; record the minimum.','Dial thickness gauge 0.01 mm','PM/FRM/IQC-02'],
    ['LEAK','Leak Test','','','','','Functional','Pressurise/immerse per method; observe for bubbles/pressure drop.','Leak tester','PM/FRM/IQC-02'],
    ['DROP','Drop Test','','','','','Functional','Drop a filled unit from spec height onto hard floor; inspect for crack/leak.','Drop rig / tape','PM/FRM/IQC-02'],
    ['COLOUR','Colour / Match','','','','','Visual','Compare against approved colour standard under D65 light.','Colour std / light box','PM/FRM/IQC-02'],
    ['CLARITY','Clarity','','','','','Visual','Inspect for haze/opacity against a printed contrast card.','Contrast card','PM/FRM/IQC-02'],
    ['PRINT','Print Quality','','','','','Visual','Check registration, smudge, missing text against artwork proof.','Loupe / proof','PM/FRM/IQC-02'],
    ['COLOUR_DE','Colour ΔE','','','','','Instrumental','Read ΔE vs approved proof with spectrophotometer; ≤ tolerance.','Spectrophotometer','PM/FRM/IQC-02'],
    ['ADHESION','Adhesion / Peel','N/25mm','','','','Mechanical','Peel a strip at 180°; record peel force per 25 mm.','Peel tester','PM/FRM/IQC-02'],
    ['BARCODE','Barcode Scan','','','','','Functional','Scan the code; must read first-attempt with a verifier grade ≥ C.','Barcode verifier','PM/FRM/IQC-02'],
    ['GSM','GSM / Grammage','gsm','','','','Gravimetric','Cut a known area; weigh; compute grams per square metre.','GSM cutter + balance','PM/FRM/IQC-02'],
    ['MOISTURE','Moisture','%','','','','Instrumental','Measure moisture content with a moisture meter per method.','Moisture meter','PM/FRM/IQC-02'],
    ['BRIGHTNESS','Brightness','%','','','','Instrumental','Read brightness with the photometer against the standard tile.','Brightness meter','PM/FRM/IQC-02'],
    ['TENSILE','Tensile Strength','N','','','','Mechanical','Pull a strip to break; record peak force.','Tensile tester','PM/FRM/IQC-02'],
    ['BURST','Bursting Strength','kPa','','','','Mechanical','Clamp sample; apply increasing pressure to burst; record kPa.','Burst tester','PM/FRM/IQC-02'],
    ['ECT','Edge Crush (ECT)','kN/m','','','','Mechanical','Crush an edge-oriented specimen; record kN/m.','ECT tester','PM/FRM/IQC-02'],
    ['PLY_BOND','Ply Bond','','','','','Mechanical','Attempt to separate plies; must not delaminate under spec load.','Ply bond tester','PM/FRM/IQC-02'],
    ['MFI','MFI / Melt Index','g/10min','','','','Instrumental','Run melt flow at spec temp/load; record g/10 min.','Melt flow indexer','PM/FRM/IQC-02'],
    ['CONTAMINATION','Contamination','','','','','Visual','Inspect a spread sample for black specks/foreign matter; count.','Light table / loupe','PM/FRM/IQC-02'],
    ['GRANULE','Granule Size','mm','','','','Dimensional','Sieve/measure granule size distribution per method.','Sieve set','PM/FRM/IQC-02'],
    ['NET_WEIGHT','Net Weight','kg','','','','Gravimetric','Weigh the bag/lot net of packaging; compare to declared.','Platform scale','PM/FRM/IQC-02']
  ];
  // category, [paramCode...] in display order, with ccp flags
  var MAP = {
    HDPE_BOTTLE: [['WEIGHT',true],['DIMENSIONS',false],['NECK_DIA',false],['WALL_THK',false],['LEAK',true],['DROP',false],['COLOUR',false],['CLARITY',false]],
    LABEL:       [['DIMENSIONS',false],['PRINT',true],['COLOUR_DE',false],['ADHESION',false],['BARCODE',true],['GSM',false]],
    PAPER:       [['GSM',false],['MOISTURE',false],['DIMENSIONS',false],['BRIGHTNESS',false],['TENSILE',false]],
    CARTON:      [['DIMENSIONS',false],['GSM',false],['BURST',true],['ECT',false],['PRINT',false],['PLY_BOND',false]],
    BULK:        [['NET_WEIGHT',false],['MOISTURE',false],['CONTAMINATION',true],['MFI',false],['COLOUR',false],['GRANULE',false]]
  };

  var pW = getSpreadsheet().getSheetByName('MASTERS_Parameters');
  if (!pW) return { success:false, error:'MASTERS_Parameters missing' };
  var existingParams = {};
  if (pW.getLastRow()>1) pW.getRange(2,1,pW.getLastRow()-1,1).getValues().forEach(function(r){ if(r[0]) existingParams[String(r[0]).trim()]=true; });
  var paramsAdded=0;
  PARAMS.forEach(function(p){ if(!existingParams[p[0]]){ pW.appendRow([p[0],p[1],p[2],p[3],p[4],p[5],p[6],p[7],p[8],p[9],'']); paramsAdded++; } });

  var cW = ensureCategoryParamsSheet_();
  var existingMap = {};
  if (cW.getLastRow()>1) cW.getRange(2,1,cW.getLastRow()-1,2).getValues().forEach(function(r){ existingMap[String(r[0]).trim()+'|'+String(r[1]).trim()]=true; });
  var mappingsAdded=0;
  Object.keys(MAP).forEach(function(cat){
    MAP[cat].forEach(function(entry, idx){
      var code=entry[0], ccp=entry[1];
      var key=cat+'|'+code;
      if(!existingMap[key]){ cW.appendRow([cat, code, 'BOTH', 'Y', ccp?'Y':'N', '', '', '', idx+1]); mappingsAdded++; }
    });
  });
  return { success:true, paramsAdded:paramsAdded, mappingsAdded:mappingsAdded };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `clasp push -f && clasp deploy --deploymentId ... --description "feat: seed inspection params" && node e2e-diag.js smokeinspparams`
Expected: PASS — seed idempotent, all 5 categories populated.

- [ ] **Step 5: Commit**

```bash
git add SeedInspectionParams.js Code.js _SmokeInspectionParams.js
git commit -m "feat: idempotent seeder for MASTERS_Parameters + CATEGORY_PARAMS (5 categories)"
```

---

### Task 5: IQC server — resolve params by category, write IQC_PARAM_LOG, fallback

**Files:**
- Modify: `IQC.js` (`getIQCFormInit` ~36; `saveIQC` param write ~103-160; add `getIqcParamsForProduct`)
- Test: `_SmokeInspectionParams.js`

**Interfaces:**
- Consumes: `getCategoryParams` + `getInspectionSpec` (Task 3), `getMaterials` (Task 1 — for `inspectionCategory`), `ensureIqcParamLogSheet_` (Task 2).
- Produces:
  - `getIqcParamsForProduct(materialCode)` → `{ category, params:[{paramCode,label,unit,std,tolMin,tolMax,ccp,method,checkBrief,tools,docRef,specText,source}], fallback:bool }`. When material has no `inspectionCategory` or category yields no params → returns the legacy 12 `IQC_PARAMS` mapped into the same shape with `fallback:true`.
  - `saveIQC` writes one `IQC_PARAM_LOG` row per submitted param (in addition to existing behavior); accepts `item.paramResults: [{paramCode, actualValue, result, remark}]`.

- [ ] **Step 1: Write the failing test** — add to `smokeInspectionParams()` (uses seeded HDPE_BOTTLE):

```javascript
    // Task 5: IQC resolves by category + writes IQC_PARAM_LOG. Seed a categorized material.
    var stamp5 = Utilities.formatDate(new Date(),'Asia/Kolkata','HHmmss');
    var mCode='TIP-BTL-'+stamp5;
    // append a material row tagged HDPE_BOTTLE
    var mW=getSpreadsheet().getSheetByName('MASTERS_Materials');
    var mrow=new Array(MAT_WIDTH).fill(''); mrow[0]=mCode; mrow[1]='Test bottle'; mrow[2]='NOS'; mrow[3]='RM'; mrow[MAT_COL.INSP_CATEGORY]='HDPE_BOTTLE';
    mW.appendRow(mrow);
    var res5 = getIqcParamsForProduct(mCode);
    assert('IQC resolves HDPE_BOTTLE params (not fallback)', res5.category==='HDPE_BOTTLE' && res5.fallback===false && res5.params.length>=8, JSON.stringify({c:res5.category,n:res5.params.length,f:res5.fallback}));
    var res5b = getIqcParamsForProduct('TIP-NOCAT-'+stamp5);
    assert('IQC falls back to legacy 12 when no category', res5b.fallback===true && res5b.params.length===12, 'n='+res5b.params.length);
    // saveIQC writes IQC_PARAM_LOG
    var grn5=createTestGRN_({materialCode:mCode,batchNo:'TIPB-'+stamp5,qtyReceived:50,locationId:'RM-STORE-A',unit:'NOS'});
    if (typeof _QMS_SUPPRESS_NOTIFY!=='undefined') _QMS_SUPPRESS_NOTIFY=true;
    var iq5=saveIQC({grnNo:grn5.docNo,date:new Date(),inspector:'claude-smoke',disposition:'ACCEPTED',lotSize:50,aqlLevel:'2.5',inspLevel:'II',severity:'Normal',
      items:[{materialCode:mCode,materialDesc:'Test bottle',batchNo:grn5.batchNo,acceptedQty:50,rejectedQty:0,holdQty:0,sampleSize:8,params:{},
        paramResults:[{paramCode:'WEIGHT',actualValue:'24.6',result:'PASS',remark:''},{paramCode:'LEAK',actualValue:'Pass',result:'PASS',remark:''}]}]});
    if (typeof _QMS_SUPPRESS_NOTIFY!=='undefined') _QMS_SUPPRESS_NOTIFY=false;
    assert('saveIQC success', iq5 && iq5.success, iq5 && (iq5.error||''));
    var plog=getSpreadsheet().getSheetByName('IQC_PARAM_LOG');
    var plogRows = plog.getDataRange().getValues().filter(function(r){return String(r[0]).indexOf(iq5.docNos && iq5.docNos[0])===0 && iq5.docNos;});
    assert('IQC_PARAM_LOG got >=2 rows for this record', plogRows.length>=2, 'rows='+plogRows.length);
    // cleanup
    _tipArchivePrefix_('MASTERS_Materials',0,mCode);
    _tipArchivePrefix_('STOCK_LEDGER',3,mCode);
    _tipArchivePrefix_('GRN_LOG',6,mCode);
    _tipArchivePrefix_('IQC_LOG',4,'Test bottle');
    _tipArchivePrefix_('IQC_PARAM_LOG',2,'WEIGHT'); _tipArchivePrefix_('IQC_PARAM_LOG',2,'LEAK');
```

- [ ] **Step 2: Run to verify it fails**

Run: `clasp push -f && clasp deploy --deploymentId ... --description "test" && node e2e-diag-long.js smokeinspparams` (use long-timeout copy — saveIQC is heavier)
Expected: FAIL — `getIqcParamsForProduct` not defined.

- [ ] **Step 3: Implement getIqcParamsForProduct + IQC_PARAM_LOG write in IQC.js**

Add the resolver wrapper (maps legacy `IQC_PARAMS` into the unified shape on fallback):

```javascript
function getIqcParamsForProduct(materialCode) {
  var mc = String(materialCode||'').trim();
  var cat = '';
  try {
    var mats = getMaterials();
    for (var i=0;i<mats.length;i++){ if(String(mats[i].code||mats[i].itemCode||'').trim()===mc){ cat=String(mats[i].inspectionCategory||'').trim(); break; } }
  } catch(e){}
  if (cat && typeof getCategoryParams==='function') {
    var params = getCategoryParams(cat, 'IQC');
    if (params.length) {
      // apply per-material spec override to each param
      params = params.map(function(p){
        var sp = getInspectionSpec(mc, cat, p.paramCode);
        return { paramCode:p.paramCode, label:p.label, unit:sp.unit||p.unit, std:sp.std, tolMin:sp.tolMin, tolMax:sp.tolMax,
          ccp:p.ccp, method:p.method, checkBrief:p.checkBrief, tools:p.tools, docRef:p.docRef, specText:sp.specText||p.specText, source:sp.source };
      });
      return { category:cat, params:params, fallback:false };
    }
  }
  // fallback: legacy 12 hardcoded params → unified shape
  var legacy = IQC_PARAMS.map(function(p, idx){
    return { paramCode:p.id, label:p.label, unit:'', std:p.spec||'', tolMin:null, tolMax:null,
      ccp:!!p.ccp, method:'', checkBrief:p.hint||'', tools:'', docRef:'', specText:p.spec||'', source:'legacy', sort:idx };
  });
  return { category:cat||'', params:legacy, fallback:true };
}
```

In `saveIQC`, after the row append per item, write IQC_PARAM_LOG rows when `item.paramResults` present:

```javascript
      // Write EAV param results (category-driven params). Legacy cols 11-22 still written above.
      if (item.paramResults && item.paramResults.length && typeof ensureIqcParamLogSheet_==='function') {
        var plW = ensureIqcParamLogSheet_();
        item.paramResults.forEach(function(pr){
          var spec = (typeof getInspectionSpec==='function') ? getInspectionSpec(item.materialCode, (data.inspectionCategory||''), pr.paramCode) : {};
          plW.appendRow([ docNo, new Date(), pr.paramCode, pr.paramName||'', spec.unit||'', spec.std!=null?spec.std:'', pr.actualValue||'', pr.result||'', pr.remark||'' ]);
        });
      }
```

Also add `params: getIQCFormInit`... leave `getIQCFormInit` returning the legacy `params` for back-compat; the form now calls `getIqcParamsForProduct` on product-select (Task 6).

- [ ] **Step 4: Run to verify it passes**

Run: `clasp push -f && clasp deploy --deploymentId ... --description "feat: IQC category params + IQC_PARAM_LOG" && node e2e-diag-long.js smokeinspparams`
Expected: PASS — category resolution, fallback to 12, IQC_PARAM_LOG rows written.

- [ ] **Step 5: Commit**

```bash
git add IQC.js _SmokeInspectionParams.js
git commit -m "feat: IQC resolves params by category + writes IQC_PARAM_LOG (legacy fallback)"
```

---

### Task 6: IQC form — render params from server + ⓘ tooltip

**Files:**
- Modify: `IQC_F.html` (delete hardcoded `IQC_PARAMS` ~503-516; param render loop ~882-921; product-select handler; save payload ~1265)
- Modify: `Code.js` (cache-key bump), `HtmlCache.html` (PFX bump)

**Interfaces:**
- Consumes: `getIqcParamsForProduct(materialCode)` (Task 5) via `google.script.run`.
- Produces: form renders the resolved param rows with an ⓘ tap-popover; save sends `item.paramResults: [{paramCode, actualValue, result, remark}]`.

- [ ] **Step 1: Delete the hardcoded client IQC_PARAMS** — remove the `var IQC_PARAMS = [...]` block (~503-516). Add a live holder: `var IQC_PARAMS_LIVE = [];`.

- [ ] **Step 2: Fetch params on product/GRN select** — in the product-select handler, call:

```javascript
google.script.run.withSuccessHandler(function(res){
  IQC_PARAMS_LIVE = (res && res.params) || [];
  renderParamRows();   // re-render from live params
}).getIqcParamsForProduct(selectedMaterialCode);
```

- [ ] **Step 3: Render rows from IQC_PARAMS_LIVE with ⓘ** — replace the param render loop to iterate `IQC_PARAMS_LIVE`, showing per row: label (+ CCP badge if `p.ccp`), the resolved spec (`p.specText` or std±tol), an actual-value input, a PASS/FAIL/NA control, and an ⓘ button:

```javascript
function renderParamRows(){
  var host=document.getElementById('paramRows'); if(!host) return; host.innerHTML='';
  IQC_PARAMS_LIVE.forEach(function(p){
    var row=document.createElement('div'); row.className='fk-param-row';
    var spec = p.specText || [p.std, (p.tolMin!=null||p.tolMax!=null)?('['+p.tolMin+'..'+p.tolMax+']'):''].filter(Boolean).join(' ');
    row.innerHTML =
      '<span class="pname">'+p.label+(p.ccp?' <b class="ccp">CCP</b>':'')+
      ' <button type="button" class="info-btn" data-pc="'+p.paramCode+'" aria-label="How to inspect">ⓘ</button></span>'+
      '<span class="pspec">'+ (spec||'—') +'</span>'+
      '<input class="pactual" data-pc="'+p.paramCode+'" placeholder="value">'+
      '<select class="presult" data-pc="'+p.paramCode+'"><option value="">—</option><option>PASS</option><option>FAIL</option><option>NA</option></select>';
    host.appendChild(row);
  });
  bindInfoButtons();
}
```

- [ ] **Step 4: Implement the ⓘ tap-popover** (tap-to-toggle; GAS touch-iframe safe — not hover-only):

```javascript
function bindInfoButtons(){
  document.querySelectorAll('.info-btn').forEach(function(btn){
    btn.addEventListener('click', function(e){
      e.stopPropagation();
      closeInfoPopover();
      var pc=btn.getAttribute('data-pc');
      var p=IQC_PARAMS_LIVE.filter(function(x){return x.paramCode===pc;})[0]; if(!p) return;
      var pop=document.createElement('div'); pop.className='info-pop'; pop.id='infoPop';
      pop.innerHTML='<b>'+p.label+'</b>'+
        (p.checkBrief?'<div><u>How</u>: '+p.checkBrief+'</div>':'')+
        (p.tools?'<div><u>Tool</u>: '+p.tools+'</div>':'')+
        ((p.specText||p.std!=null)?'<div><u>Accept</u>: '+(p.specText||p.std)+'</div>':'')+
        (p.docRef?'<div><u>Ref</u>: '+p.docRef+(p.ccp?' · CCP':'')+'</div>':'');
      document.body.appendChild(pop);
      var r=btn.getBoundingClientRect();
      pop.style.top=(window.scrollY+r.bottom+4)+'px';
      pop.style.left=Math.min(r.left, window.innerWidth-260)+'px';
    });
  });
}
function closeInfoPopover(){ var e=document.getElementById('infoPop'); if(e) e.remove(); }
document.addEventListener('click', closeInfoPopover);
```

Add CSS (in the form's `<style>`): `.info-pop{position:absolute;z-index:50;max-width:250px;background:#fff;border:1px solid #cbd5e1;border-radius:8px;padding:10px;font-size:12px;box-shadow:0 4px 16px rgba(0,0,0,.12)}.info-btn{background:none;border:none;cursor:pointer;color:#2563eb;font-size:14px}.ccp{color:#dc2626;font-size:10px}` — respect `prefers-reduced-motion` (no animation used, so compliant by default).

- [ ] **Step 5: Send paramResults in the save payload** — in the item builder (~1265), add:

```javascript
      paramResults: IQC_PARAMS_LIVE.map(function(p){
        return { paramCode:p.paramCode, paramName:p.label,
          actualValue:(document.querySelector('.pactual[data-pc="'+p.paramCode+'"]')||{}).value||'',
          result:(document.querySelector('.presult[data-pc="'+p.paramCode+'"]')||{}).value||'',
          remark:'' };
      }),
```

- [ ] **Step 6: Bump cache keys** — `Code.js`: `pmqms_formhtml_v87_` → `v88` and add `'v88'` to the flush list; `HtmlCache.html`: PFX `v18` → `v19`.

- [ ] **Step 7: Deploy + visual verify** — deploy, then load IQC via the e2e harness and screenshot; confirm: selecting an HDPE_BOTTLE material renders 8 param rows with ⓘ; tapping ⓘ opens the guide; a non-categorized material renders the legacy 12.

```bash
clasp push -f && clasp deploy --deploymentId AKfycbxMFpeJOqF5_iARRCo7aHLg0Pw_XlqKdAzmDVck8DUdDfgr1nIIjbvTgrlyc0XtYRuaVQ --description "feat: IQC form renders category params + info tooltip"
node e2e-iqc-shot.js   # or the current IQC screenshot harness
```
Expected: category rows render; ⓘ popover opens on tap; fallback works.

- [ ] **Step 8: Commit**

```bash
git add IQC_F.html Code.js HtmlCache.html
git commit -m "feat: IQC form renders category-driven params from server + info tooltip"
```

---

### Task 7: IPQC — category layer + ⓘ tooltip

**Files:**
- Modify: `IPQC.js` (`getIPQCParams` ~31-108)
- Modify: `IPQC_F.html` (param render — add ⓘ)
- Modify: `Code.js`/`HtmlCache.html` (cache bump if IPQC_F changed)

**Interfaces:**
- Consumes: `getCategoryParams(category,'IPQC')` + `getInspectionSpec` (Task 3); material `inspectionCategory` (Task 1).
- Produces: `getIPQCParams(productCode)` returns category-resolved params (with the existing `CONTROL_FG` per-product override still applied on top), each carrying `checkBrief/tools/docRef` for the ⓘ tooltip.

- [ ] **Step 1: Write the failing test** — add to `smokeInspectionParams()`:

```javascript
    // Task 7: IPQC gets a category layer + guidance fields.
    var stamp7=Utilities.formatDate(new Date(),'Asia/Kolkata','HHmmss');
    var fgCode7='TIP-FG-'+stamp7;
    var mW7=getSpreadsheet().getSheetByName('MASTERS_Materials');
    var r7=new Array(MAT_WIDTH).fill(''); r7[0]=fgCode7; r7[1]='Test FG'; r7[2]='NOS'; r7[3]='FG'; r7[MAT_COL.INSP_CATEGORY]='HDPE_BOTTLE'; mW7.appendRow(r7);
    var ip=getIPQCParams(fgCode7);
    assert('IPQC returns params for a categorized FG', ip && ip.params && ip.params.length>0, JSON.stringify(ip&&(ip.warning||ip.params&&ip.params.length)));
    if (ip && ip.params && ip.params.length) assert('IPQC param carries guidance (checkBrief)', ('checkBrief' in ip.params[0]) || ('tools' in ip.params[0]));
    _tipArchivePrefix_('MASTERS_Materials',0,fgCode7);
```

- [ ] **Step 2: Run to verify it fails**

Run: `clasp push -f && clasp deploy --deploymentId ... --description "test" && node e2e-diag-long.js smokeinspparams`
Expected: FAIL — `getIPQCParams` returns the `CONTROL_FG`-only result (empty/warning for an FG with no control plan), no category params, no `checkBrief`.

- [ ] **Step 3: Add the category layer to getIPQCParams** — resolve category params first, then merge `CONTROL_FG` overrides on top (product override wins for std/tol where present). Preserve the existing return shape `{ params:[...], warning? }`; add `checkBrief/tools/docRef` to each param object:

```javascript
  // Category layer: start from the product's inspectionCategory param set.
  var catParams = [];
  try {
    var cat='';
    var mats=getMaterials();
    for (var mi=0; mi<mats.length; mi++){ if(String(mats[mi].code||mats[mi].itemCode||'').trim()===String(productCode).trim()){ cat=String(mats[mi].inspectionCategory||'').trim(); break; } }
    if (cat && typeof getCategoryParams==='function') {
      catParams = getCategoryParams(cat,'IPQC').map(function(p){
        var sp = getInspectionSpec(productCode, cat, p.paramCode);
        return { paramCode:p.paramCode, paramName:p.label, unit:sp.unit||p.unit, stdValue:sp.std, tolMin:sp.tolMin, tolMax:sp.tolMax,
          methodType:p.method, checkBrief:p.checkBrief, tools:p.tools, docRef:p.docRef, ccp:p.ccp };
      });
    }
  } catch(e){}
  // ... existing CONTROL_FG resolution produces `controlParams` ...
  // Merge: index by paramCode; CONTROL_FG override wins for std/tol; category fills the rest.
  // If controlParams is empty, return catParams. If catParams empty, return controlParams (legacy behavior).
```

Implement the merge keyed by `paramCode` (CONTROL_FG std/tol override wins; category supplies label/guidance for any param the control plan lists but the dictionary lacks). If both empty, keep the existing `{ params:[], warning:'No control plan configured...' }`.

- [ ] **Step 4: Run to verify it passes**

Run: `clasp push -f && clasp deploy --deploymentId ... --description "feat: IPQC category layer" && node e2e-diag-long.js smokeinspparams`
Expected: PASS — categorized FG returns category params with guidance fields.

- [ ] **Step 5: Add ⓘ tooltip to IPQC_F.html param rows** — mirror the Task-6 ⓘ button + `.info-pop` popover in the IPQC param render, reading `checkBrief/tools/docRef` from each param. Reuse the same CSS + `bindInfoButtons`/`closeInfoPopover` pattern.

- [ ] **Step 6: Bump cache keys** (if IPQC_F.html changed): `Code.js` `v88`→`v89` + flush list; `HtmlCache.html` PFX `v19`→`v20`.

- [ ] **Step 7: Deploy + verify**

```bash
clasp push -f && clasp deploy --deploymentId AKfycbxMFpeJOqF5_iARRCo7aHLg0Pw_XlqKdAzmDVck8DUdDfgr1nIIjbvTgrlyc0XtYRuaVQ --description "feat: IPQC category layer + info tooltip"
node e2e-diag-long.js smokeinspparams
```
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add IPQC.js IPQC_F.html Code.js HtmlCache.html _SmokeInspectionParams.js
git commit -m "feat: IPQC category param layer + info tooltip"
```

---

### Task 8: Full regression smoke run + seed live + finalize

**Files:**
- Modify: `_SmokeInspectionParams.js` (add cleanup + RESULT already present)
- Modify: `MEMORY.md` / project memory (record the feature)

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Run the full smoke green** — via long-timeout runner:

Run: `cp e2e-diag.js e2e-diag-long.js && sed -i 's/timeout: 60000/timeout: 300000/' e2e-diag-long.js && node e2e-diag-long.js smokeinspparams`
Expected: all asserts PASS, cleanup archives all TIP-* rows.

- [ ] **Step 2: Seed the live config**

Run: `node e2e-diag.js seedcategoryparams`
Expected: `{success:true, paramsAdded:23, mappingsAdded:33}` on first run (or 0/0 if already seeded).

- [ ] **Step 3: Remove the temp runner + confirm clean tree**

```bash
rm -f e2e-diag-long.js
git status --short
```

- [ ] **Step 4: Record project memory** — write a memory file noting: category-driven params live, the 3 new sheets, the resolver precedence, the seeder diag route, and that `MATERIAL_SPECS` is populated per-material via masters. Add a one-line pointer to `MEMORY.md`.

- [ ] **Step 5: Final commit + push**

```bash
git add _SmokeInspectionParams.js
git commit -m "test: full inspection-params regression smoke green + live seed"
git push
```

---

## Self-Review

**Spec coverage:**
- inspectionCategory/coaRequired/specDocRef on material → Task 1 ✓
- CATEGORY_PARAMS + MATERIAL_SPECS + IQC_PARAM_LOG sheets → Task 2 ✓
- MastersCrud registration → Task 2 ✓
- 3-tier resolver (material›category›dictionary) → Task 3 ✓
- Seeder + 5 category starter sets → Task 4 ✓
- IQC render-from-server, kill hardcoded dupe, IQC_PARAM_LOG write, legacy fallback → Tasks 5, 6 ✓
- ⓘ operator tooltip (IQC + IPQC), tap-to-toggle, fields from MASTERS_Parameters → Tasks 6, 7 ✓
- IPQC category layer above CONTROL_FG → Task 7 ✓
- Regression smoke → Tasks 1-7 (incremental) + Task 8 (full) ✓
- Additive migration + legacy fallback → Task 5 fallback, no IQC_LOG col removal ✓
- Cache-bump ritual → Tasks 6, 7 ✓
- COA reference (coaRequired/specDocRef) stored on material → Task 1 ✓ (capture-at-GRN is existing behavior, no new task)

**Placeholder scan:** No TBD/TODO; every code step shows real code. The IPQC merge (Task 7 Step 3) describes the merge in prose with the surrounding code shown — acceptable as it depends on reading the existing `CONTROL_FG` block which the implementer has open; the return-shape and field list are explicit.

**Type consistency:** `getCategoryParams` return object keys (`paramCode,label,unit,std,tolMin,tolMax,ccp,method,checkBrief,tools,docRef,specText,sort`) used consistently in Tasks 3/5/6/7. `getInspectionSpec` returns `{std,tolMin,tolMax,unit,specText,source}` — consumed correctly in Tasks 5/7. `getIqcParamsForProduct` returns `{category,params,fallback}` — matches the IQC_F fetch in Task 6. `IQC_PARAM_LOG` column order matches the write in Task 5 and the header in Task 2.

**Note on IPQC coupling (Task 7):** the merge logic reads the existing `getIPQCParams` body; the implementer must preserve the `CONTROL_FG` override semantics. If that body is large, split Task 7 Step 3 into "read+understand existing" then "add layer" — but it stays one task (one testable deliverable).
