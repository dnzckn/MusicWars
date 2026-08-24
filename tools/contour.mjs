/*
 * contour — is the melody a LINE, or is it a rhythm part with pitches?
 *
 * This exists because every other melodic check in the suite passed while the
 * tune could only say one thing. `motif` scored 87% shaped economy, `clash`
 * was clean, `leadcheck` confirmed every note carried vibrato — and the score
 * still read as cheap techno, because the whole game contained exactly TWO
 * note lengths and the longest note anywhere was an eighth. No mode, no
 * powerup, no boss phase ever produced a held note. Pitch was being checked
 * from four directions and duration from none.
 *
 * The cause was structural rather than a matter of taste: a `Cell` is
 * `(number | null)[]`, one slot per note, and `renderSlots` turned every slot
 * a line did not play into a rest. A held note was not something the melody
 * had been written without — it was something the representation could not
 * express. `renderSlots` now ties the skeleton through the cell's empty slots
 * (mini-notation `_`), which is what this guards.
 *
 * TWO TRAPS, both of which this tool fell into before it worked:
 *
 * 1. `buildLead` emits the melody on a triangle AND doubles it an octave down
 *    on a sawtooth. Time-sorting the raw events interleaves the two voices, so
 *    every interval reads as an octave leap: the first run reported 100% leaps
 *    and a 29-semitone span identically for all nine modes. Identical numbers
 *    across inputs that should differ mean you are measuring the harness.
 * 2. Summing note durations to get "sound time" double-counts overlaps and
 *    reported NEGATIVE rest. Union the intervals.
 */
import { makeSignals } from './lib/headless-audio.mjs';
const strudel = await import('@strudel/core');
const R='../src';
const { buildLead } = await import(`${R}/audio/layers.ts`);
const { buildChord, PROGRESSIONS } = await import(`${R}/audio/theory.ts`);
function state(over={}){ const mode=over.mode??'aeolian'; return {
  tension:0.6, immediate:0.5, section:'sustain', buildProgress:1, fillBar:false, bar:0,
  tonic:57, mode, chord:buildChord(57,mode,over.degree??0), nextChord:buildChord(57,mode,4),
  chordIndex:0, barInPhrase:over.barInPhrase??0, phrase:over.phrase??0, feel:'boomchick',
  bpm:140, intensity:0.6, brightness:0.5, powerups:{}, enemies:{}, boss:false, bossPhase:0,
  wave:over.wave??1, bombs:0, health:1, grazeRate:0, combo:0, leadRegister:0, movement:null,
  sig:makeSignals(strudel), ...over }; }

