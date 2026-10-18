/* Shared client code for doctor and patient views. */

const ICONS = {
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><path d="M12 18v4"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" stroke="none"/>',
  send: '<path d="M22 2 11 13"/><path d="m22 2-7 20-4-9-9-4 20-7z"/>',
  volume: '<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/>',
  volumeOff: '<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="m23 9-6 6"/><path d="m17 9 6 6"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  pill: '<path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/>',
  clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
  form: '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  chats: '<path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z"/><path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1"/>',
  arrowLeft: '<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>',
  arrowRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  userPlus: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6"/><path d="M22 11h-6"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  stethoscope: '<path d="M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 6 6 6 6 0 0 0 6-6V4a2 2 0 0 0-2-2h-1a.2.2 0 1 0 .3.3"/><path d="M8 15v1a6 6 0 0 0 6 6 6 6 0 0 0 6-6v-4"/><circle cx="20" cy="10" r="2"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  printer: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  keyboard: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 16h10"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  reply: '<path d="m9 17-5-5 5-5"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  wifi: '<path d="M5 13a10 10 0 0 1 14 0"/><path d="M8.5 16.5a5 5 0 0 1 7 0"/><path d="M2 8.82a15 15 0 0 1 20 0"/><path d="M12 20h.01"/>',
  logo: '<path d="M7 10h6"/><path d="M10 7v6"/><path d="M21 12a8 8 0 0 1-11.8 7L4 20.5l1.5-5A8 8 0 1 1 21 12z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
};

function icon(name, cls = "") {
  return `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ""}</svg>`;
}

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function hydrateIcons(root = document) {
  for (const el of $$("[data-icon]", root)) {
    el.insertAdjacentHTML("afterbegin", icon(el.dataset.icon, el.dataset.iconClass || ""));
    el.removeAttribute("data-icon");
  }
}

function pref(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}
function setPref(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

async function api(path, { method = "GET", body, form } = {}) {
  const opts = { method, headers: {} };
  if (form) opts.body = form;
  else if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(path, opts);
  } catch {
    throw new Error("Can't reach the server. Check your connection.");
  }
  const data = res.headers.get("content-type")?.includes("application/json") ? await res.json() : null;
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function toast(message, type = "info") {
  let host = $("#toasts");
  if (!host) {
    host = document.createElement("div");
    host.id = "toasts";
    host.className = "toasts";
    host.setAttribute("role", "status");
    document.body.appendChild(host);
  }
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.innerHTML = icon(type === "error" ? "info" : type === "success" ? "check" : "info");
  el.append(document.createTextNode(message));
  host.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

/* ---------- Real-time session events (SSE) ---------- */

function connectEvents(sessionId, role, handlers) {
  const es = new EventSource(`/api/sessions/${encodeURIComponent(sessionId)}/events?role=${role}`);
  for (const [event, fn] of Object.entries(handlers)) {
    if (event === "connection") continue;
    es.addEventListener(event, (e) => fn(JSON.parse(e.data)));
  }
  es.onopen = () => handlers.connection?.("open");
  es.onerror = () => handlers.connection?.(es.readyState === EventSource.CLOSED ? "closed" : "retrying");
  return es;
}

function postActivity(sessionId, role, state, clientId) {
  fetch(`/api/sessions/${sessionId}/activity`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role, state, clientId }),
  }).catch(() => {});
}

/* ---------- Microphone recording ---------- */

class VoiceRecorder {
  static supported() {
    return Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
  }

  static unsupportedReason() {
    if (!window.isSecureContext) return "Voice needs a secure (https) link on this device. Typing still works.";
    return "This browser can't record audio. Try Chrome or Safari, or type instead.";
  }

