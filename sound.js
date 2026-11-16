// Cecilia sound: drones and gestures with plain Web Audio.
//
// Everything lives in one key (A minor pentatonic) so all layers blend.
//   base drone ........ always on: detuned saws + fifth + sub, slow breathing filter
//   voice ............. while you hold SPACE the drone opens up with your mic level
//   words ............. each new word rings a soft bell; committing a sentence rings low
//   split ............. noise burst + falling arpeggio, one note per letter
//   held letters ...... each grabbed letter sings: pitch = height, pan = x
//   loose letters ..... an FM swarm whose brightness follows how fast they move
//   wall hits ......... tiny glassy ticks
//   hands ............. each visible hand hums a quiet sine, quantized to the scale by height
//   open-palm sweep ... wind (filtered noise) that follows hand speed
//   fist rebuild ...... rising filtered chord that resolves
// M mutes.

const Sound = (() => {
  const ROOT = 55; // A1
  const SCALE = [0, 3, 5, 7, 10];
  const note = (i) => {
    const o = Math.floor(i / 5), s = ((i % 5) + 5) % 5;
    return ROOT * Math.pow(2, o + SCALE[s] / 12);
  };
  // y (0 top … 1 bottom) → scale step, high on top
  const stepFromY = (y, lo = 5, hi = 17) => Math.round(lo + (1 - Math.min(1, Math.max(0, y))) * (hi - lo));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  let ctx = null, bus, master, noiseBuf;
  let drone, swarm, wind, handVoices = [];
  const held = new Map();
  let muted = false, lastTick = 0;

  // ---------------------------------------------------------------- setup

  function init() {
    if (ctx) { ctx.resume(); return; }
    ctx = new AudioContext();

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 4;
    master = ctx.createGain();
    master.gain.value = 0;
    master.gain.setTargetAtTime(0.9, ctx.currentTime, 1.5); // fade in
    master.connect(comp).connect(ctx.destination);

    bus = ctx.createGain();
    bus.connect(master);

    // reverb: generated impulse response
    const rev = ctx.createConvolver();
    rev.buffer = impulse(4.5, 2.5);
    const revGain = ctx.createGain(); revGain.gain.value = 0.55;
    bus.connect(rev).connect(revGain).connect(master);

    // dotted-eighth-ish feedback delay into the reverb
    const delay = ctx.createDelay(2); delay.delayTime.value = 0.42;
    const fb = ctx.createGain(); fb.gain.value = 0.38;
    const dGain = ctx.createGain(); dGain.gain.value = 0.22;
    const dTone = ctx.createBiquadFilter(); dTone.type = 'lowpass'; dTone.frequency.value = 2500;
    bus.connect(delay); delay.connect(dTone).connect(fb).connect(delay);
    dTone.connect(dGain); dGain.connect(rev); dGain.connect(master);

    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    drone = makeDrone();
    swarm = makeSwarm();
    wind = makeWind();
    handVoices = [makeHandVoice(), makeHandVoice()];
  }

  function impulse(seconds, decay) {
    const len = ctx.sampleRate * seconds;
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  function osc(type, freq, detune = 0) {
    const o = ctx.createOscillator();
    o.type = type; o.frequency.value = freq; o.detune.value = detune;
    o.start();
    return o;
  }

  function makeDrone() {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 280; filter.Q.value = 6;
    const gain = ctx.createGain(); gain.gain.value = 0;
    gain.gain.setTargetAtTime(0.16, ctx.currentTime, 3);
    filter.connect(gain).connect(bus);

    const parts = [
      [osc('sawtooth', note(0), -8), 0.35],
      [osc('sawtooth', note(0), +8), 0.35],
      [osc('sawtooth', note(3), +3), 0.18],  // fifth
      [osc('sine', note(-5), 0), 0.6],       // sub octave
      [osc('triangle', note(6), -4), 0.08],  // a quiet minor third above the octave
    ];
    for (const [o, v] of parts) { const g = ctx.createGain(); g.gain.value = v; o.connect(g).connect(filter); }

    // slow breathing on the filter
    const lfo = osc('sine', 0.045);
    const lfoAmt = ctx.createGain(); lfoAmt.gain.value = 160;
    lfo.connect(lfoAmt).connect(filter.frequency);
    return { filter, gain };
  }

  function makeSwarm() {
    // FM: modulator → carrier frequency. Brightness = modulation depth.
    const car = osc('sine', note(10));
    const mod = osc('sine', note(10) * 1.5);
    const idx = ctx.createGain(); idx.gain.value = 0;
    mod.connect(idx).connect(car.frequency);
    const car2 = osc('sine', note(12), 6);
    const gain = ctx.createGain(); gain.gain.value = 0;
    const pan = ctx.createStereoPanner();
    car.connect(gain); car2.connect(gain);
    gain.connect(pan).connect(bus);
    // slow tremolo for shimmer
    const trem = osc('sine', 5.5);
    const tremAmt = ctx.createGain(); tremAmt.gain.value = 0;
    trem.connect(tremAmt).connect(gain.gain);
    return { car, mod, idx, gain, pan, tremAmt };
  }

  function makeWind() {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf; src.loop = true; src.start();
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 600; bp.Q.value = 2.5;
    const gain = ctx.createGain(); gain.gain.value = 0;
    const pan = ctx.createStereoPanner();
    src.connect(bp).connect(gain).connect(pan).connect(bus);
    return { bp, gain, pan };
  }

  function makeHandVoice() {
    const a = osc('sine', note(10));
    const b = osc('triangle', note(10) * 2, 5);
    const bg = ctx.createGain(); bg.gain.value = 0.15;
    const gain = ctx.createGain(); gain.gain.value = 0;
    const pan = ctx.createStereoPanner();
    a.connect(gain); b.connect(bg).connect(gain);
    gain.connect(pan).connect(bus);
    return { a, b, gain, pan, step: -1 };
  }

  // ---------------------------------------------------------------- one-shots

  function pluck(freq, pan = 0, vol = 0.12, decay = 1.6, type = 'sine') {
    if (!ctx) return;
    const t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    const p = ctx.createStereoPanner(); p.pan.value = clamp(pan, -1, 1);
    const o1 = ctx.createOscillator(); o1.type = type; o1.frequency.value = freq;
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = freq * 2.76; // bell-ish partial
    const g2 = ctx.createGain(); g2.gain.value = 0.25;
    o1.connect(g); o2.connect(g2).connect(g);
    g.connect(p).connect(bus);
    o1.start(t); o2.start(t); o1.stop(t + decay + 0.1); o2.stop(t + decay + 0.1);
  }

  function noiseBurst(pan = 0, vol = 0.2, dur = 0.5, from = 6000, to = 300) {
    const t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 3;
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = ctx.createStereoPanner(); p.pan.value = clamp(pan, -1, 1);
    src.connect(f).connect(g).connect(p).connect(bus);
    src.start(t, Math.random()); src.stop(t + dur + 0.05);
  }

  // ---------------------------------------------------------------- events from the sketch

  function word(text, pan) {
    if (!ctx) return;
    const code = [...text].reduce((s, c) => s + c.charCodeAt(0), 0);
    pluck(note(12 + (code % 8)), pan, 0.09, 2.2);
  }

  function commit() {
    if (!ctx) return;
    pluck(note(5), -0.3, 0.12, 4);
    pluck(note(8), 0.3, 0.08, 4);
  }

  function split(n, pan) {
    if (!ctx) return;
    noiseBurst(pan, 0.25, 0.6);
    const start = 16 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      setTimeout(() => pluck(note(start - i), pan + (Math.random() - 0.5) * 0.6, 0.07, 1.2, 'triangle'), i * 45);
    }
  }

  function rebuild() {
    if (!ctx) return;
    const t = ctx.currentTime;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 8;
    f.frequency.setValueAtTime(150, t);
    f.frequency.exponentialRampToValueAtTime(4000, t + 1.4);
    f.frequency.exponentialRampToValueAtTime(600, t + 3.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.13, t + 1.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 4);
    f.connect(g).connect(bus);
    for (const [i, d] of [[5, -6], [8, 6], [10, 0], [13, 3]]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = note(i); o.detune.value = d;
      o.connect(f); o.start(t); o.stop(t + 4.1);
    }
    setTimeout(() => pluck(note(15), 0, 0.12, 3), 1300);
  }

  function tick(pan, speed) {
    if (!ctx) return;
    const now = ctx.currentTime;
    if (now - lastTick < 0.035) return;
    lastTick = now;
    pluck(note(18 + Math.floor(Math.random() * 6)), pan, clamp(speed / 120, 0.01, 0.05), 0.25);
  }

  function release(speed, pan) {
    if (!ctx || speed < 6) return;
    noiseBurst(pan, clamp(speed / 150, 0.03, 0.2), 0.4, 1500, 4000);
  }

  // ---------------------------------------------------------------- continuous state, once per frame

  function update(s) {
    if (!ctx) return;
    const t = ctx.currentTime;

    // drone opens with your voice
    const voice = s.recording ? s.level : 0;
    drone.filter.frequency.setTargetAtTime(280 + voice * 2600 + (s.recording ? 250 : 0), t, 0.08);
    drone.gain.gain.setTargetAtTime(0.16 + voice * 0.08, t, 0.2);

    // swarm follows loose letters
    const amount = clamp(s.looseCount / 30, 0, 1);
    const energy = clamp(s.looseSpeed / 8, 0, 1);
    swarm.gain.gain.setTargetAtTime(0.05 * amount, t, 0.3);
    swarm.tremAmt.gain.setTargetAtTime(0.02 * amount, t, 0.3);
    swarm.idx.gain.setTargetAtTime(30 + energy * 900, t, 0.1);
    swarm.car.frequency.setTargetAtTime(note(10 + Math.round(energy * 4)), t, 0.4);
    swarm.pan.pan.setTargetAtTime(clamp(s.loosePan, -1, 1), t, 0.2);

    // hands hum + open-palm wind
    let windAmt = 0, windPan = 0;
    handVoices.forEach((v, i) => {
      const h = s.hands[i];
      if (!h) { v.gain.gain.setTargetAtTime(0, t, 0.3); v.step = -1; return; }
      const step = stepFromY(h.y, 7, 17);
      if (step !== v.step) {
        v.step = step;
        v.a.frequency.setTargetAtTime(note(step), t, 0.06);
        v.b.frequency.setTargetAtTime(note(step) * 2, t, 0.06);
      }
      v.gain.gain.setTargetAtTime(h.pinching ? 0.015 : 0.035, t, 0.15);
      v.pan.pan.setTargetAtTime(h.x * 2 - 1, t, 0.1);
      if (h.open) { windAmt = Math.max(windAmt, clamp(h.speed / 40, 0, 1)); windPan = h.x * 2 - 1; }
    });
    wind.gain.gain.setTargetAtTime(windAmt * 0.35, t, 0.08);
    wind.bp.frequency.setTargetAtTime(400 + windAmt * 3000, t, 0.08);
    wind.pan.pan.setTargetAtTime(windPan, t, 0.1);

    // a singing voice for every held letter
    const seen = new Set();
    for (const l of s.held) {
      seen.add(l.id);
      let v = held.get(l.id);
      if (!v) { v = makeHeldVoice(); held.set(l.id, v); }
      const f = note(stepFromY(l.y, 8, 20));
      v.o1.frequency.setTargetAtTime(f, t, 0.04);
      v.o2.frequency.setTargetAtTime(f * 1.5, t, 0.04);
      v.f.frequency.setTargetAtTime(800 + (1 - l.y) * 3000, t, 0.05);
      v.pan.pan.setTargetAtTime(l.x * 2 - 1, t, 0.05);
    }
    for (const [id, v] of held) {
      if (seen.has(id)) continue;
      v.g.gain.setTargetAtTime(0, t, 0.25);
      v.o1.stop(t + 1.5); v.o2.stop(t + 1.5);
      held.delete(id);
    }
  }

  function makeHeldVoice() {
    const t = ctx.currentTime;
    const o1 = ctx.createOscillator(); o1.type = 'triangle';
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.detune.value = 4;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 3;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.07, t + 0.08);
    const g2 = ctx.createGain(); g2.gain.value = 0.4;
    const pan = ctx.createStereoPanner();
    // vibrato
    const vib = ctx.createOscillator(); vib.frequency.value = 5;
    const vibAmt = ctx.createGain(); vibAmt.gain.value = 6;
    vib.connect(vibAmt); vibAmt.connect(o1.detune); vibAmt.connect(o2.detune);
    o1.connect(f); o2.connect(g2).connect(f);
    f.connect(g).connect(pan).connect(bus);
    o1.start(t); o2.start(t); vib.start(t); vib.stop(t + 600);
    return { o1, o2, f, g, pan };
  }

  function toggleMute() {
    if (!ctx) return;
    muted = !muted;
    master.gain.setTargetAtTime(muted ? 0 : 0.9, ctx.currentTime, 0.2);
  }

  return {
    init, update, word, commit, split, rebuild, tick, release, toggleMute,
    get started() { return !!ctx && ctx.state === 'running'; },
    get muted() { return muted; },
  };
})();
