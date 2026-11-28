// Les chats (Blanche et Seven) qui se baladent derrière le site.
// Ils rebondissent sur les bords et entre eux, on peut les attraper et les lancer,
// ils réagissent aux réponses, passent parfois la tête par un coin, et cachent un message secret.
(() => {
  "use strict";
  const cfg = window.QUIZ_CONFIG || {};
  const pets = (Array.isArray(cfg.pets) ? cfg.pets : []).filter(p => p && p.head).slice(0, 4);

  const now = () => performance.now();
  const rand = (a, b) => a + Math.random() * (b - a);
  const ease = k => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
  const sizeNow = () => (innerWidth < 520 ? 64 : 92);

  let layer = null, cats = [], raf = 0, last = 0, calm = false, started = false, lastMeow = 0;

  function meow(c, force = false) {
    if (!force && now() - lastMeow < 1400) return;
    lastMeow = now();
    FX.sound.meow(c.p.pitch || 1, c.p.sound);
  }
  function play(c, cls) {
    c.img.classList.remove(cls); void c.img.offsetWidth; c.img.classList.add(cls);
  }
  function aim(c, speed) {
    const a = rand(0, Math.PI * 2);
    c.vx = Math.cos(a) * speed; c.vy = Math.sin(a) * speed;
  }

  // ---------- déplacements scriptés ----------
  function tween(c, to, dur, done) {
    c.mode = "tween";
    c.tw = { x0: c.x, y0: c.y, r0: c.r, x1: to.x ?? c.x, y1: to.y ?? c.y, r1: to.r ?? c.r, t0: now(), dur, done };
  }
  function hold(c, ms, done) { c.mode = "hold"; c.until = now() + ms; c.after = done; }
  function wander(c, speed = rand(55, 85)) {
    c.mode = "wander";
    c.r = ((c.r % 360) + 360) % 360;
    if (Math.hypot(c.vx, c.vy) < 30) aim(c, speed);
  }

  // Coucou : le chat sort de l'écran, passe la tête par un coin du bas, regarde, puis repart
  function peek(c) {
    const W = innerWidth, H = innerHeight, s = c.s;
    const left = c.x + s / 2 < W / 2;
    c.peeking = true;
    tween(c, { x: left ? -s * 1.3 : W + s * 0.3, y: H - s * 1.1 }, 900, () =>
      tween(c, { x: left ? -s * 0.32 : W - s * 0.68, y: H - s * 0.9, r: left ? 28 : -28 }, 700, () => {
        c.node.classList.add("peeking");
        hold(c, 3000, () => {
          c.node.classList.remove("peeking");
          tween(c, { x: left ? -s * 1.3 : W + s * 0.3, r: 0 }, 600, () => {
            c.peeking = false;
            c.nextPeek = now() + rand(35000, 70000);
            enter(c, left);
          });
        });
      }));
  }
  function enter(c, fromLeft) {
    const W = innerWidth, H = innerHeight, s = c.s;
    c.x = fromLeft ? -s * 1.2 : W + s * 0.2;
    c.y = rand(H * 0.15, H * 0.7);
    c.r = 0;
    tween(c, { x: fromLeft ? rand(20, W * 0.3) : rand(W * 0.6, W - s - 20), r: fromLeft ? 360 : -360 }, 1100, () => {
      c.vx = (fromLeft ? 1 : -1) * rand(55, 85); c.vy = rand(-60, 60); c.r = 0;
      wander(c);
    });
  }

  // ---------- création ----------
  function make(p, i) {
    const node = document.createElement("div");
    node.className = "pet";
    node.setAttribute("aria-hidden", "true");
    const img = document.createElement("img");
    img.className = "pet-img"; img.src = p.head; img.alt = ""; img.draggable = false;
    node.append(img);
    layer.append(node);
    const c = { p, node, img, s: sizeNow(), x: 0, y: 0, r: 0, vx: 0, vy: 0, vr: rand(-25, 25),
      mode: "wander", boost: 1, taps: 0, tapAt: 0, nextPeek: now() + rand(25000, 45000) + i * 15000 };
    img.addEventListener("animationend", () => img.classList.remove("hop", "startle", "bonk"));
    grab(c);
    return c;
  }

  // Attraper, lancer, taper (5 tapes = message secret)
  function grab(c) {
    let down = null, samples = [];
    c.node.addEventListener("pointerdown", e => {
      if (c.mode === "tween" || c.mode === "hold") return;
      e.preventDefault();
      try { c.node.setPointerCapture(e.pointerId); } catch {}
      down = { x: e.clientX, y: e.clientY, t: now(), ox: e.clientX - c.x, oy: e.clientY - c.y, moved: false };
      samples = [{ x: e.clientX, y: e.clientY, t: now() }];
      c.mode = "drag";
      c.node.classList.add("dragging");
    });
    c.node.addEventListener("pointermove", e => {
      if (!down) return;
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) down.moved = true;
      c.x = e.clientX - down.ox; c.y = e.clientY - down.oy;
      samples.push({ x: e.clientX, y: e.clientY, t: now() });
      if (samples.length > 6) samples.shift();
    });
    const release = e => {
      if (!down) return;
      c.node.classList.remove("dragging");
      const d = down; down = null;
      if (!d.moved && now() - d.t < 350) { tap(c); return; }
      const a = samples[0], b = samples[samples.length - 1];
      const dt = Math.max(16, b.t - a.t) / 1000;
      let vx = (b.x - a.x) / dt, vy = (b.y - a.y) / dt;
      const sp = Math.hypot(vx, vy), max = 1500;
      if (sp > max) { vx *= max / sp; vy *= max / sp; }
      c.vx = vx; c.vy = vy; c.vr = vx * 0.4;
      if (sp > 500) meow(c);
      c.mode = "wander";
    };
    c.node.addEventListener("pointerup", release);
    c.node.addEventListener("pointercancel", release);
  }
  function tap(c) {
    meow(c, true);
    play(c, "startle");
    c.taps = now() - c.tapAt < 4000 ? c.taps + 1 : 1;
    c.tapAt = now();
    if (c.taps >= 5) { c.taps = 0; secret(c); return; }
    aim(c, rand(220, 320));
    c.vr = rand(-300, 300);
    c.mode = "wander";
  }
  function secret(c) {
    const b = document.createElement("div");
    b.className = "pet-bubble";
    b.textContent = c.p.secret || (c.p.name ? c.p.name + " t'aime bien" : "Miaou ♥");
    layer.append(b);
    const bx = Math.min(Math.max(c.x + c.s / 2, 110), innerWidth - 110), by = Math.max(c.y - 12, 44);
    b.style.left = bx + "px"; b.style.top = by + "px";
    FX.confetti(c.x + c.s / 2, c.y + c.s / 2, { count: 50, spread: 1.8, power: 0.8 });
    FX.sound.fanfare();
    c.vx = c.vy = 0;
    tween(c, { r: 0 }, 300, () => hold(c, 2600, () => { b.classList.add("out"); setTimeout(() => b.remove(), 400); wander(c); }));
  }

  // ---------- boucle ----------
  function step(t) {
    const dt = Math.min(0.05, (t - (last || t)) / 1000);
    last = t;
    const W = innerWidth, H = innerHeight;
    const pace = calm ? 0.5 : 1;
    for (const c of cats) {
      const s = c.s;
      if (c.mode === "wander") {
        c.boost = 1 + (c.boost - 1) * Math.exp(-dt * 1.5);
        const f = dt * pace * c.boost;
        c.x += c.vx * f; c.y += c.vy * f; c.r += c.vr * f;
        // Après un lancer ou un sursaut, on ralentit jusqu'à la vitesse de balade
        const sp = Math.hypot(c.vx, c.vy), cruise = c.zoomUntil > t ? 420 : 85;
        if (sp > cruise) { const k = Math.exp(-dt * (c.zoomUntil > t ? 0 : 1.2)); c.vx *= k; c.vy *= k; }
        else if (sp < 45) { const k = 45 / (sp || 1); c.vx *= k; c.vy *= k; }
        c.vr *= Math.exp(-dt * (c.zoomUntil > t ? 0 : 0.6));
        if (Math.abs(c.vr) < 12) c.vr = c.vr < 0 ? -12 : 12;
        let hit = false;
        if (c.x < 0) { c.x = 0; c.vx = Math.abs(c.vx); hit = true; }
        if (c.x > W - s) { c.x = W - s; c.vx = -Math.abs(c.vx); hit = true; }
        if (c.y < 0) { c.y = 0; c.vy = Math.abs(c.vy); hit = true; }
        if (c.y > H - s) { c.y = H - s; c.vy = -Math.abs(c.vy); hit = true; }
        if (hit) { c.vr = rand(-140, 140); play(c, "bonk"); }
        if (t > c.nextPeek && !cats.some(o => o.peeking) && !calm) peek(c);
      } else if (c.mode === "tween") {
        const w = c.tw, k = Math.min(1, (t - w.t0) / w.dur), e = ease(k);
        c.x = w.x0 + (w.x1 - w.x0) * e; c.y = w.y0 + (w.y1 - w.y0) * e; c.r = w.r0 + (w.r1 - w.r0) * e;
        if (k >= 1) { const done = w.done; c.tw = null; c.mode = "hold"; c.until = 0; c.after = null; if (done) done(); }
      } else if (c.mode === "hold") {
        if (t >= c.until && c.after) { const a = c.after; c.after = null; a(); }
      }
    }
    // Chocs entre chats : ils repartent chacun de leur côté
    for (let i = 0; i < cats.length; i++) for (let j = i + 1; j < cats.length; j++) {
      const a = cats[i], b = cats[j];
      if (a.mode !== "wander" || b.mode !== "wander") continue;
      const dx = (b.x + b.s / 2) - (a.x + a.s / 2), dy = (b.y + b.s / 2) - (a.y + a.s / 2);
      const d = Math.hypot(dx, dy) || 1, min = (a.s + b.s) * 0.42;
      if (d >= min) continue;
      const nx = dx / d, ny = dy / d;
      const rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
      if (rel > 0) { a.vx -= rel * nx; a.vy -= rel * ny; b.vx += rel * nx; b.vy += rel * ny; }
      const push = (min - d) / 2;
      a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
      a.vr = rand(-200, 200); b.vr = rand(-200, 200);
      play(a, "bonk"); play(b, "bonk");
      meow(Math.random() < 0.5 ? a : b);
    }
    for (const c of cats) c.node.style.transform = `translate3d(${c.x.toFixed(1)}px, ${c.y.toFixed(1)}px, 0) rotate(${c.r.toFixed(1)}deg)`;
    raf = requestAnimationFrame(step);
  }

  // ---------- réactions au jeu ----------
  function react(kind) {
    if (!started) return;
    const free = cats.filter(c => c.mode === "wander");
    if (kind === "good") {
      free.forEach((c, i) => setTimeout(() => { play(c, "hop"); c.vy -= 160; c.boost = 2; }, i * 120));
    } else if (kind === "bad") {
      // Ils filent se cacher en bas de l'écran ; seules les oreilles dépassent
      free.forEach((c, i) => {
        const H = innerHeight;
        tween(c, { y: H - c.s * 0.3, r: 0 }, 550 + i * 120, () => hold(c, 2600, () =>
          tween(c, { y: H - c.s * 1.7 }, 600, () => { c.vy = -rand(50, 80); c.vx = rand(-70, 70); wander(c); })));
      });
    } else if (kind === "perfect") {
      // Sans-faute : ils traversent l'écran en tournant avec les confettis
      free.forEach(c => { aim(c, 520); c.vr = 600 * (Math.random() < 0.5 ? -1 : 1); c.zoomUntil = now() + 3200; play(c, "hop"); });
      meow(cats[0] || {}, true);
    }
  }

  function start() {
    if (started || !pets.length || !window.FX || FX.reduceMotion()) return;
    started = true;
    layer = document.createElement("div");
    layer.className = "pets";
    document.body.prepend(layer);
    cats = pets.map(make);
    cats.forEach((c, i) => enter(c, i % 2 === 0));
    raf = requestAnimationFrame(step);
    addEventListener("resize", () => {
      const s = sizeNow();
      cats.forEach(c => { c.s = s; c.x = Math.min(c.x, innerWidth - s); c.y = Math.min(c.y, innerHeight - s); });
    });
  }

  window.CATS = {
    start,
    react,
    calm(on) { calm = !!on; },
    pets,
  };
})();