const modes = Object.keys(PROGRESSIONS);
const rows=[];
for(const mode of modes){
  const seq=[];
  for(let b=0;b<8;b++){
    /*
     * ONE VOICE, NOT TWO. `buildLead` emits the melody on a triangle and
     * doubles it an octave below on a sawtooth, so a naive time-sort
     * interleaves the two and every interval reads as an octave leap. The
     * first version of this tool did exactly that and reported 100% leaps and
     * a 29-semitone span for all nine modes identically — numbers that are
     * about the doubling, not the tune. Collapse each onset to its top note.
     */
    const evs = buildLead(state({mode,barInPhrase:b,phrase:2})).queryArc(0,1)
      .filter(e=>typeof e.value?.note==='number');
    const byOnset=new Map();
    for(const e of evs){
      const t=Number(e.part.begin);
      const prev=byOnset.get(t);
      if(!prev||e.value.note>prev.n) byOnset.set(t,{n:e.value.note,t:b+t,d:Number(e.part.end)-t});
    }
    for(const k of [...byOnset.keys()].sort((a,b)=>a-b)) seq.push(byOnset.get(k));
  }
  if(!seq.length){ rows.push([mode,0,0,0,0,0,0,0]); continue; }
  const notes=seq.map(s=>s.n);
  const span=Math.max(...notes)-Math.min(...notes);
  const iv=[]; for(let i=1;i<seq.length;i++) iv.push(Math.abs(seq[i].n-seq[i-1].n));
  const steps=iv.filter(x=>x>0&&x<=2).length, thirds=iv.filter(x=>x>=3&&x<=4).length;
  const leaps=iv.filter(x=>x>=5).length, rep=iv.filter(x=>x===0).length;
  const durs=seq.map(s=>+s.d.toFixed(4));
  const uniq=new Set(durs);
  // Union of covered time, not the sum — notes can overlap, and summing gave
  // a NEGATIVE rest figure.
  const iv2=[...seq].sort((a,b)=>a.t-b.t).map(s=>[s.t,s.t+s.d]);
  let sound=0,cur=null;
  for(const [a,b2] of iv2){ if(!cur||a>cur[1]){ if(cur) sound+=cur[1]-cur[0]; cur=[a,b2]; } else cur[1]=Math.max(cur[1],b2); }
  if(cur) sound+=cur[1]-cur[0];
  const longest=Math.max(...durs);
  rows.push([mode, seq.length, span, `${(100*steps/iv.length).toFixed(0)}%`,
    `${(100*thirds/iv.length).toFixed(0)}%`, `${(100*leaps/iv.length).toFixed(0)}%`,
    `${(100*rep/iv.length).toFixed(0)}%`, uniq.size, longest.toFixed(3),
    `${(100*(1-sound/8)).toFixed(0)}%`]);
}
const H=['mode','notes','span','step','3rd','leap','rep','durs','longest','rest'];
const w=H.map((h,i)=>Math.max(h.length,...rows.map(r=>String(r[i]).length)));
console.log('\ncontour — 8 bars of lead per mode\n');
console.log('  '+H.map((h,i)=>h.padEnd(w[i])).join('  '));
console.log('  '+w.map(x=>'-'.repeat(x)).join('  '));
for(const r of rows) console.log('  '+r.map((c,i)=>String(c).padEnd(w[i])).join('  '));
const allSpan=rows.map(r=>r[2]); const allLeap=rows.map(r=>parseInt(r[5]));
console.log(`\n  span: min ${Math.min(...allSpan)}  max ${Math.max(...allSpan)} semitones`);
console.log(`  leaps>=5st: min ${Math.min(...allLeap)}%  max ${Math.max(...allLeap)}%`);
console.log(`  distinct note-lengths per mode: ${rows.map(r=>r[7]).join(' ')}`);

/** Fewer than this and the melody is a grid pattern, not a rhythm. */
const MIN_LENGTHS = 3;
/** An eighth. At or below it, nothing in the tune is held. */
const MIN_LONGEST = 0.125;

const fails = [];
for (const r of rows) {
  const [mode, notes, , , , , , durs, longest] = r;
  if (!notes) fails.push(`${mode} produced NO notes — is the harness parsing mini-notation? (see miniAllStrings)`);
  else if (durs < MIN_LENGTHS) fails.push(`${mode} has only ${durs} distinct note-length(s) — the tune can only say one thing`);
  if (notes && Number(longest) <= MIN_LONGEST) fails.push(`${mode} longest note is ${longest} of a bar — nothing is held anywhere`);
}
console.log('');
if (fails.length) {
  for (const m of fails) console.log(`  FAIL  ${m}`);
  console.log('\n  A melody that only stabs is a rhythm part. See renderSlots in');
  console.log('  src/audio/layers.ts — the skeleton must tie through empty slots.');
  process.exit(1);
}
console.log('  ok  the melody holds as well as stabs');
console.log('\n  Baseline 2026-08-22: 4 lengths, longest 0.500, rest 45%.');
console.log('  Before the skeleton could tie: 2 lengths, longest 0.125, rest 53%.');
console.log('  Briefly 5/0.500/33%, when the skeleton tied through EVERY empty slot —');
console.log('  that also tied over the arp\'s answering slots and cost 11% masking.');
console.log('  It now ties only through gaps of 2+ slots; see renderSlots.');
