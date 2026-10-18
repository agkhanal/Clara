import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import express from "express";
import multer from "multer";
import QRCode from "qrcode";
import selfsigned from "selfsigned";
import os from "node:os";
import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID, randomInt, createHash } from "node:crypto";

const PORT = Number(process.env.PORT) || 3000;
const HTTPS_PORT = Number(process.env.HTTPS_PORT) || 3443;
// Browsers only allow the microphone on https (or localhost), so phones on the same Wi-Fi need https.
const LOCAL_HTTPS = process.env.LOCAL_HTTPS !== "false" && process.env.NODE_ENV !== "production";
const MODEL = process.env.CLAUDE_MODEL || "claude-haiku-5-5";
const PATIENT_MODEL = process.env.CLAUDE_PATIENT_MODEL || "claude-sonnet-5-5";
const GROQ_KEY = process.env.GROQ_API_KEY;
const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY?.startsWith("your-") ? null : process.env.ELEVENLABS_API_KEY;

const LANGUAGES = [
  { name: "English", native: "English", code: "en" },
  { name: "Spanish", native: "Español", code: "es" },
  { name: "Mandarin Chinese", native: "中文", code: "zh" },
  { name: "Vietnamese", native: "Tiếng Việt", code: "vi" },
  { name: "Arabic", native: "العربية", code: "ar" },
  { name: "Nepali", native: "नेपाली", code: "ne" },
  { name: "Hindi", native: "हिन्दी", code: "hi" },
  { name: "Bengali", native: "বাংলা", code: "bn" },
  { name: "Urdu", native: "اردو", code: "ur" },
  { name: "Korean", native: "한국어", code: "ko" },
  { name: "Tagalog", native: "Tagalog", code: "tl" },
  { name: "French", native: "Français", code: "fr" },
  { name: "Haitian Creole", native: "Kreyòl ayisyen", code: "ht" },
  { name: "Portuguese", native: "Português", code: "pt" },
  { name: "Russian", native: "Русский", code: "ru" },
  { name: "Ukrainian", native: "Українська", code: "uk" },
  { name: "Persian", native: "فارسی", code: "fa" },
  { name: "Japanese", native: "日本語", code: "ja" },
  { name: "Somali", native: "Soomaali", code: "so" },
  { name: "Swahili", native: "Kiswahili", code: "sw" },
  { name: "Amharic", native: "አማርኛ", code: "am" },
  { name: "Burmese", native: "မြန်မာ", code: "my" },
  { name: "Polish", native: "Polski", code: "pl" },
  { name: "German", native: "Deutsch", code: "de" },
];
const ENGLISH = LANGUAGES[0];
const langByName = (name) => LANGUAGES.find((l) => l.name === name);
const langLabel = (l) => (l.native === l.name ? l.name : `${l.name} (${l.native})`);

// ElevenLabs model per language: multilingual_v2 sounds best where supported, v3 covers the long tail
const ELEVEN_V2 = new Set(["en", "es", "zh", "ar", "hi", "ko", "tl", "fr", "pt", "ru", "uk", "ja", "pl", "de"]);
const ELEVEN_TURBO = new Set(["vi"]);
const VOICES = {
  doctor: process.env.ELEVENLABS_DOCTOR_VOICE || "JBFqnCBsd6RMkjVDRZzb",
  patient: process.env.ELEVENLABS_PATIENT_VOICE || "EXAVITQu4vr4xnSDxMaL",
};

const DOC_TYPES = ["summary", "medication", "instructions", "form", "other"];

const anthropic = new Anthropic();
const app = express();
app.set("trust proxy", true);
// Send plain-http visits by IP (e.g. a phone opening http://192.168.x.x:3000) to the https server.
app.use((req, res, next) => {
  const host = req.get("host") || "";
  if (LOCAL_HTTPS && !req.secure && req.method === "GET" && /^\d+\.\d+\.\d+\.\d+(:\d+)?$/.test(host)) {
    return res.redirect(302, `https://${host.split(":")[0]}:${HTTPS_PORT}${req.originalUrl}`);
  }
  next();
});
app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

async function claude({ system, prompt, maxTokens = 4000 }) {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    output_config: { effort: "medium" },
    system,
    messages: [{ role: "user", content: prompt }],
  });
  if (response.stop_reason === "refusal") throw new Error("Model declined the request");
  return response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

// ---------- Sessions ----------

