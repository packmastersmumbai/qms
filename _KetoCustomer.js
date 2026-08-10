// Add the KETO customer row. ?diag=ketocust[&confirm=YES]
// 125 BOM rows already use KETO as the client CODE — the master simply has no
// matching row, so getFGListByClient cannot resolve it and vocabaudit fails.
// Name is set to the code as a PLACEHOLDER: nobody has told me the registered
// customer name, and inventing one would put a wrong name on documents.
function addKetoCustomer(apply){
  var ss=getSpreadsheet(), ws=ss.getSheetByName('MASTERS_Customers');
  if(!ws) return 'MASTERS_Customers missing.';
  var d=ws.getDataRange().getValues();
  for(var i=1;i<d.length;i++)
    if(String(d[i][0]||'').trim().toUpperCase()==='KETO')
      return 'KETO already present (row '+(i+1)+'): name="'+d[i][1]+'" — nothing to do.';
  var out=['Add customer KETO — '+(apply?'LIVE':'DRY RUN')];
  out.push('  code=KETO  name=KETO (PLACEHOLDER — set the real registered name)');
  out.push('  25 FG across 125 BOM rows reference this client.');
  if(!apply) return out.join('\n')+'\nDRY RUN — re-run with &confirm=YES.';
  var row=new Array(Math.max(9,ws.getLastColumn())).fill('');
  row[0]='KETO'; row[1]='KETO'; row[5]='Pharmsil, Symbos, OS-2040, Immunater, NANO-AG, MediSizer, T-FYER, Go-Back, NEMATRON, Disclose';
  ws.appendRow(row);
  return out.join('\n')+'\nADDED. Set the registered Customer Name before printing any document.';
}
