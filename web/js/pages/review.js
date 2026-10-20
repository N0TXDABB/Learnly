// Mong Kok (旺角): review and self-test. #/review shows cards due today, weak topics, decks and
// quizzes with their scores. #/review/cards/<deck|due> runs a flashcard session,
// #/review/quiz/<id> takes a quiz or mock exam, #/review/attempt/<id> shows the results.

import { api } from "../api.js";
import { openSignIn } from "../auth.js";
import { store } from "../store.js";
import { clear, empty, fmt, h, notice, spinner, toast } from "../ui.js";
import { renderAttempt } from "./review-attempt.js";
import { renderCards } from "./review-cards.js";
import { renderQuiz } from "./review-quiz.js";
import { MATERIALS, accuracyBar, materialBadge } from "./study-shared.js";

export async function render(view, ctx) {
  if (!store.can("study:use")) {
    view.append(hero());
    view.append(h("div", { class: "panel gold section" }, store.signedIn()
      ? empty("Not for this account", "Reviewing is for student and administrator accounts.")
      : empty("Sign in to start", "Your flashcards, quizzes and scores are saved to your account on this computer.",
        h("button", { class: "btn primary", type: "button", onclick: () => openSignIn() }, store.health?.needs_setup ? "Create the owner account" : "Sign in"))));
    return;
  }
  const [kind, id] = ctx.params;
  if (kind === "cards") return renderCards(view, ctx, id);
  if (kind === "quiz") return renderQuiz(view, ctx, id);
  if (kind === "attempt") return renderAttempt(view, ctx, id);
  return renderHome(view, ctx);
}

function hero() {
  return h("section", { class: "hero short" },
    h("p", { class: "kicker" }, "旺角 Mong Kok"),
    h("h1", {}, "Review"),
    h("p", { class: "lede" }, "Flashcards that come back just before you'd forget them, quizzes and mock exams, and the topics that need more work before the exam."));
}