const sessions = new Map();
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function newCode() {
  let code;
  do {
    code = Array.from({ length: 6 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join("");
  } while (sessions.has(code));
  return code;
}

function findSession(req, res) {
  const session = sessions.get(String(req.params.id || "").toUpperCase());
  if (!session) res.status(404).json({ error: "Visit not found. Check the code and try again." });
  return session;
}

function presence(session) {
  const p = { doctor: false, patient: false };
  for (const c of session.clients) p[c.role] = true;
  return p;
}

function snapshot(session) {
  return {
    id: session.id,
    doctorName: session.doctorName,
    language: session.language,
    messages: session.messages,
    documents: session.documents,
    presence: presence(session),
  };
}

function broadcast(session, event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of session.clients) c.res.write(payload);
  session.lastActive = Date.now();
}

const roleOf = (v) => (v === "doctor" ? "doctor" : v === "patient" ? "patient" : null);

app.get("/api/config", (req, res) => {
  res.json({
    languages: LANGUAGES.filter((l) => l.code !== "en"),
    features: { voiceInput: Boolean(GROQ_KEY || ELEVEN_KEY), naturalVoice: Boolean(ELEVEN_KEY) },
  });
});

app.post("/api/sessions", (req, res) => {
  const language = langByName(req.body.patientLanguage);
  if (!language || language.code === "en") return res.status(400).json({ error: "Pick the patient's language." });
  const doctorName = String(req.body.doctorName || "").trim().slice(0, 80) || "Your doctor";
  const id = newCode();
  sessions.set(id, {
    id,
    doctorName,
    language,
    messages: [],
    documents: [],
    files: new Map(),
    clients: new Set(),
    lastActive: Date.now(),
  });
  res.json(snapshot(sessions.get(id)));
});

app.get("/api/sessions/:id", (req, res) => {
  const session = findSession(req, res);
  if (session) res.json(snapshot(session));
});

app.get("/api/sessions/:id/events", (req, res) => {
  const session = findSession(req, res);
  if (!session) return;
  const role = roleOf(req.query.role) || "patient";

  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();

  const client = { res, role };
  session.clients.add(client);
  res.write(`event: init\ndata: ${JSON.stringify(snapshot(session))}\n\n`);
  broadcast(session, "presence", presence(session));

  const ping = setInterval(() => res.write(": ping\n\n"), 25000);
  req.on("close", () => {
    clearInterval(ping);
    session.clients.delete(client);
    broadcast(session, "presence", presence(session));
  });
});

app.post("/api/sessions/:id/activity", (req, res) => {
  const session = findSession(req, res);
  if (!session) return;
  const role = roleOf(req.body.role);
  const state = ["recording", "transcribing", "idle"].includes(req.body.state) ? req.body.state : null;
  if (!role || !state) return res.status(400).json({ error: "Bad activity" });
  broadcast(session, "activity", { role, state, clientId: String(req.body.clientId || "") });
  res.json({ ok: true });
});

function conversationContext(session) {
  return session.messages
    .slice(-6)
    .map((m) => `${m.sender === "doctor" ? "Doctor" : "Patient"}: ${m.sender === "doctor" ? m.original : m.translated}`)
    .join("\n");
}

async function translateMessage(session, text, from, to) {
  const patient = session.language;
  const system = `You are a professional medical interpreter at a clinic visit between an English-speaking doctor and a patient who speaks ${langLabel(patient)}.

Translate the text inside <message> from ${langLabel(from)} into ${langLabel(to)}.
- Output only the translation: no quotes, notes, transliterations, or explanations.
- Write ${to.name} in its native script, as a native speaker would naturally say it.${to.code === "ne" ? " This must be Nepali as spoken in Nepal, not Hindi." : ""}
- Preserve meaning, tone, and person exactly. Never add, drop, or soften medical information, numbers, doses, or timing.
- When translating for the patient, prefer everyday words over jargon; keep drug names as written.
- If the message is already in ${to.name}, return it unchanged.
Earlier conversation (English) is given only for context; do not translate it.`;
  const context = conversationContext(session);
  const prompt = `${context ? `<context>\n${context}\n</context>\n\n` : ""}<message>${text}</message>`;
  return claude({ system, prompt });
}

const INTERPRET_SCHEMA = {
  type: "object",
  properties: { cleaned: { type: "string" }, translation: { type: "string" } },
  required: ["cleaned", "translation"],
  additionalProperties: false,
};

// Patient speech is the hard direction: speech recognition for languages like Nepali is error-prone and
// patients mix in English, so a stronger model reconstructs what was said before translating it.
async function interpretPatient(session, text, via, hint) {
  const lang = session.language;
  const ne = lang.code === "ne";
  const source =
    via === "voice"
      ? `<transcript> is automatic speech recognition of what the patient just said. It often contains errors:
- ${lang.name} words misheard, misspelled${ne ? " (often spelled the Hindi way)" : ""}, or split/joined wrongly${ne ? ' (e.g. "दुकसा" for "दुख्छ", "पची" for "पछि", "छाई ना" for "छैन")' : ""}
- English words the patient mixed in, written phonetically in ${lang.name} script${ne ? ' (e.g. "हेडेक" = headache, "रुम्मेट" = roommate, "आई फिल टायर्ड" = I feel tired)' : ""}
- ${lang.name} written in Latin letters${ne ? ' (e.g. "mero kotha sathi" = मेरो कोठा साथी)' : ""}
${
  hint
    ? `
<audio_english> is a separate machine translation made directly from the same audio. It is often right about who and what is being talked about, but it is sometimes wrong or just romanized gibberish. Use it to cross-check doubtful words: where it agrees with a plausible reading of the transcript, trust that reading.
`
    : ""
}
Reconstruct what the patient actually said, choosing the reading that sounds closest to the transcript.`
      : `<transcript> is a message the patient typed. It may be in ${lang.name} script, in ${lang.name} written with Latin letters, mixed with English, or contain typos. Work out what they meant.`;

  const system = `You are a professional interpreter at a clinic visit between an English-speaking doctor and a patient who speaks ${langLabel(lang)}. Like any professional interpreter, you render exactly what the patient says, nothing more and nothing less.

${source}

Rules:
- Patients also talk about other people and make small talk, jokes, complaints, and rude or crude remarks. Interpret each message on its own words. Do not reshape it to fit earlier symptoms, and do not turn remarks about someone else into the patient's own symptoms.
- Keep who the sentence is about: "my roommate's head" is not "my head".
- Keep informal, slang, rude, or crude language at the same level (e.g. ${ne ? '"चाक" = butt, "मूर्ख" = stupid' : "slang for body parts, insults"}). Never soften, censor, or skip it.
- Never invent symptoms, body parts, medicines, numbers, or names.

Return:
- "cleaned": the message in correct ${lang.name} (native script)${ne ? ", as spoken in Nepal, not Hindi" : ""}, with any English the patient used written in English letters. Fix recognition errors only; add nothing.
- "translation": the message in natural first-person English. If a part truly can't be reconstructed, write [unclear] for that part only.
The earlier conversation is context only; do not translate it.`;

  const context = conversationContext(session);
  const response = await anthropic.beta.messages.create({
    model: PATIENT_MODEL,
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: INTERPRET_SCHEMA } },
    system,
    messages: [
      {
        role: "user",
        content: `${context ? `<context>\n${context}\n</context>\n\n` : ""}<transcript>${text}</transcript>${
          hint ? `\n<audio_english>${hint}</audio_english>` : ""
        }`,
      },
    ],
  });
  if (response.stop_reason === "refusal") throw new Error("Model declined the request");
  const out = JSON.parse(response.content.filter((b) => b.type === "text").map((b) => b.text).join(""));
  const result = { cleaned: out.cleaned.trim() || text, translation: out.translation.trim() };
  console.log(`[patient ${via}] heard: ${text}${hint ? ` | audio→en: ${hint}` : ""}\n  → ${result.cleaned}\n  → ${result.translation}`);
  return result;
}

