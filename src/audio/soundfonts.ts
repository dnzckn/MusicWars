/**
 * REAL INSTRUMENTS, and the fallback that means a failure is never silence.
 *
 * Every pitched voice in this game was a bare oscillator — sine, sawtooth,
 * triangle, pulse, supersaw — for the project's whole life, and the owner's
 * standing complaint after six rounds of music work is "too much synth too much
 * bing bong". The cause was not the writing. `git show e8d61bd` rewrote the
 * envelopes, the note lengths and the registers, measured every one of them,
 * and the result still sounded synthetic, because an envelope cannot change
 * what a waveform IS. The reference corpus (eefano/strudel-songs-collection, 60
 * songs) answers the same question with General MIDI soundfonts:
 * `gm_electric_bass_finger` in 12 of them, `gm_overdriven_guitar` in 7,
 * `gm_electric_guitar_clean` in 6, `gm_choir_aahs` in 6, `gm_synth_strings_1`
 * in 4, `gm_oboe` in 3. This project had none of them, because
 * `@strudel/soundfonts` was never installed.
 *
 * ---------------------------------------------------------------------------
 * WHY THE IMPORT IS A DEEP ONE, and it is not a workaround
 * ---------------------------------------------------------------------------
 *
 * `import ... from '@strudel/soundfonts'` DOES NOT LOAD UNDER VITE. The package
 * entry is `dist/index.mjs`, which imports `sfumato`, which imports
 * `soundfont2`, whose `module` field points at `lib/SoundFont2.js` — a WEBPACK
 * UMD BUNDLE. Served to the browser as an ES module it declares no exports at
 * all (its own header tests `typeof exports`, finds nothing, and assigns
 * `window.SoundFont2` instead), so the browser reports:
 *
 *     SyntaxError: The requested module '/node_modules/sfumato/node_modules/
 *     soundfont2/lib/SoundFont2.js' does not provide an export named 'SoundFont2'
 *
 * The fix is not an alias and not an `optimizeDeps.include`, both of which
 * would drag a CommonJS interop shim into the bundle to serve code we do not
 * run. `sfumato` exists to parse USER-SUPPLIED .sf2 FILES at runtime — that is
 * `loadSoundfont()` and `Pattern.soundfont()`, neither of which this game uses.
 * The General MIDI path is `fontloader.mjs` and it imports only `@strudel/core`
 * and `@strudel/webaudio`. Importing it directly is therefore the smaller and
 * more honest dependency, not a dodge: verified through the dev server, which
 * serves `dist/index.mjs` as 536 KB reaching for a broken UMD file and
 * `fontloader.mjs` as 33 KB reaching for nothing that is not already loaded.
 *
 * The package declares no `exports` map, so the subpath is a supported import
 * rather than something that only happens to resolve today.
 *
 * ---------------------------------------------------------------------------
 * THE NETWORK COST, WHICH IS REAL AND IS PAID AT RUNTIME
 * ---------------------------------------------------------------------------
 *
 * `fontloader.mjs` fetches each instrument from
 * `https://felixroos.github.io/webaudiofontdata/sound/<file>.js` the first time
 * a note needs it. That is a network dependency, and the README used to claim
 * "There are no audio assets in this repository — not one sample, not one
 * loop." The repository half of that is still true and the browser half is not;
 * the README says so now.
 *
 * MEASURED over the wire by `tools/fontcheck.mjs`, which reads the socket
 * through Playwright rather than the page's own Resource Timing (that reports
 * zero for a cross-origin response with no `Timing-Allow-Origin`, which GitHub
 * Pages does not send).
 *
 * With ALL SEVEN roles enabled, which is what the first build shipped and what
 * the figures in the table below were taken on: six responses, 342,972 body
 * bytes gzipped (`leadTune` and `leadDecor` share the oboe). Cold that settled
 * in 3,978 ms; with DNS and TLS warm, 873 ms — first playable note of each
 * instrument at 484-521 ms, whole warm range resident by 645-873 ms.
 *
 * With only the BASS enabled, which is the current configuration and the reason
 * is in `SAMPLED_ROLES`: ONE response, 9,694 bytes. `TOTAL_WIRE_BYTES` is the
 * enabled cost and `TABLE_WIRE_BYTES` is what the whole table would cost, so
 * neither number can be quoted for the other by accident.
 *
 * `setSoundfontUrl` makes self-hosting a one-line change and `BASE_URLS` is
 * already a list, so vendoring is a follow-up and not a rewrite.
 *
 * AND THE PART THAT IS NOT ABOUT BYTES: `fontloader.mjs:31` parses each
 * response with a DIRECT `eval`. The `.js` files are `var _tone_x = {...}`
 * object literals and it splits on `'={'` and evaluates the rest. Rolldown says
 * so out loud on every build ("Use of direct `eval` function is strongly
 * discouraged"). Read plainly: this game executes JavaScript fetched from a
 * third-party GitHub Pages site at runtime, on the player's machine.
 *
 * That is upstream's design and not something a caller can opt out of — there
 * is no non-`eval` entry point. It is stated here rather than left to be
 * discovered because it is the strongest argument for self-hosting that exists,
 * and a stronger one than the byte count: vendoring the six files makes the
 * code that runs code that shipped in this repository. Nothing here decides
 * that; the owner should, with this on the page.
 *
 * ---------------------------------------------------------------------------
 * THE FALLBACK IS THE POINT OF THIS FILE
 * ---------------------------------------------------------------------------
 *
 * A LANE THAT CANNOT LOAD ITS INSTRUMENT PLAYS ITS OSCILLATOR. Not silence, and
 * not an exception. Three superdough behaviours make this mandatory rather than
 * defensive, all read out of `node_modules/superdough@1.3.0`:
 *
 *   1. `superdough.mjs:577` — `throw new Error('sound ${s} not found! Is it
 *      loaded?')`. A `gm_*` hap scheduled before `registerSoundfonts()` has run
 *      is an exception per note, not a quiet miss.
 *   2. `superdough.mjs:581` — after awaiting the sound handler, `if
 *      (ac.currentTime > t) return`. The handler awaits a fetch on the first
 *      note of each font, the scheduler runs ~0.2 s of lookahead, and a fetch
 *      is far longer than that: EVERY note of a lane is dropped, silently, for
 *      as long as its font is loading.
 *   3. `fontloader.mjs` caches the load PROMISE, so a rejection is cached too
 *      and a lane that failed once fails for the life of the page.
 *
 * So the state machine below never lets a `gm_*` name reach the scheduler
 * before its samples are decoded and in memory. Until then — and forever, if
 * the network is not there — the lane plays exactly what it played before this
 * file existed. Verified offline with Playwright's `page.route` aborting every
 * request to the font host: `tools/fontcheck.mjs` measures the state as
 * `unavailable` in about 200 ms, every role back on its oscillator, and the
 * game still making sound.
 *
 * ---------------------------------------------------------------------------
 * WHY NODE AND THE BROWSER START IN DIFFERENT STATES
 * ---------------------------------------------------------------------------
 *
 * The gates query the builders in Node with no browser and no network
 * (`tools/lib/headless-audio.mjs`). If this module defaulted to the fallback,
 * every gate would measure the oscillator score — the thing being replaced —
 * and report green on a code path the player never hears. That is exactly the
 * failure mode `AGENTS.md` §3 calls "a gate that has never been seen red".
 *
 * So the WRITTEN score is the soundfont score, and Node reads it as written.
 * The browser is the only place that downgrades, and it downgrades from
 * measurement: it starts at `loading` (oscillators, no exceptions possible),
 * and a role is promoted only once its samples are decoded. `tools/fontlanes.mjs`
 * asserts both directions.
 */

