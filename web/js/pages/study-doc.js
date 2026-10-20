// #/study/doc/<id>: one document. Its text by location (page, slide, section or time), a search
// within it, quick "make flashcards / quiz / outline from this", and renaming or deleting it.

import { api } from "../api.js";
import { clear, debounce, field, fmt, h, notice, spinner, toast } from "../ui.js";
import {
  KINDS, aiReady, confirmDialog, docPending, docStatus, kindBadge, makeMaterial, partsText, poller, sizeText, snippet,
} from "./study-shared.js";

export async function renderDocument(view, { scenes, navigate, onCleanup }, id) {
  const head = h("section", { class: "hero short" }, h("p", { class: "kicker" }, "山頂 The Peak · Document"), h("h1", { class: "doc-heading" }, "Loading…"));
  const body = h("div", { class: "section" }, spinner());
  view.append(head, body);
  let doc;
  try {
    doc = await api.get(`/study/documents/${id}`);
  } catch (err) {
    clear(body).append(notice("bad", err.message, " ", h("a", { href: "#/study" }, "Back to Study")));
    return;
  }
  const statusLine = h("span", {});
  if (docPending(doc)) {
    const poll = poller(async () => {
      const fresh = await api.get(`/study/documents/${id}`);
      if (docPending(fresh)) {
        statusLine.textContent = fresh.progress || "Waiting to start";
        return true;
      }
      if (fresh.status === "ready") scenes.pulse("celebrate");
      doc = fresh;
      draw();
      return false;
    }, 2500, onCleanup);
    poll.kick();
  }
  draw();

  function draw() {
    clear(head).append(
      h("p", { class: "kicker" }, "山頂 The Peak · Document"),
      h("h1", { class: "doc-heading" }, doc.title),
      h("p", { class: "lede row" }, kindBadge(doc.kind),
        [KINDS[doc.kind]?.label, sizeText(doc.size_bytes), partsText(doc), `added ${fmt.ago(doc.created_at)}`].filter(Boolean).join(" · ")));
    clear(body).append(h("div", { class: "grid sidebar" }, h("div", { class: "stack" }, textPanel()), h("aside", { class: "stack" }, actionsPanel(), detailsPanel())));
  }

  function textPanel() {
    if (doc.status !== "ready") {
      statusLine.textContent = doc.progress || "Waiting to start";
      return h("section", { class: "panel" },
        h("div", { class: "panel-title" }, h("h3", {}, "Text"), docStatus(doc)),
        docPending(doc) ? h("p", { class: "row" }, spinner("Reading"), statusLine) : null,
        doc.status === "failed" ? notice("bad", doc.error || "This file couldn't be read.") : null,
        doc.status === "needs_transcriber" ? notice("warn", doc.error, " ", h("a", { href: "#/settings" }, "Open AI setup")) : null,
        doc.status === "failed" || doc.status === "needs_transcriber"
          ? h("button", { class: "btn primary section", type: "button", onclick: retry }, "Try again") : null);
    }
    const query = h("input", { type: "search", placeholder: "Search these notes…", "aria-label": "Search within this document" });
    const results = h("div", { class: "search-results", "aria-live": "polite" });
    const run = debounce(async () => {
      const q = query.value.trim();
      if (!q) {
        clear(results);
        return;
      }
      try {
        const hits = await api.get(`/study/search?q=${encodeURIComponent(q)}&document_id=${encodeURIComponent(doc.id)}`);
        clear(results).append(hits.length
          ? h("ul", { class: "hit-list" }, hits.map((hit) => h("li", {},
            h("button", { class: "hit", type: "button", onclick: () => jump(hit.idx) }, h("span", { class: "tag neon" }, hit.location), " ", snippet(hit.snippet)))))
          : h("p", { class: "small muted" }, `No matches for “${q}”.`));
      } catch (err) {
        clear(results).append(notice("bad", err.message));
      }
    }, 300);
    query.addEventListener("input", run);
    return h("section", { class: "panel" },
      h("div", { class: "panel-title" }, h("h3", {}, "Text by location"), h("span", { class: "small muted" }, `${doc.chunk_count} parts`)),
      h("div", { class: "search-bar doc-search" }, query),
      results,
      h("ol", { class: "chunk-list" }, doc.chunks.map((c) => h("li", { class: "chunk", id: `chunk-${c.idx}`, tabindex: "-1" },
        h("span", { class: "tag gold chunk-loc" }, c.location), h("p", {}, c.text)))));
  }

  function jump(idx) {
    const el = document.getElementById(`chunk-${idx}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("flash");
    el.focus({ preventScroll: true });
    setTimeout(() => el.classList.remove("flash"), 1600);
  }

  function actionsPanel() {
    const ready = doc.status === "ready";
    const quick = (kind, label) => h("button", { class: "btn", type: "button", disabled: !ready || !aiReady(), onclick: async (e) => {
      const button = e.currentTarget;
      button.disabled = true;
      try {
        const material = await makeMaterial(kind, [doc.id]);
        toast("Started. It's being written now.", "good");
        navigate(`#/study/material/${material.id}`);
      } catch (err) {
        toast(err.message, "bad");
        button.disabled = false;
      }
    } }, label);
    return h("section", { class: "panel neon" },
      h("h3", {}, "Make from this"),
      h("div", { class: "stack" }, quick("flashcards", "Make flashcards"), quick("quiz", "Make a quiz"), quick("outline", "Make an outline")),
      !aiReady() ? h("p", { class: "small muted section" }, "The local AI isn't running. ", h("a", { href: "#/settings" }, "Check AI setup"), ".") : null,
      h("p", { class: "small faint section" }, "For more choices (several documents, mock exams, a focus topic) use the ", h("a", { href: "#/study" }, "Study desk"), "."));
  }

  function detailsPanel() {
    const title = h("input", { type: "text", value: doc.title, maxlength: 120 });
    const subject = h("input", { type: "text", value: doc.subject, maxlength: 80, placeholder: "e.g. Biology" });
    return h("section", { class: "panel" },
      h("div", { class: "panel-title" }, h("h3", {}, "Details"), docStatus(doc)),
      h("form", { onsubmit: async (e) => {
        e.preventDefault();
        try {
          doc = { ...doc, ...(await api.patch(`/study/documents/${doc.id}`, { title: title.value.trim(), subject: subject.value.trim() })) };
          toast("Saved", "good");
          draw();
        } catch (err) {
          toast(err.message, "bad");
        }
      } },
      field("Name", title), field("Subject", subject),
      h("p", { class: "small faint" }, `Original file: ${doc.filename}`),
      h("div", { class: "row between" },
        h("button", { class: "btn primary", type: "submit" }, "Save"),
        h("button", { class: "btn danger", type: "button", onclick: remove }, "Delete"))));
  }

  async function retry() {
    try {
      await api.post(`/study/documents/${doc.id}/retry`);
      navigate(`#/study/doc/${doc.id}`);
    } catch (err) {
      toast(err.message, "bad");
    }
  }

  async function remove() {
    if (!(await confirmDialog("Delete this document?", `“${doc.title}” and its text will be removed from Learnly. Revision material already made from it is kept.`))) return;
    try {
      await api.del(`/study/documents/${doc.id}`);
      toast("Deleted");
      navigate("#/study");
    } catch (err) {
      toast(err.message, "bad");
    }
  }
}
