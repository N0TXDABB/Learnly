// Central: one problem. The question card, then the solution streaming in as numbered step cards
// while the Central towers light up floor by floor, then the final answer and key idea. Every step
// has "Ask AI Tutor", and the practice-problem generator sits underneath.

import { api } from "../api.js";
import { markdownToHtml } from "../markdown.js";
import { store } from "../store.js";
import { clear, h, modal, notice, spinner, toast } from "../ui.js";
import { askPanel } from "./solve-ask.js";
import { loadRecent } from "./solve-composer.js";
import { practiceSection } from "./solve-practice.js";
import { progressLine, splitLive, stepCard } from "./solve-steps.js";

const POLL_MS = 4000;

function prose(markdown, cls = "") {
  const el = h("div", { class: `prose ${cls}` });
  el.innerHTML = markdownToHtml(markdown);
  return el;
}

function statusText(phase, step) {
  if (phase === "waiting") return "Waiting for the AI to start. On a laptop the first words can take 10–60 seconds.";
  if (phase === "thinking") return "Thinking it through…";
  if (phase === "answer") return "Writing the final answer…";
  return `Writing step ${Math.max(1, step)}…`;
}

/** Floors of the Central towers lit for n steps written: 28%, 48%, 63%, … never quite all before the end. */
function floors(steps) {
  return Math.min(0.9, 1 - 0.72 ** steps);
}

function confirmBox(title, text, okLabel, extra = null) {
  return modal((close) => h("div", {},
    h("h2", {}, title),
    h("p", { class: "muted" }, text),
    extra,
    h("div", { class: "row", style: { justifyContent: "flex-end", marginTop: "18px" } },
      h("button", { class: "btn", type: "button", onclick: () => close(false) }, "Cancel"),
      h("button", { class: "btn primary", type: "button", onclick: () => close(true) }, okLabel))), { label: title });
}

async function photoUrl(problemId) {
  const resp = await api.raw("GET", `/problems/${problemId}/image`);
  if (!resp.ok) throw new Error("The photo couldn't be loaded.");
  return URL.createObjectURL(await resp.blob());
}