import type { Pattern } from '@strudel/core';

// ---------------------------------------------------------------------------
// the table
// ---------------------------------------------------------------------------

/**
 * A voice that can be a real instrument.
 *
 * These are ROLES, not stems: `leadTune`, `leadDecor` and the octave-down body
 * are three layers of one stem and want different things, and `pad`, `colour`
 * and `stab` are three instruments inside `chords`.
 */
export type VoiceRole = 'bass' | 'pad' | 'colour' | 'stab' | 'motor' | 'leadTune' | 'leadDecor';

/** The oscillator a role falls back to. These are the score as it shipped. */
export interface OscVoice {
  readonly s: string;
  readonly pw?: number;
  readonly unison?: number;
}

export interface Instrument {
  /** The General MIDI name superdough registers, e.g. `gm_oboe`. */
  readonly font: string;
  /**
   * WHICH SAMPLE SET, because `gm_*` is a list and not a sound.
   *
   * superdough resolves `n` through `getSoundIndex(value.n, fonts.length)`, so
   * this is the index into `gm.mjs`'s array. The variants differ by more than
   * taste: `gm_choir_aahs` n=1 loops ONE of its three zones and n=0 loops all
   * five, which on a sustained lane is the difference between a chord and a
   * chord that stops halfway through.
   */
  readonly n: number;
  /**
   * The file name expected at `n`, asserted at load.
   *
   * `AGENTS.md` §3, "a tool holding its own copy of a constant will lie the day
   * it moves": every figure in this table was measured against THIS file, and
   * if a package update reorders the array the numbers stop describing what
   * loads. Mismatch is reported rather than guessed around.
   */
  readonly variant: string;
  /** Transferred bytes, gzipped, measured against GitHub Pages. */
  readonly wireBytes: number;
  /** Sample zones in the font. More zones is less pitch-stretching. */
  readonly zones: number;
  /** MIDI range to decode before the lane is promoted. See `warmRange`. */
  readonly warm: readonly [number, number];
  readonly osc: OscVoice;
  /** Why this instrument, in one line. The long form is in the comments. */
  readonly why: string;
}

/*
 * ---------------------------------------------------------------------------
 * THE CHOICES, ONE LANE AT A TIME
 * ---------------------------------------------------------------------------
 *
 * READ `SAMPLED_ROLES` FIRST. Six of the seven entries below are currently
 * SWITCHED OFF and their lanes emit the oscillator in the `osc` field; only the
 * bass plays its instrument. The reasoning for each choice is kept in full
 * because it is what a re-enable would be argued from, but nothing below should
 * be read as a description of what the game sounds like today.
 *
 * Chosen on what the lane DOES. Every `wireBytes` and `zones` figure below was
 * measured by fetching the actual file, not read off a page: `zones` is
 * `preset.length` after `fontloader`'s own `eval` of the response, and
 * `wireBytes` is the `content-length` GitHub Pages serves, which is gzipped.
 *
 * Two selection criteria beyond the instrument name, both of which changed a
 * choice:
 *
 *   ZONE COUNT. A font with two zones stretches two recordings across the whole
 *   keyboard by playback rate, which is audible as a chipmunk at the top and a
 *   growl at the bottom. `gm_electric_guitar_clean` n=0 (the default, Aspirin)
 *   is TWO zones over MIDI 12-127; n=1 (Chaos) is SIX zones at 44.1 kHz and is
 *   also a fifth of the size. The default was the wrong choice on both axes.
 *
 *   LOOPING, but only where the lane sustains. `gm_choir_aahs` n=1 is smaller
 *   and loops one zone of three; on the colour lane, which holds whole notes,
 *   two thirds of the chord would decay to nothing mid-bar.
 */
