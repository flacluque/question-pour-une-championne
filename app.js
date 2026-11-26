(() => {
  "use strict";

  const LETTERS = ["A", "B", "C", "D"];
  const BUCKET = "photos";
  const cfg = window.QUIZ_CONFIG || {};
  const configured = !!(cfg.supabaseUrl && cfg.supabaseAnonKey && !/VOTRE-/.test(cfg.supabaseUrl + cfg.supabaseAnonKey));
  const sb = configured && window.supabase ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey) : null;

  const view = document.getElementById("view");
  const adminLink = document.getElementById("adminLink");

  const state = {
    loaded: false, error: "",
    questions: [],
    mode: "intro",            // intro | quiz | end | login | admin
    idx: 0, picked: null, results: [],
    session: null,
    loginErr: "",
    form: emptyForm(),        // brouillon du formulaire admin
    editingId: null,
    uploading: false, saving: false,
  };

  function emptyForm() { return { question: "", answers: ["", "", "", ""], correct: 0, photoPath: null }; }

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

  // ---------- données ----------
  async function loadQuestions() {
    if (!sb) { state.loaded = true; render(); return; }
    const { data, error } = await sb.from("questions")
      .select("*").order("position", { ascending: true }).order("created_at", { ascending: true });
    if (error) { state.error = "Les questions n'ont pas pu être chargées. Recharge la page."; }
    else { state.questions = data || []; state.error = ""; }
    state.loaded = true;
    render();
  }

  async function boot() {
    render();
    if (sb) {
      const { data } = await sb.auth.getSession();
      state.session = data.session;
      sb.auth.onAuthStateChange((_e, session) => { state.session = session; });
    }
    loadQuestions();
  }

  // ---------- rendu ----------
  function render() {
    view.replaceChildren();
    adminLink.hidden = state.mode === "admin" || state.mode === "login";
    const fn = { intro: renderIntro, quiz: renderQuiz, end: renderEnd, login: renderLogin, admin: renderAdmin }[state.mode];
    view.append(fn());
  }

  function renderIntro() {
    if (!configured) {
      return el("section", { class: "card empty" },
        el("h2", { text: "Il reste à brancher Supabase" }),
        el("p", { class: "muted" }, "Remplis ", el("code", { text: "config.js" }), " avec l'adresse et la clé de ton projet Supabase (voir le README)."));
    }
    if (!state.loaded) return el("section", { class: "card empty" }, el("p", { class: "muted", text: "Chargement des questions…" }));
    if (state.error) return el("section", { class: "card empty" }, el("p", { class: "notice err", text: state.error }));
    const n = state.questions.length;
    if (!n) {
      return el("section", { class: "card empty" },
        el("span", { class: "heart", text: "♥" }),
        el("h2", { text: "Le quiz se prépare" }),
        el("p", { class: "muted", text: "Aucune question pour l'instant. Elles apparaîtront ici dès qu'elles seront ajoutées depuis l'espace admin." }));
    }
    return el("section", { class: "card" },
      el("span", { class: "eyebrow", text: n + (n > 1 ? " questions" : " question") }),
      el("h2", { text: "Prête ? Pas de triche, pas de joker." }),
      el("p", { class: "muted", text: "Tu choisis une réponse, et si c'est la bonne, une photo apparaît. À la fin, tu découvres ton score." }),
      el("div", { class: "row" }, el("button", { type: "button", onclick: startQuiz, text: "Commencer le quiz" })));
  }

  function startQuiz() {
    state.mode = "quiz"; state.idx = 0; state.picked = null; state.results = [];
    // précharge les photos pour qu'elles s'affichent sans attendre
    state.questions.forEach(q => { if (q.photo_path) { const i = new Image(); i.src = photoUrl(q.photo_path); } });
    render(); scrollTop();
  }

  function renderQuiz() {
    const qs = state.questions;
    if (!qs.length) { state.mode = "intro"; return renderIntro(); }
    if (state.idx >= qs.length) { state.mode = "end"; return renderEnd(); }
    const q = qs[state.idx];
    const answered = state.picked != null;
    const correct = Number(q.correct);

    const progress = el("div", { class: "progress", "aria-hidden": "true" },
      qs.map((_, i) => el("span", { class: i < state.results.length ? (state.results[i] ? "done-good" : "done-bad") : i === state.idx ? "current" : "" })));

    const answers = el("div", { class: "answers" },
      (q.answers || []).map((a, i) => {
        let cls = "answer";
        if (answered) cls += i === correct ? " is-good" : i === state.picked ? " is-bad" : " is-faded";
        return el("button", { type: "button", class: cls, disabled: answered, onclick: () => pick(i) },
          el("span", { class: "letter", text: LETTERS[i] }), el("span", { class: "txt", text: a }));
      }));

    const card = el("section", { class: "card" },
      progress,
      el("span", { class: "eyebrow", text: "Question " + (state.idx + 1) + " sur " + qs.length }),
      el("h2", { text: q.question }),
      answers);

    if (answered) {
      const good = state.picked === correct;
      const reveal = el("div", { class: "reveal " + (good ? "good" : "bad") },
        el("p", { class: "verdict", text: good ? "Bonne réponse !" : "Raté…" }));
      if (good && q.photo_path) {
        reveal.append(el("figure", { class: "polaroid" }, el("img", { src: photoUrl(q.photo_path), alt: "Photo souvenir" })));
      } else if (!good) {
        reveal.append(el("p", { class: "muted", text: "La bonne réponse était « " + (q.answers || [])[correct] + " ». Pas de photo cette fois." }));
      }
      const last = state.idx === qs.length - 1;
      reveal.append(el("button", { type: "button", onclick: next, text: last ? "Voir mon score" : "Question suivante" }));
      card.append(reveal);
    }
    return card;
  }

  function pick(i) {
    if (state.picked != null) return;
    state.picked = i;
    state.results.push(i === Number(state.questions[state.idx].correct));
    render();
  }
  function next() {
    state.idx++; state.picked = null;
    if (state.idx >= state.questions.length) state.mode = "end";
    render(); scrollTop();
  }

  function renderEnd() {
    const total = state.results.length || state.questions.length;
    const score = state.results.filter(Boolean).length;
    const ratio = total ? score / total : 0;
    const msg = ratio === 1 ? "Sans faute. Tu me connais par cœur."
      : ratio >= .7 ? "Très fort. Tu me connais vraiment bien."
      : ratio >= .4 ? "Pas mal ! Il reste quelques mystères à percer."
      : "Ok… on a clairement des choses à se raconter.";
    return el("section", { class: "card empty" },
      el("span", { class: "eyebrow", text: "Résultat" }),
      el("p", { class: "score", text: score + "/" + total }),
      el("h2", { text: msg }),
      el("div", { class: "row" }, el("button", { type: "button", onclick: startQuiz, text: "Rejouer" })));
  }

  // ---------- admin ----------
  adminLink.addEventListener("click", () => {
    state.mode = state.session ? "admin" : "login"; state.loginErr = ""; render(); scrollTop();
  });

  function renderLogin() {
    const input = el("input", { type: "password", id: "admin-code", autocomplete: "current-password", placeholder: "Code d'accès" });
    const btn = el("button", { type: "submit", text: "Entrer", disabled: !sb });
    const form = el("form", { class: "card", onsubmit: async e => {
      e.preventDefault();
      if (!sb) return;
      btn.disabled = true;
      const { data, error } = await sb.auth.signInWithPassword({ email: cfg.adminEmail, password: input.value });
      if (error) { state.loginErr = "Code incorrect. Réessaie."; render(); return; }
      state.session = data.session; state.mode = "admin"; state.loginErr = ""; render();
    } },
      el("span", { class: "eyebrow", text: "Espace admin" }),
      el("h2", { text: "Entre le code d'accès" }),
      el("label", { for: "admin-code" }, "Code", input),
      state.loginErr ? el("p", { class: "notice err", text: state.loginErr }) : null,
      el("div", { class: "row" },
        btn,
        el("button", { type: "button", class: "ghost", onclick: () => { state.mode = "intro"; render(); }, text: "Retour au quiz" })));
    setTimeout(() => input.focus(), 0);
    return form;
  }

  function renderAdmin() {
    if (!state.session) { state.mode = "login"; return renderLogin(); }
    const box = el("div", { class: "stack", style: "gap:24px" });

    box.append(el("div", { class: "row spread" },
      el("div", {}, el("span", { class: "eyebrow", text: "Dashboard" }), el("h2", { text: "Gérer le quiz" })),
      el("div", { class: "row" },
        el("button", { type: "button", class: "ghost small", onclick: () => { state.mode = "intro"; render(); }, text: "Voir le quiz" }),
        el("button", { type: "button", class: "ghost small", onclick: logout, text: "Se déconnecter" }))));

    box.append(renderForm());

    const list = el("section", { class: "card" }, el("h3", { text: "Questions (" + state.questions.length + ")" }));
    if (!state.questions.length) {
      list.append(el("p", { class: "muted", text: "Aucune question pour l'instant. Ajoute la première avec le formulaire ci-dessus." }));
    } else {
      list.append(el("div", { class: "qlist" }, state.questions.map((q, i) => el("div", { class: "qitem" },
        q.photo_path ? el("img", { class: "thumb", src: photoUrl(q.photo_path), alt: "" }) : el("div", { class: "thumb", text: "sans photo" }),
        el("div", { class: "meta" },
          el("p", { class: "q", text: (i + 1) + ". " + q.question }),
          el("p", { class: "a", text: "✓ " + ((q.answers || [])[Number(q.correct)] || "") })),
        el("div", { class: "acts" },
          el("button", { type: "button", class: "iconbtn", "aria-label": "Monter", disabled: i === 0, onclick: () => move(i, -1), text: "↑" }),
          el("button", { type: "button", class: "iconbtn", "aria-label": "Descendre", disabled: i === state.questions.length - 1, onclick: () => move(i, 1), text: "↓" }),
          el("button", { type: "button", class: "iconbtn", onclick: () => startEdit(q), text: "Modifier" }),
          el("button", { type: "button", class: "iconbtn danger", onclick: e => confirmDelete(e.currentTarget, q), text: "Supprimer" }))))));
    }
    box.append(list);
    box.append(renderCodeChange());
    return box;
  }

  async function logout() {
    await sb.auth.signOut();
    state.session = null; state.mode = "intro"; render();
  }

  function startEdit(q) {
    state.editingId = q.id;
    state.form = { question: q.question, answers: [...q.answers], correct: Number(q.correct), photoPath: q.photo_path };
    render(); scrollTop();
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
        ({ error } = await sb.from("questions").insert({ ...row, position: maxPos + 1 }));
      }
      state.saving = false;
      if (error) { saveBtn.disabled = false; return showErr(authHint(error) || "L'enregistrement a échoué. Réessaie dans un instant."); }
      toast(editing ? "Question modifiée" : "Question ajoutée");
      state.editingId = null; state.form = emptyForm();
      await loadQuestions();
      function showErr(m) { err.textContent = m; err.hidden = false; }
    } },
      el("h3", { text: editing ? "Modifier la question" : "Nouvelle question" }),
      el("label", { for: "f-question" }, "Question", qInput),
      el("div", { class: "stack" },
        el("span", { class: "label" }, "Réponses ", el("span", { class: "hint", text: "— coche la bonne" })),
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

  function authHint(error) {
    const m = String(error && (error.message || error.code) || "");
    if (/JWT|row-level security|permission|401|403/i.test(m)) return "Ta session admin a expiré. Déconnecte-toi puis reconnecte-toi.";
    return "";
  }

  async function move(i, dir) {
    const list = state.questions.slice();
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    // renumérote proprement toute la liste
    const updates = list.map((q, k) => ({ id: q.id, position: k + 1 })).filter((u, k) => list[k].position !== u.position);
    state.questions = list.map((q, k) => ({ ...q, position: k + 1 }));
    render();
    for (const u of updates) {
      const { error } = await sb.from("questions").update({ position: u.position }).eq("id", u.id);
      if (error) { toast("Impossible de déplacer la question."); break; }
    }
    loadQuestions();
  }

  async function confirmDelete(btn, q) {
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
    loadQuestions();
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
      el("h3", { text: "Code d'accès" }),
      el("p", { class: "muted", text: "Change ici le code qui ouvre cet espace admin." }),
      el("div", { class: "row" }, el("div", { style: "flex:1;min-width:180px" }, input), el("button", { type: "submit", class: "small", text: "Changer le code" })),
      msg);
  }

  boot();
})();