  constructor({ onLevel, onLimit, maxMs = 120000 } = {}) {
    this.onLevel = onLevel;
    this.onLimit = onLimit;
    this.maxMs = maxMs;
    this.active = false;
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((t) =>
      MediaRecorder.isTypeSupported(t)
    );
    this.chunks = [];
    this.peak = 0;
    this.startedAt = performance.now();
    this.rec = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.rec.start(250);
    this.active = true;

    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) {
      this.ctx = new Ctx();
      const analyser = this.ctx.createAnalyser();
      analyser.fftSize = 512;
      this.ctx.createMediaStreamSource(this.stream).connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += ((v - 128) / 128) ** 2;
        const rms = Math.sqrt(sum / buf.length);
        this.peak = Math.max(this.peak, rms);
        this.onLevel?.(Math.min(1, rms * 5));
        this.raf = requestAnimationFrame(tick);
      };
      tick();
    } else {
      this.peak = 1;
    }
    this.limitTimer = setTimeout(() => this.onLimit?.(), this.maxMs);
  }

  elapsed() {
    return this.active ? performance.now() - this.startedAt : 0;
  }

  // Resolves to a Blob, or null if the clip was too short or silent (Whisper invents text on silence).
  stop() {
    return new Promise((resolve) => {
      if (!this.rec || this.rec.state === "inactive") return resolve(null);
      const duration = this.elapsed();
      this.rec.onstop = () => {
        const blob = new Blob(this.chunks, { type: this.rec.mimeType || "audio/webm" });
        const heard = duration > 600 && this.peak > 0.015;
        this.cleanup();
        resolve(heard ? blob : null);
      };
      this.rec.stop();
    });
  }

  cancel() {
    if (this.rec && this.rec.state !== "inactive") {
      this.rec.onstop = () => this.cleanup();
      this.rec.stop();
    } else this.cleanup();
  }

  cleanup() {
    this.active = false;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.limitTimer);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}

async function transcribe(blob, languageCode) {
  const form = new FormData();
  const ext = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
  form.append("audio", blob, `speech.${ext}`);
  if (languageCode) form.append("language", languageCode);
  const { text, english } = await api("/api/transcribe", { method: "POST", form });
  return { text: text || "", english: english || "" };
}

/* Recording bar UI: meter, timer, label. */
function createRecBar(el, labels) {
  el.innerHTML = `<span class="rec-dot"></span><span class="label"></span><div class="meter">${"<i></i>".repeat(28)}</div><span class="rec-time">0:00</span><button type="button" class="link-btn cancel"></button>`;
  const bars = $$(".meter i", el);
  const label = $(".label", el);
  const time = $(".rec-time", el);
  const cancel = $(".cancel", el);
  cancel.textContent = labels.cancel;
  let timer = null;
  let levels = new Array(bars.length).fill(0);
  return {
    cancelButton: cancel,
    recording(recorder) {
      el.hidden = false;
      el.classList.remove("processing");
      label.textContent = labels.listening;
      cancel.hidden = false;
      time.hidden = false;
      levels.fill(0);
      timer = setInterval(() => {
        const s = Math.floor(recorder.elapsed() / 1000);
        time.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
      }, 250);
    },
    level(v) {
      levels.push(v);
      levels = levels.slice(-bars.length);
      bars.forEach((b, i) => (b.style.height = `${3 + levels[i] * 22}px`));
    },
    processing(text) {
      clearInterval(timer);
      el.hidden = false;
      el.classList.add("processing");
      label.textContent = text;
      cancel.hidden = true;
      time.hidden = true;
      bars.forEach((b) => (b.style.height = "3px"));
    },
    hide() {
      clearInterval(timer);
      el.hidden = true;
      time.textContent = "0:00";
    },
  };
}

/* ---------- Text to speech playback ---------- */

const Speech = {
  audio: null,
  btn: null,
  token: 0,

  async play(text, lang, voice, btn) {
    this.stop();
    const token = ++this.token;
    this.btn = btn || null;
    btn?.classList.add("is-loading");
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, lang, voice }),
      });
      if (!res.ok) throw new Error("Couldn't play audio right now.");
      const url = URL.createObjectURL(await res.blob());
      if (token !== this.token) return URL.revokeObjectURL(url);
      const audio = new Audio(url);
      this.audio = audio;
      btn?.classList.replace("is-loading", "is-playing");
      const done = () => {
        URL.revokeObjectURL(url);
        if (this.audio === audio) this.stop();
      };
      audio.onended = done;
      audio.onerror = done;
      await audio.play();
    } catch (err) {
      if (token !== this.token) return;
      this.stop();
      if (err.name === "NotAllowedError") toast("Tap the speaker button to play audio.");
      else toast(err.message, "error");
    }
  },

  toggle(text, lang, voice, btn) {
    if (btn && (btn.classList.contains("is-playing") || btn.classList.contains("is-loading"))) this.stop();
    else this.play(text, lang, voice, btn);
  },

  stop() {
    this.token++;
    if (this.audio) {
      this.audio.pause();
      this.audio = null;
    }
    this.btn?.classList.remove("is-loading", "is-playing");
    this.btn = null;
  },
};

/* ---------- Renderers ---------- */

const DOC_ICONS = { summary: "file", medication: "pill", instructions: "clipboard", form: "form", other: "file" };

/*
 * labels: { you, doctor, patient, listen, playTranslation, showOriginal, hideOriginal,
 *           showTranslation, hideTranslation, original, translation }
 */