export async function renderProblem(view, { navigate, scenes, onCleanup, query }, problemId) {
  const hero = h("section", { class: "hero short solve-hero" }, h("p", { class: "kicker" }, "中環 Central"), h("h1", {}, "Step by step"));
  view.append(hero);
  let problem;
  try {
    problem = await api.get(`/problems/${problemId}`);
  } catch (err) {
    view.append(h("div", { class: "panel section" }, notice("bad", err.message),
      h("p", {}, h("a", { class: "btn primary", href: "#/solve" }, "Start a new problem"))));
    return;
  }
  const controller = new AbortController();
  const timers = new Set();
  let photo = null;
  onCleanup(() => {
    controller.abort();
    timers.forEach(clearInterval);
    if (photo) URL.revokeObjectURL(photo);
  });

  // -- hero and actions ----------------------------------------------------------------
  const resolveButton = h("button", { class: "btn", type: "button", onclick: () => askResolve() }, "Re-solve");
  const deleteButton = h("button", { class: "btn danger", type: "button", onclick: () => askDelete() }, "Delete");
  const tags = h("div", { class: "row tags-row" });
  hero.append(h("p", { class: "lede" }, "Read each step. Stuck on a line? Tap “Ask AI Tutor” under it."),
    h("div", { class: "row solve-actions" }, h("a", { class: "btn primary", href: "#/solve" }, "New problem"), resolveButton, deleteButton));

  // -- the question --------------------------------------------------------------------
  const photoSlot = h("div", { class: "question-photo" });
  const questionCard = h("article", { class: "panel gold question-card" },
    h("div", { class: "row between" }, h("span", { class: "card-label" }, "Question"), tags),
    h("div", { class: "question-layout" }, problem.has_image ? photoSlot : null, prose(problem.question, "question-text")),
    problem.parent_id ? h("p", { class: "small muted", style: { margin: "10px 0 0" } }, "A practice problem from ",
      h("a", { href: `#/solve/${problem.parent_id}` }, "the original problem"), ".") : null);
  const drawTags = () => clear(tags).append(...[problem.subject, problem.topic].filter(Boolean).map((t) => h("span", { class: "tag neon" }, t)),
    problem.source === "photo" ? h("span", { class: "tag" }, "from a photo") : null);
  drawTags();
  if (problem.has_image) {
    photoSlot.append(spinner("Loading the photo"));
    photoUrl(problem.id).then((url) => {
      photo = url;
      const open = () => modal(() => h("img", { src: url, alt: "Photo of the question", class: "photo-large" }), { label: "Photo of the question", wide: true });
      photoSlot.replaceChildren(h("button", { class: "photo-button", type: "button", onclick: open, "aria-label": "Show the photo larger" },
        h("img", { src: url, alt: "Photo of the question" })));
    }).catch((err) => photoSlot.replaceChildren(h("span", { class: "small muted" }, err.message)));
  }

  // -- the solution ---------------------------------------------------------------------
  const statusBox = h("div", { class: "stack" });
  const progress = progressLine();
  progress.el.hidden = true;
  const thinkingText = h("pre", {});
  const thinking = h("details", { class: "thinking panel tight", hidden: true }, h("summary", {}, "How the AI thought it through"), thinkingText);
  const stepList = h("ol", { class: "step-list", "aria-label": "Solution steps" });
  const answerCard = h("section", { class: "panel neon answer-card", hidden: true, "aria-label": "Final answer" });
  const wholeAsk = h("div", { class: "whole-ask", hidden: true });
  const practiceBox = h("div", {});
  const recent = h("aside", { class: "panel recent-problems" });
  view.append(h("section", { class: "grid sidebar solve-layout section" },
    h("div", { class: "stack solve-main" }, questionCard, statusBox, progress.el, thinking, stepList, answerCard, wholeAsk, practiceBox),
    recent));
  loadRecent(recent, problem.id);

  function fillAnswer(answer, keyIdea) {
    answerCard.hidden = !answer && !keyIdea;
    clear(answerCard).append( // append() skips the missing part; replaceChildren() would print "null"
      answer ? h("div", { class: "answer-part" }, h("p", { class: "kicker" }, "答案 Final answer"), prose(answer, "final-answer")) : null,
      keyIdea ? h("div", { class: "answer-part" }, h("p", { class: "kicker" }, "重點 Key idea"), prose(keyIdea)) : null);
  }

  function openWholeAsk() {
    const panel = wholeAsk.querySelector(".ask-panel");
    if (panel) panel.hidden = false;
    wholeAsk.querySelector("button[aria-expanded]")?.setAttribute("aria-expanded", "true");
    wholeAsk.scrollIntoView({ behavior: "smooth", block: "center" });
    wholeAsk.querySelector(".ask-panel input")?.focus({ preventScroll: true });
  }

  /** A toggle button with its ask panel, open from the start when there are earlier answers to show. */
  function askToggle(stepIndex, label) {
    const asked = problem.questions.filter((q) => q.step_index === stepIndex).length;
    const panel = askPanel(problem, stepIndex, { signal: controller.signal });
    panel.hidden = !asked;
    const button = h("button", {
      class: "btn small neon ask-toggle", type: "button", "aria-expanded": String(!!asked),
      onclick: () => {
        panel.hidden = !panel.hidden;
        button.setAttribute("aria-expanded", String(!panel.hidden));
        if (!panel.hidden) panel.querySelector("input")?.focus({ preventScroll: true });
      },
    }, label);
    return [button, panel];
  }

  function showSolution({ interactive, seconds } = {}) {
    clear(stepList);
    problem.steps.forEach((step, i) => {
      const card = stepCard(i);
      card.set(step);
      if (interactive) card.actions.append(...askToggle(i, "Ask AI Tutor"));
      stepList.append(card.el);
    });
    fillAnswer(problem.final_answer, problem.key_idea);
    drawTags();
    if (seconds !== undefined) {
      progress.el.hidden = false;
      progress.draw(problem.steps.length, "done");
      progress.say(`Solved${seconds >= 1 ? ` in ${seconds} s` : ""}. Read it step by step, and ask about any line that isn't clear.`);
    } else {
      progress.el.hidden = true;
    }
    wholeAsk.hidden = !interactive;
    clear(wholeAsk);
    clear(practiceBox);
    if (interactive) {
      wholeAsk.append(...askToggle(-1, "Ask about the whole problem"));
      practiceBox.append(practiceSection(problem, { navigate, scenes, onTutor: openWholeAsk }));
      scenes.setData({ progress: 1 });
    }
  }

  function showFailed(message) {
    clear(statusBox).append(notice("bad", h("div", {}, message || "The solution couldn't be finished."),
      h("div", { class: "row", style: { marginTop: "10px" } },
        h("button", { class: "btn primary small", type: "button", onclick: () => solve(false) }, "Try again"),
        store.health?.ai && !store.health.ai.ok ? h("a", { class: "btn small", href: "#/settings" }, "Check AI setup") : null)));
  }

  /** A note above a solution that is kept but needs a look (cut off, or a re-solve that didn't finish). */
  function showWarning(message, buttonLabel = "Solve again") {
    clear(statusBox).append(notice("warn", h("div", {}, message),
      h("div", { class: "row", style: { marginTop: "10px" } },
        h("button", { class: "btn small", type: "button", onclick: () => askResolve() }, buttonLabel))));
  }

  function showStillSolving() {
    clear(statusBox).append(notice("info", h("span", { class: "row" }, spinner("Solving"),
      "This problem is still being solved, maybe in another tab. This page updates when it's done.")));
    const id = setInterval(async () => {
      try {
        const fresh = await api.get(`/problems/${problem.id}`);
        if (fresh.status !== "solving") {
          clearInterval(id);
          navigate(`#/solve/${problem.id}`);
        }
      } catch {
        /* try again next time */
      }
    }, POLL_MS);
    timers.add(id);
  }

  let solving = false;
  async function solve(think) {
    if (solving) return;
    solving = true;
    resolveButton.disabled = true;
    deleteButton.disabled = true;
    clear(statusBox);
    clear(stepList);
    clear(practiceBox);
    answerCard.hidden = true;
    wholeAsk.hidden = true;
    thinking.hidden = true;
    thinkingText.textContent = "";
    progress.el.hidden = false;
    scenes.pulse("solve");
    scenes.setData({ progress: 0.04 });

    let markdown = "";
    let seen = 0;
    let phase = "waiting";
    let finished = null;
    let failure = null;
    const cards = [];
    const started = Date.now();
    const seconds = () => Math.round((Date.now() - started) / 1000);
    const tick = () => progress.say(statusText(phase, seen), seconds());
    const timer = setInterval(tick, 1000);
    timers.add(timer);
    progress.draw(0, phase);
    tick();

    let frame = 0; // a repaint waiting for the next animation frame
    const paint = () => {
      frame = 0;
      const live = splitLive(markdown);
      live.steps.forEach((step, i) => {
        if (!cards[i]) {
          cards[i] = stepCard(i);
          stepList.append(cards[i].el);
        }
        cards[i].set(step);
        cards[i].el.classList.toggle("writing", i === live.steps.length - 1 && !live.answer);
      });
      if (live.answer && phase === "writing") {
        phase = "answer";
        scenes.setData({ progress: 0.94 });
      }
      if (live.answer || live.key) fillAnswer(live.answer, live.key);
      progress.draw(Math.max(seen, live.steps.length), phase);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };

    try {
      await api.stream(`/problems/${problem.id}/solve`, { think }, (event, data) => {
        if (event === "thinking") {
          if (phase === "waiting") phase = "thinking";
          thinking.hidden = false;
          thinkingText.textContent += data.text;
        } else if (event === "token") {
          if (phase === "waiting" || phase === "thinking") phase = "writing";
          markdown += data.text;
          schedule();
        } else if (event === "step") {
          seen = data.index + 1;
          scenes.setData({ progress: floors(seen) });
          scenes.pulse("stage", { index: Math.min(5, data.index) });
        } else if (event === "done") {
          finished = data.problem;
        } else if (event === "error") {
          failure = data.message;
        }
      }, { signal: controller.signal });
    } catch (err) {
      failure = err.message;
    }
    cancelAnimationFrame(frame); // the stream can finish before the last repaint: don't let it run after
    clearInterval(timer);
    timers.delete(timer);
    solving = false;
    resolveButton.disabled = false;
    deleteButton.disabled = false;
    if (controller.signal.aborted) return;
    if (finished) {
      problem = finished;
      scenes.pulse("done");
      showSolution({ interactive: true, seconds: seconds() });
      if (problem.error) showWarning(problem.error);
      loadRecent(recent, problem.id); // its status is "solved" now
    } else if (await keptEarlierSolution()) {
      scenes.pulse("reset");
      showSolution({ interactive: true });
      showWarning(["The new solution couldn't be finished.", failure, "Your earlier solution is still here."].filter(Boolean).join(" "), "Try again");
    } else {
      paint();
      cards.forEach((c) => c.el.classList.remove("writing"));
      progress.draw(Math.max(seen, cards.length), "failed");
      progress.say("");
      scenes.pulse("reset");
      showFailed(failure || "The solution stopped early. Try again.");
    }
  }

  /** After a re-solve fails the server keeps the earlier solution: load it again (with any answers checked since). */
  async function keptEarlierSolution() {
    if (!problem.steps.length) return false;
    try {
      const fresh = await api.get(`/problems/${problem.id}`);
      if (fresh.status !== "solved" || controller.signal.aborted) return false;
      problem = fresh;
      return true;
    } catch {
      return false;
    }
  }

  async function askResolve() {
    const think = h("input", { type: "checkbox" });
    const ok = await confirmBox("Solve it again?",
      "The new solution replaces this one, and the tutor's answers about its steps are cleared. Questions about the whole problem and your practice sets stay. If the new one doesn't finish, this one is kept.",
      "Solve again",
      store.health?.ai?.thinking ? h("label", { class: "check" }, think, "Think it through (slower, more careful)") : null);
    if (ok) solve(think.checked);
  }

  async function askDelete() {
    const ok = await confirmBox("Delete this problem?", "Its steps, tutor answers, practice sets and photo are removed from this computer.", "Delete");
    if (!ok) return;
    try {
      await api.del(`/problems/${problem.id}`);
      toast("Problem deleted.");
      navigate("#/solve");
    } catch (err) {
      toast(err.message, "bad");
    }
  }

  // -- what to show first ------------------------------------------------------------------
  const auto = query.get("auto") === "1";
  if (auto) history.replaceState(null, "", `#/solve/${problem.id}`); // so a reload doesn't solve it again
  if (problem.status === "solved") {
    showSolution({ interactive: true });
    if (problem.error) showWarning(problem.error);
  } else if (problem.status === "solving") {
    showStillSolving();
  } else if (problem.status === "new" || auto) {
    solve(query.get("think") === "1");
  } else {
    if (problem.steps.length) showSolution({ interactive: false });
    showFailed(problem.error);
  }
}
