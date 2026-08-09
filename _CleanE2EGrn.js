function cleanE2EGrn(apply){
  var ws=getSpreadsheet().getSheetByName('GRN_LOG');
  var d=ws.getDataRange().getValues(), hits=[];
  for(var i=1;i<d.length;i++){
    var bt=String(d[i][8]||'');
    if(/^E2E-(REALSAVE|ERRTRACE|WATCHDOG|TIMING|VERIFY|CONFIRM)/.test(bt)) hits.push({row:i+1,doc:String(d[i][0]),batch:bt});
  }
  var out=['probe GRN rows: '+hits.length];
  hits.forEach(function(h){ out.push('  row '+h.row+'  '+h.doc+'  '+h.batch); });
  if(!apply){ out.push('DRY RUN — add &confirm=YES'); return out.join('\n'); }
  for(var j=hits.length-1;j>=0;j--) ws.deleteRow(hits[j].row);
  out.push('DELETED '+hits.length+' rows.');
  return out.join('\n');
}