export const INSTRUMENTS: Record<VoiceRole, Instrument> = {
  /*
   * THE BASS — MIDI 38-57, 87-220 Hz.
   *
   * The corpus's most-used font by a distance: 12 songs of 60. It is also the
   * least arguable substitution in this table, because the part is already
   * written as a bass guitar part — `buildBass`'s default figure is the
   * Castlevania octave pedal, eighth notes, octave-displaced, walking onto the
   * next chord. That is a bass GUITAR idiom and it was being played on a
   * sawtooth through a Moog ladder.
   *
   * WHAT STAYS A SYNTH, and it is two things rather than an oversight. The
   * `chase` feel's 808 is `.s('sine')` with `penv(-7).pattack(0.11)` — a pitch
   * dropping a fifth into the note, which is a drum machine and not an
   * instrument, and a sampled bass cannot do it. And `wobble.ts` is a filter
   * being played as the instrument; there is no sample of that.
   */
  bass: {
    font: 'gm_electric_bass_finger',
    n: 0,
    variant: '0330_JCLive_sf2_file',
    wireBytes: 9694,
    zones: 5,
    warm: [26, 62],
    osc: { s: 'sawtooth' },
    why: 'the part is already a bass-guitar part; 12 of 60 corpus songs use this font',
  },

  /*
   * THE BED — MIDI 46-58, 116-233 Hz, a sustained dyad under everything.
   *
   * A three-voice supersaw at 14 cents is a trance pad, which is a genre this
   * score has been asked five times to stop being. The corpus reaches for
   * `gm_synth_strings_1` for the same job in 4 songs. At 116-233 Hz a string
   * section is violas and cellos, which is where a bed belongs.
   *
   * The name says "synth strings" and that is deliberate rather than a
   * compromise: it is a sampled string ENSEMBLE, so it arrives with the slow
   * swell and the internal beating that `.detune(0.14).spread(0.7)` and three
   * separate vibrato rates were all approximations of. Those controls are
   * supersaw-only (`AGENTS.md` §4) and are dropped when the font is playing —
   * they would be inert, and `session` counts inert controls.
   */
  pad: {
    font: 'gm_synth_strings_1',
    n: 0,
    variant: '0500_Aspirin_sf2_file',
    wireBytes: 24861,
    zones: 5,
    warm: [40, 64],
    osc: { s: 'supersaw', unison: 3 },
    why: 'a sustained bed at 116-233 Hz is a low string section; 4 corpus songs',
  },

  /*
   * THE UPPER STRUCTURE — MIDI 78-90, 740-1480 Hz, the 7th and the 9th held.
   *
   * `e8d61bd` names this lane as the FIRST SUSPECT if the score sounds harsh:
   * it became a two-voice supersaw behind an unchanged 2600-6500 Hz lowpass,
   * "+5-8 dB of upper-partial energy above the tune", and the commit says so in
   * as many words while admitting nothing was heard. A choir is the opposite
   * object — the corpus's other pad choice (6 songs), and at 740-1480 Hz it is
   * a soprano section, singing the two notes that colour the chord.
   *
   * It is also the one lane where the SUSTAIN is the whole function, which is
   * why n=0 and not the smaller n=1: five looped zones against one of three.
   */
  colour: {
    font: 'gm_choir_aahs',
    n: 0,
    variant: '0520_Aspirin_sf2_file',
    wireBytes: 71913,
    zones: 5,
    warm: [72, 96],
    osc: { s: 'supersaw', unison: 2 },
    why: 'held chord extensions in soprano register; the harshest lane on the old roster',
  },

  /*
   * THE COMPING STAB — MIDI 68-80, 415-830 Hz, sixteenths on a grid.
   *
   * THE CLEAREST "BING BONG" IN THE SCORE. Short, pitched, percussive,
   * synthetic — the owner's four words, and this lane is all four by
   * construction. It has already been re-voiced twice (a pulse, then a saw
   * through a resonant filter envelope) without ceasing to be a synthesiser
   * making a short pitched noise.
   *
   * A clean electric guitar comping sixteenths in the mid register is not an
   * approximation of this part, it IS this part: 6 corpus songs, and the
   * rhythm-guitar idiom is where the figure came from. The resonant filter
   * envelope (`lpenv(1.1) lpattack(0.006) lpdecay(0.16)`) stays — it is a
   * filter on the output, not a property of the source, and on a plucked sample
   * it reads as pick attack.
   *
   * THE VARIANT WAS CHOSEN WRONG THE FIRST TIME AND THE MEASUREMENT CAUGHT IT,
   * which is the only reason `tools/fontcheck.mjs --spectrum` exists.
   *
   * n=1 (Chaos) was picked off the catalogue: six zones at 44.1 kHz for 8955
   * bytes, better coverage than the default at a fifth of the size. Decoded and
   * analysed at five pitches across 68-80 it is **86.7% of its energy above
   * 2 kHz, out of a 53 ms sample**. Fifty-three milliseconds is not a recording
   * of a guitar, it is a wavetable, and 42.5% of it sits in the 8 kHz band. It
   * would have replaced a sawtooth measuring 25.3% up there with something over
   * three times fizzier, on a sixteenth-note lane, in a score whose one recorded
   * human complaint about frequency is "too much high pitch synth always
   * playing, its taxing on the ears".
   *
   *     variant                   >2 kHz   sample     wire
   *     n=0 Aspirin (this)         11.7%   2196 ms   35791
   *     n=1 Chaos                  86.7%     53 ms    8955
   *     n=3 GeneralUserGS          43.6%   1442 ms  119768
   *     the sawtooth it replaces   25.3%        -        0
   *
   * n=0 has TWO zones over MIDI 12-127, which is real stretching and is the
   * price paid: the figures above are measured WITH that stretching, across the
   * lane's own window, so it is a known cost rather than an unknown one.
   */
  stab: {
    font: 'gm_electric_guitar_clean',
    n: 0,
    variant: '0270_Aspirin_sf2_file',
    wireBytes: 35791,
    zones: 2,
    warm: [62, 86],
    osc: { s: 'sawtooth' },
    why: 'sixteenth-note comping in the mid register is rhythm guitar; 6 corpus songs',
  },

  /*
   * THE MOTOR — MIDI 57-69, 220-440 Hz, the continuous inner voice.
   *
   * THE MOST-HEARD SOUND IN THE GAME: 92,928 haps, under every bar of every
   * wave. It is also the lane two separate owner reports called a
   * "clavichord" — a static narrow pulse repeating eight to sixteen times a bar
   * is, as an object, a harpsichord jack. `e8d61bd` answered that with a slow
   * pulse-width sweep, which changes the timbre over five bars without changing
   * what the timbre IS.
   *
   * 220-440 Hz, on the beat, continuous, palm-mutable: that is a rhythm guitar
   * chugging, and `gm_overdriven_guitar` is the corpus's choice in 7 songs. The
   * biggest font in this table (145 KB) and the one it is worth spending on,
   * because n=1 has THIRTEEN zones against the default's stretch — the lane
   * that plays most gets the best-sampled font.
   *
   * `pwrate`/`pwsweep` are pulse-only and are dropped when the font plays.
   */
  motor: {
    font: 'gm_overdriven_guitar',
    n: 1,
    variant: '0290_Aspirin_sf2_file',
    wireBytes: 144997,
    zones: 13,
    warm: [50, 76],
    osc: { s: 'pulse', pw: 0.34 },
    why: 'a continuous chug at 220-440 Hz is a rhythm guitar; 7 corpus songs, 13 zones',
  },

  /*
   * THE TUNE — MIDI 69-83, 440-988 Hz.
   *
   * `buildLead`'s own comment says the melody "has to stay legible over a busy
   * stage", and then plays it on a triangle, which is the least penetrating
   * waveform there is: its harmonics fall as 1/k squared, so at 440-830 Hz the
   * 3rd partial is 19 dB down and the 5th is 28 dB down before any filter. A
   * double reed is the orchestra's answer to exactly that brief — an oboe is
   * the instrument an orchestra tunes to because it cuts through everything —
   * and it is the corpus's lead choice in 3 songs.
   *
   * WHAT THIS DOES NOT CHANGE, and both are deliberate; see `buildLead`:
   * the octave-down BODY stays a sawtooth behind a 500-1400 Hz lowpass, and the
   * boss stack stays sawtooth. A body is a fundamental and two partials and has
   * no business having a character of its own.
   */
  leadTune: {
    font: 'gm_oboe',
    n: 0,
    variant: '0680_JCLive_sf2_file',
    wireBytes: 80911,
    zones: 7,
    /*
     * 66-104 and not the lane's 69-83. The tune is transposed by `sig.register`
     * (0 or +12), the descant sits a sixth above it, and both compose — so the
     * highest note this instrument can be asked for is 83 + 9 + 12. A pitch
     * outside the warm range is not silent, but its FIRST hap is dropped
     * (`superdough.mjs:581`) while it decodes, which on a melody is a missing
     * note. Twelve extra pitches cost about 120 ms of decode, once.
     */
    warm: [66, 104],
    osc: { s: 'triangle' },
    why: 'a double reed is the most penetrating melodic voice at 440-988 Hz; 3 corpus songs',
  },

  /*
   * THE TUNE'S DECORATION — the filigree and the ornament, same window as the
   * tune, and THIS ONE WAS DECIDED BY MEASUREMENT AGAINST MY OWN FIRST ANSWER.
   *
   * `buildLead` keeps these two lines on a 25%-duty pulse for a measured
   * reason: the mix's air above 2 kHz is 57% this lane, and the pulse is what
   * put it there ("you cannot filter in what the source never made"). The first
   * draft of this pass therefore left them alone and wrote a comment saying the
   * change was deferred until something could measure it, because trading a
   * measured property for a plausible one is the trade this project exists to
   * refuse.
   *
   * `tools/fontcheck.mjs --spectrum` then measured it, averaged over five
   * pitches across the tune's own window, MIDI 69-83:
   *
   *     source                    500     1k     2k     4k     8k   | >2 kHz
   *     gm_oboe                   3.7   58.3   34.7    3.4    0.0   |  38.1%
   *     pulse pw0.5 (theory)     32.9   39.7   16.2    5.9    3.7   |  27.4%
   *
   * The oboe is BRIGHTER than the pulse it replaces, by half again. The
   * objection is gone, so the arranger's answer wins: three lines of one
   * melody are one instrument, and a synthesiser doubling a reed at the unison
   * is the "bing bong" this whole pass is about.
   *
   * A SINGLE-PITCH READING WOULD HAVE SAID THE OPPOSITE, and that is worth
   * recording. At MIDI 76 the oboe reads 2.2% above 2 kHz and at MIDI 79 it
   * reads 97.6%: almost all of its energy is in its SECOND harmonic, and the
   * 2 kHz band edge at 1414 Hz falls between that harmonic's frequency at those
   * two pitches. One pitch measures where the band edges are, not what the
   * instrument is.
   *
   * It shares `gm_oboe` with `leadTune`, so it costs no bytes; `TOTAL_WIRE_BYTES`
   * counts distinct files. Its FALLBACK is the pulse, exactly as shipped, so a
   * player whose fonts do not load hears the score that was measured.
   *
   * NOT MEASURED, and the first thing to listen for: three lines of the SAME
   * SAMPLE have deterministic phase, where three oscillator voices do not
   * (superdough gives supersaw a random initial phase). Where the filigree and
   * the ornament land on the same pitch at the same onset they will sum
   * coherently instead of beating. Nothing here can hear that.
   */
  leadDecor: {
    font: 'gm_oboe',
    n: 0,
    variant: '0680_JCLive_sf2_file',
    wireBytes: 0, // shares the file with `leadTune`; counted once, there
    zones: 7,
    warm: [66, 104],
    osc: { s: 'pulse', pw: 0.5 },
    why: 'the tune and its decoration are one instrument; measured brighter than the pulse it replaces',
  },
};

