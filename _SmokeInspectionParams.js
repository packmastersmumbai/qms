// _SmokeInspectionParams.gs — regression smoke for category-driven inspection params.
// Run: ?diag=smokeinspparams → node e2e-diag.js smokeinspparams (long-timeout once saveIQC lands).
function smokeInspectionParams() {
  if (!CONFIG._TESTING_ENABLED) return { success:false, error:'testing disabled' };
  if (typeof _QMS_SUPPRESS_NOTIFY!=='undefined') _QMS_SUPPRESS_NOTIFY=true;
  var log=[], pass=0, fail=0, ss=getSpreadsheet();
  function assert(n,c,d){ if(c){pass++;log.push('  PASS '+n+(d?' — '+d:''));} else {fail++;log.push('  FAIL '+n+(d?' — '+d:''));} }
  var stamp=Utilities.formatDate(new Date(),'Asia/Kolkata','HHmmss');
  try {
    // ---- Task 1: material field + param cols + resolver + IQC_PARAM_LOG ----
    assert('MAT_COL.INSP_CATEGORY=12', MAT_COL.INSP_CATEGORY===12, 'got '+MAT_COL.INSP_CATEGORY);
    assert('MAT_WIDTH=13', MAT_WIDTH===13, 'got '+MAT_WIDTH);
    ensureIqcParamLogSheet_();
    assert('IQC_PARAM_LOG exists', !!ss.getSheetByName('IQC_PARAM_LOG'));
    var pc='TIP-WT-'+stamp;
    ss.getSheetByName('MASTERS_Parameters').appendRow([pc,'Test Weight','g',24.5,24,25,'Gravimetric','Weigh on balance','Balance 0.01g','PM/FRM/IQC-02','','TIP_CAT','Y',1]);
    var cp=getCategoryParams('TIP_CAT','IQC');
    assert('getCategoryParams returns seeded param', cp.some(function(p){return p.paramCode===pc;}));
    var got=cp.filter(function(p){return p.paramCode===pc;})[0]||{};
    assert('param carries ccp + guidance', got.ccp===true && !!got.checkBrief && !!got.tools, JSON.stringify(got));
    _tipArchivePrefix_('MASTERS_Parameters',0,pc);

    // ---- Task 2: seeder ----
    var s1=seedInspectionParams(), s2=seedInspectionParams();
    assert('seed run 1 ok', s1&&s1.success, JSON.stringify(s1));
    assert('seed idempotent (run 2 adds 0)', s2&&s2.added===0, JSON.stringify(s2));
    ['HDPE_BOTTLE','LABEL','PAPER','CARTON','BULK'].forEach(function(cat){
      assert(cat+' has params', getCategoryParams(cat,'IQC').length>0);
    });
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
