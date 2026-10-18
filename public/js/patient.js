// English source strings; translated into the patient's language when they join.
const STRINGS = {
  visitWith: "Visit with {doctor}",
  connected: "Your doctor is here",
  waiting: "Waiting for your doctor",
  reconnecting: "Reconnecting…",
  conversation: "Conversation",
  documents: "Documents",
  tapToSpeak: "Tap to speak",
  tapWhenDone: "Tap when you're done",
  listening: "Listening…",
  understanding: "Understanding…",
  translating: "Translating…",
  typeInstead: "Type instead",
  speakInstead: "Speak instead",
  typePlaceholder: "Type your message…",
  cancel: "Cancel",
  you: "You",
  doctor: "Doctor",
  listen: "Listen",
  playTranslation: "Play in English",
  showOriginal: "Show English",
  hideOriginal: "Hide English",
  showTranslation: "Show English",
  hideTranslation: "Hide English",
  original: "English",
  translation: "Your doctor sees",
  emptyTitle: "Speak in your own language",
  emptyBody: "Press the button below and talk. Your doctor hears you in English, and their answers are read to you in your language.",
  docsEmpty: "Papers from your doctor, like medicines and care instructions, will appear here in your language.",
  newDocument: "Your doctor sent you a document",
  doctorSpeaking: "Your doctor is speaking…",
  doctorTranslating: "Translating for you…",
  didntCatch: "Sorry, I didn't catch that. Please try again.",
  micBlocked: "The microphone is blocked. Please allow it in your browser settings.",
  noVoice: "Voice isn't available on this device. Please type instead.",
  autoOn: "Messages will be read aloud",
  autoOff: "Messages won't be read aloud",
  print: "Print",
  originalFile: "Original document",
  translatedFile: "Open the translated document",
  reply: "Reply",
  sendReply: "Send",
  english: "English",
  type_summary: "Visit summary",
  type_medication: "Medicine",
  type_instructions: "Care instructions",
  type_form: "Questions",
  type_other: "Document",
  ended: "This visit has ended",
  endedBody: "Ask your doctor for a new code.",
};

let T = { ...STRINGS };
function t(key, vars = {}) {
  return (T[key] || STRINGS[key] || key).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
}

const state = {
  session: null,
  es: null,
  clientId: uid(),
  autoplay: pref("ll.patient.autoplay", true),
  presence: { doctor: false, patient: false },
  doctorActivity: "idle",
  pending: new Map(),
  seen: new Set(),
  docSeen: new Set(),
  unread: 0,
  typing: false,
  config: null,
};

const el = {
  join: $("#join"),
  session: $("#session"),
  messages: $("#messages"),
  input: $("#text-input"),
  send: $("#send-btn"),
  mic: $("#mic-btn"),
  micLabel: $("#mic-label"),
  composer: $("#composer"),
  modeToggle: $("#mode-toggle"),
  docList: $("#doc-list"),
  badge: $("#doc-badge"),
};

hydrateIcons();
el.mic.innerHTML = icon("mic");
el.send.innerHTML = icon("send");
el.session.classList.add("patient-ui");

const recLabels = { cancel: t("cancel"), listening: t("listening") };
const recBar = createRecBar($("#rec-bar"), recLabels);
const recorder = new VoiceRecorder({ onLevel: (v) => recBar.level(v), onLimit: () => finishRecording() });

/* ---------- Join ---------- */

const codeInput = $("#code-input");
codeInput.addEventListener("input", () => {
  codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  $("#join-error").hidden = true;
});

$("#join-form").addEventListener("submit", (e) => {
  e.preventDefault();
  join(codeInput.value);
});

async function join(code) {
  code = String(code || "").trim().toUpperCase();
  if (code.length < 6) return showJoinError("Enter the 6-letter code from your doctor.");
  const btn = $("#join-btn");
  btn.classList.add("is-busy");
  try {
    const session = await api(`/api/sessions/${encodeURIComponent(code)}`);
    history.replaceState(null, "", `patient.html?code=${session.id}`);
    startSession(session);
  } catch (err) {
    showJoinError(err.status === 404 ? "We couldn't find that visit. Check the code and try again." : err.message);
  } finally {
    btn.classList.remove("is-busy");
  }
}

