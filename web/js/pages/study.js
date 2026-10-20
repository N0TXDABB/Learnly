// The Peak (山頂): study from your own course material. #/study is the desk: upload documents,
// tick the ones to study from, and make outlines, flashcards, quizzes and mock exams.
// #/study/doc/<id> shows one document's text; #/study/material/<id> shows what was made.

import { api } from "../api.js";
import { openSignIn } from "../auth.js";
import { store } from "../store.js";
import { clear, empty, fmt, h, notice, toast } from "../ui.js";
import { renderDocument } from "./study-doc.js";
import { renderMaker } from "./study-make.js";
import { renderMaterial } from "./study-material.js";
import {
  KINDS, MATERIALS, countsText, docPending, docStatus, kindBadge, materialBadge, materialPending, materialStatus, partsText, poller, sizeText,
} from "./study-shared.js";
import { renderUploader } from "./study-upload.js";

export async function render(view, ctx) {
  if (!store.can("study:use")) {
    view.append(hero());
    view.append(h("div", { class: "panel gold section" }, store.signedIn()
      ? empty("Not for this account", "Studying is for student and administrator accounts.")
      : empty("Sign in to start", "Your documents and revision material are saved to your account on this computer.",
        h("button", { class: "btn primary", type: "button", onclick: () => openSignIn() }, store.health?.needs_setup ? "Create the owner account" : "Sign in"))));
    return;
  }
  const [kind, id] = ctx.params;
  if (kind === "doc") return renderDocument(view, ctx, id);
  if (kind === "material") return renderMaterial(view, ctx, id);
  return renderDesk(view, ctx);
}

function hero() {
  return h("section", { class: "hero short" },
    h("p", { class: "kicker" }, "山頂 The Peak"),
    h("h1", {}, "Study"),
    h("p", { class: "lede" }, "Drop in lecture slides, chapter PDFs or recordings. Learnly reads them, then writes chapter outlines, flashcards, quizzes and mock exams from them."));
}

