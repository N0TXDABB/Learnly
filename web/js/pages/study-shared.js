// Small pieces shared by the Study (山頂 The Peak) and Review (旺角 Mong Kok) pages.

import { api } from "../api.js";
import { store } from "../store.js";
import { fmt, h, modal, statusTag } from "../ui.js";

export const KINDS = {
  pdf: { badge: "PDF", label: "PDF", parts: ["page", "pages"] },
  slides: { badge: "PPT", label: "Slides", parts: ["slide", "slides"] },
  doc: { badge: "DOC", label: "Word", parts: ["section", "sections"] },
  text: { badge: "TXT", label: "Text", parts: ["part", "parts"] },
  image: { badge: "IMG", label: "Photo of notes", parts: ["photo", "photos"] },
  audio: { badge: "REC", label: "Recording", parts: null },
};

export const MATERIALS = {
  outline: { label: "Chapter outline", short: "Outline", zh: "大綱", blurb: "Headings, key points and key terms, with where each came from." },
  flashcards: { label: "Flashcards", short: "Flashcards", zh: "記憶卡", blurb: "Question-and-answer cards that come back just before you'd forget them." },
  quiz: { label: "Quiz", short: "Quiz", zh: "小測", blurb: "Multiple choice, true/false and short answers, marked straight away." },
  exam: { label: "Mock exam", short: "Mock exam", zh: "模擬試", blurb: "A timed paper with mixed difficulty, marked when you hand it in." },
};

const DOC_STATUS = { queued: "Queued", processing: "Processing", ready: "Ready", failed: "Failed", needs_transcriber: "Needs speech-to-text" };
const MATERIAL_STATUS = { queued: "Queued", generating: "Generating", ready: "Ready", failed: "Failed" };

export const docPending = (d) => d.status === "queued" || d.status === "processing";
export const materialPending = (m) => m.status === "queued" || m.status === "generating";

export function kindBadge(kind) {
  const k = KINDS[kind] || KINDS.text;
  return h("span", { class: `kind-badge kind-${kind}`, title: k.label, "aria-label": k.label }, k.badge);
}

export function materialBadge(kind) {
  return h("span", { class: `kind-badge mat-${kind}`, "aria-hidden": "true" }, MATERIALS[kind]?.zh || "");
}

export function docStatus(doc) {
  return statusTag(DOC_STATUS[doc.status] || doc.status);
}

export function materialStatus(material) {
  return statusTag(MATERIAL_STATUS[material.status] || material.status);
}

export function partsText(doc) {
  if (!doc.parts) return "";
  if (doc.kind === "audio") return `about ${fmt.number(doc.parts)} min of speech`; // one part per minute or so
  const [one, many] = (KINDS[doc.kind] || KINDS.text).parts;
  return `${fmt.number(doc.parts)} ${doc.parts === 1 ? one : many}`;
}

export function sizeText(bytes) {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export function countsText(material) {
  const c = material.counts || {};
  if (material.kind === "flashcards") return c.cards ? `${c.cards} cards` : "";
  if (material.kind === "quiz" || material.kind === "exam") return c.questions ? `${c.questions} questions` : "";
  return c.parts ? `${c.parts} part${c.parts === 1 ? "" : "s"}` : "";
}

/** Search snippets mark matched words with private-use characters; turn them into <mark>. */
export function snippet(text) {
  const out = h("span", { class: "snippet" });
  const parts = String(text || "").split(/|/);
  parts.forEach((part, i) => out.append(i % 2 ? h("mark", {}, part) : part));
  return out;
}

/**
 * Re-run `check` every `ms` while it reports pending work. Returns { kick } to start again after new work.
 * Stops when the page is left.
 */
export function poller(check, ms, onCleanup) {
  let timer = null;
  let stopped = false;
  const tick = async () => {
    timer = null;
    if (stopped) return;
    let again = true;
    try {
      again = await check();
    } catch {
      again = true; // the server may be busy; try again on the next tick
    }
    if (again && !stopped) timer = setTimeout(tick, ms);
  };
  onCleanup(() => {
    stopped = true;
    clearTimeout(timer);
  });
  return {
    kick() {
      if (!timer && !stopped) timer = setTimeout(tick, ms);
    },
  };
}

/** Ask before deleting. Resolves true when confirmed. */
export function confirmDialog(title, text, action = "Delete") {
  return modal((close) => h("div", {},
    h("h2", {}, title),
    h("p", { class: "muted" }, text),
    h("div", { class: "row", style: { justifyContent: "flex-end", marginTop: "18px" } },
      h("button", { class: "btn", type: "button", onclick: () => close(false) }, "Cancel"),
      h("button", { class: `btn ${action === "Delete" ? "danger" : "primary"}`, type: "button", onclick: () => close(true) }, action))),
  { label: title });
}

/** Start making material from documents; resolves with the new material. */
export function makeMaterial(kind, documentIds, options = {}, title = "") {
  return api.post("/study/materials", { kind, document_ids: documentIds, options, title });
}

export function aiReady() {
  return !!store.health?.ai?.ok;
}

/** A row with a coloured bar for a percentage (accuracy or score). */
export function accuracyBar(label, fraction, sub = "") {
  const pct = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
  const tone = pct >= 75 ? "good" : pct >= 50 ? "ok" : "low";
  return h("div", { class: `acc-row tone-${tone}` },
    h("div", { class: "acc-label" }, h("b", {}, label), sub ? h("span", { class: "small muted" }, sub) : null),
    h("div", { class: "acc-track", role: "img", "aria-label": `${label}: ${pct}%` }, h("span", { style: { width: `${pct}%` } })),
    h("span", { class: "acc-pct" }, `${pct}%`));
}