function showJoinError(msg) {
  const e = $("#join-error");
  e.textContent = msg;
  e.hidden = false;
}

(async function init() {
  api("/api/config").then((c) => (state.config = c)).catch(() => {});
  const code = new URLSearchParams(location.search).get("code");
  if (code) {
    codeInput.value = code.toUpperCase();
    join(code);
  }
})();

function startSession(session) {
  state.session = session;
  const lang = session.language;
  el.join.hidden = true;
  el.session.hidden = false;
  document.documentElement.lang = lang.code;
  $("#lang-chip span").textContent = lang.native;
  paintAutoplay();
  applyStrings();
  renderAll();
  renderDocs();
  connect();
  loadStrings(lang);
}

async function loadStrings(lang) {
  const cacheKey = `ll.strings.${lang.code}.v3`;
  const cached = pref(cacheKey, null);
  if (cached) {
    T = { ...STRINGS, ...cached };
    applyStrings();
    return;
  }
  try {
    const translated = await api("/api/ui-strings", { method: "POST", body: { lang: lang.name, strings: STRINGS } });
    T = { ...STRINGS, ...translated };
    setPref(cacheKey, translated);
    applyStrings();
  } catch {
    /* keep English */
  }
}

function applyStrings() {
  for (const node of $$("[data-i18n]")) node.textContent = t(node.dataset.i18n);
  for (const node of $$("[data-i18n-placeholder]")) node.placeholder = t(node.dataset.i18nPlaceholder);
  $("#visit-title").textContent = t("visitWith", { doctor: state.session.doctorName });
  document.title = `${t("visitWith", { doctor: state.session.doctorName })} · Clara`;
  recLabels.cancel = t("cancel");
  recLabels.listening = t("listening");
  recBar.cancelButton.textContent = t("cancel");
  el.micLabel.textContent = recorder.active ? t("tapWhenDone") : t("tapToSpeak");
  el.modeToggle.textContent = state.typing ? t("speakInstead") : t("typeInstead");
  paintPresence();
  paintAutoplay();
  if (state.session) {
    renderAll();
    renderDocs();
  }
}

/* ---------- Real-time ---------- */

function connect() {
  state.es?.close();
  state.es = connectEvents(state.session.id, "patient", {
    init(snapshot) {
      state.session = { ...state.session, ...snapshot };
      state.seen = new Set(snapshot.messages.map((m) => m.id));
      state.docSeen = new Set(snapshot.documents.map((d) => d.id));
      state.presence = snapshot.presence;
      paintPresence();
      renderAll();
      renderDocs();
    },
    message: (m) => handleMessage(m, true),
    document: (d) => handleDocument(d, true),
    presence(p) {
      state.presence = p;
      paintPresence();
    },
    activity(a) {
      if (a.clientId === state.clientId || a.role !== "doctor") return;
      state.doctorActivity = a.state;
      renderIndicator();
    },
    connection(status) {
      if (status === "open") return paintPresence();
      $("#presence-text").textContent = t("reconnecting");
      $("#presence").classList.remove("online");
      if (status === "closed") recoverConnection();
    },
  });
}

async function recoverConnection() {
  try {
    await api(`/api/sessions/${state.session.id}`);
    setTimeout(connect, 1500);
  } catch (err) {
    if (err.status === 404) showEnded();
    else setTimeout(recoverConnection, 3000);
  }
}

function showEnded() {
  state.es?.close();
  el.messages.innerHTML = `<div class="empty"><div class="empty-icon">${icon("info", "icon-lg")}</div><h2></h2><p></p></div>`;
  $(".empty h2", el.messages).textContent = t("ended");
  $(".empty p", el.messages).textContent = t("endedBody");
  $(".composer").hidden = true;
}

function paintPresence() {
  const online = state.presence.doctor;
  $("#presence").classList.toggle("online", online);
  $("#presence-text").textContent = online ? t("connected") : t("waiting");
}

/* ---------- Conversation ---------- */

function msgOpts() {
  return {
    viewer: "patient",
    labels: {
      you: t("you"), doctor: t("doctor"), patient: t("you"), listen: t("listen"), playTranslation: t("playTranslation"),
      showOriginal: t("showOriginal"), hideOriginal: t("hideOriginal"), showTranslation: t("showTranslation"),
      hideTranslation: t("hideTranslation"), original: t("original"), translation: t("translation"),
    },
    docTitle: (id) => state.session.documents.find((d) => d.id === id)?.translatedTitle,
  };
}

