// #/review/attempt/<id>: results. The score, how each topic went, and every question with your
// answer, the model answer, why, and where in your notes it came from. One button turns the
// topics you missed into a new practice quiz.

import { api } from "../api.js";
import { markdownToHtml } from "../markdown.js";
import { clear, fmt, h, notice, spinner, toast } from "../ui.js";
import { accuracyBar } from "./study-shared.js";

function prose(markdown, cls = "") {
  const el = h("div", { class: `prose ${cls}` });
  el.innerHTML = markdownToHtml(markdown);
  return el;
}

function verdict(result) {
  if (result.method === "unmarked") return h("span", { class: "tag amber" }, "Check yourself");
  if (result.correct >= 1) return h("span", { class: "tag green" }, "Correct");
  if (result.correct > 0) return h("span", { class: "tag amber" }, "Partly right");
  return h("span", { class: "tag red" }, "Not right");
}

function message(percent) {
  if (percent >= 90) return "Excellent. You know this well.";
  if (percent >= 75) return "Good work. A little more practice on the topics below.";
  if (percent >= 50) return "Getting there. Practise the weaker topics, then try again.";
  return "Keep going: practise the topics below and try again. Every attempt helps.";
}

export async function renderAttempt(view, { scenes, navigate, onCleanup }, attemptId) {
  const head = h("section", { class: "hero short" }, h("p", { class: "kicker" }, "旺角 Mong Kok · Results"), h("h1", { class: "doc-heading" }, "Loading…"));
  const body = h("div", { class: "section" }, spinner());
  view.append(head, body);
  let attempt;
  try {
    attempt = await api.get(`/study/attempts/${attemptId}`);
  } catch (err) {
    clear(body).append(notice("bad", err.message, " ", h("a", { href: "#/review" }, "Back to Review")));
    return;
  }
  clear(head).append(
    h("p", { class: "kicker" }, `旺角 Mong Kok · ${attempt.kind === "exam" ? "Mock exam" : "Quiz"} results`),
    h("h1", { class: "doc-heading" }, attempt.title));
  if (attempt.status !== "graded") {
    clear(body).append(h("div", { class: "panel" }, notice("warn", "This attempt hasn't been handed in yet."),
      h("a", { class: "btn primary section", href: `#/review/quiz/${attempt.material_id}` }, "Carry on")));
    return;
  }

  const correct = attempt.results.filter((r) => r.correct >= 1).length;
  // The 答對 ("correct") sign flashes once for each right answer (up to six).
  const flashes = attempt.results.filter((r) => r.correct >= 1).slice(0, 6).map((_, i) => setTimeout(() => scenes.pulse("correct"), 400 + i * 700));
  onCleanup(() => flashes.forEach(clearTimeout));
  const missed = attempt.topics.filter((t) => t.correct < t.total).map((t) => t.topic);

  const again = h("button", { class: "btn neon", type: "button", disabled: !missed.length, onclick: async (e) => {
    const button = e.currentTarget;
    button.disabled = true;
    try {
      const material = await api.post("/study/practice-weak", { topics: missed.slice(0, 5), count: 10 });
      toast("Writing a practice quiz on those topics…", "good");
      navigate(`#/study/material/${material.id}`);
    } catch (err) {
      toast(err.message, "bad");
      button.disabled = false;
    }
  } }, "Practise these topics again");

  clear(body).append(
    h("section", { class: "grid two" },
      h("div", { class: "panel gold score-panel" },
        h("div", { class: "score-big" },
          h("span", { class: "score-num" }, `${fmt.number(attempt.score, attempt.score % 1 ? 1 : 0)}`),
          h("span", { class: "score-max" }, ` / ${fmt.number(attempt.max_score)}`)),
        h("div", { class: "score-pct" }, `${attempt.percent}%`),
        h("p", { class: "lede" }, message(attempt.percent)),
        h("p", { class: "small muted" }, `${correct} of ${attempt.results.length} questions fully right · handed in ${fmt.dateTime(attempt.finished_at)}`),
        h("div", { class: "row section" },
          h("a", { class: "btn primary", href: `#/review/quiz/${attempt.material_id}` }, "Try again"),
          again,
          h("a", { class: "btn", href: "#/review" }, "Back to Review"))),
      h("div", { class: "panel" },
        h("div", { class: "panel-title" }, h("h3", {}, "By topic"), h("span", { class: "zh muted" }, "各課題")),
        h("div", { class: "stack" }, attempt.topics.map((t) => accuracyBar(t.topic, t.total ? t.correct / t.total : 0, ` ${t.correct} of ${t.total}`))))),

    h("section", { class: "section" },
      h("div", { class: "section-head" }, h("h2", {}, "Every question"), h("span", { class: "zh" }, "逐題檢討")),
      h("ol", { class: "result-list" }, attempt.results.map((r, i) => h("li", { class: `panel result ${r.correct >= 1 ? "is-right" : r.correct > 0 ? "is-partly" : "is-wrong"}` },
        h("div", { class: "row between" },
          h("span", { class: "small muted" }, `Question ${i + 1} · ${r.topic}`),
          h("span", { class: "row", style: { gap: "6px" } }, verdict(r), h("span", { class: "tag gold" }, `${fmt.number(r.score, r.score % 1 ? 1 : 0)} / ${r.points}`))),
        prose(r.question, "result-question"),
        h("dl", { class: "result-detail" },
          h("dt", {}, "Your answer"), h("dd", {}, r.your_answer ? r.your_answer : h("span", { class: "faint" }, "No answer")),
          r.correct < 1 || r.type === "short" ? [h("dt", {}, "Model answer"), h("dd", {}, prose(r.expected))] : null,
          r.marking_points?.length ? [h("dt", {}, "Marking points"), h("dd", {}, r.marking_points.join(" · "))] : null,
          r.explanation ? [h("dt", {}, "Why"), h("dd", {}, prose(r.explanation))] : null,
          r.feedback ? [h("dt", {}, "Feedback"), h("dd", {}, r.feedback)] : null,
          r.source ? [h("dt", {}, "In your notes"), h("dd", {}, h("span", { class: "tag neon" }, r.source))] : null))))));
}
