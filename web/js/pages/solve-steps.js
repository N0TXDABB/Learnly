// Step cards and the MTR-style progress line for a solution, while it streams in and once it is saved.
// While streaming, the Markdown is split here with a quick version of the server's parser
// (learnly/homework/parser.py); the server's own result replaces it when the solution is done.

import { markdownToHtml } from "../markdown.js";
import { h } from "../ui.js";

const NUMBER = "(\\d{1,2}|[一二三四五六七八九十]{1,2})";
const SEPARATOR = "[:：.)\\-–—]";
const STEP = new RegExp(`^(?:step|步驟|步骤)\\s*${NUMBER}\\s*(${SEPARATOR})?\\s*(.*)$`, "i");
const STEP_ZH = new RegExp(`^第\\s*${NUMBER}\\s*步\\s*(${SEPARATOR})?\\s*(.*)$`);
const ANSWER = /^(?:final answers?|the answer|answers?|最終答案|答案)\s*(?:[:：]\s*(.*))?$/i;
const KEY_IDEA = /^(?:key ideas?|key points?|key takeaways?)\s*(?:[:：]\s*(.*))?$/i;
const TOPIC = /^(?:topic|subject|主題|主题|科目)\s*[:：]/i;

function unmark(line) {
  const trimmed = line.trim();
  return { text: trimmed.replace(/^#+/, "").replace(/\*\*|__/g, "").trim(), marked: /^(#|\*\*|__)/.test(trimmed) };
}

function heading(text, marked) {
  for (const [kind, re] of [["answer", ANSWER], ["key", KEY_IDEA]]) {
    const m = text.match(re);
    if (m && (marked || m[1] !== undefined || text === m[0])) return { kind, rest: (m[1] || "").trim() };
  }
  return null;
}

/** Split a solution that is still being written into {steps: [{title, body}], answer, key}. */
export function splitLive(markdown) {
  let text = markdown.replace(/<think>[\s\S]*?(<\/think>|$)/g, "");
  // a heading that is still arriving ("## Ste") would flash up as body text: wait for the rest of it
  if (!text.endsWith("\n")) text = text.replace(/\n\s*(#|\*\*|__)[^\n]*$/, "\n");
  const steps = [];
  const parts = { pre: [], answer: [], key: [] };
  let section = "pre";
  for (const line of text.split("\n")) {
    const { text: plain, marked } = unmark(line);
    const step = plain.match(STEP) || plain.match(STEP_ZH);
    if (step && (marked || step[2] || !step[3])) {
      steps.push({ title: step[3].replace(/[:：.。]+$/, "").trim(), lines: [] });
      section = "step";
      continue;
    }
    const found = heading(plain, marked);
    if (found) {
      section = found.kind;
      if (found.rest) parts[section].push(found.rest);
      continue;
    }
    if (section === "pre" && TOPIC.test(plain)) continue;
    if (section === "step") steps.at(-1).lines.push(line);
    else parts[section].push(line);
  }
  const result = steps.map((s) => ({ title: s.title, body: s.lines.join("\n").trim() }));
  const intro = parts.pre.join("\n").trim();
  if (intro && result.length) result[0].body = `${intro}\n\n${result[0].body}`.trim();
  else if (intro) result.push({ title: "", body: intro });
  return { steps: result, answer: parts.answer.join("\n").trim(), key: parts.key.join("\n").trim() };
}

/** One numbered step. set(step) updates it; the body is only re-rendered when its text changed. */
export function stepCard(index) {
  const title = h("h3", { class: "step-title" });
  const body = h("div", { class: "prose step-body" });
  const actions = h("div", { class: "step-actions" });
  const el = h("li", { class: "step-card panel" },
    h("div", { class: "step-head" }, h("span", { class: "step-num", "aria-hidden": "true" }, String(index + 1)), title),
    body, actions);
  let shown = null;
  return {
    el,
    actions,
    set(step) {
      title.replaceChildren(h("span", { class: "sr-only" }, `Step ${index + 1}: `), step.title || `Step ${index + 1}`);
      if (step.body !== shown) {
        shown = step.body;
        body.innerHTML = markdownToHtml(step.body);
      }
    },
  };
}

/** The progress line: Question → Step 1 → Step 2 → … → Answer, with a status line under it. */
export function progressLine() {
  const line = h("ol", { class: "solve-line", "aria-hidden": "true" });
  const message = h("span", {});
  const clock = h("span", { class: "clock", "aria-hidden": "true" });
  const status = h("p", { class: "solve-status", role: "status" }, message, clock);
  const el = h("div", { class: "solve-progress panel tight" }, h("div", { class: "solve-line-wrap" }, line), status);
  return {
    el,
    /** phase: "waiting" | "thinking" | "writing" | "answer" | "done" | "failed" */
    draw(stepsSeen, phase) {
      const steps = Math.max(1, stepsSeen);
      const stations = [["Question", "done"]];
      for (let i = 0; i < steps; i++) {
        const last = i === steps - 1;
        let state = "done";
        if (phase === "waiting" || phase === "thinking" || phase === "writing") state = last ? "running" : "done";
        if (phase === "failed" && last) state = "failed";
        if ((phase === "waiting" || phase === "thinking") && stepsSeen === 0) state = "running";
        stations.push([`Step ${i + 1}`, state]);
      }
      stations.push(["Answer", phase === "done" ? "done" : phase === "answer" ? "running" : ""]);
      line.replaceChildren(...stations.map(([name, state]) => h("li", { class: "stop", dataset: { state } }, h("span", { class: "dot-stop" }), h("span", { class: "name" }, name))));
    },
    /** The message is announced to screen readers when it changes; the seconds are only shown. */
    say(text, seconds = null) {
      if (message.textContent !== text) message.textContent = text;
      clock.textContent = seconds === null ? "" : ` ${seconds} s`;
    },
  };
}