function renderAll() {
  el.messages.innerHTML = "";
  if (!state.session.messages.length && !state.pending.size) {
    el.messages.innerHTML = `<div class="empty"><div class="empty-icon" style="color:var(--violet)">${icon("chats", "icon-lg")}</div><h2></h2><p></p></div>`;
    $(".empty h2", el.messages).textContent = t("emptyTitle");
    $(".empty p", el.messages).textContent = t("emptyBody");
  } else {
    for (const m of state.session.messages) el.messages.append(renderMessage(m, msgOpts()));
  }
  el.tail = document.createElement("div");
  el.tail.style.display = "contents";
  el.pendingBox = document.createElement("div");
  el.pendingBox.style.display = "contents";
  el.indicator = document.createElement("div");
  el.indicator.hidden = true;
  el.tail.append(el.pendingBox, el.indicator);
  el.messages.append(el.tail);
  for (const p of state.pending.values()) el.pendingBox.append(p);
  renderIndicator();
  scrollDown(true);
}

function scrollDown(force) {
  if (force || isNearBottom(el.messages)) requestAnimationFrame(() => (el.messages.scrollTop = el.messages.scrollHeight));
}

function handleMessage(m, live) {
  if (state.seen.has(m.id)) return;
  state.seen.add(m.id);
  state.session.messages.push(m);
  const pending = state.pending.get(m.clientMsgId);
  if (pending) {
    pending.remove();
    state.pending.delete(m.clientMsgId);
  }
  if (m.sender === "doctor") {
    state.doctorActivity = "idle";
    renderIndicator();
  }
  $(".empty", el.messages)?.remove();
  const node = renderMessage(m, msgOpts());
  el.messages.insertBefore(node, el.tail);
  scrollDown(m.clientId === state.clientId);
  if (live && state.autoplay && m.clientId !== state.clientId) {
    Speech.play(m.translated, m.to, m.sender, $(".play-btn", node));
  }
}

function renderIndicator() {
  if (!el.indicator) return;
  const s = state.doctorActivity;
  el.indicator.hidden = s === "idle";
  el.indicator.className = `typing ${s === "recording" ? "recording" : ""}`;
  el.indicator.innerHTML = `<span class="dots"><i></i><i></i><i></i></span><span></span>`;
  $("span:last-child", el.indicator).textContent = s === "recording" ? t("doctorSpeaking") : t("doctorTranslating");
  if (s !== "idle") scrollDown();
}

async function sendMessage(text, via, ref = null, hint = "") {
  const clientMsgId = uid();
  $(".empty", el.messages)?.remove();
  const p = renderPending(text, { own: true, label: t("you"), translating: t("translating") });
  state.pending.set(clientMsgId, p);
  el.pendingBox.append(p);
  scrollDown(true);
  try {
    const msg = await api(`/api/sessions/${state.session.id}/messages`, {
      method: "POST",
      body: { sender: "patient", text, via, ref, hint, clientId: state.clientId, clientMsgId },
    });
    handleMessage(msg, true);
  } catch (err) {
    p.remove();
    state.pending.delete(clientMsgId);
    toast(err.message, "error");
    if (via === "text" && !el.input.value && !ref) {
      el.input.value = text;
      updateSend();
    }
    if (!state.session.messages.length && !state.pending.size) renderAll();
    throw err;
  }
}

el.composer.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = el.input.value.trim();
  if (!text) return;
  el.input.value = "";
  updateSend();
  sendMessage(text, "text").catch(() => {});
});

function updateSend() {
  el.send.disabled = !el.input.value.trim();
}
el.input.addEventListener("input", updateSend);

el.modeToggle.addEventListener("click", () => {
  state.typing = !state.typing;
  el.composer.hidden = !state.typing;
  el.mic.hidden = state.typing;
  el.micLabel.hidden = state.typing;
  el.modeToggle.textContent = state.typing ? t("speakInstead") : t("typeInstead");
  if (state.typing) el.input.focus();
});

/* ---------- Voice ---------- */