export const VOICE_ROLES = Object.keys(INSTRUMENTS) as VoiceRole[];

/*
 * WHICH LANES MAY USE A SAMPLED INSTRUMENT AT ALL.
 *
 * Reported from play, on the first build that shipped these: "sounds so whack
 * like carnival, its got beats in the background, then a foreground melody offa
 * funny instrument it's just no".
 *
 * That is an exact diagnosis and the fault is in the CHOICE, not the machinery.
 * The lanes were mapped from what the corpus uses most — oboe, choir, two
 * guitars, a string section — and those counts come from songs that are covers
 * of pop and game tunes. This game's stated references are Aphex Twin and the
 * electronic end of that corpus, and both are ENTIRELY SYNTHESIS. A reedy solo
 * oboe carrying a melody over a drum pattern is not a neutral upgrade from a
 * triangle wave; it is circus instrumentation, which is precisely what was
 * heard.
 *
 * So the melodic and harmonic lanes go back to synthesis. What stays sampled is
 * the one role where a sample is unambiguously better than an oscillator and
 * carries no orchestral connotation: the BASS, where `gm_electric_bass_finger`
 * is a plucked string with a real attack transient that a sawtooth through a
 * ladder cannot fake, and which the corpus reaches for in 12 of 60 songs
 * including its electronic ones.
 *
 * The loader, the fallback, the state machine and the per-lane table are all
 * kept intact — none of that was wrong, and re-enabling a lane is one entry in
 * this set. What was wrong was believing that "not an oscillator" was the goal.
 * The goal is that it suits THIS game, and for six of these seven lanes a
 * well-made synth voice does and a sampled acoustic one does not.
 *
 * EXPORTED, and read by `tools/fontlanes.mjs` and by the loader below, because
 * three things have to agree about it and a second copy would be the failure
 * `AGENTS.md` §3 names. In particular the loader must NOT fetch a font no lane
 * plays: with only the bass enabled, warming all seven roles would spend 333 KB
 * and three quarters of a second of the player's connection on instruments that
 * are never scheduled.
 */
