// English source strings; translated into the doctor's language when it isn't English.
const STRINGS = {
  visit: "Visit",
  waitingPatient: "Waiting for patient",
  patientConnected: "Patient connected",
  reconnecting: "Reconnecting…",
  invite: "Invite",
  conversation: "Conversation",
  documents: "Documents",
  typePlaceholder: "Type in {lang}…",
  you: "You",
  doctor: "Doctor",
  patient: "Patient",
  listen: "Listen",
  playTranslation: "Play translation",
  showOriginal: "Show original",
  hideOriginal: "Hide original",
  showTranslation: "Show translation",
  hideTranslation: "Hide translation",
  original: "Original",
  translation: "Patient sees",
  translating: "Translating…",
  patientSpeaking: "Patient is speaking…",
  patientTranslating: "Translating patient's message…",
  listening: "Listening…",
  transcribing: "Transcribing…",
  cancel: "Cancel",
  recordVoice: "Record voice",
  stopAndSend: "Stop and send",
  didntCatch: "Didn't catch that. Try again a little closer to the mic.",
  micBlocked: "Microphone access is blocked. Allow it in your browser's site settings.",
  noMic: "No microphone was found.",
  micFailed: "Couldn't start the microphone.",
  noVoiceServer: "Voice input isn't set up on the server.",
  autoOn: "Reading translations aloud (on)",
  autoOff: "Reading translations aloud (off)",
  autoOnToast: "Translations will be read aloud",
  autoOffToast: "Auto-read is off",
  inviteTitle: "Invite your patient",
  inviteBody: "Have them scan the code with their phone camera, or enter the visit code.",
  visitCode: "Visit code",
  copy: "Copy",
  linkCopied: "Link copied",
  inviteHint:
    "The phone must be on the same Wi-Fi as this computer. The first time it opens, the browser shows a security warning because the link uses this laptop's own certificate: tap Advanced, then Proceed (or Visit this website on iPhone).",
  ended: "This visit has ended",
  endedBody: "The server was restarted, so this visit is no longer available.",
  newVisit: "Start a new visit",
  sendDocument: "Send a document",
  docSub: "Written in {doctorLang}, delivered in {patientLang}.",
  write: "Write",
  uploadPdf: "Upload PDF",
  title: "Title",
  contentLabel: "Content ({lang})",
  choosePdf: "Choose a PDF or photo",
  dropHint: "or drag it here · PDF, JPG, or PNG up to 20 MB",
  titleOptional: "Optional: we'll use the document's own title",
  translateSend: "Translate & send",
  readingDoc: "Reading document",
  translatingBtn: "Translating",
  progressNote: "Reading and translating the document. Longer files can take up to a minute.",
  sentToPatient: "Sent to patient",
  nothingSent: "Nothing sent yet. Documents you send appear here, in {doctorLang} and in {patientLang}.",
  addTitle: "Add a title first.",
  fillDoc: "Fill in the document before sending.",
  chooseFile: "Choose a PDF or photo first.",
  badFile: "Choose a PDF or a photo (JPG or PNG).",
  tooBig: "That file is over 20 MB.",
  sentIn: "Sent to patient in {lang}",
  listenDoc: "Listen",
  print: "Print",
  originalFile: "Original file",
  translatedFile: "Translated PDF",
  dictate: "Dictate",
  stop: "Stop",
  transcribingShort: "Transcribing",
  type_summary: "Visit summary",
  type_medication: "Medications",
  type_instructions: "Care instructions",
  type_form: "Questions",
  type_other: "Other",
  title_summary: "After-visit summary",
  title_medication: "Your medications",
  title_instructions: "Care instructions",
  title_form: "Questions for you",
  template_summary: "Reason for visit:\n\nWhat we found:\n\nWhat we did today:\n\nNext steps:\n\nFollow-up appointment:\n",
  template_medication: "Medicine:\nDose:\nWhen to take it:\nFor how long:\nWhat it's for:\nSide effects to watch for:\n",
  template_instructions: "What to do at home:\n- \n\nWhat to avoid:\n- \n\nCall us or go to the emergency room if:\n- \n",
  template_form: "Please answer these questions:\n1. \n2. \n3. \n",
};

