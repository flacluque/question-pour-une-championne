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
  // Phrase perso de la personne (config.js > lines), sans répéter la précédente
  const lastLine = new Map();
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
    idx: 0, picked: null, results: [], fresh: false,
    session: null,
    loginErr: "", loginWho: 0,
    form: emptyForm(), editingId: null,
    uploading: false, saving: false,
  };

  function emptyForm() { return { question: "", answers: ["", "", "", ""], correct: 0, photoPath: null }; }
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
      pageHead("Choisis ton quiz", "Quatre réponses par question. Chaque bonne réponse dévoile une photo."));
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
              : el("p", { class: "muted", text: "Tu choisis une réponse, et si c'est la bonne, une photo apparaît. À la fin, tu découvres ton score." }))),
        el("div", { class: "row" },
          el("button", { type: "button", disabled: !ready || !n, onclick: startQuiz, text: "Commencer" }),
          el("button", { type: "button", class: "ghost", onclick: goHome, text: "Autres quiz" }))));
  }

  function startQuiz() {
    FX.sound.whoosh();
    state.mode = "quiz"; state.idx = 0; state.picked = null; state.results = []; state.fresh = false;
    state.questions.forEach(q => { if (q.photo_path) { const i = new Image(); i.src = photoUrl(q.photo_path); } });
    render(); scrollTop();
  }

  function renderQuiz() {
    const qs = state.questions;
    const quiz = currentQuiz();
    if (!qs.length) { state.mode = "intro"; return renderIntro(); }
    if (state.idx >= qs.length) { state.mode = "end"; return renderEnd(); }
    const q = qs[state.idx];
    const answered = state.picked != null;
    const correct = Number(q.correct);
    const good = answered && state.picked === correct;
    const fresh = answered && state.fresh; // premier affichage après le clic : on joue les animations

    const progress = el("div", { class: "progress", "aria-hidden": "true" },
      qs.map((_, i) => el("span", { class: i < state.results.length ? (state.results[i] ? "done-good" : "done-bad") : i === state.idx ? "current" : "" })));

    const answers = el("div", { class: "answers" + (answered ? "" : " answers-in") },
      (q.answers || []).map((a, i) => {
        let cls = "answer";
        if (answered) {
          if (i === correct) cls += " is-good" + (fresh ? (good ? " pop" : " hint") : "");
          else if (i === state.picked) cls += " is-bad" + (fresh ? " shake" : "");
          else cls += " is-faded";
        }
        return el("button", { type: "button", class: cls, style: "--i:" + i, disabled: answered, onclick: () => pick(i) },
          el("span", { class: "letter", text: LETTERS[i] }), el("span", { class: "txt", text: a }));
      }));

    const card = el("section", { class: "card" + (fresh && !good ? " card-bad" : "") },
      progress,
      el("div", { class: "q-head" },
        hostEl(quiz, answered ? (good ? "good" : "bad") : null, fresh ? pickOne(good ? LINES.good : LINES.bad) : null),
        el("div", { class: "stack" },
          el("span", { class: "tag", text: "Question " + (state.idx + 1) + " sur " + qs.length }),
          el("h2", { class: answered ? "" : "q-in", text: q.question }))),
      answers);

    if (answered) {
      const reveal = el("div", { class: "reveal " + (good ? "good" : "bad") },
        el("p", { class: "verdict", text: good ? "Bonne réponse !" : "Raté…" }));
      if (q.photo_path) {
        if (good) {
          reveal.append(el("figure", { class: "photo develop" },
            el("img", { src: photoUrl(q.photo_path), alt: "Photo" }),
            el("span", { class: "shine", "aria-hidden": "true" })));
        } else {
          reveal.append(el("figure", { class: "photo locked" },
            el("img", { src: photoUrl(q.photo_path), alt: "" }),
            el("figcaption", { text: "Photo perdue" })));
        }
      }
      if (!good) reveal.append(el("p", { class: "muted", text: "La bonne réponse était « " + (q.answers || [])[correct] + " »." }));
      const last = state.idx === qs.length - 1;
      reveal.append(el("button", { type: "button", class: "next-btn", onclick: next, text: last ? "Voir mon score" : "Question suivante" }));
      card.append(reveal);
    }
    return card;
  }

  function pick(i) {
    if (state.picked != null) return;
    const good = i === Number(state.questions[state.idx].correct);
    state.picked = i; state.fresh = true;
    state.results.push(good);
    render();
    state.fresh = false;
    if (good) {
      FX.sound.correct();
      FX.confettiFrom(view.querySelector(".answer.is-good"), { count: 60 });
      const photo = view.querySelector(".photo.develop");
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
    state.idx++; state.picked = null;
    if (state.idx >= state.questions.length) { state.mode = "end"; state.fresh = true; }
    render(); scrollTop();
    if (state.mode === "end") celebrate();
  }

  // Raccourcis clavier : A-D ou 1-4 pour répondre, Entrée pour continuer
  window.addEventListener("keydown", e => {
    if (state.mode !== "quiz" || e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^(INPUT|TEXTAREA)$/.test((e.target && e.target.tagName) || "")) return;
    const k = e.key.toLowerCase();
    const idx = "abcd".indexOf(k) >= 0 ? "abcd".indexOf(k) : "1234".indexOf(k);
    if (state.picked == null && idx >= 0) { e.preventDefault(); pick(idx); }
    else if (state.picked != null && e.key === "Enter" && !(e.target && e.target.tagName === "BUTTON")) { e.preventDefault(); next(); }
  });

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
    render(); scrollTop();
    loadQuestions(id);
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
        q.photo_path ? el("img", { class: "thumb", src: photoUrl(q.photo_path), alt: "" }) : el("div", { class: "thumb", text: "sans photo" }),
        el("div", { class: "meta" },
          el("p", { class: "q", text: (i + 1) + ". " + q.question }),
          el("p", { class: "a", text: "✓ " + ((q.answers || [])[Number(q.correct)] || "") })),
        el("div", { class: "acts" },
          el("button", { type: "button", class: "iconbtn", "aria-label": "Monter", disabled: i === 0, onclick: () => move(i, -1), text: "↑" }),
          el("button", { type: "button", class: "iconbtn", "aria-label": "Descendre", disabled: i === state.questions.length - 1, onclick: () => move(i, 1), text: "↓" }),
          el("button", { type: "button", class: "iconbtn", onclick: () => startEdit(q), text: "Modifier" }),
          el("button", { type: "button", class: "iconbtn danger", onclick: e => confirmDeleteQuestion(e.currentTarget, q), text: "Supprimer" }))))));
    }
    box.append(list);
    return box;
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
    const photos = state.questionsFor === quiz.id ? state.questions.map(q => q.photo_path).filter(Boolean) : [];
    const { error } = await sb.from("quizzes").delete().eq("id", quiz.id);
    if (error) { btn.disabled = false; toast(authHint(error) || "Le quiz n'a pas pu être supprimé."); return; }
    if (photos.length) await sb.storage.from(BUCKET).remove(photos);
    toast("Quiz supprimé");
    state.quizId = null; state.mode = "admin";
    await loadQuizzes();
  }

  function startEdit(q) {
    state.editingId = q.id;
    state.form = { question: q.question, answers: [...q.answers], correct: Number(q.correct), photoPath: q.photo_path };
    render();
    document.getElementById("f-question")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  function cancelEdit() { state.editingId = null; state.form = emptyForm(); render(); }

  function renderForm() {
    const f = state.form;
    const editing = !!state.editingId;

    const qInput = el("textarea", { id: "f-question", placeholder: "Ex : Quel est mon plat préféré ?", value: f.question, oninput: e => (f.question = e.target.value) });
    const rows = [0, 1, 2, 3].flatMap(i => [
      el("input", { type: "radio", name: "f-correct", id: "f-correct-" + i, "aria-label": "La réponse " + LETTERS[i] + " est la bonne", checked: f.correct === i, onchange: () => (f.correct = i) }),
      el("input", { type: "text", id: "f-ans-" + i, placeholder: "Réponse " + LETTERS[i], value: f.answers[i], oninput: e => (f.answers[i] = e.target.value) }),
    ]);

    const fileInput = el("input", { type: "file", id: "f-photo", accept: "image/*", hidden: true, onchange: e => uploadPhoto(e.target.files[0]) });
    const preview = photoUrl(f.photoPath);

    const err = el("p", { class: "notice err", hidden: true });
    const saveBtn = el("button", { type: "submit", disabled: state.saving || state.uploading, text: editing ? "Enregistrer les modifications" : "Ajouter la question" });

    return el("form", { class: "card", onsubmit: async e => {
      e.preventDefault();
      const question = f.question.trim();
      const answers = f.answers.map(a => a.trim());
      if (!question) return showErr("Écris la question.");
      if (answers.some(a => !a)) return showErr("Remplis les quatre réponses.");
      state.saving = true; saveBtn.disabled = true;
      const row = { question, answers, correct: f.correct, photo_path: f.photoPath || null };
      let error;
      if (editing) {
        ({ error } = await sb.from("questions").update(row).eq("id", state.editingId));
      } else {
        const maxPos = state.questions.reduce((m, q) => Math.max(m, q.position || 0), 0);
        ({ error } = await sb.from("questions").insert({ ...row, quiz_id: state.quizId, position: maxPos + 1 }));
      }
      state.saving = false;
      if (error) { saveBtn.disabled = false; return showErr(authHint(error) || "L'enregistrement a échoué. Réessaie dans un instant."); }
      toast(editing ? "Question modifiée" : "Question ajoutée");
      state.editingId = null; state.form = emptyForm();
      await refreshAll();
      function showErr(m) { err.textContent = m; err.hidden = false; }
    } },
      el("h3", { text: editing ? "Modifier la question" : "Nouvelle question" }),
      el("label", { for: "f-question" }, "Question", qInput),
      el("div", { class: "stack" },
        el("span", { class: "label" }, "Réponses ", el("span", { class: "hint", text: "(coche la bonne)" })),
        el("div", { class: "ans-edit" }, rows)),
      el("div", { class: "stack" },
        el("span", { class: "label", text: "Photo affichée si c'est juste" }),
        el("div", { class: "photo-pick" },
          preview ? el("img", { src: preview, alt: "Aperçu de la photo" }) : null,
          el("button", { type: "button", class: "ghost small", disabled: state.uploading, onclick: () => fileInput.click(),
            text: state.uploading ? "Envoi…" : f.photoPath ? "Changer la photo" : "Choisir une photo" }),
          fileInput,
          f.photoPath ? el("button", { type: "button", class: "link", onclick: () => { f.photoPath = null; render(); }, text: "Retirer" }) : null)),
      err,
      el("div", { class: "row" },
        saveBtn,
        editing ? el("button", { type: "button", class: "ghost", onclick: cancelEdit, text: "Annuler" }) : null));
  }

  async function uploadPhoto(file) {
    if (!file) return;
    state.uploading = true; render();
    const blob = await shrinkImage(file);
    const ext = blob.type === "image/jpeg" ? "jpg" : (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = crypto.randomUUID() + "." + ext;
    const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: blob.type || file.type, upsert: false });
    state.uploading = false;
    if (error) { toast(authHint(error) || "Échec de l'envoi de la photo."); render(); return; }
    state.form.photoPath = path;
    toast("Photo ajoutée");
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
    if (q.photo_path && !state.questions.some(o => o.id !== q.id && o.photo_path === q.photo_path)) {
      await sb.storage.from(BUCKET).remove([q.photo_path]);
    }
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
