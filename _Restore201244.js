// Restore MASTERS_Materials row 108 from the 2026-08-04 backup.
// Row 108 held 201244-000000 "Label Bottle Diesel 50ml (Front+Back)" and was
// overwritten with a duplicate of row 107 (201243-000000) some time after that
// backup was taken. Verified by diffing live vs BAK (?diag=dupprobe): rows 106
// and 109 still match, only 108 diverged — a paste over one row, not a shift.
// The BOM still references 201244-000000, which is how vocabaudit caught it.
function restore201244(apply){
  var ss=getSpreadsheet();
  var ws=ss.getSheetByName('MASTERS_Materials');
  var bak=ss.getSheetByName('BAK_MASTERS_Materials_20260804-1157');
  if(!bak) return 'ABORT: backup tab BAK_MASTERS_Materials_20260804-1157 not found.';
  var live=ws.getRange(108,1,1,MAT_WIDTH).getValues()[0];
  var orig=bak.getRange(108,1,1,MAT_WIDTH).getValues()[0];
  var out=['Restore MASTERS_Materials row 108 — '+(apply?'LIVE':'DRY RUN')];
  out.push('');
  out.push('  live: '+String(live[0])+'  '+String(live[1]).slice(0,44));
  out.push('  from: '+String(orig[0])+'  '+String(orig[1]).slice(0,44));
  out.push('');
  if(String(orig[0]).trim()!=='201244-000000')
    return out.join('\n')+'\nABORT: backup row 108 is not 201244-000000. Do not write.';
  if(String(live[0]).trim()==='201244-000000')
    return out.join('\n')+'\nAlready restored — nothing to do.';
  if(!apply) return out.join('\n')+'\nDRY RUN — re-run with &confirm=YES.';
  ws.getRange(108,1,1,MAT_WIDTH).setValues([orig]);
  return out.join('\n')+'\nRESTORED row 108 from backup ('+MAT_WIDTH+' cols).';
}