let T = { ...STRINGS };
function t(key, vars = {}) {
  return (T[key] ?? STRINGS[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
}

const DOC_TYPE_IDS = ["summary", "medication", "instructions", "form", "other"];
const docTitle = (id) => (id === "other" ? "" : t(`title_${id}`));
const docTemplate = (id) => (id === "other" ? "" : t(`template_${id}`));

const state = {
  config: null,
  session: null,
  es: null,
  clientId: uid(),
  autoplay: pref("ll.doctor.autoplay", true),
  presence: { doctor: false, patient: false },
  patientActivity: "idle",
  pending: new Map(),
  seen: new Set(),
  docSeen: new Set(),
  docType: "summary",
  docMode: "write",
  docFile: null,
  invite: null,
};

const el = {
  setup: $("#setup"),
  session: $("#session"),
  messages: $("#messages"),
  input: $("#text-input"),
  send: $("#send-btn"),
  mic: $("#mic-btn"),
  composer: $("#composer"),
  docList: $("#doc-list"),
  docTitle: $("#doc-title"),
  docContent: $("#doc-content"),
  docSend: $("#doc-send"),
  dictate: $("#dictate-btn"),
  modal: $("#invite-modal"),
};

hydrateIcons();
el.mic.innerHTML = icon("mic");
el.send.innerHTML = icon("send");

const recLabels = { cancel: t("cancel"), listening: t("listening") };
const recBar = createRecBar($("#rec-bar"), recLabels);
const recorder = new VoiceRecorder({ onLevel: (v) => recBar.level(v), onLimit: () => finishRecording() });
const dictRecorder = new VoiceRecorder({ onLimit: () => stopDictation() });

const doctorLang = () => state.session.doctorLanguage || { name: "English", native: "English", code: "en" };
const patientLang = () => state.session.language;

/* ---------- Setup ---------- */

(async function init() {
  try {
    state.config = await api("/api/config");
  } catch (err) {
    toast(err.message, "error");
    return;
  }
  const fill = (select, chosen) => {
    for (const l of state.config.languages) {
      const opt = new Option(l.native === l.name ? l.name : `${l.name} — ${l.native}`, l.name);
      if (l.name === chosen) opt.selected = true;
      select.add(opt);
    }
  };
  fill($("#doctor-language"), pref("ll.doctor.ownLang", "English"));
  fill($("#patient-language"), pref("ll.doctor.lang", "Spanish"));
  $("#doctor-name").value = pref("ll.doctor.name", "");

  const code = new URLSearchParams(location.search).get("session");
  if (code) {
    try {
      return await startSession(await api(`/api/sessions/${encodeURIComponent(code)}`));
    } catch {
      history.replaceState(null, "", "doctor.html");
      toast("That visit has ended. Start a new one.");
    }
  }
})();

$("#setup-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("#start-btn");
  const doctorName = $("#doctor-name").value.trim();
  const doctorLanguage = $("#doctor-language").value;
  const patientLanguage = $("#patient-language").value;
  if (doctorLanguage === patientLanguage) return toast("Pick a patient language different from yours.", "error");
  setPref("ll.doctor.name", doctorName);
  setPref("ll.doctor.ownLang", doctorLanguage);
  setPref("ll.doctor.lang", patientLanguage);
  btn.classList.add("is-busy");
  try {
    const session = await api("/api/sessions", { method: "POST", body: { doctorName, doctorLanguage, patientLanguage } });
    history.replaceState(null, "", `doctor.html?session=${session.id}`);
    await startSession(session);
  } catch (err) {
    toast(err.message, "error");
  } finally {
    btn.classList.remove("is-busy");
  }
});

async function startSession(session) {
  state.session = session;
  el.setup.hidden = true;
  el.session.hidden = false;
  document.documentElement.lang = doctorLang().code;
  $("#code-label").textContent = session.id;
  const lang = patientLang();
  $("#lang-chip span").textContent = lang.native === lang.name ? lang.name : `${lang.name} · ${lang.native}`;
  renderDocTypes();
  selectDocType("summary");

  try {
    state.invite = await api(`/api/sessions/${session.id}/invite`);
  } catch {
    state.invite = null;
  }
  applyStrings();
  connect();
  loadStrings();
}

async function loadStrings() {
  const lang = doctorLang();
  if (lang.code === "en") return;
  const cacheKey = `ll.doctorStrings.${lang.code}.v1`;
  let translated = pref(cacheKey, null);
  if (!translated) {
    try {
      translated = await api("/api/ui-strings", { method: "POST", body: { lang: lang.name, strings: STRINGS } });
      setPref(cacheKey, translated);
    } catch {
      return;
    }
  }
  // Swap untouched templates for translated ones.
  const keepTitle = !el.docTitle.value.trim() || el.docTitle.value === docTitle(state.docType);
  const keepContent = !el.docContent.value.trim() || el.docContent.value === docTemplate(state.docType);
  T = { ...STRINGS, ...translated };
  if (state.docMode === "write") {
    if (keepTitle) el.docTitle.value = docTitle(state.docType);
    if (keepContent) el.docContent.value = docTemplate(state.docType);
  }
  applyStrings();
}

function applyStrings() {
  for (const node of $$("#session [data-i18n]")) node.textContent = t(node.dataset.i18n);
  const dl = doctorLang();
  const pl = patientLang();
  document.title = `${t("visit")} ${state.session.id} · Clara`;
  el.input.placeholder = t("typePlaceholder", { lang: dl.native });
  $("#doc-sub").textContent = t("docSub", { doctorLang: dl.native, patientLang: pl.native });
  $("#content-label").textContent = t("contentLabel", { lang: dl.native });
  if (state.docMode === "upload") el.docTitle.placeholder = t("titleOptional");
  recLabels.cancel = t("cancel");
  recLabels.listening = t("listening");
  recBar.cancelButton.textContent = t("cancel");
  el.mic.setAttribute("aria-label", recorder.active ? t("stopAndSend") : t("recordVoice"));
  renderDocTypes();
  paintDictate(dictRecorder.active ? "recording" : "idle");
  paintPresence();
  paintAutoplay();
  renderAll();
  renderDocs();
}

/* ---------- Real-time ---------- */

function connect() {
  state.es?.close();
  state.es = connectEvents(state.session.id, "doctor", {
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
    document: (d) => handleDocument(d),
    presence(p) {
      state.presence = p;
      paintPresence();
    },
    activity(a) {
      if (a.clientId === state.clientId || a.role !== "patient") return;
      state.patientActivity = a.state;
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
  el.messages.innerHTML = `
    <div class="empty">
      <div class="empty-icon">${icon("info", "icon-lg")}</div>
      <h2></h2><p></p>
      <p style="margin-top:16px"><a class="btn btn-primary" href="doctor.html"></a></p>
    </div>`;
  $(".empty h2", el.messages).textContent = t("ended");
  $(".empty p", el.messages).textContent = t("endedBody");
  $(".empty a", el.messages).textContent = t("newVisit");
  $(".composer").hidden = true;
}

function paintPresence() {
  const online = state.presence.patient;
  $("#presence").classList.toggle("online", online);
  $("#presence-text").textContent = online ? t("patientConnected") : t("waitingPatient");
}

/* ---------- Conversation ---------- */

function msgOpts() {
  const labels = {};
  for (const k of ["you", "doctor", "patient", "listen", "playTranslation", "showOriginal", "hideOriginal", "showTranslation", "hideTranslation", "original", "translation"]) {
    labels[k] = t(k);
  }
  return { viewer: "doctor", labels, docTitle: (id) => state.session.documents.find((d) => d.id === id)?.title };
}

function renderAll() {
  el.messages.innerHTML = "";
  if (!state.session.messages.length && !state.pending.size) {
    el.messages.append(renderInvitePanel());
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

function clearEmptyState() {
  $(".invite, .empty", el.messages)?.remove();
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
  if (m.sender === "patient") {
    state.patientActivity = "idle";
    renderIndicator();
  }
  clearEmptyState();
  const node = renderMessage(m, msgOpts());
  el.messages.insertBefore(node, el.tail);
  scrollDown(m.clientId === state.clientId);

  if (live && state.autoplay && m.clientId !== state.clientId) {
    Speech.play(m.translated, m.to, m.sender, $(".play-btn", node));
  }
}

function renderIndicator() {
  if (!el.indicator) return;
  const s = state.patientActivity;
  el.indicator.hidden = s === "idle";
  el.indicator.className = `typing ${s === "recording" ? "recording" : ""}`;
  el.indicator.innerHTML = `<span class="dots"><i></i><i></i><i></i></span><span></span>`;
  $("span:last-child", el.indicator).textContent = s === "recording" ? t("patientSpeaking") : t("patientTranslating");
  if (s !== "idle") scrollDown();
}

async function sendMessage(text, via) {
  const clientMsgId = uid();
  clearEmptyState();
  const p = renderPending(text, { own: true, label: t("you"), translating: t("translating") });
  state.pending.set(clientMsgId, p);
  el.pendingBox.append(p);
  scrollDown(true);
  try {
    const msg = await api(`/api/sessions/${state.session.id}/messages`, {
      method: "POST",
      body: { sender: "doctor", text, via, clientId: state.clientId, clientMsgId },
    });
    handleMessage(msg, true);
  } catch (err) {
    p.remove();
    state.pending.delete(clientMsgId);
    toast(err.message, "error");
    if (via === "text" && !el.input.value) {
      el.input.value = text;
      updateSend();
    }
    if (!state.session.messages.length && !state.pending.size) renderAll();
  }
}

el.composer.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = el.input.value.trim();
  if (!text) return;
  el.input.value = "";
  updateSend();
  sendMessage(text, "text");
});

function updateSend() {
  el.send.disabled = !el.input.value.trim();
}
el.input.addEventListener("input", updateSend);

/* ---------- Voice ---------- */

function micError(err) {
  if (err.name === "NotAllowedError") return t("micBlocked");
  if (err.name === "NotFoundError") return t("noMic");
  return t("micFailed");
}

function canRecord() {
  if (!VoiceRecorder.supported()) return toast(VoiceRecorder.unsupportedReason(), "error"), false;
  if (!state.config.features.voiceInput) return toast(t("noVoiceServer"), "error"), false;
  return true;
}

el.mic.addEventListener("click", async () => {
  if (recorder.active) return finishRecording();
  if (dictRecorder.active || !canRecord()) return;
  Speech.stop();
  try {
    await recorder.start();
  } catch (err) {
    return toast(micError(err), "error");
  }
  el.mic.classList.add("recording");
  el.mic.innerHTML = icon("stop");
  el.mic.setAttribute("aria-label", t("stopAndSend"));
  recBar.recording(recorder);
  postActivity(state.session.id, "doctor", "recording", state.clientId);
});

function resetMic() {
  el.mic.classList.remove("recording");
  el.mic.innerHTML = icon("mic");
  el.mic.setAttribute("aria-label", t("recordVoice"));
}

async function finishRecording() {
  if (!recorder.active) return;
  resetMic();
  const blob = await recorder.stop();
  if (!blob) {
    recBar.hide();
    postActivity(state.session.id, "doctor", "idle", state.clientId);
    return toast(t("didntCatch"));
  }
  postActivity(state.session.id, "doctor", "transcribing", state.clientId);
  recBar.processing(t("transcribing"));
  el.mic.classList.add("busy");
  try {
    const { text } = await transcribe(blob, doctorLang().code);
    if (text) sendMessage(text, "voice");
    else {
      postActivity(state.session.id, "doctor", "idle", state.clientId);
      toast(t("didntCatch"));
    }
  } catch (err) {
    postActivity(state.session.id, "doctor", "idle", state.clientId);
    toast(err.message, "error");
  } finally {
    recBar.hide();
    el.mic.classList.remove("busy");
  }
}

recBar.cancelButton.addEventListener("click", () => {
  recorder.cancel();
  resetMic();
  recBar.hide();
  postActivity(state.session.id, "doctor", "idle", state.clientId);
});

/* ---------- Autoplay toggle ---------- */

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
  setPref("ll.doctor.autoplay", state.autoplay);
  if (!state.autoplay) Speech.stop();
  paintAutoplay();
  toast(state.autoplay ? t("autoOnToast") : t("autoOffToast"));
});

/* ---------- Invite ---------- */

function renderInvitePanel() {
  const box = document.createElement("div");
  box.className = "card invite";
  const inv = state.invite;
  box.innerHTML = `
    <h2></h2>
    <p class="invite-body-text"></p>
    <div class="invite-body">
      ${inv ? `<div class="qr">${inv.svg}</div>` : ""}
      <div>
        <div class="invite-code-label"></div>
        <div class="invite-code">${escapeHtml(state.session.id)}</div>
        <span class="lang-chip">${icon("globe")}<span></span></span>
      </div>
    </div>
    ${inv ? `<div class="invite-link"><code></code><button type="button" class="btn btn-soft btn-sm copy-btn">${icon("copy", "icon-sm")}<span></span></button></div>` : ""}
    ${inv?.local ? `<p class="invite-hint">${icon("wifi")}<span></span></p>` : ""}`;
  $("h2", box).textContent = t("inviteTitle");
  $(".invite-body-text", box).textContent = t("inviteBody");
  $(".invite-code-label", box).textContent = t("visitCode");
  $(".lang-chip span", box).textContent = patientLang().native;
  if (inv) {
    $("code", box).textContent = inv.url;
    $(".copy-btn span", box).textContent = t("copy");
    $(".copy-btn", box).addEventListener("click", () => copyText(inv.url));
  }
  if (inv?.local) $(".invite-hint span", box).textContent = t("inviteHint");
  return box;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.append(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  toast(t("linkCopied"), "success");
}

$("#invite-btn").addEventListener("click", () => {
  const body = $("#invite-modal-body");
  body.replaceChildren(...renderInvitePanel().childNodes);
  body.insertAdjacentHTML("afterbegin", `<button class="icon-btn modal-close" type="button" aria-label="Close">${icon("x")}</button>`);
  $(".modal-close", body).addEventListener("click", closeModal);
  el.modal.hidden = false;
});
function closeModal() {
  el.modal.hidden = true;
}
el.modal.addEventListener("click", (e) => e.target === el.modal && closeModal());
document.addEventListener("keydown", (e) => e.key === "Escape" && closeModal());

/* ---------- Documents ---------- */

function docOpts() {
  return {
    labels: {
      listen: t("listenDoc"),
      print: t("print"),
      english: doctorLang().native,
      originalFile: t("originalFile"),
      translatedFile: t("translatedFile"),
    },
    typeLabel: (id) => t(`type_${id}`),
    defaultView: "translated",
    languageLabel: patientLang().native,
    fileUrl: (doc, v) => `/api/sessions/${state.session.id}/documents/${doc.id}/file${v ? `?v=${v}` : ""}`,
  };
}

function renderDocs() {
  el.docList.innerHTML = "";
  const docs = state.session.documents;
  if (!docs.length) {
    el.docList.innerHTML = `<div class="empty" style="padding:12px"><p></p></div>`;
    $(".empty p", el.docList).textContent = t("nothingSent", { doctorLang: doctorLang().native, patientLang: patientLang().native });
  }
  for (const d of [...docs].reverse()) el.docList.append(renderDocCard(d, docOpts()));
  const count = $("#doc-count");
  count.hidden = !docs.length;
  count.textContent = docs.length;
}

function handleDocument(doc) {
  if (state.docSeen.has(doc.id)) return;
  state.docSeen.add(doc.id);
  state.session.documents.push(doc);
  renderDocs();
}

function renderDocTypes() {
  const box = $("#doc-types");
  box.innerHTML = "";
  for (const id of DOC_TYPE_IDS) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = `chip${id === state.docType ? " active" : ""}`;
    chip.dataset.type = id;
    chip.innerHTML = icon(DOC_ICONS[id]);
    chip.append(t(`type_${id}`));
    chip.addEventListener("click", () => selectDocType(id));
    box.append(chip);
  }
}

function selectDocType(id) {
  const prev = state.docType;
  state.docType = id;
  $$("#doc-types .chip").forEach((c) => c.classList.toggle("active", c.dataset.type === id));
  if (state.docMode === "upload") return;
  if (!el.docTitle.value.trim() || el.docTitle.value === docTitle(prev)) el.docTitle.value = docTitle(id);
  if (!el.docContent.value.trim() || el.docContent.value === docTemplate(prev)) el.docContent.value = docTemplate(id);
}

/* Write vs. upload */

for (const btn of $$(".doc-mode button")) {
  btn.addEventListener("click", () => {
    state.docMode = btn.dataset.mode;
    $$(".doc-mode button").forEach((b) => b.classList.toggle("active", b === btn));
    const upload = state.docMode === "upload";
    $("#write-fields").hidden = upload;
    $("#upload-fields").hidden = !upload;
    if (upload) {
      if (el.docTitle.value === docTitle(state.docType)) el.docTitle.value = "";
      el.docTitle.placeholder = t("titleOptional");
    } else {
      el.docTitle.placeholder = "";
      selectDocType(state.docType);
    }
  });
}

function setDocFile(file) {
  if (!file) return;
  const ok = ["application/pdf", "image/png", "image/jpeg", "image/webp"].includes(file.type);
  if (!ok) return toast(t("badFile"), "error");
  if (file.size > 20 * 1024 * 1024) return toast(t("tooBig"), "error");
  state.docFile = file;
  $("#file-name").textContent = file.name;
  $("#file-size").textContent = formatBytes(file.size);
  $("#file-chip").hidden = false;
  $("#dropzone").hidden = true;
}

function clearDocFile() {
  state.docFile = null;
  $("#file-input").value = "";
  $("#file-chip").hidden = true;
  $("#dropzone").hidden = false;
}

$("#file-input").addEventListener("change", (e) => setDocFile(e.target.files[0]));
$("#file-clear").addEventListener("click", clearDocFile);
const dropzone = $("#dropzone");
dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("drag");
});
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("drag"));
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("drag");
  setDocFile(e.dataTransfer.files[0]);
});