async function renderHome(view, { scenes, navigate }) {
  view.append(hero());
  const body = h("div", {}, h("div", { class: "section" }, spinner()));
  view.append(body);
  let overview;
  let weak;
  let materials;
  let attempts;
  try {
    [overview, weak, materials, attempts] = await Promise.all([
      api.get("/study/overview"), api.get("/study/weak-topics"), api.get("/study/materials"), api.get("/study/attempts"),
    ]);
  } catch (err) {
    clear(body).append(notice("bad", err.message));
    return;
  }
  scenes.setData({ cardsMastered: overview.cards_mastered });

  const ready = materials.filter((m) => m.status === "ready");
  const decks = ready.filter((m) => m.kind === "flashcards");
  const tests = ready.filter((m) => m.kind === "quiz" || m.kind === "exam");
  const scores = new Map();
  for (const a of attempts.filter((x) => x.status === "graded")) {
    const s = scores.get(a.material_id) || { best: 0, last: null, count: 0 };
    s.best = Math.max(s.best, a.percent);
    if (s.last === null) s.last = a.percent; // attempts come newest first
    s.count += 1;
    scores.set(a.material_id, s);
  }

  const practise = h("button", { class: "btn primary", type: "button", onclick: async (e) => {
    const button = e.currentTarget;
    button.disabled = true;
    try {
      const material = await api.post("/study/practice-weak", { count: 10 });
      toast("Writing a quiz on your weak topics…", "good");
      navigate(`#/study/material/${material.id}`);
    } catch (err) {
      toast(err.message, "bad");
      button.disabled = false;
    }
  } }, "Practise my weak topics");

  clear(body).append(
    h("section", { class: "grid two section" },
      h("div", { class: "panel gold due-panel" },
        h("div", { class: "panel-title" }, h("h3", {}, "Due today"), h("span", { class: "zh muted" }, "今日溫習")),
        h("div", { class: "due-count" }, h("span", { class: "value" }, fmt.number(overview.cards_due)), h("span", { class: "muted" }, overview.cards_due === 1 ? "card to review" : "cards to review")),
        overview.cards_due
          ? h("a", { class: "btn primary big", href: "#/review/cards/due" }, "Start")
          : overview.cards_total
            ? h("p", { class: "muted" }, "Nothing due right now. Well done! Come back later, or practise a deck below.")
            : h("p", { class: "muted" }, "No flashcards yet. Make some on the ", h("a", { href: "#/study" }, "Study"), " page."),
        h("p", { class: "small faint" }, `${fmt.number(overview.cards_mastered)} of ${fmt.number(overview.cards_total)} cards mastered (reviewed well enough to wait two weeks or more).`)),
      h("div", { class: "panel weak-panel" },
        h("div", { class: "panel-title" }, h("h3", {}, "Weak topics"), h("span", { class: "zh muted" }, "弱項")),
        weak.weak.length
          ? h("div", { class: "stack" },
            weak.weak.slice(0, 6).map((w) => accuracyBar(w.topic, w.accuracy, ` ${w.subject ? w.subject + " · " : ""}${w.answered} answered`)),
            h("div", {}, practise))
          : h("p", { class: "muted" }, "No weak topics yet. They appear here after a few quiz answers, flashcard reviews or homework practice problems on a topic."),
        weak.strong.length ? h("p", { class: "small faint section" }, "Strong: ", weak.strong.slice(0, 5).map((s) => s.topic).join(", ")) : null)),

    h("section", { class: "section" },
      h("div", { class: "section-head" }, h("h2", {}, "Flashcard decks"), h("span", { class: "zh" }, "記憶卡")),
      decks.length
        ? h("div", { class: "review-list" }, decks.map((m) => h("div", { class: "panel review-item" },
          materialBadge(m.kind),
          h("div", { class: "review-main" }, h("a", { href: `#/study/material/${m.id}` }, h("b", {}, m.title)),
            h("div", { class: "small muted" }, `${m.counts.cards} cards · ${m.counts.due} due · ${m.counts.mastered} mastered`)),
          h("a", { class: `btn ${m.counts.due ? "primary" : ""} small`, href: `#/review/cards/${m.id}` }, m.counts.due ? "Review" : "Practise"))))
        : h("div", { class: "panel" }, empty("No decks yet", "Make flashcards from your notes on the Study page.", h("a", { class: "btn", href: "#/study" }, "Go to Study")))),

    h("section", { class: "section" },
      h("div", { class: "section-head" }, h("h2", {}, "Quizzes and mock exams"), h("span", { class: "zh" }, "測驗")),
      tests.length
        ? h("div", { class: "review-list" }, tests.map((m) => {
          const s = scores.get(m.id);
          return h("div", { class: "panel review-item" },
            materialBadge(m.kind),
            h("div", { class: "review-main" }, h("a", { href: `#/study/material/${m.id}` }, h("b", {}, m.title)),
              h("div", { class: "small muted" }, [MATERIALS[m.kind].label, `${m.counts.questions} questions`,
                s ? `best ${s.best}% · last ${s.last}%` : "not taken yet"].join(" · "))),
            h("a", { class: "btn small", href: `#/review/quiz/${m.id}` }, s ? "Take again" : m.kind === "exam" ? "Start exam" : "Start"));
        }))
        : h("div", { class: "panel" }, empty("No quizzes yet", "Make a quiz or mock exam from your notes on the Study page."))),

    attempts.length ? h("section", { class: "section" },
      h("div", { class: "section-head" }, h("h2", {}, "Recent attempts"), h("span", { class: "zh" }, "最近成績")),
      h("div", { class: "panel" }, h("ul", { class: "attempt-list" }, attempts.slice(0, 8).map((a) => h("li", {},
        h("a", { href: a.status === "graded" ? `#/review/attempt/${a.id}` : `#/review/quiz/${a.material_id}` },
          a.status === "graded" ? h("b", { class: "attempt-pct" }, `${a.percent}%`) : h("span", { class: "tag amber" }, "Unfinished"),
          " ", a.title),
        h("span", { class: "small faint" }, fmt.ago(a.finished_at || a.started_at))))))) : null,
  );
}