function renderMessage(msg, { viewer, labels, docTitle }) {
  const own = msg.sender === viewer;
  const el = document.createElement("article");
  el.className = `msg ${own ? "msg-own" : "msg-other"} msg-${msg.sender}`;
  el.dataset.id = msg.id;

  const shown = own ? msg.original : msg.translated;
  const alt = own ? msg.translated : msg.original;
  const refTitle = msg.ref ? docTitle?.(msg.ref) : null;

  el.innerHTML = `
    <div class="msg-meta">
      <span class="who"></span><span>·</span><span>${fmtTime(msg.at)}</span>
      ${msg.via === "voice" ? icon("mic") : ""}
    </div>
    <div class="bubble">
      ${refTitle ? `<div class="msg-ref">${icon("reply")}<span></span></div>` : ""}
      <p class="msg-text" dir="auto"></p>
      <div class="msg-alt" hidden><span class="msg-alt-label"></span><p dir="auto"></p></div>
      <div class="msg-actions">
        <button type="button" class="pill play-btn">${icon("volume")}<span></span></button>
        <button type="button" class="pill alt-btn"></button>
      </div>
    </div>`;

  $(".who", el).textContent = own ? labels.you : labels[msg.sender];
  if (refTitle) $(".msg-ref span", el).textContent = refTitle;
  $(".msg-text", el).textContent = shown;
  $(".msg-alt-label", el).textContent = own ? labels.translation : labels.original;
  $(".msg-alt p", el).textContent = alt;

  const playBtn = $(".play-btn", el);
  $("span", playBtn).textContent = own ? labels.playTranslation : labels.listen;
  // Always speak the translation: the other person's words in your language, or your words in theirs.
  playBtn.addEventListener("click", () => Speech.toggle(msg.translated, msg.to, msg.sender, playBtn));

  const altBtn = $(".alt-btn", el);
  const altBox = $(".msg-alt", el);
  const setAltLabel = () =>
    (altBtn.textContent = altBox.hidden
      ? own ? labels.showTranslation : labels.showOriginal
      : own ? labels.hideTranslation : labels.hideOriginal);
  setAltLabel();
  altBtn.addEventListener("click", () => {
    altBox.hidden = !altBox.hidden;
    setAltLabel();
  });

  return el;
}

function renderPending(text, { own, label, translating }) {
  const el = document.createElement("article");
  el.className = `msg ${own ? "msg-own" : "msg-other"} pending`;
  el.innerHTML = `
    <div class="msg-meta"><span class="who"></span></div>
    <div class="bubble"><p class="msg-text" dir="auto"></p><div class="pending-note"><span class="spinner"></span><span></span></div></div>`;
  $(".who", el).textContent = label;
  $(".msg-text", el).textContent = text;
  $(".pending-note span:last-child", el).textContent = translating;
  return el;
}

/*
 * opts: { labels: { listen, print, reply, sendReply, cancel, english }, typeLabel(type),
 *         defaultView: "translated" | "original", languageLabel, onReply?(doc, text) }
 */