export const SAMPLED_ROLES: ReadonlySet<VoiceRole> = new Set<VoiceRole>(['bass']);

/** The roles that will actually be fetched. `VOICE_ROLES` is the whole table. */
export const ENABLED_ROLES = VOICE_ROLES.filter((r) => SAMPLED_ROLES.has(r));

/**
 * Transferred bytes, over DISTINCT FILES rather than roles: `leadTune` and
 * `leadDecor` are two lanes playing one instrument and `fontloader` caches per
 * font, so the oboe would cross the wire once. Summing per role overstates it.
 */
const wireOver = (roles: readonly VoiceRole[]): number => {
  const seen = new Set<string>();
  let total = 0;
  for (const r of roles) {
    const i = INSTRUMENTS[r];
    if (seen.has(i.variant)) continue;
    seen.add(i.variant);
    total += i.wireBytes;
  }
  return total;
};

/** What the player actually downloads: the ENABLED roles only. */
export const TOTAL_WIRE_BYTES = wireOver(ENABLED_ROLES);
/** What the whole table would cost if every role were enabled. */
export const TABLE_WIRE_BYTES = wireOver(VOICE_ROLES);

/*
 * ---------------------------------------------------------------------------
 * LANES THAT KEEP THEIR OSCILLATOR, and the reason for each
 * ---------------------------------------------------------------------------
 *
 * "Replaced everything" is as thoughtless as "replaced nothing", so these are
 * decisions rather than leftovers. None of them is in `INSTRUMENTS`, which is
 * the whole statement.
 *
 * SUB (`buildSub`, MIDI 26-45, 41-110 Hz) — a sub IS a sine. Below about 80 Hz
 *   a sampled instrument's zone is one recording stretched down by playback
 *   rate, which is where every GM font is at its worst, and the lane's job is
 *   one partial at one frequency. There is nothing to sample.
 *
 * KICK, CLAP, HATS, IMPACT, METAL (`kit.ts`) — synthesised percussion is what
 *   the genre actually uses; a sampled 909 is a sample of a synthesiser. The
 *   kick's octave and envelope are also measured targets (`g1`, +12.7 dB in the
 *   63 Hz band) that a sample would replace with someone else's.
 *
 * FX (`buildFx`) — risers, sweeps and noise washes. These are not instruments
 *   and there is no General MIDI program for them.
 *
 * WOBBLE (`wobble.ts`) — the dubstep bass is a FILTER being played. The
 *   instrument is the modulation, not the source.
 *
 * ARP (MIDI 87-99, 1245-2489 Hz) — the one substitution that was considered
 *   and REJECTED on measurement. Every sampled candidate in that register is a
 *   struck metal bar: `gm_celesta`, `gm_vibraphone`, `gm_glockenspiel`,
 *   `gm_music_box`. Short, pitched, percussive — the owner's complaint,
 *   installed rather than removed. The flute-family alternative is
 *   `gm_piccolo`, whose usable variant is 54 zones and 523 KB, more than the
 *   entire rest of this table, for the quietest pitched lane in the mix. And
 *   `e8d61bd` records a measured reason for the triangle at this pitch: a
 *   brighter source here puts -6 dB partials at 7 kHz, against the one recorded
 *   human complaint about high-synth fatigue. Left alone, on purpose.
 *
 * MOTIFS and POWERUP VOICES — the game's DIEGETIC layer. A motif says which
 *   archetype is on screen and a powerup voice says what you picked up; the job
 *   is instant recognition, not blend, and they are heavily distorted onto
 *   their own orbits. They are also the loudest remaining "bing bong" in the
 *   score and are named as such in the report rather than quietly left out.
 *
 * LEAD BODY and the BOSS STACK — the octave-down doubling and the three-octave
 *   boss lead, both sawtooths behind a 500-1400 Hz lowpass. Their job is weight
 *   under the tune, and `buildLead`'s own definition of a body is "a fundamental
 *   and its first two or three partials". An instrument there would bring a
 *   character to a layer whose whole value is having none. The boss's "scored
 *   for LOW BRASS" comment names the obvious follow-up: `gm_brass_section` n=0
 *   is 7 zones for 66,779 bytes, and it would be the single biggest moment in
 *   the run played on the thing the comment says it is.
 */

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------

