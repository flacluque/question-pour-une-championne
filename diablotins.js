// Les diablotins du fond qui prennent vie : de temps en temps, l'un d'eux (n'importe lequel, au hasard)
// se colore puis se met vraiment à bouger — la tête se penche, les bras s'agitent, les pieds tapent,
// le corps se plie et rebondit — avant de retourner dans le motif.
// L'image est déformée en direct (WebGL) : une grille posée sur le dessin, dont chaque zone
// (tête, bras, jambes, buste) suit sa propre petite chorégraphie.
// Il est posé exactement sur son double du fond et suit la lente glissade du motif.
// Rien ne bouge pendant les questions.
(() => {
  "use strict";
  const BASE = "img/diablotins/";
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = list => list[(Math.random() * list.length) | 0];
  const PI = Math.PI;
  const SAYS = ["😈", "Hé !", "Coucou", "👀", "Hihi", "Bouh !", "😜", "Youhou", "Dansez !"];

  let map = null, layer = null, started = false, calm = false, busy = false, timer = 0, forced = null;

  // ---------- position dans le motif ----------
  function motif() {
    const cs = getComputedStyle(document.documentElement);
    const W = parseFloat(cs.getPropertyValue("--motif-w")) || 1552, H = parseFloat(cs.getPropertyValue("--motif-h")) || 1380;
    let tx = 0, ty = 0;
    const t = getComputedStyle(document.body, "::after").transform;
    if (t && t !== "none") { const m = new DOMMatrixReadOnly(t); tx = m.m41; ty = m.m42; }
    return { W, H, ox: -W + tx, oy: -H + ty };
  }
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
        if (x < r || y < r * 1.6 || x > innerWidth - r || y > innerHeight - r) continue;
        if (isFree(x, y) && isFree(x - r * 0.7, y) && isFree(x + r * 0.7, y) && isFree(x, y - r * 0.9)) out.push({ it, i, j });
      }
    }
    return out;
  }

  // ---------- rendu WebGL : une grille déformée ----------
  const VS = `
attribute vec2 aUV;
uniform vec2 uSize, uCanvas;
uniform float uHead;              // tête : inclinaison (rad)
uniform float uArmL, uArmR;       // bras gauche / droit : levée (fraction de la hauteur)
uniform float uLegL, uLegR;       // jambes gauche / droite : levée
uniform float uSway;              // buste : balancement (fraction de la largeur), plié depuis les pieds
uniform vec2 uMove, uScale; uniform float uRot; // tout le corps : déplacement, écrasement, rotation
varying vec2 vUV;
void main() {
  vUV = aUV;
  float x = aUV.x, y = aUV.y;
  vec2 P = aUV * uSize;
  // Tête : tourne autour du cou
  float headW = 1.0 - smoothstep(0.30, 0.50, y);
  vec2 neck = vec2(0.5, 0.46) * uSize;
  float a = uHead * headW;
  vec2 d = P - neck;
  P = neck + vec2(d.x * cos(a) - d.y * sin(a), d.x * sin(a) + d.y * cos(a));
  // Bras / ailes : les côtés du buste se lèvent (et s'écartent), d'autant plus qu'on s'éloigne du centre
  float armW = smoothstep(0.10, 0.45, abs(x - 0.5)) * smoothstep(0.24, 0.40, y) * (1.0 - smoothstep(0.62, 0.82, y));
  float arm = x < 0.5 ? uArmL : uArmR;
  P.y -= armW * arm * uSize.y;
  P.x += armW * sign(x - 0.5) * arm * 0.35 * uSize.x;
  // Jambes : chacune se lève de son côté
  float legW = smoothstep(0.66, 0.96, y);
  float wl = 1.0 - smoothstep(0.38, 0.55, x), wr = smoothstep(0.45, 0.62, x);
  P.y -= legW * (wl * uLegL + wr * uLegR) * uSize.y;
  // Buste : se balance en pliant depuis les pieds
  P.x += uSway * uSize.x * pow(1.0 - y, 1.6);
  // Tout le corps : écrasement / étirement depuis les pieds, rotation autour du centre, puis déplacement
  vec2 F = vec2(0.5, 1.0) * uSize;
  P = F + (P - F) * uScale;
  vec2 C = vec2(0.5, 0.55) * uSize, r = P - C;
  P = C + vec2(r.x * cos(uRot) - r.y * sin(uRot), r.x * sin(uRot) + r.y * cos(uRot));
  P += uMove * uSize.y;
  vec2 c = 0.5 + (P - uSize * 0.5) / uCanvas;
  gl_Position = vec4(c.x * 2.0 - 1.0, 1.0 - c.y * 2.0, 0.0, 1.0);
}`;
  const FS = `
precision mediump float;
uniform sampler2D uTex; uniform float uAlpha;
varying vec2 vUV;
void main() { gl_FragColor = texture2D(uTex, vUV) * uAlpha; }`;

  const GRID = 28;
  let glr = null; // rendu partagé (un seul diablotin à la fois)
  function makeRenderer() {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: true });
    if (!gl) return null;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null; };
    const vs = sh(gl.VERTEX_SHADER, VS), fs = sh(gl.FRAGMENT_SHADER, FS);
    if (!vs || !fs) return null;
    const prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
    gl.useProgram(prog);
    // Grille de triangles
    const verts = [];
    for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) {
      const u0 = i / GRID, u1 = (i + 1) / GRID, v0 = j / GRID, v1 = (j + 1) / GRID;
      verts.push(u0, v0, u1, v0, u0, v1, u1, v0, u1, v1, u0, v1);
    }
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "aUV");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach(p => gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const U = {};
    ["uSize", "uCanvas", "uHead", "uArmL", "uArmR", "uLegL", "uLegR", "uSway", "uMove", "uScale", "uRot", "uAlpha", "uTex"]
      .forEach(n => (U[n] = gl.getUniformLocation(prog, n)));
    return { canvas, gl, U, count: verts.length / 2 };
  }

  // ---------- chorégraphies ----------
  // Chaque action donne, à l'instant t (en secondes), la pose du corps. L'appelant l'adoucit au début et à la fin.
  const smooth = k => k * k * (3 - 2 * k);
  const bump = (t, a, b) => (t <= a || t >= b ? 0 : Math.sin(PI * (t - a) / (b - a)));
  const up = v => Math.max(0, v);
  const ACTIONS = {
    // Danse : le buste se balance, les pieds tapent en rythme, les bras s'agitent, petits sauts
    dance: { dur: 3.4, say: 0.35, pose(t) {
      const b = t * 6.6;
      return { head: 0.2 * Math.sin(b), armL: 0.1 * (0.5 + 0.5 * Math.sin(b * 2)), armR: 0.1 * (0.5 + 0.5 * Math.sin(b * 2 + PI)),
        legL: 0.1 * up(Math.sin(b)), legR: 0.1 * up(Math.sin(b + PI)), sway: 0.09 * Math.sin(b), move: [0, -0.05 * Math.abs(Math.sin(b))] };
    } },
    // Coucou : un bras fait de grands signes, la tête se penche
    wave: { dur: 3.0, say: 0.9, init() { this.side = Math.random() < 0.5 ? "armL" : "armR"; }, pose(t) {
      return { head: 0.2 * Math.sin(t * 3.2), [this.side]: 0.13 + 0.1 * Math.sin(t * 11), sway: 0.035 * Math.sin(t * 3.2) };
    } },
    // Fou rire : tout le corps tressaute, la tête part en arrière
    laugh: { dur: 2.8, say: 0.8, pose(t) {
      const b = Math.sin(t * 19);
      return { head: -0.1 + 0.1 * b, armL: 0.05 * (0.5 + 0.5 * b), armR: 0.05 * (0.5 + 0.5 * b), sway: 0.03 * b,
        scale: [1 + 0.045 * b, 1 - 0.06 * b], rot: -0.06 };
    } },
    // Saut : il s'accroupit, bondit bras en l'air (parfois en tournant), retombe en s'écrasant
    jump: { dur: 2.6, say: 0.25, init() { this.spin = Math.random() < 0.4 ? (Math.random() < 0.5 ? -1 : 1) : 0; }, pose(t) {
      const crouch = (t < 0.7 ? bump(t, 0.3, 0.9) : 0) + bump(t, 1.45, 1.8) * 0.8;
      const air = bump(t, 0.7, 1.5);
      const k = Math.min(1, Math.max(0, (t - 0.7) / 0.8));
      return { scale: [1 + 0.14 * crouch - 0.08 * air, 1 - 0.18 * crouch + 0.12 * air], move: [0, -0.45 * air],
        armL: 0.16 * air, armR: 0.16 * air, legL: 0.06 * air, legR: 0.06 * air, head: 0.1 * Math.sin(t * 4),
        rot: this.spin * 2 * PI * smooth(k), keepRot: true };
    } },
    // Étirement : il s'étire en hauteur, bras levés, tête en arrière, puis se relâche
    stretch: { dur: 3.4, say: 0.3, pose(t) {
      const s = bump(t, 0.35, 2.9);
      return { scale: [1 - 0.06 * s, 1 + 0.13 * s], armL: 0.15 * s, armR: 0.15 * s, head: -0.22 * s, sway: 0.03 * s * Math.sin(t * 2.2) };
    } },
    // Pas chassés : il marche un peu vers la gauche puis vers la droite
    walk: { dur: 3.4, say: 0.3, pose(t) {
      const b = t * 9;
      return { legL: 0.11 * up(Math.sin(b)), legR: 0.11 * up(Math.sin(b + PI)), armL: 0.06 * (0.5 + 0.5 * Math.sin(b + PI)),
        armR: 0.06 * (0.5 + 0.5 * Math.sin(b)), head: 0.12 * Math.sin(t * 4.5), sway: 0.035 * Math.sin(b),
        move: [0.22 * Math.sin(t * PI * 2 / 3.4), -0.02 * Math.abs(Math.sin(b))] };
    } },
  };

  // ---------- lecture ----------
  function wake() {
    timer = 0;
    if (calm) return schedule(4000);
    if (busy || document.hidden || !map) return schedule();
    const list = candidates();
    if (!list.length) return schedule(2500);
    const { it, i, j } = pick(list);
    const img = new Image();
    img.decoding = "async";
    img.onerror = () => schedule();
    img.onload = () => play(it, i, j, img);
    img.src = BASE + it.f + ".png";
  }

  function play(it, i, j, img) {
    if (calm) return schedule(4000);
    if (!glr) glr = makeRenderer();
    if (!glr) return playFallback(it, i, j, img);
    busy = true;
    const { gl, U, canvas, count } = glr;
    const { W } = motif();
    const cell = W / map.cols, side = it.s * cell;
    const k = side / Math.max(img.naturalWidth, img.naturalHeight);
    const w = img.naturalWidth * k, h = img.naturalHeight * k;
    // Zone de dessin carrée, bien plus grande que le diablotin : place pour les sauts, les bras et les pirouettes
    const S = Math.max(w, h) * 2.4;
    const dpr = Math.min(2, devicePixelRatio || 1);
    canvas.width = Math.round(S * dpr); canvas.height = Math.round(S * dpr);
    canvas.style.width = S + "px"; canvas.style.height = S + "px";
    canvas.className = "diab-gl";
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.uniform1i(U.uTex, 0);
    gl.uniform2f(U.uSize, w, h);
    gl.uniform2f(U.uCanvas, S, S);

    const node = document.createElement("div");
    node.className = "diab";
    node.style.width = S + "px"; node.style.height = S + "px";
    node.append(canvas);
    layer.append(node);

    const name = forced && ACTIONS[forced] ? forced : pick(Object.keys(ACTIONS));
    forced = null;
    const act = Object.create(ACTIONS[name]);
    if (act.init) act.init();
    const dur = act.dur;
    let bubble = null;
    if (Math.random() < act.say) {
      bubble = document.createElement("span");
      bubble.className = "diab-say";
      bubble.textContent = pick(SAYS);
      bubble.style.top = ((S - h) / 2 - 4) + "px";
      bubble.style.animationDuration = dur + "s";
      node.append(bubble);
    }

    const t0 = performance.now();
    let raf = 0;
    const frame = now => {
      const t = (now - t0) / 1000;
      // Suit la glissade du fond
      const m = motif();
      const x = m.ox + (it.x + i) * m.W, y = m.oy + (it.y + j) * m.H;
      node.style.transform = `translate3d(${(x - S / 2).toFixed(1)}px, ${(y - S / 2).toFixed(1)}px, 0) rotate(${it.a.toFixed(2)}deg)`;
      // Ouverture : il prend ses couleurs, s'anime, puis se fige et repart dans le motif
      const fadeIn = smooth(Math.min(1, t / 0.35)), fadeOut = smooth(Math.min(1, Math.max(0, (dur - t) / 0.45)));
      const e = Math.min(smooth(Math.min(1, Math.max(0, (t - 0.15) / 0.4))), fadeOut);
      const p = act.pose(t);
      gl.uniform1f(U.uHead, (p.head || 0) * e);
      gl.uniform1f(U.uArmL, (p.armL || 0) * e);
      gl.uniform1f(U.uArmR, (p.armR || 0) * e);
      gl.uniform1f(U.uLegL, (p.legL || 0) * e);
      gl.uniform1f(U.uLegR, (p.legR || 0) * e);
      gl.uniform1f(U.uSway, (p.sway || 0) * e);
      const mv = p.move || [0, 0], sc = p.scale || [1, 1];
      gl.uniform2f(U.uMove, mv[0] * e, mv[1] * e);
      gl.uniform2f(U.uScale, 1 + (sc[0] - 1) * e, 1 + (sc[1] - 1) * e);
      gl.uniform1f(U.uRot, (p.rot || 0) * (p.keepRot ? 1 : e));
      gl.uniform1f(U.uAlpha, Math.min(fadeIn, fadeOut));
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, count);
      if (t < dur) raf = requestAnimationFrame(frame);
      else { node.remove(); busy = false; schedule(); }
    };
    raf = requestAnimationFrame(frame);
  }

  // Sans WebGL : l'ancienne version (il se colore et fait un petit saut)
  function playFallback(it, i, j, img) {
    busy = true;
    const { W } = motif();
    const cell = W / map.cols, side = it.s * cell;
    const k = side / Math.max(img.naturalWidth, img.naturalHeight);
    const w = img.naturalWidth * k, h = img.naturalHeight * k;
    const node = document.createElement("div");
    node.className = "diab";
    node.style.width = w + "px"; node.style.height = h + "px";
    img.className = "diab-img"; img.style.width = "100%"; img.style.height = "100%";
    node.append(img);
    layer.append(node);
    let raf = 0;
    const follow = () => {
      const m = motif();
      const x = m.ox + (it.x + i) * m.W, y = m.oy + (it.y + j) * m.H;
      node.style.transform = `translate3d(${(x - w / 2).toFixed(1)}px, ${(y - h / 2).toFixed(1)}px, 0) rotate(${it.a.toFixed(2)}deg)`;
      raf = requestAnimationFrame(follow);
    };
    follow();
    img.animate([
      { opacity: 0, transform: "none" }, { opacity: 1, transform: "scale(1.05)", offset: 0.15 },
      { transform: "translateY(-30%) scale(1.25) rotate(-8deg)", offset: 0.35 }, { transform: "translateY(0) scale(1.12, .9)", offset: 0.5 },
      { opacity: 1, transform: "scale(1)", offset: 0.85 }, { opacity: 0, transform: "none" },
    ], { duration: 2600, easing: "ease-in-out", fill: "both" }).finished.catch(() => {}).then(() => {
      cancelAnimationFrame(raf); node.remove(); busy = false; schedule();
    });
  }

  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(wake, ms ?? rand(4500, 9500));
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
    // Pendant les questions : aucun diablotin ne bouge
    calm(on) { calm = !!on; },
    // Pour tester : DIABLOTINS.play("dance") anime tout de suite un diablotin visible
    play(name) {
      if (!map || busy) return false;
      const list = candidates(); if (!list.length) return false;
      const { it, i, j } = pick(list);
      forced = name || null;
      const img = new Image();
      img.onload = () => play(it, i, j, img);
      img.src = BASE + it.f + ".png";
      return true;
    },
    actions: () => Object.keys(ACTIONS),
    // Pour vérifier une chorégraphie : renvoie des images (data URL) de l'action à plusieurs instants
    async preview(name, file, times) {
      if (!glr) glr = makeRenderer();
      if (!glr || !ACTIONS[name]) return [];
      const img = new Image(); img.src = BASE + file + ".png"; await img.decode();
      const { gl, U, canvas, count } = glr;
      const h = 160, w = img.naturalWidth * h / img.naturalHeight, S = Math.max(w, h) * 2.4;
      canvas.width = Math.round(S); canvas.height = Math.round(S);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.uniform1i(U.uTex, 0); gl.uniform2f(U.uSize, w, h); gl.uniform2f(U.uCanvas, S, S); gl.uniform1f(U.uAlpha, 1);
      const act = Object.create(ACTIONS[name]); if (act.init) act.init();
      return times.map(t => {
        const p = act.pose(t);
        gl.uniform1f(U.uHead, p.head || 0); gl.uniform1f(U.uArmL, p.armL || 0); gl.uniform1f(U.uArmR, p.armR || 0);
        gl.uniform1f(U.uLegL, p.legL || 0); gl.uniform1f(U.uLegR, p.legR || 0); gl.uniform1f(U.uSway, p.sway || 0);
        const mv = p.move || [0, 0], sc = p.scale || [1, 1];
        gl.uniform2f(U.uMove, mv[0], mv[1]); gl.uniform2f(U.uScale, sc[0], sc[1]); gl.uniform1f(U.uRot, p.rot || 0);
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLES, 0, count);
        return canvas.toDataURL();
      });
    },
  };
})();
