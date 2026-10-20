// "Ask AI Tutor": quick questions about one step (or the whole problem). The answer streams into the
// panel under the step and is saved, so the conversation is still there next time.

import { api } from "../api.js";
import { markdownToHtml } from "../markdown.js";
import { clear, h, notice, spinner, toast } from "../ui.js";

export const QUICK_QUESTIONS = [
  ["simpler", "Explain more simply"],
  ["why", "Why does this rule apply?"],
  ["detail", "Show more detail"],
];

// The AI on a laptop answers one thing at a time, so only one question is asked at once.
let busy = false;

function exchange(question, answer) {
  const body = h("div", { class: "prose ask-a" });
  if (answer) body.innerHTML = markdownToHtml(answer);
  return { el: h("div", { class: "ask-item" }, h("div", { class: "ask-q" }, h("b", {}, "You asked: "), question), body), body };
}

/** The panel for one step (stepIndex ≥ 0) or for the whole problem (stepIndex = -1). */
export function askPanel(problem, stepIndex, { signal } = {}) {
  const whole = stepIndex < 0;
  const about = whole ? "this problem" : "this step";
  const log = h("div", { class: "ask-log", "aria-live": "polite" });
  for (const q of problem.questions.filter((q) => q.step_index === stepIndex)) log.append(exchange(q.question, q.answer).el);
  const input = h("input", { type: "text", maxlength: 2000, placeholder: `Ask your own question about ${about}`, "aria-label": `Ask your own question about ${about}` });
  const chips = QUICK_QUESTIONS.map(([mode, label]) => h("button", { class: "chip ask-chip", type: "button", onclick: () => ask(mode, label) }, label));
  const submit = h("button", { class: "btn primary small", type: "submit" }, "Ask");
  const form = h("form", {
    class: "ask-form",
    onsubmit: (e) => {
      e.preventDefault();
      const question = input.value.trim();
      if (question) ask("question", question);
      else input.focus();
    },
  }, input, submit);
  const el = h("div", { class: "ask-panel" },
    h("div", { class: "ask-head" }, h("span", { class: "ask-label" }, "AI Tutor"), h("span", { class: "small muted" }, whole ? "Ask about the whole problem" : `Ask about step ${stepIndex + 1}`)),
    h("div", { class: "chips" }, chips), form, log);

  const setDisabled = (value) => {
    for (const control of [...chips, input, submit]) control.disabled = value;
  };

  async function ask(mode, label) {
    if (busy) {
      toast("Wait for the tutor to finish the answer it's writing.");
      return;
    }
    busy = true;
    setDisabled(true);
    const item = exchange(label, "");
    item.body.classList.add("cursor");
    item.body.append(h("span", { class: "row small muted" }, spinner("Waiting for the tutor"), "The tutor is thinking… (10–60 s on a laptop)"));
    log.append(item.el);
    let text = "";
    let failure = null;
    let saved = false;
    let frame = 0;
    const paint = () => {
      frame = 0;
      if (text) item.body.innerHTML = markdownToHtml(text);
    };
    try {
      await api.stream(`/problems/${problem.id}/ask`, { step_index: stepIndex, mode, question: mode === "question" ? label : "" }, (event, data) => {
        if (event === "token") {
          text += data.text;
          if (!frame) frame = requestAnimationFrame(paint);
        } else if (event === "error") {
          failure = data.message;
        } else if (event === "done") {
          saved = true;
          problem.questions.push(data.question);
        }
      }, { signal });
    } catch (err) {
      failure = err.message;
    } finally {
      cancelAnimationFrame(frame);
      paint();
      item.body.classList.remove("cursor");
      if (!text) clear(item.body);
      if (!saved && !signal?.aborted) item.body.append(notice("bad", failure || "The answer stopped early. Try again."));
      if (saved && mode === "question") input.value = "";
      busy = false;
      setDisabled(false);
    }
  }

  return el;
}