/**
 * `written` — no browser: the score as authored, which is the soundfont score.
 *             This is what every node gate measures.
 * `loading` — a browser has started the load. Oscillators, so that nothing can
 *             throw and nothing can be dropped while samples are in flight.
 * `ready`   — every role's samples are decoded and resident.
 * `partial` — some roles loaded, some did not. Each lane answers for itself.
 * `unavailable` — no role loaded. The score as it shipped before this file.
 */
export type SoundfontState = 'written' | 'loading' | 'ready' | 'partial' | 'unavailable';

const IS_BROWSER = typeof window !== 'undefined' && typeof document !== 'undefined';

/*
 * RUN ANY GATE AGAINST THE FALLBACK SCORE: `MUSICWARS_SOUNDFONTS=fallback`.
 *
 * `tools/fontlanes.mjs` proves the fallback emits the right SOURCE, and that is
 * a narrow claim. It says nothing about whether the oscillator score still
 * passes `registermap`, `masking`, `attackfloor` or `harmony` — and those are
 * the gates that would notice if the fallback drifted into something nobody
 * would ship. One environment variable makes the whole suite runnable against
 * it, which is a far stronger answer to "nothing measures the fallback" than
 * one dedicated tool.
 *
 * Node only, and read once: the browser decides for itself, from measurement.
 */
const ENV_MODE =
  !IS_BROWSER && typeof process !== 'undefined' ? (process.env?.MUSICWARS_SOUNDFONTS ?? '') : '';

let started = false;
let finished = false;
const loaded = new Set<VoiceRole>();
let generation = 0;

/** Per-role load outcome, for the report and for `tools/fontcost.mjs`. */
export interface RoleLoad {
  readonly role: VoiceRole;
  readonly font: string;
  readonly file: string;
  readonly ok: boolean;
  /**
   * Wall-clock ms to the FIRST decoded pitch — the fetch plus one decode. This
   * is "how long before this instrument could make any sound at all", and it is
   * the honest half of the latency question.
   */
  readonly firstMs: number;
  /**
   * Wall-clock ms to the whole warm range being resident, which is when the
   * lane is actually promoted. Longer than `firstMs`, deliberately: a lane
   * switched on with one pitch warm would drop every OTHER note it plays.
   */
  readonly ms: number;
  /** `transferSize` from the Resource Timing entry: what actually crossed the wire. */
  readonly transferred: number;
  /** Pitches decoded before the role was promoted. */
  readonly pitches: number;
  readonly error?: string;
}

export interface SoundfontLoadReport {
  readonly state: SoundfontState;
  readonly baseUrl: string;
  /** ms from `beginSoundfontLoad()` to the last role resolving. */
  readonly totalMs: number;
  readonly transferred: number;
  readonly roles: readonly RoleLoad[];
}

let report: SoundfontLoadReport = {
  state: IS_BROWSER ? 'loading' : 'written',
  baseUrl: '',
  totalMs: 0,
  transferred: 0,
  roles: [],
};

export function soundfontState(): SoundfontState {
  if (ENV_MODE === 'fallback' && !started) return 'unavailable';
  if (!IS_BROWSER && !started) return 'written';
  if (!finished) return started ? 'loading' : 'loading';
  if (loaded.size === ENABLED_ROLES.length) return 'ready';
  return loaded.size === 0 ? 'unavailable' : 'partial';
}

export function soundfontReport(): SoundfontLoadReport {
  return { ...report, state: soundfontState() };
}

/**
 * Does THIS role play its instrument right now?
 *
 * Per-role rather than global, because the brief that produced this file is
 * explicit: one font failing must cost one lane its timbre, not the whole
 * score. A partial load is the normal outcome of a flaky connection.
 */
