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
    assert('MAT_WIDTH=15', MAT_WIDTH===15, 'got '+MAT_WIDTH);
    // Asserting the CONSTANTS alone is what let this bug hide: the live sheet had only
    // 12 columns, so MAT_COL.INSP_CATEGORY=12 pointed past its end and no category could
    // ever be stored — yet this file still passed 18/18. Check the SHEET, not just the
    // contract, and check the header actually says what the contract believes.
    var matWs = ss.getSheetByName('MASTERS_Materials');
    assert('MASTERS_Materials is >= MAT_WIDTH cols',
           matWs && matWs.getLastColumn() >= MAT_WIDTH,
           'sheet has ' + (matWs ? matWs.getLastColumn() : 'no sheet') + ' cols, need ' + MAT_WIDTH);
    var matHdr = matWs.getRange(1, 1, 1, matWs.getLastColumn()).getValues()[0];
    assert('col 12 header is Inspection Category',
           String(matHdr[MAT_COL.INSP_CATEGORY] || '').trim().toLowerCase() === 'inspection category',
           'got "' + matHdr[MAT_COL.INSP_CATEGORY] + '"');
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

    // ---- Task 3: IQC resolves by category + writes IQC_PARAM_LOG + fallback ----
    var mCode='TIP-BTL-'+stamp;
    var mrow=new Array(MAT_WIDTH).fill(''); mrow[0]=mCode; mrow[1]='Test bottle'; mrow[2]='NOS'; mrow[3]='RM'; mrow[MAT_COL.INSP_CATEGORY]='HDPE_BOTTLE';
    ss.getSheetByName('MASTERS_Materials').appendRow(mrow);
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

    // ---- Task 4: IPQC category layer ----
    var fg7='TIP-FG-'+stamp; var r7=new Array(MAT_WIDTH).fill(''); r7[0]=fg7; r7[1]='Test FG'; r7[2]='NOS'; r7[3]='FG'; r7[MAT_COL.INSP_CATEGORY]='HDPE_BOTTLE';
    ss.getSheetByName('MASTERS_Materials').appendRow(r7);
    var ip=getIPQCParams(fg7);
    assert('IPQC returns category params for FG', ip&&ip.params&&ip.params.length>0, JSON.stringify(ip&&(ip.warning||('n='+(ip.params&&ip.params.length)))));
    if (ip&&ip.params&&ip.params.length) assert('IPQC param carries guidance', ('checkBrief' in ip.params[0])||('tools' in ip.params[0]));
    _tipArchivePrefix_('MASTERS_Materials',0,fg7);
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
