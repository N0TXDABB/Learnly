// "Make revision material": pick a kind (outline, flashcards, quiz, mock exam), set a few options,
// and the local model writes it in the background from the documents ticked above.

import { clear, field, h, toast } from "../ui.js";
import { MATERIALS, aiReady, makeMaterial } from "./study-shared.js";

const COUNTS = { flashcards: [20, 5, 60], quiz: [10, 5, 30], exam: [20, 10, 50] };
const TYPES = [["choice", "Multiple choice"], ["truefalse", "True / false"], ["short", "Short answer"]];

/**
 * Draws the panel into `box`. `selected()` returns the ticked documents; `onMade(material)` is called
 * after the server accepts the request. Returns { update } to call when the selection changes.
 */
export function renderMaker(box, { selected, onMade }) {
  let kind = "flashcards";
  const summary = h("p", { class: "muted small", "aria-live": "polite" });
  const count = h("input", { type: "number", inputmode: "numeric" });
  const difficulty = h("select", {}, h("option", { value: "mixed" }, "Mixed (recommended)"), h("option", { value: "easy" }, "Easier"), h("option", { value: "hard" }, "Harder"));
  const focus = h("input", { type: "text", maxlength: 200, placeholder: "e.g. enzymes, or chapter 3", autocomplete: "off" });
  const minutes = h("input", { type: "number", min: 5, max: 240, value: 45, inputmode: "numeric" });
  const title = h("input", { type: "text", maxlength: 120, placeholder: "Named automatically if left empty", autocomplete: "off" });
  const typeBoxes = TYPES.map(([value, label]) => ({ value, input: h("input", { type: "checkbox", value, checked: true }), label }));
  const go = h("button", { class: "btn primary big", type: "submit" }, "Generate");

  const kindButtons = Object.entries(MATERIALS).map(([value, info]) => h("button", {
    class: "make-kind", type: "button", role: "radio", "aria-checked": String(value === kind), dataset: { kind: value },
    onclick: () => pick(value),
  }, h("span", { class: "make-zh", "aria-hidden": "true" }, info.zh), h("b", {}, info.label), h("span", { class: "small muted" }, info.blurb)));

  const countField = field("How many", count);
  const difficultyField = field("Difficulty", difficulty);
  const typesField = h("fieldset", { class: "make-types" }, h("legend", {}, "Question types"),
    typeBoxes.map((t) => h("label", { class: "check" }, t.input, t.label)));
  const minutesField = field("Time limit (minutes)", minutes);

  function pick(value) {
    kind = value;
    kindButtons.forEach((b) => b.setAttribute("aria-checked", String(b.dataset.kind === value)));
    const limits = COUNTS[value];
    countField.hidden = !limits;
    if (limits) {
      count.value = limits[0];
      count.min = limits[1];
      count.max = limits[2];
      countField.querySelector(".hint")?.remove();
      countField.append(h("div", { class: "hint" }, `${limits[1]} to ${limits[2]} ${value === "flashcards" ? "cards" : "questions"}`));
    }
    difficultyField.hidden = typesField.hidden = !(value === "quiz" || value === "exam");
    minutesField.hidden = value !== "exam";
    go.textContent = `Generate ${MATERIALS[value].short.toLowerCase()}`;
  }

  async function submit(e) {
    e.preventDefault();
    const docs = selected();
    if (!docs.length) {
      toast("Tick one or more ready documents first.", "bad");
      return;
    }
    const options = { focus: focus.value.trim() };
    if (COUNTS[kind]) options.count = Number(count.value);
    if (kind === "quiz" || kind === "exam") {
      options.difficulty = difficulty.value;
      options.question_types = typeBoxes.filter((t) => t.input.checked).map((t) => t.value);
      if (!options.question_types.length) {
        toast("Choose at least one type of question.", "bad");
        return;
      }
    }
    if (kind === "exam") options.time_limit_min = Number(minutes.value);
    go.disabled = true;
    try {
      const material = await makeMaterial(kind, docs.map((d) => d.id), options, title.value.trim());
      toast(`Writing your ${MATERIALS[kind].label.toLowerCase()}. You'll get a notification when it's ready.`, "good");
      title.value = "";
      onMade(material);
    } catch (err) {
      toast(err.message, "bad");
    } finally {
      go.disabled = false;
      update();
    }
  }

  function update() {
    const docs = selected();
    go.disabled = !docs.length;
    summary.textContent = docs.length
      ? `From ${docs.length === 1 ? `“${docs[0].title}”` : `${docs.length} documents`}.`
      : "Tick one or more ready documents above to choose what to study from.";
  }

  clear(box).append(h("form", { class: "make", onsubmit: submit },
    h("div", { class: "panel-title" }, h("h3", {}, "Make revision material"), h("span", { class: "zh muted" }, "製作溫習材料")),
    summary,
    aiReady() ? null : h("p", { class: "small", style: { color: "var(--amber)" } }, "The local AI isn't running, so nothing can be written yet. ", h("a", { href: "#/settings" }, "Check AI setup"), "."),
    h("div", { class: "make-kinds", role: "radiogroup", "aria-label": "What to make" }, kindButtons),
    h("div", { class: "make-options" }, countField, difficultyField, minutesField,
      field("Focus on a topic (optional)", focus), field("Title (optional)", title)),
    typesField,
    h("div", { class: "row" }, go, h("span", { class: "small faint" }, "Runs on your computer: a few minutes for long documents."))));
  pick(kind);
  update();
  return { update };
}
