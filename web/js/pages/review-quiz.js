// #/review/quiz/<material id>: take a quiz or mock exam. One question per screen (easy on a phone),
// with a numbered navigator to jump around. Answers save as you go, so closing the tab loses
// nothing. Mock exams have a timer: a warning at 5 minutes, and the paper is handed in at zero.
// An exam whose time ran out while the page was closed is handed in as soon as it is opened.

import { api } from "../api.js";
import { markdownToHtml } from "../markdown.js";
import { clear, debounce, h, modal, notice, spinner, toast } from "../ui.js";

const TYPE_LABELS = { choice: "Multiple choice", truefalse: "True or false", short: "Short answer" };

function prose(markdown, cls = "") {
  const el = h("div", { class: `prose ${cls}` });
  el.innerHTML = markdownToHtml(markdown);
  return el;
}

function clock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = String(s % 60).padStart(2, "0");
  return hrs ? `${hrs}:${String(mins).padStart(2, "0")}:${secs}` : `${mins}:${secs}`;
}

export async function renderQuiz(view, { navigate, onCleanup }, materialId) {
  const head = h("section", { class: "hero short" }, h("p", { class: "kicker" }, "旺角 Mong Kok · Quiz"), h("h1", { class: "doc-heading" }, "Loading…"));
  const body = h("div", { class: "section" }, spinner());
  view.append(head, body);
  let attempt;
  try {
    attempt = await api.post(`/study/materials/${materialId}/attempts`);
  } catch (err) {
    clear(body).append(notice("bad", err.message, " ", h("a", { href: `#/study/material/${materialId}` }, "Back")));
    return;
  }
  const exam = attempt.kind === "exam";
  clear(head).append(
    h("p", { class: "kicker" }, `旺角 Mong Kok · ${exam ? "Mock exam" : "Quiz"}`),
    h("h1", { class: "doc-heading" }, attempt.title));
  const timeUp = Boolean(attempt.time_up);
  if (attempt.resumed && !timeUp) toast("Carrying on where you left off.");

  const questions = attempt.questions;
  const answers = { ...attempt.answers };
  let index = Math.max(0, questions.findIndex((q) => answers[String(q.index)] === undefined));
  let submitting = false;
  let saveState = "";

  const saved = h("span", { class: "small muted save-state", "aria-live": "polite" });
  const answeredText = h("span", { class: "small" });
  const timer = h("span", { class: "quiz-timer", role: "timer", "aria-live": "off" });
  const timerNote = h("span", { class: "sr-only", "aria-live": "assertive" });
  const nav = h("nav", { class: "qnav", "aria-label": "Questions" });
  const stage = h("div", { class: "exam-stage" });
  const handIn = h("button", { class: "btn primary", type: "button", onclick: () => confirmSubmit() }, "Hand in");

  clear(body).append(
    h("div", { class: "quiz-bar" },
      h("div", { class: "row" }, answeredText, saved),
      exam && attempt.deadline ? h("div", { class: "row" }, h("span", { class: "small muted" }, "Time left"), timer, timerNote) : null,
      handIn),
    nav, stage);

  // -- saving ------------------------------------------------------------------------------------
  const save = debounce(() => flush(), 800);
  async function flush() {
    if (submitting) return;
    saveState = "saving";
    saved.textContent = "Saving…";
    try {
      await api.put(`/study/attempts/${attempt.id}`, { answers });
      saveState = "";
      saved.textContent = "Saved";
    } catch (err) {
      saveState = "failed";
      // 409: handed in elsewhere, or the exam's time is up (the message says which)
      saved.textContent = err.status === 409 ? err.message : "Not saved yet: check that Learnly is running";
    }
  }
  onCleanup(() => {
    if (!submitting && saveState !== "") flush();
  });

  function setAnswer(q, value) {
    if (value === "" || value === null || value === undefined) delete answers[String(q.index)];
    else answers[String(q.index)] = value;
    saveState = "pending";
    save();
    drawNav();
  }

  // -- timer --------------------------------------------------------------------------------------
  if (timeUp) {
    timer.textContent = clock(0);
    timer.classList.add("low");
  } else if (exam && attempt.deadline) {
    const endsAt = Date.now() + attempt.seconds_left * 1000; // the server's count, so a wrong PC clock doesn't matter
    let warned = attempt.seconds_left <= 300;
    const tick = () => {
      const left = (endsAt - Date.now()) / 1000;
      timer.textContent = clock(left);
      timer.classList.toggle("low", left <= 300);
      if (!warned && left <= 300) {
        warned = true;
        toast("5 minutes left. Check your answers.", "bad");
        timerNote.textContent = "Five minutes left.";
      }
      if (left <= 0 && !submitting) {
        clearInterval(handle);
        toast("Time's up. Handing in your answers.", "bad");
        submit();
      }
    };
    const handle = setInterval(tick, 1000);
    onCleanup(() => clearInterval(handle));
    tick();
  }

  // -- drawing -----------------------------------------------------------------------------------------
  function drawNav() {
    const done = questions.filter((q) => answers[String(q.index)] !== undefined).length;
    answeredText.textContent = `${done} of ${questions.length} answered`;
    clear(nav).append(...questions.map((q, i) => h("button", {
      type: "button", class: `qnav-btn ${answers[String(q.index)] !== undefined ? "answered" : ""}`,
      "aria-current": i === index ? "step" : null, "aria-label": `Question ${i + 1}${answers[String(q.index)] !== undefined ? ", answered" : ""}`,
      onclick: () => go(i),
    }, String(i + 1))));
  }

  function go(i) {
    index = Math.max(0, Math.min(questions.length - 1, i));
    drawQuestion();
    drawNav();
    stage.querySelector(".exam-q-text")?.focus({ preventScroll: false });
  }

  function drawQuestion() {
    const q = questions[index];
    const key = String(q.index);
    const name = `q-${q.index}`;
    let answerBox;
    if (q.type === "short") {
      const input = h("textarea", { rows: 3, maxlength: 2000, placeholder: "Type your answer…", "aria-label": `Your answer to question ${index + 1}` });
      input.value = answers[key] ?? "";
      input.addEventListener("input", () => setAnswer(q, input.value.trim() ? input.value : ""));
      answerBox = h("div", { class: "short-answer" }, input,
        h("p", { class: "small faint" }, exam ? "Worth 2 points. Write the key words: you can get partial credit." : "A word, a number or a sentence or two."));
    } else {
      answerBox = h("div", { class: `choices type-${q.type}`, role: "radiogroup", "aria-label": `Answers to question ${index + 1}` },
        q.choices.map((choice, i) => {
          const input = h("input", { type: "radio", name, value: String(i), checked: answers[key] === i });
          input.addEventListener("change", () => setAnswer(q, i));
          return h("label", { class: "choice" }, input, h("span", { class: "choice-letter", "aria-hidden": "true" }, q.type === "choice" ? "ABCD"[i] : ""),
            prose(choice, "choice-text"));
        }));
    }
    const last = index === questions.length - 1;
    clear(stage).append(h("article", { class: "panel exam-q" },
      h("div", { class: "row between" },
        h("span", { class: "small muted" }, `Question ${index + 1} of ${questions.length} · ${TYPE_LABELS[q.type]}`),
        h("span", { class: "row", style: { gap: "6px" } }, q.topic ? h("span", { class: "tag" }, q.topic) : null,
          h("span", { class: "tag gold" }, `${q.points} point${q.points === 1 ? "" : "s"}`))),
      h("div", { class: "exam-q-text", role: "heading", "aria-level": "2", tabindex: "-1" }, prose(q.question)),
      answerBox,
      h("div", { class: "row between exam-q-actions" },
        h("button", { class: "btn", type: "button", disabled: index === 0, onclick: () => go(index - 1) }, "← Previous"),
        last
          ? h("button", { class: "btn primary", type: "button", onclick: () => confirmSubmit() }, "Hand in")
          : h("button", { class: "btn primary", type: "button", onclick: () => go(index + 1) }, "Next →"))));
  }

  // -- handing in ----------------------------------------------------------------------------------------
  async function confirmSubmit() {
    const missing = questions.filter((q) => answers[String(q.index)] === undefined).length;
    const ok = await modal((close) => h("div", {},
      h("h2", {}, "Hand in your answers?"),
      h("p", { class: "muted" }, missing
        ? `${missing} question${missing === 1 ? " has" : "s have"} no answer yet. Unanswered questions score 0.`
        : "You've answered every question."),
      h("div", { class: "row", style: { justifyContent: "flex-end", marginTop: "18px" } },
        h("button", { class: "btn", type: "button", onclick: () => close(false) }, "Keep working"),
        h("button", { class: "btn primary", type: "button", onclick: () => close(true) }, "Hand in"))), { label: "Hand in" });
    if (ok) submit();
  }

  async function submit() {
    if (submitting) return;
    submitting = true;
    handIn.disabled = true;
    clear(stage).append(h("section", { class: "panel neon marking", "aria-live": "polite" },
      spinner("Marking"), h("h3", {}, "Marking your answers…"),
      h("p", { class: "muted small" }, questions.some((q) => q.type === "short")
        ? "Short answers are checked by the AI on your computer. This can take a minute."
        : "Nearly there.")));
    clear(nav);
    try {
      const graded = await api.post(`/study/attempts/${attempt.id}/submit`, { answers });
      navigate(`#/review/attempt/${graded.id}`);
    } catch (err) {
      submitting = false;
      handIn.disabled = false;
      toast(err.message, "bad");
      drawNav();
      drawQuestion();
    }
  }

  drawNav();
  drawQuestion();
  if (timeUp) {
    toast("The time for this exam ran out, so your saved answers are being handed in.", "bad");
    submit();
  }
}
