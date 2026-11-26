// Effets : sons synthétisés (Web Audio, aucun fichier) et confettis.
(() => {
  "use strict";
  const reduceMotion = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- son ----------
  let ctx = null, master = null;
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

  const sound = {
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

  window.FX = {
    sound,
    confetti, confettiFrom,
    reduceMotion,
    get muted() { return muted; },
    set muted(v) { muted = !!v; try { localStorage.setItem("qpuc-muted", muted ? "1" : "0"); } catch {} },
  };
})();