async function renderDesk(view, { scenes, onCleanup, refreshHealth }) {
  view.append(hero());
  let documents = [];
  let materials = [];
  const shown = { docs: null, materials: null }; // what is on screen, to skip redrawing the same thing
  const selected = new Set();
  const known = new Map(); // id -> last status, to celebrate when something becomes ready

  const uploadBox = h("section", { class: "panel gold section study-upload" });
  const docsBox = h("div", { class: "doc-groups" });
  const makeBox = h("section", { class: "panel neon section" });
  const materialsBox = h("div", { class: "material-grid" });

  view.append(uploadBox,
    h("section", { class: "section" },
      h("div", { class: "section-head" }, h("h2", {}, "Your documents"), h("span", { class: "zh" }, "我的文件")),
      docsBox),
    makeBox,
    h("section", { class: "section" },
      h("div", { class: "section-head" }, h("h2", {}, "Revision material"), h("span", { class: "zh" }, "溫習材料")),
      materialsBox));

  const maker = renderMaker(makeBox, {
    selected: () => documents.filter((d) => selected.has(d.id) && d.status === "ready"),
    onMade: (material) => {
      materials = [material, ...materials];
      drawMaterials();
      poll.kick();
    },
  });

  renderUploader(uploadBox, {
    scenes,
    onCleanup,
    onUploaded: (doc) => {
      documents = [doc, ...documents.filter((d) => d.id !== doc.id)];
      known.set(doc.id, doc.status);
      drawDocuments();
      poll.kick();
    },
  });

  function noteChanges(items, pending) {
    let celebrate = false;
    for (const item of items) {
      const before = known.get(item.id);
      if (before && pending({ status: before }) && item.status === "ready") celebrate = true;
      known.set(item.id, item.status);
    }
    return celebrate;
  }

  async function refresh() {
    const [docs, mats] = await Promise.all([api.get("/study/documents"), api.get("/study/materials")]);
    const docReady = noteChanges(docs, docPending);
    const materialReady = noteChanges(mats, materialPending);
    // Redraw only what changed, so a tick of the poll doesn't move keyboard focus off a checkbox.
    if (JSON.stringify(docs) !== shown.docs) {
      documents = docs;
      drawDocuments();
    }
    if (JSON.stringify(mats) !== shown.materials) {
      materials = mats;
      drawMaterials();
    }
    scenes.setData({ documents: documents.filter((d) => d.status === "ready").length });
    if (docReady || materialReady) {
      scenes.pulse("celebrate");
      refreshHealth?.(); // the status bar's counts and its "cards due" link, without waiting for the next poll
    }
    return documents.some(docPending) || materials.some(materialPending);
  }
  const poll = poller(refresh, 2500, onCleanup);

  function drawDocuments() {
    shown.docs = JSON.stringify(documents);
    clear(docsBox);
    for (const id of [...selected]) if (!documents.some((d) => d.id === id && d.status === "ready")) selected.delete(id);
    if (!documents.length) {
      docsBox.append(h("div", { class: "panel" }, empty("No documents yet", "Upload your first lecture slides, notes or recording above.")));
      maker.update();
      return;
    }
    if (documents.some((d) => d.status === "needs_transcriber")) {
      docsBox.append(notice("warn", h("b", {}, "A recording is waiting for speech-to-text. "),
        "Learnly needs speech-to-text installed to turn recordings into notes. ",
        store.can("admin:settings")
          ? h("span", {}, "Install it in ", h("a", { href: "#/settings" }, "AI setup → Lecture recordings"), ", then press Try again.")
          : "Ask the administrator to install it in AI setup → Lecture recordings, then press Try again."));
    }
    const groups = new Map();
    for (const doc of documents) {
      const key = doc.subject || "";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(doc);
    }
    const names = [...groups.keys()].sort((a, b) => (a === "") - (b === "") || a.localeCompare(b));
    for (const name of names) {
      const docs = groups.get(name);
      const ready = docs.filter((d) => d.status === "ready");
      const all = h("input", { type: "checkbox", "aria-label": `Select all ready documents in ${name || "No subject"}`,
        checked: ready.length > 0 && ready.every((d) => selected.has(d.id)), disabled: !ready.length,
        onchange: (e) => { ready.forEach((d) => (e.target.checked ? selected.add(d.id) : selected.delete(d.id))); drawDocuments(); } });
      docsBox.append(h("div", { class: "panel doc-group" },
        h("div", { class: "doc-group-head" }, h("label", { class: "check" }, all, h("b", {}, name || "No subject")), h("span", { class: "small muted" }, `${docs.length} document${docs.length === 1 ? "" : "s"}`)),
        h("ul", { class: "doc-list" }, docs.map(docRow))));
    }
    maker.update();
  }

  function docRow(doc) {
    const ready = doc.status === "ready";
    const box = h("input", { type: "checkbox", checked: selected.has(doc.id), disabled: !ready, "aria-label": `Use “${doc.title}”`,
      onchange: (e) => { e.target.checked ? selected.add(doc.id) : selected.delete(doc.id); drawDocuments(); } });
    const meta = [KINDS[doc.kind]?.label, sizeText(doc.size_bytes), ready ? partsText(doc) : ""].filter(Boolean).join(" · ");
    return h("li", { class: `doc-row ${selected.has(doc.id) ? "selected" : ""}` },
      box, kindBadge(doc.kind),
      h("div", { class: "doc-main" },
        h("a", { href: `#/study/doc/${doc.id}`, class: "doc-title" }, doc.title),
        h("div", { class: "small muted" }, meta),
        docPending(doc) && doc.progress ? h("div", { class: "small doc-progress" }, h("span", { class: "spinner", "aria-hidden": "true" }), " ", doc.progress) : null,
        doc.status === "failed" && doc.error ? h("div", { class: "small doc-error" }, doc.error) : null),
      h("div", { class: "doc-side" }, docStatus(doc),
        doc.status === "failed" || doc.status === "needs_transcriber"
          ? h("button", { class: "btn small", type: "button", onclick: () => retry(doc) }, "Try again") : null));
  }

  async function retry(doc) {
    try {
      const updated = await api.post(`/study/documents/${doc.id}/retry`);
      documents = documents.map((d) => (d.id === doc.id ? updated : d));
      known.set(doc.id, updated.status);
      drawDocuments();
      poll.kick();
    } catch (err) {
      toast(err.message, "bad");
    }
  }

  function drawMaterials() {
    shown.materials = JSON.stringify(materials);
    clear(materialsBox);
    if (!materials.length) {
      materialsBox.append(h("div", { class: "panel" }, empty("Nothing made yet", "Tick some documents, choose what to make, and press Generate.")));
      return;
    }
    for (const m of materials) {
      const pending = materialPending(m);
      materialsBox.append(h("a", { class: `material-card mat-${m.kind}`, href: `#/study/material/${m.id}` },
        h("div", { class: "row between" }, h("span", { class: "row", style: { gap: "8px" } }, materialBadge(m.kind), h("span", { class: "small muted" }, MATERIALS[m.kind].label)), materialStatus(m)),
        h("b", { class: "material-title" }, m.title),
        pending ? h("div", { class: "small doc-progress" }, h("span", { class: "spinner", "aria-hidden": "true" }), " ", m.progress || "Waiting to start") : null,
        m.status === "failed" ? h("div", { class: "small doc-error" }, m.error) : null,
        h("div", { class: "small faint" }, [countsText(m), fmt.ago(m.created_at)].filter(Boolean).join(" · "))));
    }
  }

  try {
    if (await refresh()) poll.kick();
  } catch (err) {
    docsBox.append(notice("bad", err.message));
  }
}
