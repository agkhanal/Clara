const LABELS = {
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
};

const DOC_TYPES = [
  {
    id: "summary",
    label: "Visit summary",
    title: "After-visit summary",
    template: "Reason for visit:\n\nWhat we found:\n\nWhat we did today:\n\nNext steps:\n\nFollow-up appointment:\n",
  },
  {
    id: "medication",
    label: "Medications",
    title: "Your medications",
    template: "Medicine:\nDose:\nWhen to take it:\nFor how long:\nWhat it's for:\nSide effects to watch for:\n",
  },
  {
    id: "instructions",
    label: "Care instructions",
    title: "Care instructions",
    template: "What to do at home:\n- \n\nWhat to avoid:\n- \n\nCall us or go to the emergency room if:\n- \n",
  },
  { id: "form", label: "Questions", title: "Questions for you", template: "Please answer these questions:\n1. \n2. \n3. \n" },
  { id: "other", label: "Other", title: "", template: "" },
];

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

const recBar = createRecBar($("#rec-bar"), { cancel: "Cancel", listening: "Listening…" });
const recorder = new VoiceRecorder({ onLevel: (v) => recBar.level(v), onLimit: () => finishRecording() });
const dictRecorder = new VoiceRecorder({ onLimit: () => stopDictation() });

/* ---------- Setup ---------- */