app.post("/api/sessions/:id/messages", async (req, res) => {
  const session = findSession(req, res);
  if (!session) return;
  const sender = roleOf(req.body.sender);
  const text = String(req.body.text || "").trim();
  if (!sender || !text) return res.status(400).json({ error: "Message is empty." });
  if (text.length > 4000) return res.status(400).json({ error: "Message is too long." });
  const ref = session.documents.some((d) => d.id === req.body.ref) ? req.body.ref : null;

  const from = sender === "doctor" ? ENGLISH : session.language;
  const to = sender === "doctor" ? session.language : ENGLISH;
  const clientId = String(req.body.clientId || "");
  broadcast(session, "activity", { role: sender, state: "translating", clientId });

  const via = req.body.via === "voice" ? "voice" : "text";

  try {
    let original = text;
    let translated;
    if (sender === "patient") {
      const hint = via === "voice" ? String(req.body.hint || "").slice(0, 4000) : "";
      const result = await interpretPatient(session, text, via, hint);
      translated = result.translation;
      // Show the corrected transcript for speech; keep exactly what the patient typed otherwise.
      if (via === "voice") original = result.cleaned;
    } else {
      translated = await translateMessage(session, text, from, to);
    }
    const message = {
      id: randomUUID(),
      sender,
      original,
      heard: via === "voice" && original !== text ? text : undefined,
      translated,
      from: from.name,
      to: to.name,
      via,
      ref,
      clientId,
      clientMsgId: String(req.body.clientMsgId || ""),
      at: Date.now(),
    };
    session.messages.push(message);
    broadcast(session, "message", message);
    res.json(message);
  } catch (err) {
    console.error("Translation error:", err.message);
    broadcast(session, "activity", { role: sender, state: "idle", clientId });
    res.status(502).json({ error: "Translation failed. Please try again." });
  }
});

