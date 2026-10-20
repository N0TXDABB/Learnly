// "Practise similar problems": the integrated quiz generator. Choose 3, 4 or 5 problems and a level;
// each answer is checked (quick rules first, the AI only when needed), with a hint, a worked
// solution, and a score that says when the concept is mastered.

import { api } from "../api.js";
import { markdownToHtml } from "../markdown.js";
import { clear, fmt, h, notice, spinner, toast } from "../ui.js";
import { ticker } from "./solve-composer.js";

const COUNTS = [3, 4, 5];
const LEVELS = [["easier", "Easier"], ["same", "Same level"], ["harder", "Harder"]];
const LEVEL_NAMES = { easier: "easier", same: "same level", harder: "harder" };

function prose(markdown, cls = "") {
  const el = h("div", { class: `prose ${cls}` });
  el.innerHTML = markdownToHtml(markdown);
  return el;
}

/** A row of chips where exactly one is chosen. Returns {el, select(value)}. */
function choice(label, options, current, onPick) {
  const buttons = options.map(([value, text]) => h("button", {
    class: "chip", type: "button", "aria-pressed": String(value === current), onclick: () => select(value),
  }, text));
  const select = (value) => {
    buttons.forEach((b, i) => b.setAttribute("aria-pressed", String(options[i][0] === value)));
    onPick(value);
  };
  const el = h("div", { class: "practice-choice", role: "group", "aria-label": label }, h("span", { class: "small muted" }, label), h("div", { class: "chips" }, buttons));
  return { el, select };
}

/**
 * The practice section for a solved problem.
 * onTutor() opens the AI tutor for the whole problem (suggested when answers are wrong).
 */
