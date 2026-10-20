// #/study/material/<id>: what was made. While the model is still writing it shows live progress;
// then an outline (printable), a flashcard deck, or a quiz / mock exam ready to take.

import { api } from "../api.js";
import { markdownToHtml } from "../markdown.js";
import { clear, fmt, h, notice, spinner, toast } from "../ui.js";
import { MATERIALS, confirmDialog, countsText, materialPending, materialStatus, poller } from "./study-shared.js";

function prose(markdown, cls = "") {
  const el = h("div", { class: `prose ${cls}` });
  el.innerHTML = markdownToHtml(markdown);
  return el;
}

export async function renderMaterial(view, { scenes, navigate, onCleanup }, id) {
  const head = h("section", { class: "hero short" }, h("p", { class: "kicker" }, "山頂 The Peak"), h("h1", { class: "doc-heading" }, "Loading…"));
  const body = h("div", { class: "section" }, spinner());
  view.append(head, body);
  let material;
  try {
    material = await api.get(`/study/materials/${id}`);
  } catch (err) {
    clear(body).append(notice("bad", err.message, " ", h("a", { href: "#/study" }, "Back to Study")));
    return;
  }

  const progressText = h("span", {});
  const poll = poller(async () => {
    const fresh = await api.get(`/study/materials/${id}`);
    if (materialPending(fresh)) {
      progressText.textContent = fresh.progress || "Waiting to start";
      return true;
    }
    if (fresh.status === "ready") scenes.pulse("celebrate");
    material = fresh;
    await draw();
    return false;
  }, 2500, onCleanup);

  await draw();
  if (materialPending(material)) poll.kick();

  async function draw() {
    const info = MATERIALS[material.kind];
    clear(head).append(
      h("p", { class: "kicker" }, `山頂 The Peak · ${info.label}`),
      h("h1", { class: "doc-heading" }, material.title),
      h("p", { class: "lede" }, [material.subject, countsText(material), `made ${fmt.ago(material.created_at)}`].filter(Boolean).join(" · ")));
    clear(body);
    if (materialPending(material)) {
      progressText.textContent = material.progress || "Waiting to start";
      body.append(h("section", { class: "panel neon writing" },
        h("div", { class: "panel-title" }, h("h3", {}, `Writing your ${info.label.toLowerCase()}`), materialStatus(material)),
        h("p", { class: "row", "aria-live": "polite" }, spinner("Writing"), progressText),
        h("div", { class: "progress indeterminate" }, h("span", {})),
        h("p", { class: "small muted" }, "The AI on your computer reads your documents part by part, so this can take a few minutes. "
          + "You can leave this page: you'll get a notification (the bell, top right) when it's ready.")));
      return;
    }
    if (material.status === "failed") {
      body.append(h("section", { class: "panel" },
        notice("bad", material.error || "This couldn't be made."),
        h("div", { class: "row section" },
          h("button", { class: "btn primary", type: "button", onclick: retry }, "Try again"),
          deleteButton())));
      return;
    }
    if (material.kind === "outline") body.append(outline());
    else if (material.kind === "flashcards") body.append(deck());
    else body.append(await quiz());
    body.append(sources());
  }

  function outline() {
    return h("section", { class: "stack" },
      h("div", { class: "row no-print" },
        h("button", { class: "btn primary", type: "button", onclick: () => window.print() }, "Print"),
        h("a", { class: "btn", href: "#/study" }, "Back to Study"),
        h("span", { class: "spacer" }), deleteButton()),
      h("article", { class: "panel outline-doc" }, prose(material.content.markdown)));
  }

  function deck() {
    const cards = material.content.cards;
    const c = material.counts;
    return h("section", { class: "stack" },
      h("div", { class: "grid mini-stats" },
        stat("Cards", c.cards), stat("Due now", c.due, "gold"), stat("Mastered", c.mastered)),
      h("div", { class: "row" },
        h("a", { class: "btn primary big", href: `#/review/cards/${material.id}` }, "Study these cards"),
        h("span", { class: "spacer" }), deleteButton()),
      h("section", { class: "panel" },
        h("div", { class: "panel-title" }, h("h3", {}, "The cards"), h("span", { class: "small muted" }, "Front · back")),
        h("ol", { class: "card-preview" }, cards.map((card) => h("li", {},
          h("div", { class: "card-front" }, prose(card.front)),
          h("div", { class: "card-back" }, prose(card.back)),
          h("div", { class: "small faint" }, [card.topic, card.source].filter(Boolean).join(" · ")))))));
  }

  async function quiz() {
    const exam = material.kind === "exam";
    const questions = material.content.questions;
    const types = { choice: 0, truefalse: 0, short: 0 };
    questions.forEach((q) => (types[q.type] += 1));
    const typeText = [["choice", "multiple choice"], ["truefalse", "true/false"], ["short", "short answer"]]
      .filter(([k]) => types[k]).map(([k, label]) => `${types[k]} ${label}`).join(" · ");
    let attempts = [];
    try {
      attempts = await api.get(`/study/attempts?material_id=${material.id}`);
    } catch {
      attempts = [];
    }
    const graded = attempts.filter((a) => a.status === "graded");
    const best = graded.length ? Math.max(...graded.map((a) => a.percent)) : null;
    const unfinished = attempts.find((a) => a.status === "in_progress");
    return h("section", { class: "stack" },
      h("div", { class: "grid mini-stats" },
        stat("Questions", questions.length, "", typeText),
        stat(exam ? "Time limit" : "Points", exam ? `${material.content.time_limit_min || "–"} min` : material.counts.points, "gold"),
        stat("Best score", best === null ? "–" : `${best}%`, "", graded.length ? `${graded.length} attempt${graded.length === 1 ? "" : "s"}` : "Not taken yet")),
      h("div", { class: "row" },
        h("a", { class: "btn primary big", href: `#/review/quiz/${material.id}` }, unfinished ? "Carry on" : exam ? "Start mock exam" : "Start quiz"),
        exam ? h("span", { class: "small muted" }, "The timer starts when you press Start. Answers save as you go.") : null,
        h("span", { class: "spacer" }), deleteButton()),
      h("section", { class: "panel" },
        h("h3", {}, "Past attempts"),
        attempts.length
          ? h("ul", { class: "attempt-list" }, attempts.map((a) => h("li", {},
            h("a", { href: a.status === "graded" ? `#/review/attempt/${a.id}` : `#/review/quiz/${material.id}` },
              a.status === "graded" ? h("b", {}, `${a.percent}%`) : h("span", { class: "tag amber" }, "Unfinished"),
              h("span", { class: "small muted" }, ` ${fmt.dateTime(a.finished_at || a.started_at)}`)))))
          : h("p", { class: "muted small" }, "No attempts yet.")),
      h("section", { class: "panel" },
        h("h3", {}, "Topics covered"),
        h("div", { class: "chips" }, [...new Set(questions.map((q) => q.topic))].map((t) => h("span", { class: "chip" }, t)))));
  }

  function sources() {
    if (!material.document_ids.length) {
      return material.options.general_topics
        ? h("p", { class: "small muted section" }, "None of your documents mention these topics, so these are general questions, not from your notes.")
        : null;
    }
    const line = h("p", { class: "small muted section no-print" });
    api.get("/study/documents").then((docs) => {
      const used = docs.filter((d) => material.document_ids.includes(d.id));
      if (used.length) line.append("Made from: ", ...used.flatMap((d, i) => [i ? ", " : "", h("a", { href: `#/study/doc/${d.id}` }, d.title)]));
    }).catch(() => {});
    return line;
  }

  function stat(label, value, cls = "", sub = "") {
    return h("div", { class: "panel stat" }, h("div", { class: "label" }, label), h("div", { class: `value ${cls}` }, String(value ?? "–")), sub ? h("div", { class: "sub" }, sub) : null);
  }

  function deleteButton() {
    return h("button", { class: "btn danger", type: "button", onclick: async () => {
      if (!(await confirmDialog("Delete this?", `“${material.title}” will be removed${material.kind === "flashcards" ? ", with its cards and their review history" : ""}.`))) return;
      try {
        await api.del(`/study/materials/${material.id}`);
        toast("Deleted");
        navigate("#/study");
      } catch (err) {
        toast(err.message, "bad");
      }
    } }, "Delete");
  }

  async function retry() {
    try {
      material = await api.post(`/study/materials/${material.id}/retry`);
      await draw();
      poll.kick();
    } catch (err) {
      toast(err.message, "bad");
    }
  }
}