app.post("/api/sessions/:id/documents", async (req, res) => {
  const session = findSession(req, res);
  if (!session) return;
  const type = DOC_TYPES.includes(req.body.type) ? req.body.type : "other";
  const title = String(req.body.title || "").trim().slice(0, 200);
  const content = String(req.body.content || "").trim();
  if (!title || !content) return res.status(400).json({ error: "Add a title and some content." });
  if (content.length > 20000) return res.status(400).json({ error: "Document is too long." });

  const lang = session.language;
  const system = `You translate medical documents from English into ${langLabel(lang)} for a patient to take home.
- Translate everything faithfully. Never add, remove, or change medical information, drug names, doses, numbers, dates, or times.
- Use clear, everyday ${lang.name} a patient without medical training understands, in its native script.${lang.code === "ne" ? " Use Nepali as spoken in Nepal, not Hindi." : ""}
- Keep the structure: line breaks, headings, numbered and bulleted lists. Use plain text, no Markdown symbols like ** or #.
- Keep drug names as written.

Reply in exactly this format, keeping the markers TITLE: and --- in English:
TITLE: <translated title>
---
<translated document>`;

  try {
    const out = await claude({
      system,
      prompt: `<title>${title}</title>\n<document>\n${content}\n</document>`,
      maxTokens: 16000,
    });
    const match = out.match(/^\s*TITLE:\s*(.+?)\s*\n-{3,}\s*\n([\s\S]+)$/);
    const doc = {
      id: randomUUID(),
      type,
      title,
      content,
      translatedTitle: match ? match[1].trim() : title,
      translatedContent: match ? match[2].trim() : out,
      language: lang.name,
      at: Date.now(),
    };
    session.documents.push(doc);
    broadcast(session, "document", doc);
    res.json(doc);
  } catch (err) {
    console.error("Document translation error:", err.message);
    res.status(502).json({ error: "Couldn't translate the document. Please try again." });
  }
});

// ---------- Uploaded documents (PDF or photo) ----------

const FILE_KINDS = { "application/pdf": "document", "image/png": "image", "image/jpeg": "image", "image/webp": "image" };
const docUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const PYTHON = fs.existsSync(".venv/bin/python") ? ".venv/bin/python" : "python3";

function pdfTool(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON, ["pdf/pdf_translate.py", ...args]);
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(JSON.parse(out)) : reject(new Error(err.trim().split("\n").pop() || `pdf tool exited ${code}`))
    );
    child.stdin.end(input ? JSON.stringify(input) : "");
  });
}

const BLOCKS_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "integer" }, text: { type: "string" } },
        required: ["id", "text"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
};

// Translates a document's text boxes in batches; returns Map(id -> translation).
async function translateBlocks(blocks, lang) {
  const chunks = [];
  let current = [];
  let size = 0;
  for (const b of blocks) {
    if (current.length && (size + b.text.length > 4000 || current.length >= 60)) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(b);
    size += b.text.length;
  }
  if (current.length) chunks.push(current);

  const system = `You translate the text of a medical document from English into ${langLabel(lang)} for a patient. Each item is one text box on the page (a heading, paragraph, table cell, label, or footer). Items are in reading order, so use neighbouring items for context and keep terms consistent.
- Translate every item and return it with the same id.
- Keep "\n" line breaks where an item has them.
- Never add, remove, or change medical information, drug names, doses, numbers, dates, times, phone numbers, addresses, or people's names. Keep drug names and names of people and places as written.
- Use clear, everyday ${lang.name} in its native script${lang.code === "ne" ? ", as spoken in Nepal, not Hindi" : ""}.
- Each translation must fit back into the same space on the page, so word it concisely.
- Plain text only.`;

  const results = new Map();
  let next = 0;
  async function worker() {
    while (next < chunks.length) {
      const chunk = chunks[next++];
      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 16000,
        output_config: { effort: "medium", format: { type: "json_schema", schema: BLOCKS_SCHEMA } },
        system,
        messages: [{ role: "user", content: JSON.stringify(chunk.map((b) => ({ id: b.id, text: b.text }))) }],
      });
      if (response.stop_reason === "refusal") throw new Error("Model declined the request");
      const out = JSON.parse(response.content.filter((b) => b.type === "text").map((b) => b.text).join(""));
      for (const item of out.items) results.set(item.id, item.text);
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, chunks.length) }, worker));
  return results;
}

