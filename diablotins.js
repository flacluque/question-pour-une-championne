// Les diablotins du fond qui prennent vie : de temps en temps, l'un d'eux (n'importe lequel, au hasard)
// se colore, sort du motif, fait une petite action, puis y retourne. Il est posé exactement sur son double du fond
// et suit la lente glissade du motif.
(() => {
  "use strict";
  const BASE = "img/diablotins/";
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = list => list[(Math.random() * list.length) | 0];
  const SAYS = ["😈", "Hé !", "Coucou", "👀", "Hihi", "Bouh !", "😜"];

  let map = null, layer = null, started = false, calm = false, busy = false, timer = 0;

  // Taille du motif (en px CSS) et décalage actuel de sa glissade
  function motif() {
    const cs = getComputedStyle(document.documentElement);
    const W = parseFloat(cs.getPropertyValue("--motif-w")) || 1552, H = parseFloat(cs.getPropertyValue("--motif-h")) || 1380;
    let tx = 0, ty = 0;
    const t = getComputedStyle(document.body, "::after").transform;
    if (t && t !== "none") { const m = new DOMMatrixReadOnly(t); tx = m.m41; ty = m.m42; }
    return { W, H, ox: -W + tx, oy: -H + ty };
  }

  // Un endroit est libre si rien du site n'est au-dessus (ni carte, ni bouton)
  function isFree(x, y) {
    const top = document.elementFromPoint(x, y);
    return !top || top === document.body || top === document.documentElement;
  }

  function candidates() {
    const { W, H, ox, oy } = motif();
    const cell = W / map.cols, out = [];
    for (const it of map.items) {
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
        const x = ox + (it.x + i) * W, y = oy + (it.y + j) * H, r = it.s * cell / 2;
        if (x < r || y < r || x > innerWidth - r || y > innerHeight - r) continue;
        if (isFree(x, y) && isFree(x - r * 0.6, y) && isFree(x + r * 0.6, y)) out.push({ it, i, j });
      }
    }
    return out;
  }

  // Les petites actions possibles
  const ACTIONS = {
    hop: [
      { opacity: 0, transform: "none" },
      { opacity: 1, transform: "scale(1.05)", offset: 0.15 },
      { transform: "translateY(-30%) scale(1.25) rotate(-8deg)", offset: 0.35 },
      { transform: "translateY(0) scale(1.12, .9)", offset: 0.5 },
      { transform: "translateY(-16%) scale(1.18) rotate(7deg)", offset: 0.65 },
      { opacity: 1, transform: "scale(1)", offset: 0.85 },
      { opacity: 0, transform: "none" },
    ],
    spin: [
      { opacity: 0, transform: "none" },
      { opacity: 1, transform: "scale(1.15)", offset: 0.15 },
      { transform: "scale(1.35) rotate(360deg)", offset: 0.6 },
      { opacity: 1, transform: "scale(1) rotate(360deg)", offset: 0.85 },
      { opacity: 0, transform: "rotate(360deg)" },
    ],
    laugh: [
      { opacity: 0, transform: "none" },
      { opacity: 1, transform: "scale(1.2)", offset: 0.15 },
      { transform: "scale(1.2) rotate(-10deg)", offset: 0.25 }, { transform: "scale(1.2) rotate(10deg)", offset: 0.35 },
      { transform: "scale(1.2) rotate(-8deg)", offset: 0.45 }, { transform: "scale(1.2) rotate(8deg)", offset: 0.55 },
      { transform: "scale(1.2) rotate(-4deg)", offset: 0.65 },
      { opacity: 1, transform: "scale(1)", offset: 0.85 },
      { opacity: 0, transform: "none" },
    ],
    zoom: [
      { opacity: 0, transform: "none" },
      { opacity: 1, transform: "scale(1.1)", offset: 0.15 },
      { transform: "scale(1.75)", offset: 0.45 },
      { transform: "scale(1.65) rotate(4deg)", offset: 0.6 },
      { opacity: 1, transform: "scale(1)", offset: 0.85 },
      { opacity: 0, transform: "none" },
    ],
    peek: [
      { opacity: 0, transform: "none" },
      { opacity: 1, transform: "scale(1.15) rotate(18deg)", offset: 0.2 },
      { transform: "scale(1.2) rotate(18deg) translateY(-8%)", offset: 0.35 },
      { transform: "scale(1.2) rotate(18deg)", offset: 0.45 },
      { transform: "scale(1.2) rotate(18deg) translateY(-8%)", offset: 0.55 },
      { opacity: 1, transform: "scale(1)", offset: 0.85 },
      { opacity: 0, transform: "none" },
    ],
  };

  function wake() {
    timer = 0;
    if (busy || document.hidden || !map) return schedule();
    const list = candidates();
    if (!list.length) return schedule(2500);
    const { it, i, j } = pick(list);
    const img = new Image();
    img.decoding = "async";
    img.className = "diab-img";
    img.alt = "";
    img.onerror = () => schedule();
    img.onload = () => play(it, i, j, img);
    img.src = BASE + it.f + ".png";
  }

  function play(it, i, j, img) {
    busy = true;
    const { W } = motif();
    const cell = W / map.cols, side = it.s * cell;
    const k = side / Math.max(img.naturalWidth, img.naturalHeight);
    const w = img.naturalWidth * k, h = img.naturalHeight * k;
    const node = document.createElement("div");
    node.className = "diab";
    node.style.width = w + "px"; node.style.height = h + "px";
    img.style.width = "100%"; img.style.height = "100%";
    node.append(img);
    layer.append(node);

    // Suit la glissade du fond, image par image
    let raf = 0;
    const follow = () => {
      const m = motif();
      const x = m.ox + (it.x + i) * m.W, y = m.oy + (it.y + j) * m.H;
      node.style.transform = `translate3d(${(x - w / 2).toFixed(1)}px, ${(y - h / 2).toFixed(1)}px, 0) rotate(${it.a.toFixed(2)}deg)`;
      raf = requestAnimationFrame(follow);
    };
    follow();

    const name = pick(Object.keys(ACTIONS));
    const dur = name === "spin" ? 2000 : 2600;
    const anim = img.animate(ACTIONS[name], { duration: dur, easing: "ease-in-out", fill: "both" });
    let bubble = null;
    if (name === "peek" || name === "laugh" || Math.random() < 0.25) {
      bubble = document.createElement("span");
      bubble.className = "diab-say";
      bubble.textContent = pick(SAYS);
      node.append(bubble);
    }
    anim.finished.catch(() => {}).then(() => {
      cancelAnimationFrame(raf);
      node.remove();
      busy = false;
      schedule();
    });
  }

  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(wake, ms ?? (calm ? rand(14000, 24000) : rand(4500, 9500)));
  }

  function start() {
    if (started || !window.FX || FX.reduceMotion()) return;
    started = true;
    fetch(BASE + "map.json").then(r => r.json()).then(m => {
      if (!m || !Array.isArray(m.items) || !m.cols) return;
      map = m;
      layer = document.createElement("div");
      layer.className = "diabs";
      layer.setAttribute("aria-hidden", "true");
      document.body.prepend(layer);
      schedule(2500);
    }).catch(() => {});
  }

  window.DIABLOTINS = {
    start,
    calm(on) { calm = !!on; },
    // pour vérifier l'alignement : DIABLOTINS.debug() dessine le contour de chaque bonhomme du fond
    debug() {
      if (!map || !layer) return;
      const { W, H, ox, oy } = motif(), cell = W / map.cols;
      for (const it of map.items) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
        const d = document.createElement("div"), r = it.s * cell;
        d.style.cssText = `position:fixed;left:${ox + (it.x + i) * W - r / 2}px;top:${oy + (it.y + j) * H - r / 2}px;width:${r}px;height:${r}px;border:2px solid red;border-radius:50%;pointer-events:none;z-index:99`;
        document.body.append(d);
      }
    },
  };
})();