function renderDocCard(doc, opts) {
  const { labels } = opts;
  const el = document.createElement("article");
  el.className = `card doc-card doc-${doc.type}`;
  el.dataset.id = doc.id;
  el.innerHTML = `
    <div class="doc-head">
      <div class="doc-icon">${icon(DOC_ICONS[doc.type] || "file")}</div>
      <div><h3 dir="auto"></h3><p class="doc-meta"></p></div>
    </div>
    <div class="seg" role="tablist">
      <button type="button" data-view="translated"></button>
      <button type="button" data-view="original"></button>
    </div>
    <div class="doc-body" dir="auto"></div>
    <div class="doc-actions">
      <button type="button" class="pill play-btn">${icon("volume")}<span></span></button>
      <button type="button" class="pill print-btn">${icon("printer")}<span></span></button>
      ${doc.file && opts.fileUrl ? `<a class="pill file-link" target="_blank" rel="noopener">${icon("external")}<span></span></a>` : ""}
      ${opts.onReply ? `<button type="button" class="pill reply-btn">${icon("reply")}<span></span></button>` : ""}
    </div>
    ${opts.onReply ? `<form class="reply-box" hidden><textarea dir="auto"></textarea><div class="row"><button type="button" class="btn btn-ghost btn-sm cancel"></button><button type="submit" class="btn btn-violet btn-sm send"></button></div></form>` : ""}`;

  $(".doc-meta", el).textContent = `${opts.typeLabel(doc.type)} · ${fmtTime(doc.at)}`;
  const [tBtn, oBtn] = $$(".seg button", el);
  tBtn.textContent = opts.languageLabel;
  oBtn.textContent = labels.english;
  $(".play-btn span", el).textContent = labels.listen;
  $(".print-btn span", el).textContent = labels.print;
  const fileLink = $(".file-link", el);
  if (fileLink) {
    fileLink.href = opts.fileUrl(doc);
    $("span", fileLink).textContent = labels.originalFile;
  }

  let view = opts.defaultView || "translated";
  const current = () =>
    view === "translated"
      ? { title: doc.translatedTitle, body: doc.translatedContent, lang: doc.language }
      : { title: doc.title, body: doc.content, lang: "English" };
  const paint = () => {
    const c = current();
    $("h3", el).textContent = c.title;
    $(".doc-body", el).textContent = c.body;
    tBtn.classList.toggle("active", view === "translated");
    oBtn.classList.toggle("active", view === "original");
  };
  paint();
  tBtn.addEventListener("click", () => { view = "translated"; Speech.stop(); paint(); });
  oBtn.addEventListener("click", () => { view = "original"; Speech.stop(); paint(); });

  const playBtn = $(".play-btn", el);
  playBtn.addEventListener("click", () => {
    const c = current();
    Speech.toggle(`${c.title}.\n${c.body}`, c.lang, "doctor", playBtn);
  });
  $(".print-btn", el).addEventListener("click", () => {
    const c = current();
    printDocument(c.title, c.body, `${opts.typeLabel(doc.type)} · ${new Date(doc.at).toLocaleString()}`);
  });

  if (opts.onReply) {
    const replyBtn = $(".reply-btn", el);
    const box = $(".reply-box", el);
    const ta = $("textarea", box);
    $(".reply-btn span", el).textContent = labels.reply;
    $(".cancel", box).textContent = labels.cancel;
    $(".send", box).textContent = labels.sendReply;
    replyBtn.addEventListener("click", () => {
      box.hidden = !box.hidden;
      if (!box.hidden) ta.focus();
    });
    $(".cancel", box).addEventListener("click", () => (box.hidden = true));
    box.addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = ta.value.trim();
      if (!text) return;
      const send = $(".send", box);
      send.classList.add("is-busy");
      try {
        await opts.onReply(doc, text);
        ta.value = "";
        box.hidden = true;
      } finally {
        send.classList.remove("is-busy");
      }
    });
  }
  return el;
}

function printDocument(title, body, subtitle) {
  const w = window.open("", "_blank");
  if (!w) return toast("Allow pop-ups to print this document.");
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
    <style>body{font-family:system-ui,-apple-system,sans-serif;max-width:720px;margin:40px auto;padding:0 24px;color:#0b2a3a;line-height:1.65}
    h1{font-size:24px;margin:0 0 4px}.sub{color:#6b7f8b;font-size:13px;margin-bottom:24px;padding-bottom:16px;border-bottom:1px solid #e1e8ec}
    .body{white-space:pre-wrap;font-size:16px}.foot{margin-top:32px;font-size:12px;color:#8a9aa4}</style></head>
    <body><h1 dir="auto">${escapeHtml(title)}</h1><div class="sub">${escapeHtml(subtitle)}</div>
    <div class="body" dir="auto">${escapeHtml(body)}</div><div class="foot">LinguaLink</div></body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}

/* Mobile tab switching between conversation and documents. */
function setupTabs(onChange) {
  const workspace = $(".workspace");
  for (const btn of $$(".tabs button")) {
    btn.addEventListener("click", () => {
      $$(".tabs button").forEach((b) => b.classList.toggle("active", b === btn));
      workspace.dataset.active = btn.dataset.pane;
      onChange?.(btn.dataset.pane);
    });
  }
  return () => workspace.dataset.active;
}

function isNearBottom(el) {
  return el.scrollHeight - el.scrollTop - el.clientHeight < 160;
}

function formatBytes(n) {
  return n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`;
}

/* ---------- Theme ---------- */

function currentTheme() {
  return document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}

function paintThemeButtons() {
  const dark = currentTheme() === "dark";
  for (const btn of $$("[data-theme-toggle]")) {
    btn.innerHTML = icon(dark ? "sun" : "moon");
    const label = dark ? "Switch to light mode" : "Switch to dark mode";
    btn.title = label;
    btn.setAttribute("aria-label", label);
  }
}

for (const btn of $$("[data-theme-toggle]")) {
  btn.addEventListener("click", () => {
    const next = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    setPref("ll.theme", next);
    paintThemeButtons();
  });
}
paintThemeButtons();
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", paintThemeButtons);
