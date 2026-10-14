const fs=require('fs');const dir=process.argv[2];const f=fs.readdirSync(dir).filter(x=>x.endsWith('.cpuprofile')).map(x=>dir+'/'+x).sort((a,b)=>fs.statSync(b).size-fs.statSync(a).size)[0];
const p=JSON.parse(fs.readFileSync(f));const byId={};for(const n of p.nodes)byId[n.id]=n;
const cnt={};for(let i=0;i<p.samples.length;i++)cnt[p.samples[i]]=(cnt[p.samples[i]]||0)+(p.timeDeltas[i]||0);
const self={};for(const id in cnt){const n=byId[id];const k=(n.callFrame.functionName||'(anon)')+' '+(n.callFrame.url||'').split('/').pop()+':'+(n.callFrame.lineNumber+1);self[k]=(self[k]||0)+cnt[id];}
const tot=Object.values(self).reduce((a,b)=>a+b,0);
Object.entries(self).sort((a,b)=>b[1]-a[1]).slice(0,+(process.argv[3]||25)).forEach(([k,v])=>console.log((v/tot*100).toFixed(1).padStart(5)+'%  '+k));