// Joins text boxes into readable text: boxes on the same row (table cells) become one line.
function blocksToText(blocks, textOf) {
  const lines = [];
  let row = [];
  for (const b of blocks) {
    const prev = row[row.length - 1];
    if (prev && (prev.page !== b.page || Math.abs(prev.bbox[1] - b.bbox[1]) > 3)) {
      lines.push(row.map(textOf).join("  |  "));
      row = [];
    }
    row.push(b);
  }
  if (row.length) lines.push(row.map(textOf).join("  |  "));
  return lines.join("\n\n");
}

// Rebuilds the PDF with translated text in place. Returns null if the PDF has no text layer (a scan).
async function translatePdfLayout(session, file, type, givenTitle) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clara-"));
  const src = path.join(dir, "in.pdf");
  const out = path.join(dir, "out.pdf");
  const preview = path.join(dir, "preview.png");
  try {
    fs.writeFileSync(src, file.buffer);
    const { blocks } = await pdfTool(["extract", src]);
    if (blocks.reduce((n, b) => n + b.text.length, 0) < 20) return null;

    const titleBlock = [...blocks].filter((b) => b.page === 0).sort((a, b) => b.size - a.size)[0];
    const extra = givenTitle ? [{ id: -1, text: givenTitle }] : [];
    const t = await translateBlocks([...blocks, ...extra], session.language);
    const translated = blocks.map((b) => ({ ...b, translation: t.get(b.id) || "" }));
    const result = await pdfTool(["render", src, out, preview], { blocks: translated });
    console.log(`PDF translated: ${blocks.length} text boxes, smallest text scale ${result.minScale}`);

    const id = randomUUID();
    const base = file.originalname.replace(/\.pdf$/i, "");
    session.files.set(id, { buffer: file.buffer, mime: file.mimetype, name: file.originalname });
    session.files.set(`${id}:translated`, {
      buffer: fs.readFileSync(out),
      mime: "application/pdf",
      name: `${base} (${session.language.name}).pdf`,
    });
    session.files.set(`${id}:preview`, { buffer: fs.readFileSync(preview), mime: "image/png", name: "preview.png" });
    return {
      id,
      type,
      title: givenTitle || titleBlock.text.replace(/\n/g, " "),
      content: blocksToText(blocks, (b) => b.text),
      translatedTitle: givenTitle ? t.get(-1) || givenTitle : t.get(titleBlock.id) || titleBlock.text,
      translatedContent: blocksToText(translated, (b) => b.translation || b.text),
      language: session.language.name,
      at: Date.now(),
      file: { name: file.originalname.slice(0, 200), mime: file.mimetype, size: file.size },
      translatedFile: true,
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const FILE_DOC_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    text: { type: "string" },
    translatedTitle: { type: "string" },
    translatedText: { type: "string" },
  },
  required: ["title", "text", "translatedTitle", "translatedText"],
  additionalProperties: false,
};

// For photos and scanned PDFs: Claude reads the image and returns the text in both languages.
async function translateFileAsText(session, file, type, givenTitle) {
  const lang = session.language;
  const system = `You prepare medical documents for a patient who speaks ${langLabel(lang)}. The attached file may be a PDF, a scan, or a photo.
Return:
- "title": a short English title for the document${givenTitle ? ` — use exactly: ${givenTitle}` : ""}.
- "text": the document's full content in English as plain text, keeping its structure (headings, lists, line breaks, table rows as lines). Skip page numbers and repeated headers/footers. Keep blanks in forms as "____". If parts are not in English, translate them to English.
- "translatedTitle" and "translatedText": the same title and content in ${lang.name}, in its native script${lang.code === "ne" ? ", as spoken in Nepal, not Hindi" : ""}.
Translation rules: never add, remove, or change medical information, drug names, doses, numbers, dates, or times. Use everyday words a patient understands. Keep drug names as written. Plain text only, no Markdown symbols.`;

  const stream = anthropic.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    output_config: { effort: "medium", format: { type: "json_schema", schema: FILE_DOC_SCHEMA } },
    system,
    messages: [
      {
        role: "user",
        content: [
          { type: FILE_KINDS[file.mimetype], source: { type: "base64", media_type: file.mimetype, data: file.buffer.toString("base64") } },
          { type: "text", text: "Prepare this document for the patient." },
        ],
      },
    ],
  });
  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") throw new Error("Model declined the request");
  if (message.stop_reason === "max_tokens") throw Object.assign(new Error("too long"), { status: 413 });
  const out = JSON.parse(message.content.filter((b) => b.type === "text").map((b) => b.text).join(""));
  const id = randomUUID();
  session.files.set(id, { buffer: file.buffer, mime: file.mimetype, name: file.originalname });
  return {
    id,
    type,
    title: givenTitle || out.title.trim() || file.originalname,
    content: out.text.trim(),
    translatedTitle: out.translatedTitle.trim(),
    translatedContent: out.translatedText.trim(),
    language: lang.name,
    at: Date.now(),
    file: { name: file.originalname.slice(0, 200), mime: file.mimetype, size: file.size },
  };
}