async function sendWrittenDoc() {
  const title = el.docTitle.value.trim();
  const content = el.docContent.value.trim();
  if (!title) return toast(t("addTitle")), null;
  if (!content || content === docTemplate(state.docType).trim()) return toast(t("fillDoc")), null;
  const doc = await api(`/api/sessions/${state.session.id}/documents`, {
    method: "POST",
    body: { type: state.docType, title, content },
  });
  el.docTitle.value = "";
  el.docContent.value = "";
  selectDocType(state.docType);
  return doc;
}

async function sendUploadedDoc() {
  if (!state.docFile) return toast(t("chooseFile")), null;
  const form = new FormData();
  form.append("file", state.docFile, state.docFile.name);
  form.append("type", state.docType);
  form.append("title", el.docTitle.value.trim());
  const doc = await api(`/api/sessions/${state.session.id}/documents/upload`, { method: "POST", form });
  el.docTitle.value = "";
  clearDocFile();
  return doc;
}

el.docSend.addEventListener("click", async () => {
  const upload = state.docMode === "upload";
  el.docSend.classList.add("is-busy");
  el.docSend.textContent = upload ? t("readingDoc") : t("translatingBtn");
  $("#doc-progress").hidden = !upload;
  try {
    const doc = upload ? await sendUploadedDoc() : await sendWrittenDoc();
    if (doc) {
      handleDocument(doc);
      toast(t("sentIn", { lang: patientLang().native }), "success");
    }
  } catch (err) {
    toast(err.message, "error");
  } finally {
    el.docSend.classList.remove("is-busy");
    el.docSend.textContent = t("translateSend");
    $("#doc-progress").hidden = true;
  }
});

