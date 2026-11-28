// Effets : sons synthétisés (Web Audio, aucun fichier) et confettis.
(() => {
  "use strict";
  const reduceMotion = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- son ----------
  let ctx = null, master = null, musicBus = null, noiseBuf = null;
  let muted = false;
  try { muted = localStorage.getItem("qpuc-muted") === "1"; } catch {}

  function audio() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      musicBus = ctx.createGain();
      musicBus.gain.value = 0;
      musicBus.connect(master);
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }
  // Débloque l'audio au premier geste (les navigateurs l'exigent)
  ["pointerdown", "keydown"].forEach(ev => window.addEventListener(ev, () => audio(), { once: true, passive: true }));

  // Une note : fréquence, départ (s), durée (s), forme d'onde, volume, glissando éventuel
  function note(freq, at, dur, { type = "triangle", vol = 0.3, to = null, filter = null } = {}) {
    const c = audio(); if (!c || muted) return;
    const t0 = c.currentTime + at;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let node = osc;
    if (filter) {
      const f = c.createBiquadFilter();
      f.type = "lowpass"; f.frequency.value = filter;
      osc.connect(f); node = f;
    }
    node.connect(g); g.connect(master);
    osc.start(t0); osc.stop(t0 + dur + 0.05);
  }

  // Bruit blanc (caisse claire, charleston, cymbale)
  function noise(at, dur, { vol = 0.2, hp = 1000, lp = null, dest = null, decay = true } = {}) {
    const c = audio(); if (!c || muted) return;
    if (!noiseBuf) {
      noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const t0 = c.currentTime + at;
    const src = c.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const h = c.createBiquadFilter(); h.type = "highpass"; h.frequency.value = hp;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t0);
    if (decay) g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    else g.gain.setValueAtTime(0.0001, t0 + dur);
    let node = h;
    src.connect(h);
    if (lp) { const l = c.createBiquadFilter(); l.type = "lowpass"; l.frequency.value = lp; h.connect(l); node = l; }
    node.connect(g); g.connect(dest || master);
    src.start(t0); src.stop(t0 + dur + 0.05);
  }

  // Sons enregistrés : chargés une fois, puis joués via Web Audio (hauteur réglable)
  // Le vrai miaulement, enregistré puis débruité
  const MEOW_URL = "sounds/miaou.m4a";
  const samples = {};
  function loadSample(url) {
    const c = audio(); if (!c) return Promise.resolve(null);
    if (!samples[url]) {
      samples[url] = fetch(url).then(r => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)))
        .then(buf => new Promise((res, rej) => c.decodeAudioData(buf, res, rej)))
        .catch(() => { delete samples[url]; return null; });
    }
    return samples[url];
  }
  function playSample(url, rate = 1, vol = 1) {
    const c = audio(); if (!c || muted) return;
    loadSample(url).then(buf => {
      if (!buf || muted) return;
      const src = c.createBufferSource(), g = c.createGain();
      src.buffer = buf; src.playbackRate.value = rate; g.gain.value = vol;
      src.connect(g); g.connect(master);
      src.start();
    });
  }
  // On prépare le miaou dès le premier geste, pour qu'il parte sans délai
  ["pointerdown", "keydown"].forEach(ev => window.addEventListener(ev, () => loadSample(MEOW_URL), { once: true, passive: true }));

  const sound = {
    // Roulement de tambour qui monte, pour l'annonce du score
    drumroll(dur = 1.8) {
      const hits = Math.round(dur * 22);
      for (let i = 0; i < hits; i++) {
        const k = i / hits;
        noise(i / 22, 0.07, { vol: 0.05 + 0.2 * k * k, hp: 900, lp: 5200 });
      }
    },
    // Miaou : le vrai miaulement enregistré, joué plus aigu ou plus grave selon le chat (pitch)
    meow(pitch = 1, url = null) {
      playSample(url || MEOW_URL, pitch * (0.96 + Math.random() * 0.08), 1);
    },
    crash() {
      noise(0, 1.4, { vol: 0.22, hp: 4500 });
      note(110, 0, 0.35, { type: "sine", vol: 0.35, to: 45 });
    },
    tick() { note(1250, 0, 0.04, { type: "square", vol: 0.06 }); },
    correct() {
      [659.25, 830.61, 987.77, 1318.5].forEach((f, i) => note(f, i * 0.075, 0.22, { vol: 0.28 }));
      note(2637, 0.3, 0.35, { type: "sine", vol: 0.08 });
    },
    wrong() {
      note(196, 0, 0.22, { type: "sawtooth", vol: 0.22, filter: 900 });
      note(147, 0.2, 0.42, { type: "sawtooth", vol: 0.22, filter: 700, to: 120 });
    },
    boing() { note(260, 0, 0.32, { type: "sine", vol: 0.3, to: 720 }); note(720, 0.12, 0.25, { type: "sine", vol: 0.15, to: 300 }); },
    pop() { note(520, 0, 0.09, { type: "sine", vol: 0.25, to: 1100 }); },
    whoosh() { note(180, 0, 0.35, { type: "sawtooth", vol: 0.05, to: 900, filter: 1400 }); },
    fanfare() {
      const seq = [[523.25, 0], [659.25, 0.12], [783.99, 0.24], [1046.5, 0.36]];
      seq.forEach(([f, t]) => note(f, t, 0.2, { vol: 0.25 }));
      [523.25, 659.25, 783.99, 1046.5].forEach(f => note(f, 0.52, 0.7, { vol: 0.12 }));
    },
    sad() {
      [[392, 0], [370, 0.32], [349, 0.64]].forEach(([f, t]) => note(f, t, 0.3, { type: "sawtooth", vol: 0.14, filter: 1100 }));
      note(330, 0.96, 0.9, { type: "sawtooth", vol: 0.14, filter: 1100, to: 290 });
    },
  };

  // ---------- confettis ----------
  let canvas = null, c2d = null, parts = [], raf = 0;
  const COLORS = ["#2f45c9", "#8d9bff", "#17a865", "#ffb020", "#ff5d73", "#ffffff"];

  function ensureCanvas() {
    if (canvas) return;
    canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:30";
    document.body.appendChild(canvas);
    c2d = canvas.getContext("2d");
  }
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr;
    c2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function confetti(x, y, { count = 70, spread = 1, power = 1 } = {}) {
    if (reduceMotion()) return;
    ensureCanvas(); resize();
    for (let i = 0; i < count; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.1 * spread;
      const v = (5 + Math.random() * 8) * power;
      parts.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        w: 5 + Math.random() * 6, h: 3 + Math.random() * 4,
        r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.4,
        color: COLORS[(Math.random() * COLORS.length) | 0], life: 0, max: 70 + Math.random() * 50,
      });
    }
    if (!raf) raf = requestAnimationFrame(step);
  }
  function step() {
    c2d.clearRect(0, 0, innerWidth, innerHeight);
    parts = parts.filter(p => p.life < p.max && p.y < innerHeight + 40);
    for (const p of parts) {
      p.life++; p.vy += 0.28; p.vx *= 0.985; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      c2d.save();
      c2d.globalAlpha = Math.max(0, 1 - p.life / p.max);
      c2d.translate(p.x, p.y); c2d.rotate(p.r);
      c2d.fillStyle = p.color;
      c2d.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.life * 0.15)));
      c2d.restore();
    }
    raf = parts.length ? requestAnimationFrame(step) : 0;
    if (!raf) c2d.clearRect(0, 0, innerWidth, innerHeight);
  }
  function confettiFrom(el, opts) {
    if (!el) return;
    const r = el.getBoundingClientRect();
    confetti(r.left + r.width / 2, r.top + r.height / 2, opts);
  }

  // ---------- musique d'ambiance ----------
  // Petite boucle façon jeu télé, synthétisée en direct : basse, accords en contretemps, charleston, mélodie de marimba.
  const BPM = 108, BEAT = 60 / BPM;
  const MIDI = n => 440 * Math.pow(2, (n - 69) / 12);
  // 4 mesures : Fmaj7 · Em7 · Dm7 · G7 (degrés en notes MIDI)
  const BARS = [
    { bass: [41, 48], chord: [57, 60, 64, 65] },
    { bass: [40, 47], chord: [55, 59, 62, 64] },
    { bass: [38, 45], chord: [57, 60, 62, 65] },
    { bass: [43, 50], chord: [55, 59, 62, 65] },
  ];
  const MELODY = [ // [mesure, temps (en croches), note]
    [0, 0, 72], [0, 3, 76], [0, 6, 77], [1, 2, 76], [1, 4, 74], [1, 6, 71],
    [2, 0, 74], [2, 3, 77], [2, 6, 81], [3, 1, 79], [3, 4, 77], [3, 6, 74],
  ];
  let music = { on: false, timer: 0, next: 0, step: 0, duck: false, round: 0 };
  function mnote(freq, t, dur, type, vol, lp) {
    const c = ctx;
    const osc = c.createOscillator(), g = c.createGain();
    osc.type = type; osc.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = osc;
    if (lp) { const f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = lp; osc.connect(f); node = f; }
    node.connect(g); g.connect(musicBus);
    osc.start(t); osc.stop(t + dur + 0.05);
  }
  function scheduleStep(i, t) {
    const bar = BARS[Math.floor(i / 8) % 4], e = i % 8; // e : croche dans la mesure
    if (e === 0 || e === 4) mnote(MIDI(bar.bass[e === 0 ? 0 : 1]), t, BEAT * 0.9, "triangle", 0.5, 600);
    if (e === 7) mnote(MIDI(bar.bass[0] + 12), t, BEAT * 0.4, "triangle", 0.25, 600);
    if (e === 2 || e === 6) bar.chord.forEach(n => mnote(MIDI(n), t, BEAT * 0.35, "square", 0.035, 1800));
    noise(t - ctx.currentTime, 0.04, { vol: e % 2 ? 0.05 : 0.09, hp: 7000, dest: musicBus });
    if (music.round % 2 === 1) { // la mélodie un tour sur deux
      const m = MELODY.find(([b, s]) => b === Math.floor(i / 8) % 4 && s === e);
      if (m) { mnote(MIDI(m[2]), t, BEAT * 0.5, "sine", 0.22); mnote(MIDI(m[2] + 12), t, BEAT * 0.25, "sine", 0.05); }
    }
  }
  function tickMusic() {
    if (!ctx || !music.on) return;
    while (music.next < ctx.currentTime + 0.25) {
      if (!muted) scheduleStep(music.step, music.next);
      music.step++;
      if (music.step % 32 === 0) music.round++;
      music.next += BEAT / 2;
    }
  }
  function musicLevel() {
    if (!ctx || !musicBus) return;
    const target = music.on && !muted && !music.duck ? 0.32 : 0.0001;
    musicBus.gain.cancelScheduledValues(ctx.currentTime);
    musicBus.gain.setTargetAtTime(target, ctx.currentTime, music.on && !music.duck ? 0.4 : 0.12);
  }
  const musicApi = {
    start() {
      if (music.on) return;
      const c = audio(); if (!c) return;
      music.on = true; music.step = 0; music.round = 0; music.next = c.currentTime + 0.1;
      music.timer = setInterval(tickMusic, 80);
      tickMusic(); musicLevel();
    },
    stop() {
      if (!music.on) return;
      music.on = false; clearInterval(music.timer);
      musicLevel();
    },
    // Baisse la musique pendant un son ou une vidéo (blind test, récompense)
    duck(on) { music.duck = !!on; musicLevel(); },
    get playing() { return music.on; },
  };

  window.FX = {
    sound,
    music: musicApi,
    confetti, confettiFrom,
    reduceMotion,
    get muted() { return muted; },
    set muted(v) { muted = !!v; try { localStorage.setItem("qpuc-muted", muted ? "1" : "0"); } catch {} musicLevel(); },
  };
})();