app.post("/api/sessions/:id/documents/upload", docUpload.single("file"), async (req, res) => {
  const session = findSession(req, res);
  if (!session) return;
  if (!req.file || !FILE_KINDS[req.file.mimetype]) return res.status(400).json({ error: "Upload a PDF or a photo (JPG or PNG)." });
  const type = DOC_TYPES.includes(req.body.type) ? req.body.type : "other";
  const givenTitle = String(req.body.title || "").trim().slice(0, 200);

  try {
    let doc = null;
    if (req.file.mimetype === "application/pdf") {
      doc = await translatePdfLayout(session, req.file, type, givenTitle).catch((err) => {
        console.error("Layout-preserving PDF translation failed, sending text version:", err.message);
        return null;
      });
    }
    doc ||= await translateFileAsText(session, req.file, type, givenTitle);
    session.documents.push(doc);
    broadcast(session, "document", doc);
    res.json(doc);
  } catch (err) {
    console.error("File translation error:", err.message);
    if (err.status === 413) {
      return res.status(413).json({ error: "That document is too long to translate in one go. Try sending fewer pages." });
    }
    res.status(502).json({ error: "Couldn't read or translate that file. Please try again." });
  }
});

// ?v=translated | preview | (default) original
app.get("/api/sessions/:id/documents/:docId/file", (req, res) => {
  const session = findSession(req, res);
  if (!session) return;
  const variant = ["translated", "preview"].includes(req.query.v) ? `:${req.query.v}` : "";
  const file = session.files.get(req.params.docId + variant);
  if (!file) return res.status(404).json({ error: "File not found" });
  const safeName = file.name.replace(/[^\w.\- ()]+/g, "_");
  res.set("Content-Disposition", `inline; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(file.name)}`);
  res.type(file.mime).send(file.buffer);
});

// ---------- Invite link + QR ----------

function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === "IPv4" && !i.internal) return i.address;
  }
  return null;
}

// Returns [baseUrl, isLocalNetwork]
function publicBase(req) {
  if (process.env.PUBLIC_URL) return [process.env.PUBLIC_URL.replace(/\/$/, ""), false];
  const host = req.get("host") || `localhost:${PORT}`;
  const ip = lanAddress();
  if (/^(localhost|127\.0\.0\.1|\d+\.\d+\.\d+\.\d+)(:\d+)?$/.test(host) && ip) {
    return [LOCAL_HTTPS ? `https://${ip}:${HTTPS_PORT}` : `http://${ip}:${PORT}`, true];
  }
  return [`${req.protocol}://${host}`, false];
}

app.get("/api/sessions/:id/invite", async (req, res) => {
  const session = findSession(req, res);
  if (!session) return;
  const [base, local] = publicBase(req);
  const url = `${base}/patient.html?code=${session.id}`;
  const svg = await QRCode.toString(url, { type: "svg", margin: 1, color: { dark: "#0b2a3a", light: "#ffffff" } });
  res.json({ url, svg, local, secure: url.startsWith("https://") });
});

// ---------- Speech to text (Groq Whisper) ----------

// Whisper copies the style of its prompt: this one teaches it to keep mixed-in English in Latin letters
// and to use Nepali (not Hindi) spellings.
const WHISPER_STYLE = {
  ne: "मेरो roommate लाई headache छ। ऊ अलि मूर्ख छ, तर राम्रो साथी हो। म hospital गएँ।",
};

function whisperForm(file, fields) {
  const ext = file.mimetype.includes("mp4") ? "m4a" : file.mimetype.includes("ogg") ? "ogg" : "webm";
  const form = new FormData();
  form.append("file", new Blob([file.buffer], { type: file.mimetype }), `speech.${ext}`);
  form.append("temperature", "0");
  form.append("response_format", "json");
  for (const [k, v] of Object.entries(fields)) if (v) form.append(k, v);
  return form;
}