export function usingSoundfont(role: VoiceRole): boolean {
  if (!SAMPLED_ROLES.has(role)) return false;
  if (ENV_MODE === 'fallback' && !started) return false;
  if (!IS_BROWSER && !started) return true; // `written`
  return loaded.has(role);
}

/**
 * Bumped whenever the answer to `usingSoundfont` changes.
 *
 * `Director.structureKey` names this, because a cache key has to name
 * everything the built pattern depends on and the pattern's OSCILLATOR now
 * depends on it. Without it the promotion from oscillators to instruments would
 * land whenever some unrelated thing happened to force a rebuild.
 */
export function soundfontGeneration(): number {
  return generation;
}

/**
 * The resolved source controls for a role: what `.s()`, `.n()`, `.pw()` and
 * `.unison()` should carry on this hap, right now.
 */
export interface ResolvedVoice {
  readonly s: string;
  readonly n?: number;
  readonly pw?: number;
  readonly unison?: number;
  /** True when `s` is a General MIDI name rather than an oscillator. */
  readonly sampled: boolean;
}

export function voiceSource(role: VoiceRole): ResolvedVoice {
  const inst = INSTRUMENTS[role];
  if (usingSoundfont(role)) return { s: inst.font, n: inst.n, sampled: true };
  return { ...inst.osc, sampled: false };
}

/**
 * Apply a role's source to a pattern. The ONE place `.s()` is chosen for a
 * lane that has an instrument.
 *
 * `extra` carries the controls superdough reads only inside one oscillator's
 * branch — `detune`/`spread`/`unison` on supersaw, `pw`/`pwrate`/`pwsweep` on
 * pulse. They are passed in rather than chained by the caller so that they
 * vanish together with the oscillator: set on a soundfont they are inert, and
 * `tools/session.mjs` counts inert controls as a failure precisely because this
 * project has shipped that bug before.
 */
export interface SynthOnly {
  /** supersaw */ detune?: number;
  /** supersaw */ spread?: number;
  /** pulse */ pwrate?: number;
  /** pulse */ pwsweep?: number;
}

export function applyVoice(p: Pattern, role: VoiceRole, extra?: SynthOnly): Pattern {
  const v = voiceSource(role);
  let out = p.s(v.s);
  if (v.n !== undefined) out = out.n(v.n);
  if (v.pw !== undefined) out = out.pw(v.pw);
  if (v.unison !== undefined) out = out.unison(v.unison);
  if (!extra) return out;
  if (v.s === 'supersaw') {
    if (extra.detune !== undefined) out = out.detune(extra.detune);
    if (extra.spread !== undefined) out = out.spread(extra.spread);
  }
  if (v.s === 'pulse') {
    if (extra.pwrate !== undefined) out = out.pwrate(extra.pwrate);
    if (extra.pwsweep !== undefined) out = out.pwsweep(extra.pwsweep);
  }
  return out;
}

/**
 * Test hook. `tools/fontlanes.mjs` uses it to query the SAME builders in both
 * modes, so the fallback score is measured rather than assumed — a fallback
 * nobody queries is the "unmeasured properties rot" case in a new costume.
 */
export function setSoundfontModeForTesting(mode: 'written' | 'fallback' | 'ready'): void {
  started = mode !== 'written';
  finished = mode !== 'written';
  loaded.clear();
  if (mode === 'ready') for (const r of VOICE_ROLES) loaded.add(r);
  generation++;
}

// ---------------------------------------------------------------------------
// loading
// ---------------------------------------------------------------------------

/**
 * Where the samples come from, tried in order.
 *
 * A list rather than a string because self-hosting is the obvious follow-up and
 * should not be a refactor: drop the six files into `public/soundfonts/`, put
 * `/soundfonts` at the front, and the CDN becomes the backstop. It is NOT done
 * here because the six fonts are 561 KB uncompressed of base64-in-JavaScript,
 * and `npm run package` builds a single standalone HTML file that cannot inline
 * anything under `public/` — so vendoring would help the dev server and the
 * hosted build while leaving the standalone artefact exactly where it is now.
 * That is a judgement the owner should make with the numbers in front of them.
 */
const BASE_URLS = ['https://felixroos.github.io/webaudiofontdata/sound'];

/**
 * How long a single role may take before its lane keeps its oscillator.
 *
 * Six seconds is long for a fetch and short for a stalled one. The cost of
 * waiting is not silence — the lane is already playing its oscillator — so this
 * only decides how long a slow connection can hold up the promotion.
 */
const ROLE_TIMEOUT_MS = 6000;

/** Every pitch in this window is decoded before a role is promoted. */
function warmRange(role: VoiceRole): number[] {
  const [lo, hi] = INSTRUMENTS[role].warm;
  const out: number[] = [];
  for (let n = lo; n <= hi; n++) out.push(n);
  return out;
}

function transferredFor(url: string): number {
  try {
    const perf = (globalThis as { performance?: Performance }).performance;
    const entries = perf?.getEntriesByName?.(url) ?? [];
    const e = entries[entries.length - 1] as PerformanceResourceTiming | undefined;
    // `transferSize` is 0 on a cache hit and on a cross-origin response without
    // Timing-Allow-Origin; `encodedBodySize` is the honest second choice.
    return e ? (e.transferSize || e.encodedBodySize || 0) : 0;
  } catch {
    return 0;
  }
}

