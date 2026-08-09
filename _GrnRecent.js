function grnRecent() {
  var ws = getSpreadsheet().getSheetByName('GRN_LOG');
  if (!ws || ws.getLastRow() < 2) return 'GRN_LOG empty';
  var n = ws.getLastRow(), start = Math.max(2, n-11);
  var d = ws.getRange(start,1,n-start+1,18).getValues(), out=[];
  out.push('GRN_LOG rows: '+(n-1));
  d.forEach(function(r,i){
    out.push((start+i)+'  '+String(r[0]).padEnd(18)+'  '+
      (r[1] instanceof Date ? Utilities.formatDate(r[1],'Asia/Kolkata','dd-MMM HH:mm') : String(r[1])).padEnd(14)+
      '  '+String(r[3]||'').slice(0,18).padEnd(19)+'  '+String(r[6]||'').slice(0,14).padEnd(15)+
      '  by='+String(r[16]||''));
  });
  return out.join('\n');
}