function whisper(file, language) {
  return fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${GROQ_KEY}` },
    body: whisperForm(file, {
      // turbo is faster for English; full large-v3 is noticeably better on lower-resource languages
      model: language?.code === "en" ? "whisper-large-v3-turbo" : "whisper-large-v3",
      language: language?.code,
      prompt: WHISPER_STYLE[language?.code],
    }),
  });
}

// Whisper's own audio→English rendering: an independent second opinion for the interpreter.
async function whisperEnglish(file) {
  try {
    const response = await fetch("https://api.groq.com/openai/v1/audio/translations", {
      method: "POST",
      headers: { Authorization: `Bearer ${GROQ_KEY}` },
      body: whisperForm(file, { model: "whisper-large-v3" }),
    });
    return response.ok ? ((await response.json()).text || "").trim() : "";
  } catch {
    return "";
  }
}

// ElevenLabs Scribe is far more accurate than Whisper on Nepali and handles mixed-language speech.
let scribeAvailable = Boolean(ELEVEN_KEY);

async function scribe(file, language) {
  const form = new FormData();
  form.append("file", new Blob([file.buffer], { type: file.mimetype }), "speech.webm");
  form.append("model_id", process.env.ELEVENLABS_STT_MODEL || "scribe_v1");
  form.append("tag_audio_events", "false");
  // Only pin English; for the patient, auto-detect keeps English words they mix in as English.
  if (language?.code === "en") form.append("language_code", "en");
  const response = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": ELEVEN_KEY },
    body: form,
  });
  if (response.status === 401 || response.status === 403) {
    scribeAvailable = false;
    console.warn("! ElevenLabs key lacks Speech to Text permission — using Whisper. Enable it on the key for better accuracy.");
    return null;
  }
  if (!response.ok) throw new Error(`Scribe ${response.status}: ${(await response.text()).slice(0, 200)}`);
  return ((await response.json()).text || "").trim();
}

app.post("/api/transcribe", upload.single("audio"), async (req, res) => {
  if (!GROQ_KEY && !scribeAvailable) return res.status(503).json({ error: "Voice input isn't set up (GROQ_API_KEY missing)." });
  if (!req.file || req.file.size < 1000) return res.status(400).json({ error: "Recording was empty." });
  const language = LANGUAGES.find((l) => l.code === req.body.language);
  const english = GROQ_KEY && language && language.code !== "en" ? whisperEnglish(req.file) : Promise.resolve("");

  if (scribeAvailable) {
    try {
      const text = await scribe(req.file, language);
      if (text !== null) return res.json({ text, english: await english });
    } catch (err) {
      console.error("Scribe failed, using Whisper:", err.message);
    }
  }
  if (!GROQ_KEY) return res.status(502).json({ error: "Couldn't understand the recording. Please try again." });

  try {
    let response = await whisper(req.file, language);
    if (response.status === 400 && language) response = await whisper(req.file, null);
    if (!response.ok) {
      console.error("Groq error:", response.status, (await response.text()).slice(0, 300));
      return res.status(502).json({ error: "Couldn't understand the recording. Please try again." });
    }
    const data = await response.json();
    res.json({ text: (data.text || "").trim(), english: await english });
  } catch (err) {
    console.error("Transcribe error:", err.message);
    res.status(502).json({ error: "Couldn't understand the recording. Please try again." });
  }
});

// ---------- Text to speech (ElevenLabs, falls back to Google) ----------

const ttsCache = new Map();

async function elevenLabsSpeech(text, lang, voiceId) {
  const model =
    process.env.ELEVENLABS_MODEL ||
    (ELEVEN_V2.has(lang.code) ? "eleven_multilingual_v2" : ELEVEN_TURBO.has(lang.code) ? "eleven_turbo_v2_5" : "eleven_v3");
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": ELEVEN_KEY, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: model }),
  });
  if (!response.ok) throw new Error(`ElevenLabs ${response.status}: ${(await response.text()).slice(0, 200)}`);
  return Buffer.from(await response.arrayBuffer());
}

function splitForTTS(text, max = 180) {
  const parts = [];
  for (const sentence of text.split(/(?<=[.!?।؟。\n])\s+/)) {
    let s = sentence.trim();
    while (s.length > max) {
      const cut = s.lastIndexOf(" ", max) > max / 2 ? s.lastIndexOf(" ", max) : max;
      parts.push(s.slice(0, cut));
      s = s.slice(cut).trim();
    }
    if (!s) continue;
    if (parts.length && parts[parts.length - 1].length + s.length + 1 <= max) parts[parts.length - 1] += ` ${s}`;
    else parts.push(s);
  }
  return parts;
}

async function googleSpeech(text, lang) {
  const tl = lang.code === "zh" ? "zh-CN" : lang.code;
  const buffers = [];
  for (const chunk of splitForTTS(text)) {
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${tl}&q=${encodeURIComponent(chunk)}`;
    const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!response.ok) throw new Error(`Google TTS ${response.status}`);
    buffers.push(Buffer.from(await response.arrayBuffer()));
  }
  return Buffer.concat(buffers);
}