/**
 * Fetch, decode and hold every sample a role needs, then promote the lane.
 *
 * NOTHING IS PROMOTED UNTIL ITS SAMPLES ARE RESIDENT, and that is the whole
 * design. `getFontBufferSource` caches per (font, pitch) and superdough drops
 * any hap whose handler resolves after its deadline (`superdough.mjs:581`), so
 * a lane switched on before the cache is warm loses notes for as long as the
 * decode takes and reports nothing.
 */
async function loadRole(
  role: VoiceRole,
  fontloader: FontLoaderModule,
  gm: Record<string, string[]>,
  ctx: BaseAudioContext,
  baseUrl: string,
  t0: number,
): Promise<RoleLoad> {
  const inst = INSTRUMENTS[role];
  const list = gm[inst.font];
  const file = list?.[inst.n] ?? '';
  const url = `${baseUrl}/${file}.js`;
  const base = { role, font: inst.font, file, transferred: 0, pitches: 0 };
  if (!file) {
    return {
      ...base,
      ok: false,
      firstMs: 0,
      ms: performance.now() - t0,
      error: `no variant ${inst.n} of ${inst.font}`,
    };
  }
  if (file !== inst.variant) {
    // Not fatal — the font still plays — but every measurement in the table
    // above was taken against `inst.variant`, so a silent swap would make the
    // byte counts and zone counts fiction.
    console.warn(`[soundfonts] ${inst.font} n=${inst.n} is ${file}, expected ${inst.variant}`);
  }
  const pitches = warmRange(role);
  let firstMs = 0;
  try {
    await withTimeout(
      (async () => {
        // The first call fetches the font AND decodes one zone; the rest are
        // decodes served out of `fontloader`'s own per-pitch cache thereafter.
        for (const n of pitches) {
          await fontloader.getFontBufferSource(file, { note: n }, ctx);
          if (firstMs === 0) firstMs = performance.now() - t0;
        }
      })(),
      ROLE_TIMEOUT_MS,
    );
  } catch (err) {
    return {
      ...base,
      ok: false,
      firstMs,
      ms: performance.now() - t0,
      transferred: transferredFor(url),
      error: String((err as Error)?.message ?? err).slice(0, 160),
    };
  }
  loaded.add(role);
  generation++;
  return {
    ...base,
    ok: true,
    firstMs,
    ms: performance.now() - t0,
    transferred: transferredFor(url),
    pitches: pitches.length,
  };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(id);
        resolve(v);
      },
      (e) => {
        clearTimeout(id);
        reject(e as Error);
      },
    );
  });
}

interface FontLoaderModule {
  registerSoundfonts: () => void;
  setSoundfontUrl: (u: string) => void;
  getFontBufferSource: (
    name: string,
    value: { note: number },
    ac: BaseAudioContext,
  ) => Promise<AudioBufferSourceNode>;
}

/**
 * Start the load. Safe to call more than once; only the first call does work.
 *
 * Called from `bootAudio` AFTER the context is resumed, and deliberately NOT
 * awaited: the game starts on its oscillators within a frame of the button
 * press and the instruments arrive underneath it. What the player hears in the
 * meantime is the score exactly as it was before this file existed, which is
 * the only reason it is acceptable to make them wait for it at all.
 */
export function beginSoundfontLoad(ctx: BaseAudioContext): Promise<SoundfontLoadReport> {
  if (started) return Promise.resolve(soundfontReport());
  started = true;
  generation++;
  const t0 = performance.now();

  return (async () => {
    let roles: RoleLoad[] = [];
    let baseUrl = BASE_URLS[0] ?? '';
    try {
      const fontloader = (await import('@strudel/soundfonts/fontloader.mjs')) as unknown as FontLoaderModule;
      const gm = ((await import('@strudel/soundfonts/gm.mjs')) as unknown as { default: Record<string, string[]> })
        .default;
      // Registers all 129 General MIDI names with superdough. No network: the
      // fetch happens per font on first use, which is what the warm-up below
      // is for.
      fontloader.registerSoundfonts();
      fontloader.setSoundfontUrl(baseUrl);
      roles = await Promise.all(ENABLED_ROLES.map((r) => loadRole(r, fontloader, gm, ctx, baseUrl, t0)));
    } catch (err) {
      // The import itself failed — an offline first load, or the packaging
      // fault this file's header describes coming back. Every lane keeps its
      // oscillator and the game is unaffected.
      roles = ENABLED_ROLES.map((role) => ({
        role,
        font: INSTRUMENTS[role].font,
        file: '',
        ok: false,
        firstMs: 0,
        ms: performance.now() - t0,
        transferred: 0,
        pitches: 0,
        error: String((err as Error)?.message ?? err).slice(0, 160),
      }));
      baseUrl = '';
    }
    finished = true;
    generation++;
    report = {
      state: soundfontState(),
      baseUrl,
      totalMs: performance.now() - t0,
      transferred: roles.reduce((a, r) => a + r.transferred, 0),
      roles,
    };
    return report;
  })();
}

/*
 * A READ-ONLY WINDOW HOOK, because the only honest measurement of this file is
 * taken in a browser.
 *
 * How many bytes crossed the wire, how long before the first real note could
 * play, and whether a lane fell back are all runtime facts that no node gate
 * can see. `tools/fontcheck.mjs` reads this; `src/main.ts` is not touched for
 * it, because that file belongs to the renderer's owner and a debug hook is not
 * worth a merge.
 */
if (IS_BROWSER) {
  (window as unknown as Record<string, unknown>).__soundfonts = {
    report: soundfontReport,
    state: soundfontState,
    using: usingSoundfont,
    enabled: () => [...ENABLED_ROLES],
    roles: () => VOICE_ROLES.map((r) => ({ role: r, ...voiceSource(r) })),
  };
}
