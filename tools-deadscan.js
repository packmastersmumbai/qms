const fs=require('fs'), path=require('path');
const dir=process.argv[2];
const files=fs.readdirSync(dir).filter(f=>/\.(js|html)$/.test(f) && !/\(1\)|\(2\)/.test(f));
const src={};
files.forEach(f=>{ try{ src[f]=fs.readFileSync(path.join(dir,f),'utf8'); }catch(e){} });
// definitions from production .js only (skip probes/tests)
const prod=Object.keys(src).filter(f=>f.endsWith('.js') && !/^e2e-|^_/.test(f));
const defs=[];
prod.forEach(f=>{ const re=/function\s+([A-Za-z_$][\w$]*)\s*\(/g; let m;
  while((m=re.exec(src[f]))) defs.push({fn:m[1],file:f}); });
// count occurrences across EVERYTHING (incl. html onclick, menu strings, e2e)
const hay=Object.values(src).join('\n');
const dead=[];
defs.forEach(d=>{
  let n=0, i=0;
  while((i=hay.indexOf(d.fn,i))!==-1){
    const before=hay[i-1]||' ', after=hay[i+d.fn.length]||' ';
    if(!/[\w$]/.test(before) && !/[\w$]/.test(after)) n++;
    i+=d.fn.length;
  }
  if(n<=1) dead.push(d);
});
const byFile={};
dead.forEach(d=>{(byFile[d.file]=byFile[d.file]||[]).push(d.fn);});
console.log('production functions: '+defs.length);
console.log('never referenced anywhere (incl. HTML/menu/e2e): '+dead.length+'\n');
Object.keys(byFile).sort((a,b)=>byFile[b].length-byFile[a].length)
 .forEach(f=>console.log(String(byFile[f].length).padStart(3)+'  '+f+'\n     '+byFile[f].join(', ')));
