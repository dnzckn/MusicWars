import './lib/headless-audio.mjs';
const { PROGRESSIONS, degreeToSemitone } = await import('../src/audio/theory.ts');
const fs = await import('node:fs');
const raw = JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const H='_';
const cells=[raw.a,raw.a2,raw.b,raw.b2,raw.a,raw.a2,raw.c,raw.tag];
const tri=(m,d)=>[0,2,4].map(x=>((degreeToSemitone(m,d+x)%12)+12)%12);
function degBar(p,bar){const n=p.reduce((a,s)=>a+s[1],0);let at=((bar%n)+n)%n,d=p[p.length-1][0];
 for(const s of p){ if(at<s[1]){d=s[0];break;} at-=s[1]; } return d;}
const perBar={};
for(const mode of Object.keys(PROGRESSIONS)){
  const p=PROGRESSIONS[mode];
  cells.forEach((cell,bar)=>{
    const ch=tri(mode,degBar(p,bar));
    for(let s=0;s<cell.length;s+=2){
      const d=cell[s]; if(typeof d!=='number') continue;
      const se=degreeToSemitone(mode,d);
      if(ch.includes(((se%12)+12)%12)) continue;
      let nx=null;
      for(let j=s+1;j<cell.length&&nx===null;j++) if(typeof cell[j]==='number') nx=cell[j];
      if(nx===null&&bar+1<cells.length) for(const v of cells[bar+1]){ if(typeof v==='number'){nx=v;break;} }
      const st=nx===null?null:Math.abs(degreeToSemitone(mode,nx)-se);
      if(!(st!==null&&st>=1&&st<=2)){ const k=`bar${bar+1} slot${s} deg${d}`; perBar[k]=(perBar[k]??0)+1; }
    }
  });
}
const rows=Object.entries(perBar).sort((a,b)=>b[1]-a[1]);
console.log('  unresolved clashes by position (summed over 9 modes):');
for(const [k,v] of rows) console.log('    '+k.padEnd(24)+v);
console.log('  total '+rows.reduce((a,r)=>a+r[1],0));