app.post("/api/tts", async (req, res) => {
  const text = String(req.body.text || "").trim().slice(0, 5000);
  if (!text) return res.status(400).json({ error: "Nothing to read." });
  const lang = langByName(req.body.lang) || ENGLISH;
  const voice = req.body.voice === "patient" ? "patient" : "doctor";
  const key = createHash("sha1").update(`${lang.code}|${voice}|${text}`).digest("hex");

  let audio = ttsCache.get(key);
  if (!audio && ELEVEN_KEY) {
    try {
      audio = await elevenLabsSpeech(text, lang, VOICES[voice]);
    } catch (err) {
      console.error("ElevenLabs failed, using fallback voice:", err.message);
    }
  }
  if (!audio) {
    try {
      audio = await googleSpeech(text, lang);
    } catch (err) {
      console.error("Fallback TTS failed:", err.message);
      return res.status(502).json({ error: "Couldn't play audio right now." });
    }
  }
  ttsCache.set(key, audio);
  if (ttsCache.size > 300) ttsCache.delete(ttsCache.keys().next().value);
  res.type("audio/mpeg").send(audio);
});

// ---------- Patient UI localization ----------

const uiCache = new Map();

app.post("/api/ui-strings", async (req, res) => {
  const lang = langByName(req.body.lang);
  const strings = req.body.strings;
  const valid =
    strings && typeof strings === "object" && Object.values(strings).every((v) => typeof v === "string" && v.length < 400);
  if (!lang || !valid || Object.keys(strings).length > 80) return res.status(400).json({ error: "Bad request" });
  if (lang.code === "en") return res.json(strings);

  const key = `${lang.code}|${createHash("sha1").update(JSON.stringify(strings)).digest("hex")}`;
  if (uiCache.has(key)) return res.json(uiCache.get(key));

  try {
    const out = await claude({
      system: `You localize the interface of a medical visit app for patients who speak ${langLabel(lang)}.
Translate every JSON value into short, warm, natural ${lang.name} in its native script${lang.code === "ne" ? " (Nepali as spoken in Nepal, not Hindi)" : ""}. Keep keys unchanged and keep any {placeholders} exactly as they are. Output only the JSON object.`,
      prompt: JSON.stringify(strings),
      maxTokens: 8000,
    });
    const parsed = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1));
    const result = {};
    for (const [k, english] of Object.entries(strings)) {
      const t = parsed[k];
      const placeholders = english.match(/\{\w+\}/g) || [];
      result[k] = typeof t === "string" && t.trim() && placeholders.every((p) => t.includes(p)) ? t : english;
    }
    uiCache.set(key, result);
    res.json(result);
  } catch (err) {
    console.error("UI localization failed:", err.message);
    res.json(strings);
  }
});

// Drop idle sessions after 12 hours
setInterval(() => {
  const cutoff = Date.now() - 12 * 60 * 60 * 1000;
  for (const [id, s] of sessions) if (!s.clients.size && s.lastActive < cutoff) sessions.delete(id);
}, 60 * 60 * 1000).unref();

// Self-signed certificate for the laptop's Wi-Fi IP, cached so phones only accept it once.
function localCertificate(ip) {
  const dir = ".cert";
  try {
    const meta = JSON.parse(fs.readFileSync(`${dir}/meta.json`, "utf8"));
    if (meta.ip === ip) return { key: fs.readFileSync(`${dir}/key.pem`), cert: fs.readFileSync(`${dir}/cert.pem`) };
  } catch {
    /* generate a new one */
  }
  const altNames = [{ type: 2, value: "localhost" }, { type: 7, ip: "127.0.0.1" }];
  if (ip) altNames.push({ type: 7, ip });
  const pems = selfsigned.generate([{ name: "commonName", value: "LinguaLink (local)" }], {
    days: 825,
    keySize: 2048,
    algorithm: "sha256",
    extensions: [{ name: "basicConstraints", cA: false }, { name: "subjectAltName", altNames }],
  });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(`${dir}/key.pem`, pems.private);
  fs.writeFileSync(`${dir}/cert.pem`, pems.cert);
  fs.writeFileSync(`${dir}/meta.json`, JSON.stringify({ ip }));
  return { key: pems.private, cert: pems.cert };
}

if (LOCAL_HTTPS) {
  const ip = lanAddress();
  https
    .createServer(localCertificate(ip), app)
    .on("error", (err) => console.warn(`! Local https server not started: ${err.message}`))
    .listen(HTTPS_PORT, () => {
      if (ip) console.log(`Phones/other computers on your Wi-Fi: https://${ip}:${HTTPS_PORT}  (accept the security warning once)`);
    });
}

app.listen(PORT, () => {
  console.log(`LinguaLink running at http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) console.warn("! ANTHROPIC_API_KEY missing — translation won't work");
  if (!GROQ_KEY) console.warn("! GROQ_API_KEY missing — voice input disabled");
  if (!ELEVEN_KEY) console.warn("! ELEVENLABS_API_KEY missing — using the basic fallback voice");
});
