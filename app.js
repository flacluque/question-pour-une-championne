(() => {
  "use strict";

  const LETTERS = ["A", "B", "C", "D"];
  const BUCKET = "photos";
  const cfg = window.QUIZ_CONFIG || {};
  const people = (Array.isArray(cfg.people) ? cfg.people : Array.isArray(cfg.admins) ? cfg.admins : [])
    .filter(p => p && (p.email || p.head));
  if (!people.length && cfg.adminEmail) people.push({ name: "Admin", email: cfg.adminEmail });
  const admins = people.filter(p => p.email);
  const heads = people.filter(p => p.head);
  const FX = window.FX || { sound: new Proxy({}, { get: () => () => {} }), confetti() {}, confettiFrom() {}, reduceMotion: () => true, muted: true };

  // Petites phrases des têtes
  const LINES = {
    hello: ["Prêt·e à perdre ?", "Pas de triche !", "Facile, non ?", "On parie ?", "Je t'ai à l'œil.", "Concentre-toi…"],
    good: ["Bien joué !", "Évidemment.", "Trop fort·e !", "Ok, respect.", "Yes !"],
    bad: ["Sérieux ?!", "Raté !", "Aïe…", "Mais non !", "Tu m'as vexé·e."],
  };
  const pickOne = list => list[(Math.random() * list.length) | 0];
  function shuffle(list) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  // Prénom du joueur, retenu sur cet appareil
  function storedPlayer() { try { return localStorage.getItem("qpuc-player") || ""; } catch { return ""; } }
  function storePlayer(v) { try { localStorage.setItem("qpuc-player", v); } catch {} }
  // Phrase perso de la personne (config.js > lines), sans répéter la précédente
  const lastLine = new Map();
  // Réaction de la tête quand on répond (config.js > good / bad), sinon phrases par défaut
  function reactionLine(person, good) {
    const own = person && person[good ? "good" : "bad"];
    return pickOne(Array.isArray(own) && own.length ? own : good ? LINES.good : LINES.bad);
  }
  function helloLine(person) {
    const list = person && Array.isArray(person.lines) && person.lines.length ? person.lines : LINES.hello;
    let line = pickOne(list);
    if (list.length > 1) while (line === lastLine.get(person)) line = pickOne(list);
    lastLine.set(person, line);
    return line;
  }
  const configured = !!(cfg.supabaseUrl && cfg.supabaseAnonKey && !/VOTRE-/.test(cfg.supabaseUrl + cfg.supabaseAnonKey));
  const sb = configured && window.supabase ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey) : null;

  const view = document.getElementById("view");
  const adminLink = document.getElementById("adminLink");

  const state = {
    loaded: false, error: "",
    quizzes: [],              // quiz visibles (publiés + brouillons de l'admin connecté)
    quizId: null,             // quiz ouvert (partie ou gestion)
    questions: [], questionsFor: null, questionsLoading: false,
    mode: "home",             // home | intro | quiz | end | login | admin | adminQuiz
    idx: 0, picked: null, results: [], fresh: false, log: [], orders: null, saved: false, draft: null, outcome: null,
    player: storedPlayer(),
    session: null,
    loginErr: "", loginWho: 0,
    form: emptyForm(), editingId: null,
    uploading: false, saving: false,
  };

  function emptyForm(kind = "choice") {
    return { kind, question: "", answers: ["", "", "", ""], correct: 0, tf: 0,
      slider: { min: "0", max: "100", step: "1", unit: "", answer: "", tol: "0" },
      order: ["", "", "", ""], accepted: "", blindMode: "choice", promptPath: null, effect: "blur", focus: { x: 50, y: 45 },
      photoPath: null, photoCaption: "" };
  }
  const uid = () => state.session && state.session.user ? state.session.user.id : null;
  const currentQuiz = () => state.quizzes.find(q => q.id === state.quizId) || null;
  const countOf = q => (q.questions && q.questions[0] && q.questions[0].count) || 0;
  const personFor = quiz => (quiz && people.find(p => p.id && p.id === quiz.owner)) || null;
  // Celui ou celle qui « présente » une partie : l'auteur du quiz, sinon l'autre tête au hasard
  function hostFor(quiz) {
    const p = personFor(quiz);
    if (p && p.head) return p;
    return heads.length ? heads[(quiz ? quiz.id.charCodeAt(0) : 0) % heads.length] : null;
  }

  function headImg(p, cls = "head") {
    return el("img", { class: cls, src: p.head, alt: p.name ? "Tête de " + p.name : "", draggable: "false" });
  }
  function bubble(text, side = "top") {
    return el("span", { class: "bubble bubble-" + side, text });
  }

  // Bouton son
  const soundBtn = document.getElementById("soundToggle");
  function syncSoundBtn() {
    if (!soundBtn) return;
    soundBtn.setAttribute("aria-pressed", String(!FX.muted));
    soundBtn.setAttribute("aria-label", FX.muted ? "Activer le son" : "Couper le son");
    soundBtn.classList.toggle("is-muted", FX.muted);
  }
  if (soundBtn) {
    soundBtn.addEventListener("click", () => { FX.muted = !FX.muted; syncSoundBtn(); if (!FX.muted) FX.sound.pop(); });
    syncSoundBtn();
  }

  // ---------- utilitaires ----------
  function el(tag, attrs = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k === "value") n.value = v;
      else if (k === "checked") n.checked = true;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const c of kids.flat()) if (c != null) n.append(c);
    return n;
  }
  function photoUrl(path) {
    if (!path || !sb) return null;
    return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  }
  const VIDEO_EXT = ["mp4", "mov", "m4v", "webm", "ogv"];
  const MAX_VIDEO_MB = 50; // limite d'envoi par fichier de l'offre gratuite Supabase
  function isVideo(path) { return !!path && VIDEO_EXT.includes(String(path).split(".").pop().toLowerCase()); }
  const AUDIO_EXT = ["mp3", "m4a", "aac", "wav", "ogg", "oga", "flac"];
  function isAudio(path) { return !!path && AUDIO_EXT.includes(String(path).split(".").pop().toLowerCase()); }
  // Affiche une photo, une vidéo ou un son selon le fichier
  function media(path, { cls = null, alt = "", play = false, preview = false } = {}) {
    const src = photoUrl(path);
    if (isAudio(path)) {
      if (cls) return el("div", { class: cls + " audio-thumb", "aria-label": "Son", text: "♪" });
      const a = el("audio", { src, preload: "metadata", "aria-label": alt || "Son" });
      a.controls = true; if (play) a.autoplay = true;
      return a;
    }
    if (!isVideo(path)) return el("img", { class: cls, src, alt });
    const v = el("video", { class: cls, src: src + (preview ? "#t=0.1" : ""), playsinline: true, preload: "metadata",
      "aria-label": alt || "Vidéo" });
    v.muted = !play; v.playsInline = true;
    if (play) { v.controls = true; v.autoplay = true; v.loop = true; }
    return v;
  }
  let toastTimer;
  function toast(msg) {
    const t = document.getElementById("toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 2600);
  }
  function scrollTop() { window.scrollTo({ top: 0, behavior: "smooth" }); }
  function plural(n, one, many) { return n + " " + (n > 1 ? many : one); }
  function setHash(h) {
    const url = location.pathname + location.search + (h ? "#" + h : "");
    if (location.href.endsWith(url)) return;
    history.replaceState(null, "", url);
  }
  function quizLink(id) { return location.origin + location.pathname + "#quiz-" + id; }

  // Réduit les grosses photos de téléphone avant l'envoi (max 1600 px, JPEG).
  async function shrinkImage(file) {
    try {
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
      const bmp = await createImageBitmap(file);
      const max = 1600, scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
      if (scale === 1 && file.size < 1.5e6) return file;
      const c = document.createElement("canvas");
      c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
      c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
      const blob = await new Promise(r => c.toBlob(r, "image/jpeg", 0.85));
      return blob || file;
    } catch { return file; }
  }
  function authHint(error) {
    const m = String(error && (error.message || error.code) || "");
    if (/JWT|row-level security|permission|401|403|42501/i.test(m)) return "Ta session admin a expiré. Déconnecte-toi puis reconnecte-toi.";
    return "";
  }

  // ---------- données ----------
  async function loadQuizzes() {
    if (!sb) { state.loaded = true; render(); return; }
    const { data, error } = await sb.from("quizzes")
      .select("id, title, description, published, owner, created_at, questions(count)")
      .order("created_at", { ascending: true });
    if (error) state.error = "Les quiz n'ont pas pu être chargés. Recharge la page.";
    else { state.quizzes = data || []; state.error = ""; }
    state.loaded = true;
    render();
  }

  async function loadQuestions(quizId) {
    state.questionsLoading = true; state.questionsFor = quizId;
    const { data, error } = await sb.from("questions")
      .select("*").eq("quiz_id", quizId)
      .order("position", { ascending: true }).order("created_at", { ascending: true });
    if (state.questionsFor !== quizId) return; // une autre demande a pris le relais
    state.questionsLoading = false;
    state.questions = error ? [] : (data || []);
    if (error) toast("Les questions n'ont pas pu être chargées.");
    render();
  }

  async function refreshAll() {
    await loadQuizzes();
    if (state.quizId) await loadQuestions(state.quizId);
  }

  async function boot() {
    render();
    playSplash();
    if (sb) {
      const { data } = await sb.auth.getSession();
      state.session = data.session;
      sb.auth.onAuthStateChange((_e, session) => { state.session = session; });
    }
    await loadQuizzes();
    routeFromHash();
  }

  function routeFromHash() {
    const m = /^#quiz-([0-9a-f-]{36})$/i.exec(location.hash);
    if (m) openQuiz(m[1]);
  }
  window.addEventListener("hashchange", routeFromHash);

  // ---------- navigation ----------
  function goHome() {
    state.mode = "home"; state.quizId = null; setHash(""); render(); scrollTop();
  }
  function openQuiz(id) {
    state.quizId = id; state.mode = "intro"; state.questions = []; setHash("quiz-" + id);
    render(); scrollTop();
    if (sb) loadQuestions(id);
  }
  document.getElementById("home").addEventListener("click", goHome);

  // ---------- rendu ----------
  function render() {
    view.replaceChildren();
    adminLink.hidden = ["admin", "adminQuiz", "login"].includes(state.mode);
    const fn = { home: renderHome, intro: renderIntro, quiz: renderQuiz, end: renderEnd, login: renderLogin, admin: renderAdmin, adminQuiz: renderAdminQuiz }[state.mode];
    view.append(fn());
  }

  function pageHead(title, sub) {
    return el("div", { class: "page-head" }, el("h1", { text: title }), sub ? el("p", { class: "muted", text: sub }) : null);
  }

  function renderHome() {
    const box = el("div", { class: "stack", style: "gap:24px" },
      renderDuo(),
      pageHead("Choisis ton quiz", "Choix multiples, vrai ou faux, blind test, photo mystère… À chaque bonne réponse, une photo ou une vidéo se débloque."));
    if (!configured) {
      box.append(el("section", { class: "card empty" },
        el("h2", { text: "Il reste à brancher Supabase" }),
        el("p", { class: "muted" }, "Remplis ", el("code", { text: "config.js" }), " avec l'adresse et la clé de ton projet Supabase (voir le README).")));
      return box;
    }
    if (!state.loaded) { box.append(el("p", { class: "muted", text: "Chargement des quiz…" })); return box; }
    if (state.error) { box.append(el("p", { class: "notice err", text: state.error })); return box; }
    const list = state.quizzes.filter(q => q.published);
    if (!list.length) {
      box.append(el("section", { class: "card empty" },
        el("h2", { text: "Aucun quiz pour l'instant" }),
        el("p", { class: "muted", text: "Les quiz apparaîtront ici dès qu'ils seront publiés depuis l'espace admin." })));
      return box;
    }
    box.append(el("div", { class: "quiz-grid" }, list.map(q =>
      el("button", { type: "button", class: "quiz-card", onclick: () => { FX.sound.tick(); openQuiz(q.id); } },
        personFor(q) && personFor(q).head ? headImg(personFor(q), "card-head") : null,
        el("span", { class: "tag", text: plural(countOf(q), "question", "questions") + (personFor(q) ? " · par " + personFor(q).name : "") }),
        el("h3", { text: q.title }),
        q.description ? el("p", { text: q.description }) : null,
        el("span", { class: "go", text: "Jouer →" })))));
    return box;
  }

  // Les deux têtes qui arrivent des côtés, se cognent, puis flottent. Un clic les fait parler.
  let duoPlayed = false;
  function renderDuo() {
    if (!heads.length) return null;
    // On attend que la liste soit chargée pour jouer l'entrée une seule fois, sans saccade
    const waiting = configured && !state.loaded && !duoPlayed;
    const first = !waiting && !duoPlayed && !FX.reduceMotion();
    if (!waiting) duoPlayed = true;
    const stage = el("div", { class: "duo" + (waiting ? " duo-wait" : first ? " duo-enter" : ""), "aria-hidden": "true" });
    heads.slice(0, 2).forEach((p, i) => {
      const side = i === 0 ? "left" : "right";
      const wrap = el("button", { type: "button", class: "duo-head duo-" + side, tabindex: "-1", onclick: () => poke(wrap, p) },
        el("span", { class: "float" }, headImg(p)));
      stage.append(wrap);
    });
    stage.append(el("span", { class: "duo-vs", text: "?" }));
    if (first) setTimeout(() => { if (stage.isConnected) FX.sound.pop(); }, 900);
    return stage;
  }
  // ---------- ouverture : le titre en géant, les deux têtes, puis tout rejoint sa place ----------
  const SPLASH_WORDS = ["Question", "pour une", "championne"];
  function playSplash() {
    let seen = false;
    try { seen = sessionStorage.getItem("qpuc-splash") === "1"; } catch {}
    if (seen || location.hash || state.mode !== "home" || FX.reduceMotion()) return;
    try { sessionStorage.setItem("qpuc-splash", "1"); } catch {}
    duoPlayed = true; // l'entrée des têtes se fait ici, pas une seconde fois sur l'accueil
    render();
    window.scrollTo(0, 0);
    document.body.classList.add("splashing");

    const mark = el("span", { class: "splash-mark", text: "?" });
    const words = SPLASH_WORDS.map((w, i) => el("span", { class: "splash-word" + (i === 2 ? " accent" : ""), style: "--w:" + i },
      [...w].map((c, j) => el("span", { class: "splash-ch", style: "--c:" + j, text: c }))));
    const pair = heads.slice(0, 2).map((p, i) => el("span", { class: "splash-head splash-head-" + (i ? "r" : "l") },
      el("span", { class: "float" }, headImg(p))));
    const overlay = el("div", { class: "splash", "aria-hidden": "true" },
      el("div", { class: "splash-stage" },
        mark,
        el("div", { class: "splash-title" }, words),
        pair.length ? el("div", { class: "splash-heads" }, pair) : null));
    document.body.append(overlay);

    const timers = [];
    const at = (ms, fn) => timers.push(setTimeout(fn, ms));
    at(150, () => FX.sound.whoosh());
    at(600, () => FX.sound.pop());
    SPLASH_WORDS.forEach((_, i) => at(700 + i * 280, () => FX.sound.tick()));
    if (pair.length) at(2350, () => { FX.sound.boing(); overlay.classList.add("bumped"); });

    let leaving = false;
    const leave = () => {
      if (leaving) return;
      leaving = true;
      timers.forEach(clearTimeout);
      FX.sound.whoosh();
      overlay.classList.add("leaving");
      const DUR = 800, ease = "cubic-bezier(.65, 0, .25, 1)";
      const fly = (node, target, delay = 0, extra = {}) => {
        if (!node || !target) return null;
        const a = node.getBoundingClientRect(), b = target.getBoundingClientRect();
        if (!a.width || !b.width) return null;
        const s = b.width / a.width;
        const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
        return node.animate([{ transform: "translate(0, 0) scale(1)", ...extra.from }, { transform: `translate(${dx}px, ${dy}px) scale(${s})`, ...extra.to }],
          { duration: DUR, delay, easing: ease, fill: "forwards" });
      };
      const brandWords = document.querySelectorAll(".brand .bw");
      const anims = [
        fly(mark, document.querySelector(".brand-mark")),
        ...words.map((w, i) => fly(w, brandWords[i], 40 + i * 50, i === 2 ? { from: { color: getComputedStyle(w).color }, to: { color: getComputedStyle(document.body).color } } : {})),
        ...pair.map((h, i) => fly(h, document.querySelector(".duo .duo-" + (i ? "right" : "left")), 90)),
      ].filter(Boolean);
      // Le décor s'efface pendant que tout vole vers sa place
      overlay.animate([{ backgroundColor: getComputedStyle(overlay).backgroundColor }, { backgroundColor: "transparent" }], { duration: DUR, easing: ease, fill: "forwards" });
      Promise.all(anims.map(a => a.finished.catch(() => {}))).then(() => {
        document.body.classList.remove("splashing");
        document.body.classList.add("splash-landed");
        overlay.remove();
        setTimeout(() => document.body.classList.remove("splash-landed"), 1200);
      });
    };
    at(3700, leave);
    overlay.addEventListener("pointerdown", leave);
    window.addEventListener("keydown", function onKey() { window.removeEventListener("keydown", onKey); leave(); });
  }

  function poke(wrap, person) {
    FX.sound.boing();
    wrap.classList.remove("poked"); void wrap.offsetWidth; wrap.classList.add("poked");
    wrap.querySelector(".bubble")?.remove();
    const b = bubble(helloLine(person), wrap.classList.contains("duo-left") ? "left" : "right");
    wrap.append(b);
    setTimeout(() => b.remove(), 2200);
  }

  function hostEl(quiz, mood = null, line = null) {
    const p = hostFor(quiz);
    if (!p) return null;
    return el("div", { class: "host" + (mood ? " host-" + mood : "") },
      el("span", { class: "float" }, headImg(p)),
      line ? bubble(line, "right") : null);
  }

  function renderIntro() {
    const quiz = currentQuiz();
    if (!quiz) {
      return el("section", { class: "card empty" },
        el("h2", { text: state.loaded ? "Ce quiz n'existe pas ou n'est plus disponible" : "Chargement…" }),
        state.loaded ? el("button", { type: "button", onclick: goHome, text: "Voir tous les quiz" }) : null);
    }
    const n = state.questions.length;
    const ready = !state.questionsLoading && state.questionsFor === quiz.id;
    const author = personFor(quiz);
    return el("div", { class: "stack", style: "gap:24px" },
      pageHead(quiz.title, quiz.description || null),
      el("section", { class: "card" },
        el("div", { class: "q-head" },
          hostEl(quiz, "hello", ready && n ? helloLine(hostFor(quiz)) : null),
          el("div", { class: "stack" },
            el("span", { class: "tag", text: ready ? plural(n, "question", "questions") + (author ? " · par " + author.name : "") : "Chargement des questions…" }),
            ready && !n
              ? el("p", { class: "muted", text: "Ce quiz n'a pas encore de questions." })
              : el("p", { class: "muted", text: "À chaque bonne réponse, une photo ou une vidéo se débloque. À la fin, tu découvres ton score." }))),
        ready && n ? el("label", { for: "player-name", class: "player-field" }, "Ton prénom ",
          el("span", { class: "hint", text: "(pour que l'auteur du quiz voie ton score)" }),
          el("input", { type: "text", id: "player-name", maxlength: "40", autocomplete: "given-name", placeholder: "Ex : Léa",
            value: state.player, oninput: e => { state.player = e.target.value; storePlayer(e.target.value.trim()); } })) : null,
        el("div", { class: "row" },
          el("button", { type: "button", disabled: !ready || !n, onclick: startQuiz, text: "Commencer" }),
          el("button", { type: "button", class: "ghost", onclick: goHome, text: "Autres quiz" }))));
  }

  // ---------- types de questions ----------
  const KINDS = {
    choice:    { label: "Choix multiple",        hint: "4 réponses, une seule bonne" },
    truefalse: { label: "Vrai ou faux",          hint: "Une affirmation, vraie ou fausse" },
    slider:    { label: "Curseur",               hint: "Un chiffre à estimer, avec une marge" },
    order:     { label: "Remettre dans l'ordre", hint: "3 à 8 éléments à classer" },
    text:      { label: "Réponse libre",         hint: "On tape la réponse, petites fautes tolérées" },
    mystery:   { label: "Photo mystère",         hint: "Photo floutée ou zoomée, dévoilée à la fin" },
    blindtest: { label: "Blind test",            hint: "Un son ou une musique à reconnaître" },
  };
  const kindOf = q => (q && KINDS[q.kind] ? q.kind : "choice");
  const isChoiceKind = k => k === "choice" || k === "mystery" || k === "blindtest";
  const qData = q => (q && q.data && typeof q.data === "object" ? q.data : {});
  // Façon de répondre : un blind test peut se jouer en choix multiple ou en réponse libre
  const answerKindOf = (k, mode) => (k === "blindtest" && mode === "text" ? "text" : k);
  const answerKind = q => answerKindOf(kindOf(q), qData(q).answer);
  function num(v) { const n = parseFloat(String(v ?? "").replace(",", ".")); return Number.isFinite(n) ? n : NaN; }
  const numFmt = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });
  function withUnit(v, unit) { return numFmt.format(v) + (unit ? " " + unit : ""); }

  // La bonne réponse, en texte (pour l'affichage et l'historique)
  function correctText(q) {
    const k = answerKind(q), a = q.answers || [], d = qData(q);
    if (k === "slider") return withUnit(num(d.answer), d.unit);
    if (k === "order") return a.join(" → ");
    if (k === "text") return a[0] || "";
    return a[Number(q.correct)] || "";
  }

  // Réponse libre : on ignore majuscules, accents, ponctuation, articles, et on tolère 1-2 fautes de frappe
  function normalize(s) {
    return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, " ").trim().replace(/^(le|la|les|l|un|une|des|du|de|d) /, "").trim();
  }
  function levenshtein(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[n];
  }
  function textMatches(input, accepted) {
    const n = normalize(input);
    if (!n) return false;
    return accepted.some(acc => {
      const m = normalize(acc);
      if (!m) return false;
      const tol = m.length >= 9 ? 2 : m.length >= 4 ? 1 : 0;
      return n === m || levenshtein(n, m) <= tol;
    });
  }

  // ---------- partie ----------
  function startQuiz() {
    FX.sound.whoosh();
    state.mode = "quiz"; state.idx = 0; state.picked = null; state.results = []; state.log = []; state.fresh = false;
    state.saved = false;
    // Ordre des réponses mélangé à chaque partie (la bonne n'est jamais au même endroit)
    state.orders = state.questions.map(q => {
      const k = answerKind(q);
      if (k === "truefalse") return [0, 1];
      return isChoiceKind(k) ? shuffle((q.answers || []).map((_, i) => i)) : null;
    });
    state.questions.forEach(q => [q.photo_path, q.prompt_media].forEach(p => {
      if (p && !isVideo(p) && !isAudio(p)) { const i = new Image(); i.src = photoUrl(p); }
    }));
    initDraft();
    render(); scrollTop();
  }

  // Brouillon de la réponse en cours (curseur, ordre, texte)
  function initDraft() {
    const q = state.questions[state.idx];
    state.outcome = null; state.blindLevel = 0;
    if (!q) { state.draft = null; return; }
    const k = answerKind(q), d = qData(q);
    if (k === "slider") {
      const min = num(d.min), max = num(d.max), step = num(d.step) || 1;
      state.draft = { value: Math.round(((min + max) / 2 - min) / step) * step + min };
    } else if (k === "order") {
      const idx = (q.answers || []).map((_, i) => i);
      let o = shuffle(idx);
      for (let t = 0; t < 10 && idx.length > 1 && o.every((v, i) => v === i); t++) o = shuffle(idx);
      state.draft = { order: o };
    } else if (k === "text") {
      state.draft = { text: "" };
    } else state.draft = null;
  }

  function renderQuiz() {
    const qs = state.questions;
    const quiz = currentQuiz();
    if (!qs.length) { state.mode = "intro"; return renderIntro(); }
    if (state.idx >= qs.length) { state.mode = "end"; return renderEnd(); }
    const q = qs[state.idx];
    const k = kindOf(q);
    const answered = state.picked != null;
    const good = answered && !!(state.outcome && state.outcome.good);
    const fresh = answered && state.fresh; // premier affichage après la réponse : on joue les animations

    const progress = el("div", { class: "progress", "aria-hidden": "true" },
      qs.map((_, i) => el("span", { class: i < state.results.length ? (state.results[i] ? "done-good" : "done-bad") : i === state.idx ? "current" : "" })));

    const card = el("section", { class: "card" + (fresh && !good ? " card-bad" : "") },
      progress,
      el("div", { class: "q-head" },
        hostEl(quiz, answered ? (good ? "good" : "bad") : null, fresh ? reactionLine(hostFor(quiz), good) : null),
        el("div", { class: "stack" },
          el("span", { class: "tag", text: "Question " + (state.idx + 1) + " sur " + qs.length + (k !== "choice" ? " · " + KINDS[k].label : "") }),
          el("h2", { class: answered ? "" : "q-in", text: q.question }))),
      renderPrompt(q, answered),
      renderAnswerArea(q, answerKind(q), answered, good, fresh));

    if (answered) card.append(renderReveal(q, answerKind(q), good));
    return card;
  }

  // Média dans la question : photo mystère (floutée / zoomée) ou son du blind test
  function renderPrompt(q, answered) {
    const path = q.prompt_media;
    if (!path) return null;
    if (isAudio(path) || kindOf(q) === "blindtest") return renderAudioPlayer(path, answered, q);
    const d = qData(q);
    const effect = kindOf(q) === "mystery" ? (d.effect || "blur") : "none";
    const fx = el("div", { class: "prompt-media fx-" + effect + (answered ? " revealed" : "") });
    if (effect === "zoom") fx.style.setProperty("--focus", (d.focus_x ?? 50) + "% " + (d.focus_y ?? 45) + "%");
    const m = media(path, { alt: answered ? "Photo de la question" : "Photo mystère", preview: !isVideo(path) });
    if (isVideo(path)) { m.controls = true; m.loop = true; m.muted = kindOf(q) !== "blindtest"; }
    fx.append(m);
    if (!answered && effect !== "none") fx.append(el("span", { class: "prompt-badge", text: effect === "zoom" ? "Zoom ×3" : "Flouté" }));
    return fx;
  }

  // Blind test : l'extrait s'allonge par niveaux (3 s, puis 5 s, puis 10 s). Après la réponse, on écoute en entier.
  const BLIND_LEVELS = [3, 5, 10];
  function renderAudioPlayer(path, answered, q) {
    const video = isVideo(path);
    const m = el(video ? "video" : "audio", { src: photoUrl(path), preload: "auto", playsinline: "" });
    if (video) { m.className = "blind-video"; if (answered) m.controls = true; }
    const limited = !answered && kindOf(q) === "blindtest";
    const limit = () => (limited ? BLIND_LEVELS[state.blindLevel || 0] : Infinity);
    const bar = el("span", { class: "blind-bar", "aria-hidden": "true" }, el("i"));
    const btn = el("button", { type: "button", class: "blind-play" },
      el("span", { class: "blind-icon", "aria-hidden": "true", text: "▶" }),
      el("span", { class: "eq", "aria-hidden": "true" }, el("i"), el("i"), el("i"), el("i"), el("i")),
      el("span", { class: "blind-label" }));
    const more = el("button", { type: "button", class: "ghost small blind-more", hidden: true });
    const level = el("p", { class: "blind-level muted" });
    let listened = false, raf = 0;
    const idleLabel = () => limited ? "Écouter " + limit() + " s" : (m.currentTime > 0 ? "Réécouter" : answered ? "Écouter en entier" : "Écouter l'extrait");
    const update = playing => {
      btn.classList.toggle("playing", playing);
      btn.querySelector(".blind-icon").textContent = playing ? "❚❚" : "▶";
      btn.querySelector(".blind-label").textContent = playing ? "En écoute…" : idleLabel();
      btn.setAttribute("aria-label", playing ? "Mettre en pause" : idleLabel());
      if (!limited) return;
      const lv = state.blindLevel || 0;
      level.textContent = "Niveau " + (lv + 1) + " sur " + BLIND_LEVELS.length + " · extrait de " + limit() + " secondes";
      const nextLv = BLIND_LEVELS[lv + 1];
      more.hidden = !(listened && nextLv) || playing;
      if (nextLv) more.textContent = "Pas trouvé ? Écouter " + nextLv + " s";
    };
    const tick = () => {
      const lim = limit();
      bar.firstChild.style.width = (Number.isFinite(lim) ? Math.min(100, m.currentTime / lim * 100) : (m.duration ? m.currentTime / m.duration * 100 : 0)) + "%";
      if (m.currentTime >= lim) { m.pause(); m.currentTime = 0; bar.firstChild.style.width = "0%"; return; }
      if (!m.paused) raf = requestAnimationFrame(tick);
    };
    const play = () => {
      if (limited) m.currentTime = 0;
      m.play().catch(() => toast("Impossible de lire ce son sur cet appareil."));
    };
    btn.addEventListener("click", () => { if (m.paused) play(); else { m.pause(); if (limited) m.currentTime = 0; } });
    more.addEventListener("click", () => {
      state.blindLevel = Math.min(BLIND_LEVELS.length - 1, (state.blindLevel || 0) + 1);
      FX.sound.tick();
      play();
    });
    m.addEventListener("play", () => { listened = true; update(true); cancelAnimationFrame(raf); raf = requestAnimationFrame(tick); });
    m.addEventListener("pause", () => { cancelAnimationFrame(raf); update(false); });
    m.addEventListener("ended", () => { m.currentTime = 0; update(false); });
    update(false);
    return el("div", { class: "blind" + (answered ? " done" : "") },
      video ? m : null,
      el("div", { class: "blind-controls" }, btn, bar, video ? null : m),
      limited ? level : null,
      limited ? more : null);
  }

  function renderAnswerArea(q, k, answered, good, fresh) {
    if (isChoiceKind(k) || k === "truefalse") {
      const order = (state.orders && state.orders[state.idx]) || (q.answers || []).map((_, i) => i);
      const correct = Number(q.correct);
      const picked = state.outcome ? state.outcome.pickedIdx : null;
      return el("div", { class: "answers" + (k === "truefalse" ? " answers-tf" : "") + (answered ? "" : " answers-in") },
        order.map((i, pos) => {
          let cls = "answer";
          if (answered) {
            if (i === correct) cls += " is-good" + (fresh ? (good ? " pop" : " hint") : "");
            else if (i === picked) cls += " is-bad" + (fresh ? " shake" : "");
            else cls += " is-faded";
          }
          const label = (q.answers || [])[i];
          return el("button", { type: "button", class: cls, style: "--i:" + pos, disabled: answered, onclick: () => answerChoice(i) },
            el("span", { class: "letter", text: k === "truefalse" ? (i === 0 ? "V" : "F") : LETTERS[pos] }), el("span", { class: "txt", text: label }));
        }));
    }
    if (k === "slider") return renderSlider(q, answered, good, fresh);
    if (k === "order") return renderOrder(q, answered, good, fresh);
    if (k === "text") return renderTextAnswer(q, answered, good, fresh);
    return null;
  }

  function renderSlider(q, answered, good, fresh) {
    const d = qData(q);
    const min = num(d.min), max = num(d.max), step = num(d.step) || 1, ans = num(d.answer), tol = Math.max(0, num(d.tol) || 0);
    const value = answered ? state.outcome.value : state.draft.value;
    const out = el("output", { class: "slider-value" + (answered ? (good ? " is-good" : " is-bad") : ""), for: "slider", text: withUnit(value, d.unit) });
    const range = el("input", { type: "range", id: "slider", min: String(min), max: String(max), step: String(step), value: String(value), disabled: answered,
      "aria-label": "Ta réponse",
      oninput: e => { state.draft.value = Number(e.target.value); out.textContent = withUnit(state.draft.value, d.unit); } });
    const pct = v => Math.min(100, Math.max(0, ((v - min) / (max - min)) * 100));
    const track = el("div", { class: "slider-track" }, range);
    if (answered) {
      // Zone acceptée et bonne réponse sur la piste
      const zone = el("span", { class: "slider-zone", "aria-hidden": "true" });
      zone.style.left = pct(ans - tol) + "%"; zone.style.width = Math.max(1.2, pct(ans + tol) - pct(ans - tol)) + "%";
      const mark = el("span", { class: "slider-mark", "aria-hidden": "true" }, el("b", { text: withUnit(ans, d.unit) }));
      mark.style.left = pct(ans) + "%";
      track.append(zone, mark);
    }
    return el("div", { class: "slider-box" + (fresh ? (good ? " pop" : " shake") : "") },
      out,
      track,
      el("div", { class: "slider-ends", "aria-hidden": "true" }, el("span", { text: withUnit(min, d.unit) }), el("span", { text: withUnit(max, d.unit) })),
      answered ? null : el("div", { class: "row" }, el("button", { type: "button", class: "validate", onclick: answerSlider, text: "Valider" })));
  }

  function renderOrder(q, answered, good, fresh) {
    const items = q.answers || [];
    const order = answered ? state.outcome.order : state.draft.order;
    const move = (pos, dir) => {
      const o = state.draft.order, j = pos + dir;
      if (j < 0 || j >= o.length) return;
      [o[pos], o[j]] = [o[j], o[pos]];
      FX.sound.tick();
      render();
      view.querySelectorAll(".order-item")[j]?.classList.add("moved");
      view.querySelectorAll(".order-item")[j]?.querySelector(dir < 0 ? ".up" : ".down")?.focus();
    };
    return el("div", { class: "order-box" + (fresh && !good ? " shake" : "") },
      answered ? null : el("p", { class: "hint", text: "Classe du premier au dernier avec les flèches." }),
      el("ol", { class: "order-list" }, order.map((i, pos) => {
        const ok = answered && i === pos;
        return el("li", { class: "order-item" + (answered ? (ok ? " is-good" : " is-bad") : ""), style: "--i:" + pos },
          el("span", { class: "order-rank", text: String(pos + 1) }),
          el("span", { class: "txt", text: items[i] }),
          answered ? el("span", { class: "order-mark", "aria-label": ok ? "Bien placé" : "Mal placé", text: ok ? "✓" : "✗" })
            : el("span", { class: "order-acts" },
                el("button", { type: "button", class: "iconbtn up", "aria-label": "Monter « " + items[i] + " »", disabled: pos === 0, onclick: () => move(pos, -1), text: "↑" }),
                el("button", { type: "button", class: "iconbtn down", "aria-label": "Descendre « " + items[i] + " »", disabled: pos === order.length - 1, onclick: () => move(pos, 1), text: "↓" })));
      })),
      answered ? null : el("div", { class: "row" }, el("button", { type: "button", class: "validate", onclick: answerOrder, text: "Valider l'ordre" })));
  }

  function renderTextAnswer(q, answered, good, fresh) {
    const input = el("input", { type: "text", id: "free-answer", autocomplete: "off", autocapitalize: "off", spellcheck: "false", maxlength: "120",
      placeholder: "Ta réponse…", value: answered ? state.outcome.text : state.draft.text, disabled: answered,
      class: answered ? (good ? "is-good" : "is-bad") : "",
      oninput: e => (state.draft.text = e.target.value) });
    if (!answered) setTimeout(() => { if (input.isConnected && !("ontouchstart" in window)) input.focus(); }, 50);
    return el("form", { class: "text-answer" + (fresh ? (good ? " pop" : " shake") : ""), onsubmit: e => { e.preventDefault(); answerText(); } },
      input,
      answered ? null : el("button", { type: "submit", class: "validate", text: "Valider" }));
  }

  function renderReveal(q, k, good) {
    const o = state.outcome;
    const d = qData(q);
    const reveal = el("div", { class: "reveal " + (good ? "good" : "bad") },
      el("p", { class: "verdict", text: good ? (k === "slider" && o.value !== num(d.answer) ? "Bien vu !" : "Bonne réponse !") : "Raté…" }));
    if (good && o.secs) reveal.append(el("p", { class: "blind-found", text: o.secs === BLIND_LEVELS[0] ? "Trouvé en " + o.secs + " secondes, chapeau !" : "Trouvé avec l'extrait de " + o.secs + " secondes." }));
    if (q.photo_path) {
      if (good) {
        reveal.append(el("figure", { class: "photo develop" },
          media(q.photo_path, { alt: q.photo_caption || "Photo", play: true }),
          el("span", { class: "shine", "aria-hidden": "true" })));
        if (q.photo_caption) reveal.append(el("p", { class: "photo-caption", text: q.photo_caption }));
      } else {
        reveal.append(el("figure", { class: "photo locked" },
          media(q.photo_path, { preview: true }),
          el("figcaption", { text: isVideo(q.photo_path) ? "Vidéo perdue" : isAudio(q.photo_path) ? "Son perdu" : "Photo perdue" })));
      }
    }
    if (k === "slider") {
      const tol = num(d.tol) || 0;
      reveal.append(el("p", { class: "muted", text: "Tu as dit " + withUnit(o.value, d.unit) + ", la réponse était " + withUnit(num(d.answer), d.unit)
        + (tol ? " (accepté à ±" + withUnit(tol, d.unit) + ")." : ".") }));
    } else if (k === "order" && !good) {
      reveal.append(el("div", { class: "stack", style: "align-items:center" },
        el("p", { class: "muted", text: "Le bon ordre :" }),
        el("ol", { class: "good-order" }, (q.answers || []).map(a => el("li", { text: a })))));
    } else if (k === "text") {
      if (!good) reveal.append(el("p", { class: "muted", text: "Tu as écrit « " + (o.text || "") + " ». La réponse attendue : « " + correctText(q) + " »." }));
      else if (normalize(o.text) !== normalize(correctText(q))) reveal.append(el("p", { class: "muted", text: "La réponse exacte : « " + correctText(q) + " »." }));
    } else if (!good) {
      reveal.append(el("p", { class: "muted", text: "La bonne réponse était « " + correctText(q) + " »." }));
    }
    const last = state.idx === state.questions.length - 1;
    reveal.append(el("button", { type: "button", class: "next-btn", onclick: next, text: last ? "Voir mon score" : "Question suivante" }));
    return reveal;
  }

  // ---------- réponses ----------
  function answerChoice(i) {
    const q = state.questions[state.idx];
    finish(i === Number(q.correct), (q.answers || [])[i], { pickedIdx: i });
  }
  function answerSlider() {
    const q = state.questions[state.idx], d = qData(q);
    const v = state.draft.value;
    finish(Math.abs(v - num(d.answer)) <= (num(d.tol) || 0) + 1e-9, withUnit(v, d.unit), { value: v });
  }
  function answerOrder() {
    const q = state.questions[state.idx];
    const o = state.draft.order.slice();
    finish(o.every((v, i) => v === i), o.map(i => (q.answers || [])[i]).join(" → "), { order: o });
  }
  function answerText() {
    const q = state.questions[state.idx];
    const t = (state.draft.text || "").trim();
    if (!t) { toast("Écris une réponse avant de valider."); return; }
    finish(textMatches(t, q.answers || []), t, { text: t });
  }

  function finish(good, pickedText, extra = {}) {
    if (state.picked != null) return;
    const q = state.questions[state.idx];
    state.picked = true; state.fresh = true;
    if (kindOf(q) === "blindtest") {
      extra.secs = BLIND_LEVELS[state.blindLevel || 0];
      pickedText = (pickedText || "") + " (extrait de " + extra.secs + " s)";
    }
    state.outcome = { good, ...extra };
    state.results.push(good);
    (state.log = state.log || []).push({ q: q.question, picked: pickedText, correct: correctText(q), good });
    render();
    state.fresh = false;
    const prompt = view.querySelector(".blind audio, .blind video");
    if (prompt && !prompt.paused) prompt.pause();
    if (good) {
      FX.sound.correct();
      FX.confettiFrom(view.querySelector(".answer.is-good, .slider-value, .order-list, .text-answer"), { count: 60 });
      const photo = view.querySelector(".photo.develop");
      // Lance la vidéo avec le son (le clic sur la réponse l'autorise) ; sinon en muet
      const vid = photo && photo.querySelector("video");
      if (vid) { vid.muted = false; vid.play().catch(() => { vid.muted = true; vid.play().catch(() => {}); }); }
      const aud = photo && photo.querySelector("audio");
      if (aud) aud.play().catch(() => {});
      if (photo) setTimeout(() => { if (photo.isConnected) FX.confettiFrom(photo, { count: 90, spread: 1.4, power: 1.2 }); }, 450);
    } else {
      FX.sound.wrong();
      if (navigator.vibrate) try { navigator.vibrate(120); } catch {}
    }
    const r = view.querySelector(".reveal");
    if (r) setTimeout(() => r.scrollIntoView({ behavior: FX.reduceMotion() ? "auto" : "smooth", block: "nearest" }), 250);
  }

  function next() {
    FX.sound.tick();
    view.querySelectorAll("audio, video").forEach(m => { try { m.pause(); } catch {} });
    state.idx++; state.picked = null;
    if (state.idx >= state.questions.length) { state.mode = "end"; state.fresh = true; }
    else initDraft();
    render(); scrollTop();
    if (state.mode === "end") { celebrate(); saveResult(); }
  }

  // Raccourcis clavier : A-D (ou 1-4) pour les choix, V / F pour vrai ou faux, Entrée pour continuer
  window.addEventListener("keydown", e => {
    if (state.mode !== "quiz" || e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^(INPUT|TEXTAREA)$/.test((e.target && e.target.tagName) || "")) return;
    const q = state.questions[state.idx];
    const k = answerKind(q);
    const key = e.key.toLowerCase();
    if (state.picked == null) {
      if (k === "truefalse" && (key === "v" || key === "f")) { e.preventDefault(); answerChoice(key === "v" ? 0 : 1); return; }
      if (isChoiceKind(k)) {
        const idx = "abcd".indexOf(key) >= 0 ? "abcd".indexOf(key) : "1234".indexOf(key);
        const order = (state.orders && state.orders[state.idx]) || [0, 1, 2, 3];
        if (idx >= 0 && idx < order.length) { e.preventDefault(); answerChoice(order[idx]); }
      }
    } else if (e.key === "Enter" && !(e.target && e.target.tagName === "BUTTON")) { e.preventDefault(); next(); }
  });

  // Enregistre la partie terminée (lisible ensuite par l'auteur du quiz dans l'admin)
  async function saveResult() {
    if (!sb || state.saved || !state.quizId) return;
    state.saved = true;
    const qs = state.questions;
    const player = (state.player || "").trim().slice(0, 40) || null;
    const { error } = await sb.from("results").insert({
      quiz_id: state.quizId, player, score: state.results.filter(Boolean).length, total: qs.length, answers: state.log || [],
    });
    if (error) console.warn("Résultat non enregistré :", error.message);
  }

  function endInfo() {
    const total = state.results.length || state.questions.length;
    const score = state.results.filter(Boolean).length;
    return { total, score, ratio: total ? score / total : 0 };
  }

  function renderEnd() {
    const { total, score, ratio } = endInfo();
    const msg = ratio === 1 ? "Sans faute. Rien ne t'échappe."
      : ratio >= .7 ? "Très fort, tu connais bien le sujet."
      : ratio >= .4 ? "Pas mal ! Il reste quelques mystères à percer."
      : "Il y a encore des choses à découvrir.";
    const mood = ratio >= .7 ? "good" : ratio >= .4 ? "hello" : "bad";
    const line = ratio === 1 ? "Impressionnant." : ratio >= .7 ? "Pas mal du tout !" : ratio >= .4 ? "Peut mieux faire…" : "On en reparle ?";
    const scoreEl = el("p", { class: "score", "aria-label": score + " sur " + total },
      el("span", { class: "score-num", text: state.fresh && !FX.reduceMotion() ? "0" : String(score) }), "/" + total);
    return el("section", { class: "card empty end" },
      el("span", { class: "tag", text: currentQuiz() ? currentQuiz().title : "Résultat" }),
      hostEl(currentQuiz(), mood, line),
      scoreEl,
      el("h2", { text: msg }),
      el("div", { class: "row", style: "justify-content:center" },
        el("button", { type: "button", onclick: startQuiz, text: "Rejouer" }),
        el("button", { type: "button", class: "ghost", onclick: goHome, text: "Autres quiz" })));
  }

  function celebrate() {
    state.fresh = false;
    const { score, ratio } = endInfo();
    const num = view.querySelector(".score-num");
    if (num && !FX.reduceMotion() && score > 0) {
      const t0 = performance.now(), dur = 300 + score * 180;
      const tick = now => {
        const k = Math.min(1, (now - t0) / dur);
        const v = Math.round(score * (1 - Math.pow(1 - k, 3)));
        if (num.textContent !== String(v)) { num.textContent = String(v); FX.sound.tick(); }
        if (k < 1) requestAnimationFrame(tick);
        else done();
      };
      requestAnimationFrame(tick);
    } else { if (num) num.textContent = String(score); done(); }
    function done() {
      if (ratio >= .5) {
        FX.sound.fanfare();
        const s = view.querySelector(".score");
        FX.confettiFrom(s, { count: ratio === 1 ? 160 : 80, spread: 1.6, power: 1.3 });
        if (ratio === 1) setTimeout(() => { FX.confetti(innerWidth * 0.2, innerHeight * 0.4, { count: 80 }); FX.confetti(innerWidth * 0.8, innerHeight * 0.4, { count: 80 }); }, 350);
      } else {
        FX.sound.sad();
      }
    }
  }

  // ---------- admin : connexion ----------
  adminLink.addEventListener("click", () => {
    state.mode = state.session ? "admin" : "login"; state.loginErr = ""; setHash(""); render(); scrollTop();
  });

  function renderLogin() {
    const input = el("input", { type: "password", id: "admin-code", autocomplete: "current-password", placeholder: "Code d'accès" });
    const btn = el("button", { type: "submit", text: "Entrer", disabled: !sb || !admins.length });
    const who = admins.length > 1
      ? el("div", { class: "stack" },
          el("span", { class: "label", text: "Qui es-tu ?" }),
          el("div", { class: "who", role: "radiogroup" }, admins.map((a, i) =>
            el("label", {}, el("input", { type: "radio", name: "who", id: "who-" + i, checked: state.loginWho === i, onchange: () => { state.loginWho = i; FX.sound.pop(); } }),
              a.head ? headImg(a, "who-head") : null, a.name || "Admin " + (i + 1)))))
      : null;
    const form = el("form", { class: "card", onsubmit: async e => {
      e.preventDefault();
      if (!sb) return;
      btn.disabled = true;
      const admin = admins[state.loginWho] || admins[0];
      const { data, error } = await sb.auth.signInWithPassword({ email: admin.email, password: input.value });
      if (error) { state.loginErr = "Code incorrect. Réessaie."; render(); return; }
      state.session = data.session; state.mode = "admin"; state.loginErr = "";
      await loadQuizzes(); // recharge avec les brouillons de cet admin
    } },
      el("h2", { text: "Espace admin" }),
      who,
      el("label", { for: "admin-code" }, "Code d'accès", input),
      state.loginErr ? el("p", { class: "notice err", text: state.loginErr }) : null,
      el("div", { class: "row" },
        btn,
        el("button", { type: "button", class: "ghost", onclick: goHome, text: "Retour aux quiz" })));
    setTimeout(() => input.focus(), 0);
    return form;
  }

  async function logout() {
    await sb.auth.signOut();
    state.session = null; state.quizId = null;
    await loadQuizzes();
    goHome();
  }

  // ---------- admin : mes quiz ----------
  function renderAdmin() {
    if (!state.session) { state.mode = "login"; return renderLogin(); }
    const mine = state.quizzes.filter(q => q.owner === uid());
    const me = admins.find(a => a.email === (state.session.user && state.session.user.email));

    const box = el("div", { class: "stack", style: "gap:24px" });
    box.append(el("div", { class: "row spread" },
      pageHead("Mes quiz", me && me.name ? "Profil : " + me.name : null),
      el("div", { class: "row" },
        el("button", { type: "button", class: "ghost small", onclick: goHome, text: "Voir le site" }),
        el("button", { type: "button", class: "ghost small", onclick: logout, text: "Se déconnecter" }))));

    // Nouveau quiz
    const title = el("input", { type: "text", id: "nq-title", placeholder: "Ex : Est-ce que tu me connais ?" });
    const desc = el("input", { type: "text", id: "nq-desc", placeholder: "Une phrase pour présenter le quiz (facultatif)" });
    const err = el("p", { class: "notice err", hidden: true });
    const create = el("button", { type: "submit", text: "Créer le quiz" });
    box.append(el("form", { class: "card", onsubmit: async e => {
      e.preventDefault();
      if (!title.value.trim()) { err.textContent = "Donne un titre au quiz."; err.hidden = false; return; }
      create.disabled = true;
      const { data, error } = await sb.from("quizzes")
        .insert({ title: title.value.trim(), description: desc.value.trim() || null, published: false })
        .select("id").single();
      if (error) { create.disabled = false; err.textContent = authHint(error) || "Le quiz n'a pas pu être créé."; err.hidden = false; return; }
      toast("Quiz créé");
      await loadQuizzes();
      openAdminQuiz(data.id);
    } },
      el("h3", { text: "Nouveau quiz" }),
      el("label", { for: "nq-title" }, "Titre", title),
      el("label", { for: "nq-desc" }, "Description", desc),
      err,
      el("div", { class: "row" }, create)));

    // Liste
    const list = el("section", { class: "card" }, el("h3", { text: "Tes quiz (" + mine.length + ")" }));
    if (!mine.length) {
      list.append(el("p", { class: "muted", text: "Tu n'as pas encore de quiz. Crée le premier avec le formulaire ci-dessus." }));
    } else {
      list.append(el("div", { class: "qlist" }, mine.map(q => el("div", { class: "qitem no-thumb" },
        el("div", { class: "meta" },
          el("p", { class: "q", text: q.title }),
          el("p", { class: "row", style: "gap:8px" },
            el("span", { class: "pill " + (q.published ? "on" : "off"), text: q.published ? "Publié" : "Brouillon" }),
            el("span", { class: "tag", text: plural(countOf(q), "question", "questions") }))),
        el("div", { class: "acts" },
          el("button", { type: "button", class: "iconbtn", onclick: () => openAdminQuiz(q.id), text: "Gérer" }))))));
    }
    box.append(list);
    box.append(renderCodeChange());
    return box;
  }

  function openAdminQuiz(id) {
    state.quizId = id; state.mode = "adminQuiz"; state.questions = [];
    state.editingId = null; state.form = emptyForm();
    state.quizResults = []; state.resultsError = "";
    render(); scrollTop();
    loadQuestions(id);
    loadResults(id);
  }

  // ---------- admin : un quiz ----------
  function renderAdminQuiz() {
    const quiz = currentQuiz();
    if (!state.session || !quiz || quiz.owner !== uid()) { state.mode = "admin"; return renderAdmin(); }
    const box = el("div", { class: "stack", style: "gap:24px" });

    box.append(el("div", { class: "stack" },
      el("div", {}, el("button", { type: "button", class: "link", style: "padding-left:0", onclick: () => { state.mode = "admin"; state.quizId = null; render(); }, text: "← Tous mes quiz" })),
      pageHead(quiz.title)));

    box.append(renderQuizSettings(quiz));
    box.append(renderForm());

    const list = el("section", { class: "card" }, el("h3", { text: "Questions (" + state.questions.length + ")" }));
    if (state.questionsLoading) list.append(el("p", { class: "muted", text: "Chargement…" }));
    else if (!state.questions.length) list.append(el("p", { class: "muted", text: "Aucune question pour l'instant. Ajoute la première avec le formulaire ci-dessus." }));
    else {
      list.append(el("div", { class: "qlist" }, state.questions.map((q, i) => el("div", { class: "qitem" },
        (q.photo_path || q.prompt_media) ? media(q.photo_path || q.prompt_media, { cls: "thumb", preview: true }) : el("div", { class: "thumb", text: "sans photo" }),
        el("div", { class: "meta" },
          el("span", { class: "kind-tag", text: KINDS[kindOf(q)].label + (kindOf(q) === "blindtest" ? (answerKind(q) === "text" ? " · réponse libre" : " · choix") : "") }),
          el("p", { class: "q", text: (i + 1) + ". " + q.question }),
          el("p", { class: "a", text: "✓ " + correctText(q) + (kindOf(q) === "slider" && num(qData(q).tol) ? " (±" + withUnit(num(qData(q).tol), qData(q).unit) + ")" : "") })),
        el("div", { class: "acts" },
          el("button", { type: "button", class: "iconbtn", "aria-label": "Monter", disabled: i === 0, onclick: () => move(i, -1), text: "↑" }),
          el("button", { type: "button", class: "iconbtn", "aria-label": "Descendre", disabled: i === state.questions.length - 1, onclick: () => move(i, 1), text: "↓" }),
          el("button", { type: "button", class: "iconbtn", onclick: () => startEdit(q), text: "Modifier" }),
          el("button", { type: "button", class: "iconbtn danger", onclick: e => confirmDeleteQuestion(e.currentTarget, q), text: "Supprimer" }))))));
    }
    box.append(list);
    box.append(renderResults(quiz));
    return box;
  }

  // ---------- admin : résultats des parties ----------
  async function loadResults(quizId) {
    state.resultsFor = quizId; state.resultsLoading = true;
    const { data, error } = await sb.from("results").select("*").eq("quiz_id", quizId)
      .order("created_at", { ascending: false }).limit(100);
    if (state.resultsFor !== quizId) return;
    state.resultsLoading = false;
    state.quizResults = error ? [] : (data || []);
    state.resultsError = error ? "Les résultats n'ont pas pu être chargés." : "";
    if (state.mode === "adminQuiz") render();
  }

  const dateFmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  function fmtDate(v) { const d = new Date(v); return isNaN(d) ? "" : dateFmt.format(d); }

  function renderResults(quiz) {
    const list = state.resultsFor === quiz.id ? (state.quizResults || []) : [];
    const card = el("section", { class: "card" },
      el("div", { class: "row spread" },
        el("h3", { text: "Résultats (" + list.length + ")" }),
        el("button", { type: "button", class: "ghost small", onclick: () => loadResults(quiz.id), text: "Actualiser" })));
    if (state.resultsLoading && state.resultsFor === quiz.id) { card.append(el("p", { class: "muted", text: "Chargement…" })); return card; }
    if (state.resultsError) { card.append(el("p", { class: "notice err", text: state.resultsError })); return card; }
    if (!list.length) { card.append(el("p", { class: "muted", text: "Personne n'a encore terminé ce quiz. Les parties apparaîtront ici." })); return card; }

    card.append(el("div", { class: "results" }, list.map(r => {
      const ratio = r.total ? r.score / r.total : 0;
      const tone = ratio >= .7 ? "on" : ratio >= .4 ? "mid" : "low";
      const answers = Array.isArray(r.answers) ? r.answers : [];
      const del = el("button", { type: "button", class: "iconbtn danger", onclick: e => { e.preventDefault(); confirmDeleteResult(e.currentTarget, r); }, text: "Supprimer" });
      return el("details", { class: "result" },
        el("summary", {},
          el("span", { class: "pill score-pill " + tone, text: r.score + "/" + r.total }),
          el("span", { class: "result-who", text: r.player || "Anonyme" }),
          el("span", { class: "tag", text: fmtDate(r.created_at) })),
        el("ol", { class: "result-answers" }, answers.map(a => el("li", { class: a.good ? "ok" : "ko" },
          el("span", { class: "mark", "aria-label": a.good ? "Juste" : "Faux", text: a.good ? "✓" : "✗" }),
          el("div", { class: "stack", style: "gap:2px;min-width:0" },
            el("span", { class: "rq", text: a.q }),
            el("span", { class: "ra", text: a.good ? "« " + a.picked + " »" : "A répondu « " + (a.picked ?? "—") + " », la bonne était « " + a.correct + " »" }))))),
        el("div", { class: "row", style: "justify-content:flex-end" }, del));
    })));
    return card;
  }

  async function confirmDeleteResult(btn, r) {
    if (!btn.dataset.armed) {
      btn.dataset.armed = "1"; btn.textContent = "Confirmer ?";
      setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = "Supprimer"; } }, 3000);
      return;
    }
    const { error } = await sb.from("results").delete().eq("id", r.id);
    if (error) { toast(authHint(error) || "Suppression impossible."); return; }
    toast("Résultat supprimé");
    loadResults(r.quiz_id);
  }

  function renderQuizSettings(quiz) {
    const title = el("input", { type: "text", id: "qs-title", value: quiz.title });
    const desc = el("input", { type: "text", id: "qs-desc", value: quiz.description || "", placeholder: "Facultatif" });
    const pub = el("input", { type: "checkbox", id: "qs-pub", checked: quiz.published });
    const save = el("button", { type: "submit", class: "small", text: "Enregistrer" });
    const delBtn = el("button", { type: "button", class: "danger small", onclick: e => confirmDeleteQuiz(e.currentTarget, quiz), text: "Supprimer le quiz" });
    const copyBtn = el("button", { type: "button", class: "ghost small", disabled: !quiz.published, onclick: () => copyLink(quiz.id), text: "Copier le lien" });

    return el("form", { class: "card", onsubmit: async e => {
      e.preventDefault();
      if (!title.value.trim()) { toast("Le titre ne peut pas être vide."); return; }
      save.disabled = true;
      const { error } = await sb.from("quizzes")
        .update({ title: title.value.trim(), description: desc.value.trim() || null, published: pub.checked })
        .eq("id", quiz.id);
      save.disabled = false;
      if (error) { toast(authHint(error) || "Les réglages n'ont pas pu être enregistrés."); return; }
      toast(pub.checked ? "Quiz enregistré et publié" : "Quiz enregistré (brouillon)");
      await loadQuizzes();
    } },
      el("div", { class: "row spread" },
        el("h3", { text: "Réglages du quiz" }),
        el("span", { class: "pill " + (quiz.published ? "on" : "off"), text: quiz.published ? "Publié" : "Brouillon" })),
      el("label", { for: "qs-title" }, "Titre", title),
      el("label", { for: "qs-desc" }, "Description", desc),
      el("label", { class: "check", for: "qs-pub" }, pub, "Publié : visible dans la liste des quiz"),
      el("p", { class: "hint", text: "Un brouillon n'est visible que par toi. Publie-le quand il est prêt." }),
      el("div", { class: "row spread" },
        el("div", { class: "row" }, save, copyBtn),
        delBtn));
  }

  async function copyLink(id) {
    const link = quizLink(id);
    try { await navigator.clipboard.writeText(link); toast("Lien copié"); }
    catch { toast(link); }
  }

  async function confirmDeleteQuiz(btn, quiz) {
    if (!btn.dataset.armed) {
      btn.dataset.armed = "1"; btn.textContent = "Supprimer ce quiz et ses questions ?";
      setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = "Supprimer le quiz"; } }, 4000);
      return;
    }
    btn.disabled = true;
    const photos = state.questionsFor === quiz.id ? state.questions.flatMap(q => [q.photo_path, q.prompt_media]).filter(Boolean) : [];
    const { error } = await sb.from("quizzes").delete().eq("id", quiz.id);
    if (error) { btn.disabled = false; toast(authHint(error) || "Le quiz n'a pas pu être supprimé."); return; }
    if (photos.length) await sb.storage.from(BUCKET).remove(photos);
    toast("Quiz supprimé");
    state.quizId = null; state.mode = "admin";
    await loadQuizzes();
  }

  function startEdit(q) {
    const k = kindOf(q), d = qData(q), a = q.answers || [];
    const f = emptyForm(k);
    if (k === "blindtest") f.blindMode = d.answer === "text" ? "text" : "choice";
    Object.assign(f, { question: q.question, photoPath: q.photo_path, photoCaption: q.photo_caption || "", promptPath: q.prompt_media || null });
    const ak = answerKind(q);
    if (isChoiceKind(ak)) { f.answers = [0, 1, 2, 3].map(i => a[i] || ""); f.correct = Number(q.correct) || 0; }
    if (k === "truefalse") f.tf = Number(q.correct) === 1 ? 1 : 0;
    if (k === "slider") f.slider = { min: String(d.min ?? 0), max: String(d.max ?? 100), step: String(d.step ?? 1), unit: d.unit || "", answer: String(d.answer ?? ""), tol: String(d.tol ?? 0) };
    if (k === "order") f.order = a.slice();
    if (ak === "text") f.accepted = a.join("\n");
    if (k === "mystery") { f.effect = d.effect || "blur"; f.focus = { x: d.focus_x ?? 50, y: d.focus_y ?? 45 }; }
    state.editingId = q.id;
    state.form = f;
    render();
    document.getElementById("f-question")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  function cancelEdit() { state.editingId = null; state.form = emptyForm(state.form.kind); render(); }

  // Construit la ligne à enregistrer, ou renvoie un message d'erreur
  function buildRow(f) {
    const k = answerKindOf(f.kind, f.blindMode);
    const question = f.question.trim();
    if (!question) return { error: "Écris la question." };
    const row = { kind: f.kind, question, correct: 0, data: {}, prompt_media: null,
      photo_path: f.photoPath || null, photo_caption: f.photoPath && f.photoCaption.trim() ? f.photoCaption.trim() : null };
    if (isChoiceKind(k)) {
      const answers = f.answers.map(a => a.trim());
      if (answers.some(a => !a)) return { error: "Remplis les quatre réponses." };
      row.answers = answers; row.correct = f.correct;
    }
    if (k === "truefalse") { row.answers = ["Vrai", "Faux"]; row.correct = f.tf; }
    if (k === "slider") {
      const s = f.slider, min = num(s.min), max = num(s.max), step = num(s.step), ans = num(s.answer), tol = s.tol === "" ? 0 : num(s.tol);
      if ([min, max, step, ans, tol].some(Number.isNaN)) return { error: "Remplis tous les nombres du curseur." };
      if (min >= max) return { error: "Le minimum doit être plus petit que le maximum." };
      if (step <= 0 || step > max - min) return { error: "Le pas doit être positif et plus petit que l'écart min-max." };
      if (ans < min || ans > max) return { error: "La bonne réponse doit être entre le minimum et le maximum." };
      if (tol < 0) return { error: "La marge ne peut pas être négative." };
      row.answers = [String(ans)];
      row.data = { min, max, step, answer: ans, tol, unit: s.unit.trim().slice(0, 12) };
    }
    if (k === "order") {
      const items = f.order.map(a => a.trim()).filter(Boolean);
      if (items.length < 3) return { error: "Mets au moins 3 éléments à classer." };
      if (new Set(items.map(normalize)).size !== items.length) return { error: "Deux éléments sont identiques : rends-les différents." };
      row.answers = items;
    }
    if (k === "text") {
      const acc = f.accepted.split("\n").map(a => a.trim()).filter(Boolean).slice(0, 12);
      if (!acc.length) return { error: "Écris au moins une réponse acceptée." };
      row.answers = acc;
    }
    if (k === "mystery") {
      if (!f.promptPath || isAudio(f.promptPath)) return { error: "Ajoute la photo (ou vidéo) mystère." };
      row.prompt_media = f.promptPath;
      row.data = { effect: f.effect, focus_x: Math.round(f.focus.x), focus_y: Math.round(f.focus.y) };
    }
    if (f.kind === "blindtest") {
      row.data = { answer: f.blindMode === "text" ? "text" : "choice" };
      if (!f.promptPath || !(isAudio(f.promptPath) || isVideo(f.promptPath))) return { error: "Ajoute le son (ou la vidéo) à reconnaître." };
      row.prompt_media = f.promptPath;
    }
    return { row };
  }

  function renderForm() {
    const f = state.form;
    const k = f.kind;
    const editing = !!state.editingId;

    const qInput = el("textarea", { id: "f-question", placeholder: questionPlaceholder(k), value: f.question, oninput: e => (f.question = e.target.value) });
    const err = el("p", { class: "notice err", hidden: true });
    const saveBtn = el("button", { type: "submit", disabled: state.saving || state.uploading, text: editing ? "Enregistrer les modifications" : "Ajouter la question" });

    const kinds = el("div", { class: "kind-chips", role: "radiogroup", "aria-label": "Type de question" },
      Object.entries(KINDS).map(([key, info]) => el("label", { class: "kind-chip" + (k === key ? " on" : "") },
        el("input", { type: "radio", name: "f-kind", id: "f-kind-" + key, checked: k === key, onchange: () => { f.kind = key; render(); } }),
        el("span", { class: "kind-name", text: info.label }),
        el("span", { class: "kind-hint", text: info.hint }))));

    return el("form", { class: "card", onsubmit: async e => {
      e.preventDefault();
      const { row, error: msg } = buildRow(f);
      if (msg) return showErr(msg);
      state.saving = true; saveBtn.disabled = true;
      let error;
      if (editing) {
        ({ error } = await sb.from("questions").update(row).eq("id", state.editingId));
      } else {
        const maxPos = state.questions.reduce((m, q) => Math.max(m, q.position || 0), 0);
        ({ error } = await sb.from("questions").insert({ ...row, quiz_id: state.quizId, position: maxPos + 1 }));
      }
      state.saving = false;
      if (error) {
        saveBtn.disabled = false;
        const schema = /kind|prompt_media|data|column|constraint|check/i.test(String(error.message || ""));
        return showErr(authHint(error) || (schema ? "La base n'est pas à jour : relance supabase/schema.sql dans Supabase." : "L'enregistrement a échoué. Réessaie dans un instant."));
      }
      toast(editing ? "Question modifiée" : "Question ajoutée");
      state.editingId = null; state.form = emptyForm(k);
      await refreshAll();
      function showErr(m) { err.textContent = m; err.hidden = false; }
    } },
      el("h3", { text: editing ? "Modifier la question" : "Nouvelle question" }),
      el("div", { class: "stack" }, el("span", { class: "label", text: "Type de question" }), kinds),
      el("label", { for: "f-question" }, k === "truefalse" ? "Affirmation" : "Question", qInput),
      renderPromptField(f),
      renderAnswerFields(f),
      renderRewardField(f),
      err,
      el("div", { class: "row" },
        saveBtn,
        editing ? el("button", { type: "button", class: "ghost", onclick: cancelEdit, text: "Annuler" }) : null));
  }

  function questionPlaceholder(k) {
    return {
      choice: "Ex : Quel est mon plat préféré ?",
      truefalse: "Ex : J'ai déjà sauté en parachute.",
      slider: "Ex : Combien de cafés je bois par semaine ?",
      order: "Ex : Remets nos voyages dans l'ordre, du plus ancien au plus récent.",
      text: "Ex : Comment s'appelait mon premier chat ?",
      mystery: "Ex : C'était où ?",
      blindtest: "Ex : C'est quelle chanson ?",
    }[k];
  }

  function renderAnswerFields(f) {
    const k = answerKindOf(f.kind, f.blindMode);
    const modePick = f.kind !== "blindtest" ? null : el("div", { class: "stack" },
      el("span", { class: "label", text: "Façon de répondre" }),
      el("div", { class: "who" }, [["choice", "Plusieurs choix"], ["text", "Réponse libre"]].map(([v, t]) =>
        el("label", {}, el("input", { type: "radio", name: "f-blind-mode", id: "f-blind-" + v, checked: f.blindMode === v, onchange: () => { f.blindMode = v; render(); } }), t))));
    const fields = answerFieldsFor(f, k);
    return modePick ? el("div", { class: "stack" }, modePick, fields) : fields;
  }
  function answerFieldsFor(f, k) {
    if (isChoiceKind(k)) {
      const rows = [0, 1, 2, 3].flatMap(i => [
        el("input", { type: "radio", name: "f-correct", id: "f-correct-" + i, "aria-label": "La réponse " + LETTERS[i] + " est la bonne", checked: f.correct === i, onchange: () => (f.correct = i) }),
        el("input", { type: "text", id: "f-ans-" + i, placeholder: "Réponse " + LETTERS[i], value: f.answers[i], oninput: e => (f.answers[i] = e.target.value) }),
      ]);
      return el("div", { class: "stack" },
        el("span", { class: "label" }, "Réponses ", el("span", { class: "hint", text: "(coche la bonne, elles seront mélangées)" })),
        el("div", { class: "ans-edit" }, rows));
    }
    if (k === "truefalse") {
      return el("div", { class: "stack" },
        el("span", { class: "label", text: "Cette affirmation est…" }),
        el("div", { class: "who" }, ["Vraie", "Fausse"].map((t, i) =>
          el("label", {}, el("input", { type: "radio", name: "f-tf", id: "f-tf-" + i, checked: f.tf === i, onchange: () => (f.tf = i) }), t))));
    }
    if (k === "slider") {
      const s = f.slider;
      const field = (key, label, attrs = {}) => el("label", { for: "f-sl-" + key }, label,
        el("input", { type: "text", id: "f-sl-" + key, inputmode: key === "unit" ? "text" : "decimal", value: s[key], ...attrs, oninput: e => (s[key] = e.target.value) }));
      return el("div", { class: "stack" },
        el("span", { class: "label" }, "Réglages du curseur ", el("span", { class: "hint", text: "(la réponse est juste si elle tombe dans la marge)" })),
        el("div", { class: "slider-grid" },
          field("answer", "Bonne réponse", { placeholder: "Ex : 14" }),
          field("tol", "Marge ±", { placeholder: "Ex : 2" }),
          field("unit", "Unité", { placeholder: "Ex : cafés, cm, €", maxlength: "12" }),
          field("min", "Minimum"),
          field("max", "Maximum"),
          field("step", "Pas")));
    }
    if (k === "order") {
      const list = el("ol", { class: "order-edit" }, f.order.map((v, i) => el("li", {},
        el("input", { type: "text", id: "f-ord-" + i, placeholder: "Élément " + (i + 1), value: v, maxlength: "80", oninput: e => (f.order[i] = e.target.value) }),
        f.order.length > 3 ? el("button", { type: "button", class: "iconbtn", "aria-label": "Retirer l'élément " + (i + 1), onclick: () => { f.order.splice(i, 1); render(); }, text: "✕" }) : null)));
      return el("div", { class: "stack" },
        el("span", { class: "label" }, "Éléments dans le bon ordre ", el("span", { class: "hint", text: "(du premier au dernier, ils seront mélangés)" })),
        list,
        f.order.length < 8 ? el("div", {}, el("button", { type: "button", class: "ghost small", onclick: () => { f.order.push(""); render(); document.getElementById("f-ord-" + (f.order.length - 1))?.focus(); }, text: "+ Ajouter un élément" })) : null);
    }
    if (k === "text") {
      return el("label", { for: "f-accepted" }, "Réponses acceptées ",
        el("span", { class: "hint", text: "(une par ligne : majuscules, accents et petites fautes de frappe sont tolérés)" }),
        el("textarea", { id: "f-accepted", value: f.accepted, placeholder: "Ex :\nMinou\nLe minou", oninput: e => (f.accepted = e.target.value) }));
    }
    return null;
  }

  // Média dans la question (photo mystère, blind test)
  function renderPromptField(f) {
    const k = f.kind;
    if (k !== "mystery" && k !== "blindtest") return null;
    const mystery = k === "mystery";
    const fileInput = el("input", { type: "file", id: "f-prompt", hidden: true, accept: mystery ? "image/*,video/*" : "audio/*,video/*",
      onchange: e => uploadMedia(e.target.files[0], "promptPath") });
    const valid = f.promptPath && (mystery ? !isAudio(f.promptPath) : (isAudio(f.promptPath) || isVideo(f.promptPath)));
    const box = el("div", { class: "stack" },
      el("span", { class: "label" }, mystery ? "Photo mystère " : "Son à reconnaître ",
        el("span", { class: "hint", text: mystery ? "(affichée dans la question, dévoilée après la réponse)" : "(mp3, m4a, wav… ou une vidéo, " + MAX_VIDEO_MB + " Mo max)" })),
      el("div", { class: "photo-pick" },
        valid && !mystery ? media(f.promptPath, { alt: "Aperçu du son" }) : null,
        el("button", { type: "button", class: "ghost small", disabled: state.uploading, onclick: () => fileInput.click(),
          text: state.uploading ? "Envoi…" : valid ? "Changer" : mystery ? "Choisir la photo mystère" : "Choisir le son" }),
        fileInput,
        valid ? el("button", { type: "button", class: "link", onclick: () => { f.promptPath = null; render(); }, text: "Retirer" }) : null));
    if (mystery) {
      box.append(el("div", { class: "who" }, [["blur", "Floutée"], ["zoom", "Zoomée ×3"]].map(([v, t]) =>
        el("label", {}, el("input", { type: "radio", name: "f-effect", id: "f-effect-" + v, checked: f.effect === v, onchange: () => { f.effect = v; render(); } }), t))));
      if (valid) {
        // Aperçu de ce que verra le joueur ; en mode zoom, un clic choisit le point zoomé
        const fx = el("div", { class: "prompt-media admin-preview fx-" + f.effect });
        fx.style.setProperty("--focus", f.focus.x + "% " + f.focus.y + "%");
        fx.append(media(f.promptPath, { alt: "Aperçu de la photo mystère", preview: true }));
        if (f.effect === "zoom") {
          const full = el("div", { class: "focus-picker", title: "Clique sur le détail à zoomer" }, media(f.promptPath, { alt: "", preview: true }));
          const dot = el("span", { class: "focus-dot" }); dot.style.left = f.focus.x + "%"; dot.style.top = f.focus.y + "%";
          full.append(dot);
          full.addEventListener("click", e => {
            const r = full.getBoundingClientRect();
            f.focus = { x: Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)), y: Math.min(100, Math.max(0, ((e.clientY - r.top) / r.height) * 100)) };
            render();
          });
          box.append(el("div", { class: "mystery-admin" },
            el("div", { class: "stack" }, el("span", { class: "hint", text: "Clique sur le détail à zoomer" }), full),
            el("div", { class: "stack" }, el("span", { class: "hint", text: "Ce que verra le joueur" }), fx)));
        } else {
          box.append(el("div", { class: "mystery-admin" }, el("div", { class: "stack" }, el("span", { class: "hint", text: "Ce que verra le joueur" }), fx)));
        }
      }
    }
    return box;
  }

  // Récompense affichée quand la réponse est juste
  function renderRewardField(f) {
    const fileInput = el("input", { type: "file", id: "f-photo", accept: "image/*,video/*", hidden: true, onchange: e => uploadMedia(e.target.files[0], "photoPath") });
    return el("div", { class: "stack" },
      el("span", { class: "label" }, "Photo ou vidéo affichée si c'est juste ", el("span", { class: "hint", text: "(vidéo : " + MAX_VIDEO_MB + " Mo max, de préférence en .mp4)" })),
      el("div", { class: "photo-pick" },
        f.photoPath ? media(f.photoPath, { alt: "Aperçu", preview: true }) : null,
        el("button", { type: "button", class: "ghost small", disabled: state.uploading, onclick: () => fileInput.click(),
          text: state.uploading ? "Envoi…" : f.photoPath ? "Changer" : "Choisir une photo ou une vidéo" }),
        fileInput,
        f.photoPath ? el("button", { type: "button", class: "link", onclick: () => { f.photoPath = null; render(); }, text: "Retirer" }) : null),
      f.photoPath ? el("label", { for: "f-caption" }, "Description ", el("span", { class: "hint", text: "(facultatif)" }),
        el("textarea", { id: "f-caption", class: "caption-input", maxlength: "300", placeholder: "Ex : Notre premier week-end à la montagne, juillet 2024",
          value: f.photoCaption, oninput: e => (f.photoCaption = e.target.value) })) : null);
  }

  async function uploadMedia(file, field) {
    if (!file) return;
    const fileExt = (file.name.split(".").pop() || "").toLowerCase();
    const video = (file.type || "").startsWith("video/") || VIDEO_EXT.includes(fileExt);
    const audio = !video && ((file.type || "").startsWith("audio/") || AUDIO_EXT.includes(fileExt));
    if ((video || audio) && file.size > MAX_VIDEO_MB * 1024 * 1024) {
      toast("Fichier trop lourd (" + Math.round(file.size / 1048576) + " Mo). Maximum " + MAX_VIDEO_MB + " Mo : raccourcis-le ou exporte-le en plus petit.");
      return;
    }
    state.uploading = true; render();
    const blob = video || audio ? file : await shrinkImage(file);
    const ext = video ? (VIDEO_EXT.includes(fileExt) ? fileExt : "mp4")
      : audio ? (AUDIO_EXT.includes(fileExt) ? fileExt : "mp3")
      : blob.type === "image/jpeg" ? "jpg" : (fileExt || "jpg");
    const path = crypto.randomUUID() + "." + ext;
    const contentType = blob.type || file.type
      || (video ? (ext === "mov" ? "video/quicktime" : "video/" + ext) : audio ? (ext === "mp3" ? "audio/mpeg" : ext === "m4a" ? "audio/mp4" : "audio/" + ext) : "image/jpeg");
    const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType, upsert: false });
    state.uploading = false;
    if (error) {
      const big = /size|large|413|exceed/i.test(String(error.message || ""));
      toast(authHint(error) || (big ? "Fichier trop lourd pour Supabase." : "Échec de l'envoi."));
      render(); return;
    }
    state.form[field] = path;
    toast(video ? "Vidéo ajoutée" : audio ? "Son ajouté" : "Photo ajoutée");
    render();
  }

  async function move(i, dir) {
    const list = state.questions.slice();
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    const updates = list.map((q, k) => ({ id: q.id, position: k + 1 })).filter((u, k) => list[k].position !== u.position);
    state.questions = list.map((q, k) => ({ ...q, position: k + 1 }));
    render();
    for (const u of updates) {
      const { error } = await sb.from("questions").update({ position: u.position }).eq("id", u.id);
      if (error) { toast("Impossible de déplacer la question."); break; }
    }
    loadQuestions(state.quizId);
  }

  async function confirmDeleteQuestion(btn, q) {
    if (!btn.dataset.armed) {
      btn.dataset.armed = "1"; btn.textContent = "Confirmer ?";
      setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = "Supprimer"; } }, 3000);
      return;
    }
    const { error } = await sb.from("questions").delete().eq("id", q.id);
    if (error) { toast(authHint(error) || "Suppression impossible."); return; }
    const used = new Set(state.questions.filter(o => o.id !== q.id).flatMap(o => [o.photo_path, o.prompt_media]));
    const orphans = [q.photo_path, q.prompt_media].filter(p => p && !used.has(p));
    if (orphans.length) await sb.storage.from(BUCKET).remove(orphans);
    if (state.editingId === q.id) { state.editingId = null; state.form = emptyForm(); }
    toast("Question supprimée");
    refreshAll();
  }

  function renderCodeChange() {
    const input = el("input", { type: "password", id: "new-code", autocomplete: "new-password", placeholder: "Nouveau code (6 caractères min.)" });
    const msg = el("p", { class: "notice", hidden: true });
    return el("form", { class: "card", onsubmit: async e => {
      e.preventDefault();
      const v = input.value;
      if (v.length < 6) { msg.className = "notice err"; msg.textContent = "Choisis un code d'au moins 6 caractères."; msg.hidden = false; return; }
      const { error } = await sb.auth.updateUser({ password: v });
      if (error) { msg.className = "notice err"; msg.textContent = "Le code n'a pas pu être changé : " + error.message; }
      else { input.value = ""; msg.className = "notice"; msg.textContent = "Code changé. Utilise-le la prochaine fois."; }
      msg.hidden = false;
    } },
      el("h3", { text: "Ton code d'accès" }),
      el("p", { class: "muted", text: "Change ici le code qui ouvre ton espace admin." }),
      el("div", { class: "row" }, el("div", { style: "flex:1;min-width:180px" }, input), el("button", { type: "submit", class: "small", text: "Changer le code" })),
      msg);
  }

  boot();
})();
