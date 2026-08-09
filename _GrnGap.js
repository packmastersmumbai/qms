function grnGap(){
  var ws=getSpreadsheet().getSheetByName('GRN_LOG');
  var d=ws.getRange(2,1,ws.getLastRow()-1,1).getValues();
  var seen={}; d.forEach(function(r){var m=String(r[0]||'').match(/PM\/GRN\/2026-(\d+)/); if(m) seen[parseInt(m[1],10)]=1;});
  var nums=Object.keys(seen).map(Number).sort(function(a,b){return a-b;});
  var gaps=[]; for(var i=nums[0];i<=nums[nums.length-1];i++) if(!seen[i]) gaps.push(i);
  var cfg=getSpreadsheet().getSheetByName('CONFIG'), ctr='?';
  if(cfg){var cd=cfg.getDataRange().getValues();for(var j=0;j<cd.length;j++) if(String(cd[j][0])==='grn_counter') ctr=cd[j][1];}
  return 'range '+nums[0]+'-'+nums[nums.length-1]+'  count='+nums.length+
    '\nMISSING numbers: '+(gaps.length?gaps.join(', '):'none')+
    '\nCONFIG grn_counter = '+ctr;
}