(async function init() {
  try {
    state.config = await api("/api/config");
  } catch (err) {
    toast(err.message, "error");
    return;
  }
  const select = $("#patient-language");
  const last = pref("ll.doctor.lang", "Spanish");
  for (const l of state.config.languages) {
    const opt = new Option(l.native === l.name ? l.name : `${l.name} — ${l.native}`, l.name);
    if (l.name === last) opt.selected = true;
    select.add(opt);
  }
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
  const patientLanguage = $("#patient-language").value;
  setPref("ll.doctor.name", doctorName);
  setPref("ll.doctor.lang", patientLanguage);
  btn.classList.add("is-busy");
  try {
    const session = await api("/api/sessions", { method: "POST", body: { doctorName, patientLanguage } });
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
  const lang = session.language;
  el.setup.hidden = true;
  el.session.hidden = false;
  document.title = `Visit ${session.id} · LinguaLink`;
  $("#code-label").textContent = session.id;
  $("#lang-chip span").textContent = lang.native === lang.name ? lang.name : `${lang.name} · ${lang.native}`;
  $("#doc-sub").textContent = `Written in English, delivered in ${lang.name}.`;
  renderDocTypes();
  selectDocType("summary");
  paintAutoplay();

  try {
    state.invite = await api(`/api/sessions/${session.id}/invite`);
  } catch {
    state.invite = null;
  }
  renderAll();
  renderDocs();
  connect();
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
      $("#presence-text").textContent = "Reconnecting…";
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
      <h2>This visit has ended</h2>
      <p>The server was restarted, so this visit is no longer available.</p>
      <p style="margin-top:16px"><a class="btn btn-primary" href="doctor.html">Start a new visit</a></p>
    </div>`;
  $(".composer").hidden = true;
}

function paintPresence() {
  const online = state.presence.patient;
  $("#presence").classList.toggle("online", online);
  $("#presence-text").textContent = online ? "Patient connected" : "Waiting for patient";
}

/* ---------- Conversation ---------- */

function msgOpts() {
  return { viewer: "doctor", labels: LABELS, docTitle: (id) => state.session.documents.find((d) => d.id === id)?.title };
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
  $("span:last-child", el.indicator).textContent =
    s === "recording" ? "Patient is speaking…" : "Translating patient's message…";
  if (s !== "idle") scrollDown();
}

async function sendMessage(text, via) {
  const clientMsgId = uid();
  clearEmptyState();
  const p = renderPending(text, { own: true, label: LABELS.you, translating: "Translating…" });
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
  if (err.name === "NotAllowedError") return "Microphone access is blocked. Allow it in your browser's site settings.";
  if (err.name === "NotFoundError") return "No microphone was found.";
  return "Couldn't start the microphone.";
}

function canRecord() {
  if (!VoiceRecorder.supported()) return toast(VoiceRecorder.unsupportedReason(), "error"), false;
  if (!state.config.features.voiceInput) return toast("Voice input isn't set up on the server (GROQ_API_KEY).", "error"), false;
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
  el.mic.setAttribute("aria-label", "Stop and send");
  recBar.recording(recorder);
  postActivity(state.session.id, "doctor", "recording", state.clientId);
});

function resetMic() {
  el.mic.classList.remove("recording");
  el.mic.innerHTML = icon("mic");
  el.mic.setAttribute("aria-label", "Record voice");
}

async function finishRecording() {
  if (!recorder.active) return;
  resetMic();
  const blob = await recorder.stop();
  if (!blob) {
    recBar.hide();
    postActivity(state.session.id, "doctor", "idle", state.clientId);
    return toast("Didn't catch that. Try again a little closer to the mic.");
  }
  postActivity(state.session.id, "doctor", "transcribing", state.clientId);
  recBar.processing("Transcribing…");
  el.mic.classList.add("busy");
  try {
    const { text } = await transcribe(blob, "en");
    if (text) sendMessage(text, "voice");
    else {
      postActivity(state.session.id, "doctor", "idle", state.clientId);
      toast("Didn't catch that. Try again.");
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
  const label = state.autoplay ? "Reading translations aloud (on)" : "Reading translations aloud (off)";
  b.title = label;
  b.setAttribute("aria-label", label);
}
$("#autoplay-btn").addEventListener("click", () => {
  state.autoplay = !state.autoplay;
  setPref("ll.doctor.autoplay", state.autoplay);
  if (!state.autoplay) Speech.stop();
  paintAutoplay();
  toast(state.autoplay ? "Translations will be read aloud" : "Auto-read is off");
});

/* ---------- Invite ---------- */

function renderInvitePanel() {
  const box = document.createElement("div");
  box.className = "card invite";
  const inv = state.invite;
  const lang = state.session.language;
  box.innerHTML = `
    <h2>Invite your patient</h2>
    <p>Have them scan the code with their phone camera, or enter the visit code.</p>
    <div class="invite-body">
      ${inv ? `<div class="qr">${inv.svg}</div>` : ""}
      <div>
        <div class="invite-code-label">Visit code</div>
        <div class="invite-code">${escapeHtml(state.session.id)}</div>
        <span class="lang-chip">${icon("globe")}<span></span></span>
      </div>
    </div>
    ${inv ? `<div class="invite-link"><code></code><button type="button" class="btn btn-soft btn-sm copy-btn">${icon("copy", "icon-sm")}Copy</button></div>` : ""}
    ${inv?.local ? `<p class="invite-hint">${icon("wifi")}<span>The phone must be on the same Wi-Fi as this computer. The first time it opens, the browser shows a security warning because the link uses this laptop&#39;s own certificate: tap <strong>Advanced</strong>, then <strong>Proceed</strong> (or <strong>Visit this website</strong> on iPhone).</span></p>` : ""}`;
  $(".lang-chip span", box).textContent = lang.native;
  if (inv) {
    $("code", box).textContent = inv.url;
    $(".copy-btn", box).addEventListener("click", () => copyText(inv.url));
  }
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
  toast("Link copied", "success");
}

$("#invite-btn").addEventListener("click", () => {
  const body = $("#invite-modal-body");
  const panel = renderInvitePanel();
  body.innerHTML = panel.innerHTML;
  body.insertAdjacentHTML("afterbegin", `<button class="icon-btn modal-close" type="button" aria-label="Close">${icon("x")}</button>`);
  $(".lang-chip span", body).textContent = state.session.language.native;
  if (state.invite) {
    $("code", body).textContent = state.invite.url;
    $(".copy-btn", body).addEventListener("click", () => copyText(state.invite.url));
  }
  $(".modal-close", body).addEventListener("click", closeModal);
  el.modal.hidden = false;
});
function closeModal() {
  el.modal.hidden = true;
}
el.modal.addEventListener("click", (e) => e.target === el.modal && closeModal());
document.addEventListener("keydown", (e) => e.key === "Escape" && closeModal());

/* ---------- Documents ---------- */

const typeLabel = (id) => DOC_TYPES.find((t) => t.id === id)?.label || "Document";

function docOpts() {
  return {
    labels: { listen: "Listen", print: "Print", english: "English", originalFile: "Original file" },
    typeLabel,
    defaultView: "translated",
    languageLabel: state.session.language.native,
    fileUrl: (doc) => `/api/sessions/${state.session.id}/documents/${doc.id}/file`,
  };
}

function renderDocs() {
  el.docList.innerHTML = "";
  const docs = state.session.documents;
  if (!docs.length) {
    el.docList.innerHTML = `<div class="empty" style="padding:12px"><p>Nothing sent yet. Documents you send appear here, in English and in ${escapeHtml(state.session.language.name)}.</p></div>`;
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
  for (const t of DOC_TYPES) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.dataset.type = t.id;
    chip.innerHTML = icon(DOC_ICONS[t.id]);
    chip.append(t.label);
    chip.addEventListener("click", () => selectDocType(t.id));
    box.append(chip);
  }
}

function selectDocType(id) {
  const prev = DOC_TYPES.find((t) => t.id === state.docType);
  const next = DOC_TYPES.find((t) => t.id === id);
  state.docType = id;
  $$("#doc-types .chip").forEach((c) => c.classList.toggle("active", c.dataset.type === id));
  if (state.docMode === "upload") return;
  if (!el.docTitle.value.trim() || el.docTitle.value === prev.title) el.docTitle.value = next.title;
  if (!el.docContent.value.trim() || el.docContent.value === prev.template) el.docContent.value = next.template;
}

/* Write vs. upload */

state.docMode = "write";
state.docFile = null;

for (const btn of $$(".doc-mode button")) {
  btn.addEventListener("click", () => {
    state.docMode = btn.dataset.mode;
    $$(".doc-mode button").forEach((b) => b.classList.toggle("active", b === btn));
    const upload = state.docMode === "upload";
    $("#write-fields").hidden = upload;
    $("#upload-fields").hidden = !upload;
    const typeTitle = DOC_TYPES.find((t) => t.id === state.docType).title;
    if (upload) {
      if (el.docTitle.value === typeTitle) el.docTitle.value = "";
      el.docTitle.placeholder = "Optional: we'll use the document's own title";
    } else {
      el.docTitle.placeholder = "";
      selectDocType(state.docType);
    }
  });
}

function setDocFile(file) {
  if (!file) return;
  const ok = ["application/pdf", "image/png", "image/jpeg", "image/webp"].includes(file.type);
  if (!ok) return toast("Choose a PDF or a photo (JPG or PNG).", "error");
  if (file.size > 20 * 1024 * 1024) return toast("That file is over 20 MB.", "error");
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
  const template = DOC_TYPES.find((t) => t.id === state.docType).template;
  const title = el.docTitle.value.trim();
  const content = el.docContent.value.trim();
  if (!title) return toast("Add a title first."), null;
  if (!content || content === template.trim()) return toast("Fill in the document before sending."), null;
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
  if (!state.docFile) return toast("Choose a PDF or photo first."), null;
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
  el.docSend.textContent = upload ? "Reading document" : "Translating";
  $("#doc-progress").hidden = !upload;
  try {
    const doc = upload ? await sendUploadedDoc() : await sendWrittenDoc();
    if (doc) {
      handleDocument(doc);
      toast(`Sent to patient in ${state.session.language.name}`, "success");
    }
  } catch (err) {
    toast(err.message, "error");
  } finally {
    el.docSend.classList.remove("is-busy");
    el.docSend.textContent = "Translate & send";
    $("#doc-progress").hidden = true;
  }
});

/* Dictate into the document */

function paintDictate(mode) {
  el.dictate.classList.toggle("recording", mode === "recording");
  el.dictate.disabled = mode === "busy";
  el.dictate.innerHTML =
    mode === "recording" ? `${icon("stop")}Stop` : mode === "busy" ? `<span class="spinner"></span>Transcribing` : `${icon("mic")}Dictate`;
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
    if (!blob) toast("Didn't catch that. Try again.");
    else insertAtCursor(el.docContent, (await transcribe(blob, "en")).text);
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