/* Dictate into the document */

function paintDictate(mode) {
  el.dictate.classList.toggle("recording", mode === "recording");
  el.dictate.disabled = mode === "busy";
  el.dictate.innerHTML =
    mode === "recording"
      ? `${icon("stop")}${escapeHtml(t("stop"))}`
      : mode === "busy"
        ? `<span class="spinner"></span>${escapeHtml(t("transcribingShort"))}`
        : `${icon("mic")}${escapeHtml(t("dictate"))}`;
}
paintDictate("idle");

el.dictate.addEventListener("click", async () => {
  if (dictRecorder.active) return stopDictation();
  if (recorder.active || !canRecord()) return;
  try {
    await dictRecorder.start();
    paintDictate("recording");
  } catch (err) {
    toast(micError(err), "error");
  }
});

async function stopDictation() {
  if (!dictRecorder.active) return;
  paintDictate("busy");
  const blob = await dictRecorder.stop();
  try {
    if (!blob) toast(t("didntCatch"));
    else insertAtCursor(el.docContent, (await transcribe(blob, doctorLang().code)).text);
  } catch (err) {
    toast(err.message, "error");
  } finally {
    paintDictate("idle");
  }
}

function insertAtCursor(ta, text) {
  if (!text) return;
  const start = ta.selectionStart ?? ta.value.length;
  const end = ta.selectionEnd ?? start;
  const before = ta.value.slice(0, start);
  const sep = before && !/\s$/.test(before) ? " " : "";
  ta.value = before + sep + text + ta.value.slice(end);
  const caret = (before + sep + text).length;
  ta.focus();
  ta.setSelectionRange(caret, caret);
}

setupTabs();