export function practiceSection(problem, { navigate, scenes, onTutor }) {
  let count = 3;
  let level = "same";
  let generating = false; // one set at a time: a laptop model would only queue a second one behind the first
  const status = h("div", { class: "practice-status", "aria-live": "polite" });
  const sets = h("div", { class: "practice-sets" });
  const generateButton = h("button", { class: "btn primary", type: "button", onclick: () => generate() }, "Generate practice problems");
  const levelChoice = choice("Level", LEVELS, level, (v) => (level = v));
  const countChoice = choice("How many?", COUNTS.map((n) => [n, String(n)]), count, (v) => (count = v));
  const el = h("section", { class: "panel practice section", id: "practice" },
    h("div", { class: "section-head" }, h("h2", {}, "Practise similar problems"), h("span", { class: "zh" }, "練習 Practice")),
    h("p", { class: "muted", style: { marginTop: 0 } }, "Check you've really got it. The quiz generator writes new problems like this one for you to try."),
    h("div", { class: "practice-controls" },
      countChoice.el,
      levelChoice.el,
      generateButton),
    status, sets);

  /** Every button that writes a new set ("Generate", "Try easier problems", "Try harder ones") is off while one is written. */
  function setGenerating(on) {
    generating = on;
    generateButton.disabled = on;
    el.querySelectorAll("button[data-generates]").forEach((b) => (b.disabled = on));
  }

  async function generate(options = {}) {
    if (generating) return;
    if (options.level) levelChoice.select(options.level);
    setGenerating(true);
    const timer = ticker(`Writing ${count} practice problems (${LEVEL_NAMES[level]})… about 20–90 s on a laptop.`);
    clear(status).append(h("div", { class: "row small muted" }, spinner("Writing practice problems"), timer.el));
    scenes.pulse("solve");
    try {
      const created = await api.post(`/problems/${problem.id}/practice`, { count, difficulty: level });
      problem.practice_sets.push(created);
      clear(status);
      const block = practiceSet(created, problem.practice_sets.length);
      sets.prepend(block);
      block.scrollIntoView({ behavior: "smooth", block: "start" });
      scenes.pulse("done");
    } catch (err) {
      clear(status).append(notice("bad", err.message));
      scenes.pulse("reset");
    } finally {
      timer.stop();
      setGenerating(false);
    }
  }

  function practiceSet(set, number) {
    const latest = new Map(); // item index → correct?
    for (const a of set.answers) latest.set(a.item_index, a);
    const score = h("span", { class: "tag gold score" });
    const summary = h("div", { class: "practice-summary", "aria-live": "polite" });
    const cards = set.items.map((item) => quizCard(set, item, latest.get(item.index), (result) => {
      latest.set(item.index, result);
      update(true);
    }));
    const update = (fresh) => {
      const right = [...latest.values()].filter((a) => a.correct).length;
      const wrong = [...latest.values()].filter((a) => !a.correct).length;
      const total = set.items.length;
      score.textContent = `${right} of ${total} correct`;
      clear(summary);
      if (right === total) {
        summary.append(h("div", { class: "mastered" }, h("b", {}, "You've mastered this ✓"),
          h("span", {}, ` All ${total} right. Ready for a challenge?`),
          h("button", { class: "btn small", type: "button", "data-generates": "", disabled: generating, onclick: () => generate({ level: "harder" }) }, "Try harder ones")));
        if (fresh) scenes.pulse("done");
      } else if (wrong) {
        summary.append(h("div", { class: "keep-going" },
          h("span", {}, "Not there yet, and that's normal. Open a hint, look at the steps again, or:"),
          h("div", { class: "row" },
            h("button", { class: "btn small", type: "button", "data-generates": "", disabled: generating, onclick: () => generate({ level: "easier" }) }, "Try easier problems"),
            h("button", { class: "btn small neon", type: "button", onclick: () => onTutor() }, "Ask the AI Tutor"))));
      } else {
        summary.append(h("span", { class: "small muted" }, "Answer each problem, then press Check."));
      }
    };
    update(false);
    return h("div", { class: "practice-set" },
      h("div", { class: "row between practice-set-head" },
        h("h3", {}, `Practice set ${number}`),
        h("span", { class: "small muted" }, `${set.items.length} problems · ${LEVEL_NAMES[set.difficulty]} · ${fmt.ago(set.created_at)}`),
        score),
      h("div", { class: "quiz-grid" }, cards),
      summary);
  }

  function quizCard(set, item, previous, onResult) {
    const n = item.index + 1;
    const input = h("input", { type: "text", maxlength: 500, placeholder: "Your answer", "aria-label": `Your answer to problem ${n}`, autocomplete: "off" });
    const check = h("button", { class: "btn small primary", type: "submit" }, "Check");
    const verdict = h("div", { class: "verdict", "aria-live": "polite" });
    const hint = h("div", { class: "hint-box", hidden: true }, item.hint ? prose(item.hint) : h("p", { class: "muted small" }, "No hint for this one. Look back at the steps above."));
    const solution = h("div", { class: "solution-box", hidden: true },
      h("div", { class: "small muted" }, "Answer"), prose(item.answer, "answer-line"),
      item.solution ? prose(item.solution) : null);
    const toggle = (box, button) => {
      box.hidden = !box.hidden;
      button.setAttribute("aria-expanded", String(!box.hidden));
    };
    const hintButton = h("button", { class: "btn small", type: "button", "aria-expanded": "false", onclick: () => toggle(hint, hintButton) }, "Hint");
    const solutionButton = h("button", { class: "btn small", type: "button", "aria-expanded": "false", onclick: () => toggle(solution, solutionButton) }, "Show solution");
    const solveButton = h("button", { class: "btn small neon", type: "button", onclick: () => solveIt() }, "Solve this step by step");
    const card = h("article", { class: "quiz-card" },
      h("div", { class: "quiz-head" }, h("span", { class: "quiz-num" }, `Problem ${n}`), h("span", { class: "quiz-mark", "aria-hidden": "true" })),
      prose(item.question, "quiz-question"),
      h("form", { class: "answer-row", onsubmit: (e) => { e.preventDefault(); checkAnswer(); } }, input, check),
      verdict,
      h("div", { class: "row quiz-actions" }, hintButton, solutionButton, solveButton),
      hint, solution);

    const show = (result) => {
      card.dataset.state = result.correct ? "right" : "wrong";
      card.querySelector(".quiz-mark").textContent = result.correct ? "✓" : "✗";
      clear(verdict).append(h("span", { class: "mark" }, result.correct ? "✓ " : "✗ "), result.feedback || (result.correct ? "Correct." : "Not quite."),
        result.method === "ai" ? h("span", { class: "small muted" }, " (checked by the AI)") : null);
    };
    if (previous) {
      input.value = previous.answer;
      show(previous);
    }

    async function checkAnswer() {
      const answer = input.value.trim();
      if (!answer) {
        clear(verdict).append(h("span", { class: "small muted" }, "Type your answer first."));
        input.focus();
        return;
      }
      check.disabled = true;
      clear(verdict).append(h("span", { class: "row small muted" }, spinner("Checking"), "Checking…"));
      try {
        const result = await api.post(`/problems/practice/${set.id}/check`, { item_index: item.index, answer });
        show(result);
        onResult({ ...result, answer, item_index: item.index });
        if (result.correct) scenes.pulse("done");
      } catch (err) {
        clear(verdict).append(notice("bad", err.message));
      } finally {
        check.disabled = false;
      }
    }

    async function solveIt() {
      solveButton.disabled = true;
      try {
        const created = await api.post(`/problems/practice/${set.id}/items/${item.index}/solve`, {});
        navigate(`#/solve/${created.id}?auto=1`);
      } catch (err) {
        toast(err.message, "bad");
        solveButton.disabled = false;
      }
    }
    return card;
  }

  problem.practice_sets.forEach((set, i) => sets.prepend(practiceSet(set, i + 1)));
  return el;
}