el.mic.addEventListener("click", async () => {
  if (recorder.active) return finishRecording();
  if (!VoiceRecorder.supported() || state.config?.features.voiceInput === false) {
    toast(t("noVoice"), "error");
    if (!state.typing) el.modeToggle.click();
    return;
  }
  Speech.stop();
  try {
    await recorder.start();
  } catch (err) {
    return toast(err.name === "NotAllowedError" ? t("micBlocked") : t("noVoice"), "error");
  }
  el.mic.classList.add("recording");
  el.mic.innerHTML = icon("stop");
  el.micLabel.textContent = t("tapWhenDone");
  recBar.recording(recorder);
  postActivity(state.session.id, "patient", "recording", state.clientId);
});

function resetMic() {
  el.mic.classList.remove("recording");
  el.mic.innerHTML = icon("mic");
  el.micLabel.textContent = t("tapToSpeak");
}

async function finishRecording() {
  if (!recorder.active) return;
  resetMic();
  const blob = await recorder.stop();
  if (!blob) {
    recBar.hide();
    postActivity(state.session.id, "patient", "idle", state.clientId);
    return toast(t("didntCatch"));
  }
  postActivity(state.session.id, "patient", "transcribing", state.clientId);
  recBar.processing(t("understanding"));
  el.mic.classList.add("busy");
  try {
    const { text, english } = await transcribe(blob, state.session.language.code);
    if (text) sendMessage(text, "voice", null, english).catch(() => {});
    else {
      postActivity(state.session.id, "patient", "idle", state.clientId);
      toast(t("didntCatch"));
    }
  } catch {
    postActivity(state.session.id, "patient", "idle", state.clientId);
    toast(t("didntCatch"), "error");
  } finally {
    recBar.hide();
    el.mic.classList.remove("busy");
  }
}

recBar.cancelButton.addEventListener("click", () => {
  recorder.cancel();
  resetMic();
  recBar.hide();
  postActivity(state.session.id, "patient", "idle", state.clientId);
});

/* ---------- Autoplay ---------- */

function paintAutoplay() {
  const b = $("#autoplay-btn");
  b.innerHTML = icon(state.autoplay ? "volume" : "volumeOff");
  b.classList.toggle("is-on", state.autoplay);
  const label = state.autoplay ? t("autoOn") : t("autoOff");
  b.title = label;
  b.setAttribute("aria-label", label);
}
$("#autoplay-btn").addEventListener("click", () => {
  state.autoplay = !state.autoplay;
  setPref("ll.patient.autoplay", state.autoplay);
  if (!state.autoplay) Speech.stop();
  paintAutoplay();
  toast(state.autoplay ? t("autoOn") : t("autoOff"));
});

/* ---------- Documents ---------- */

const desktop = window.matchMedia("(min-width: 960px)");

function docOpts() {
  return {
    labels: {
      listen: t("listen"), print: t("print"), english: t("english"), reply: t("reply"),
      sendReply: t("sendReply"), cancel: t("cancel"), originalFile: t("originalFile"), translatedFile: t("translatedFile"),
    },
    typeLabel: (type) => t(`type_${type}`),
    defaultView: "translated",
    languageLabel: state.session.language.native,
    fileUrl: (doc, v) => `/api/sessions/${state.session.id}/documents/${doc.id}/file${v ? `?v=${v}` : ""}`,
    onReply: (doc, text) => sendMessage(text, "text", doc.id),
  };
}

function renderDocs() {
  el.docList.innerHTML = "";
  const docs = state.session.documents;
  if (!docs.length) {
    el.docList.innerHTML = `<div class="empty"><div class="empty-icon" style="color:var(--violet)">${icon("file", "icon-lg")}</div><p></p></div>`;
    $(".empty p", el.docList).textContent = t("docsEmpty");
    return;
  }
  for (const d of [...docs].reverse()) el.docList.append(renderDocCard(d, docOpts()));
}

function handleDocument(doc, live) {
  if (state.docSeen.has(doc.id)) return;
  state.docSeen.add(doc.id);
  state.session.documents.push(doc);
  renderDocs();
  if (!live) return;
  toast(t("newDocument"), "success");
  if (!desktop.matches && $(".workspace").dataset.active !== "docs") {
    state.unread++;
    el.badge.textContent = state.unread;
    el.badge.hidden = false;
  }
}

setupTabs((pane) => {
  if (pane === "docs") {
    state.unread = 0;
    el.badge.hidden = true;
  }
});
