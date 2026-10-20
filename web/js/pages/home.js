// Victoria Harbour: the front door. A quick way to snap or type a problem, the two journeys the app
// is built around (homework help and exam revision), and what's waiting today.

import { api } from "../api.js";
import { openSignIn } from "../auth.js";
import { imageFromTransfer } from "../images.js";
import { store } from "../store.js";
import { command, fmt, h, toast } from "../ui.js";
import { handOffPhoto, photoButtons, plainQuestion } from "./solve-composer.js";

export function aiSetupSteps(health) {
  const os = /Win/i.test(navigator.userAgent) ? "Windows" : /Mac/i.test(navigator.userAgent) ? "Mac" : "Linux";
  const chat = health?.recommended?.chat || "qwen3.5:4b";
  const ai = health?.ai || {};
  return h("ol", { class: "steps" },
    h("li", {}, h("b", {}, `Install Ollama for ${os}`), " — the free app that runs AI models on your computer. ",
      h("a", { href: "https://ollama.com/download", target: "_blank", rel: "noopener" }, "ollama.com/download"),
      ai.reachable ? h("span", { class: "tag green", style: { marginLeft: "8px" } }, "Found it ✓") : null),
    h("li", {}, h("b", {}, "Download the model"), " (about 3.4 GB, once). In a terminal:", command(`ollama pull ${chat}`),
      h("div", { class: "small muted" }, "It reads photos of questions too. Older laptops: ", h("code", {}, "ollama pull qwen3.5:2b"), ". 16 GB+ RAM: ", h("code", {}, "ollama pull qwen3.5:9b"), ".")),
    h("li", {}, "Come back here. Learnly finds the model by itself. Prefer LM Studio? Pick it in ", h("a", { href: "#/settings" }, "AI setup"), "."),
  );
}

const JOURNEYS = [
  {
    kicker: "中環 Central",
    title: "Homework help",
    steps: [
      ["Snap or type", "Take a photo of the question, or type or paste it."],
      ["Read the steps", "Short numbered steps that explain why, with the maths written properly."],
      ["Ask AI Tutor", "Stuck on a line? Ask for a simpler explanation, or why a rule applies."],
      ["Practise similar problems", "Try 3–5 problems like it to be sure you've got it."],
    ],
    links: [["#/solve", "Solve a problem", "primary"]],
  },
  {
    kicker: "山頂 The Peak",
    title: "Exam revision",
    steps: [
      ["Upload slides, PDFs, recordings", "Drag in lecture slides, chapter PDFs or lecture recordings."],
      ["Make outlines, flashcards, mock exams", "Revision material written from your own course files."],
      ["Test your weak areas", "Quizzes find the topics you keep missing, so you revise those first."],
    ],
    links: [["#/study", "Upload course material", "primary"], ["#/review", "Review & self-test", ""]],
  },
];

function journeyPanel(journey) {
  return h("article", { class: "panel journey" },
    h("p", { class: "kicker" }, journey.kicker),
    h("h2", {}, journey.title),
    h("ol", { class: "journey-steps" }, journey.steps.map(([title, text]) => h("li", {}, h("b", {}, title), h("span", {}, text)))),
    h("div", { class: "row" }, journey.links.map(([href, label, kind]) => h("a", { class: `btn ${kind}`, href }, label))));
}

/** Type a problem (solved at once on #/solve/<id>) or snap one (read on #/solve, where it can be checked). */
function quickComposer({ navigate, onCleanup }) {
  const ai = store.health?.ai || {};
  const text = h("textarea", { rows: 2, maxlength: 8000, placeholder: "Type or paste a homework problem, e.g. Solve x^2 - 5x + 6 = 0", "aria-label": "Your homework problem" });
  const solve = h("button", { class: "btn primary", type: "submit" }, "Solve it");
  const usePhoto = (file) => {
    handOffPhoto(file);
    navigate("#/solve");
  };
  const submit = async () => {
    const question = text.value.trim();
    if (!question) {
      text.focus();
      toast("Type the problem first, or snap a photo of it.");
      return;
    }
    solve.disabled = true;
    try {
      const created = await api.post("/problems", { question, source: "text" });
      navigate(`#/solve/${created.id}?auto=1`);
    } catch (err) {
      toast(err.message, "bad");
      solve.disabled = false;
    }
  };
  text.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submit();
    }
  });
  if (ai.vision) {
    const onPaste = (e) => {
      const file = imageFromTransfer(e.clipboardData);
      if (file) {
        e.preventDefault();
        usePhoto(file);
      }
    };
    window.addEventListener("paste", onPaste);
    onCleanup(() => window.removeEventListener("paste", onPaste));
  }
  return h("form", { class: "quick-composer panel gold", onsubmit: (e) => { e.preventDefault(); submit(); } },
    text,
    h("div", { class: "row" },
      ai.vision ? photoButtons(usePhoto, { small: true }) : h("span", { class: "small muted" }, "To snap photos of questions, ",
        h("a", { href: "#/settings" }, "use a model that reads photos"), "."),
      h("span", { class: "spacer" }),
      solve));
}

function todayItem(label, value, body) {
  return h("div", { class: "today-item" }, h("div", { class: "label" }, label), value !== null ? h("div", { class: "value" }, value) : null, body);
}

/** What's waiting: cards due, weak topics, recent documents and problems. Quietly left out if nothing loads. */
async function todayPanel(box) {
  const [overview, problems] = await Promise.all([
    store.can("study:use") ? api.get("/study/overview").catch(() => null) : null,
    store.can("solve:use") ? api.get("/problems?limit=3").catch(() => []) : [],
  ]);
  const items = [];
  if (overview) {
    items.push(todayItem("Cards due", fmt.number(overview.cards_due || 0),
      overview.cards_due ? h("a", { href: "#/review/cards/due" }, "Review them now →") : h("span", { class: "small muted" }, "All caught up.")));
    const weak = overview.weak_topics || [];
    items.push(todayItem("Weak topics", null, weak.length
      ? h("div", { class: "chips" }, weak.map((t) => h("a", { class: "chip", href: "#/review" }, t.topic, t.accuracy !== undefined ? h("span", { class: "faint" }, ` ${Math.round(t.accuracy * 100)}%`) : null)))
      : h("span", { class: "small muted" }, "None yet. Quizzes and practice problems find them.")));
    const docs = overview.recent_documents || [];
    items.push(todayItem("Recent documents", null, docs.length
      ? h("ul", { class: "today-list" }, docs.map((d) => h("li", {}, h("a", { href: `#/study/doc/${d.id}` }, d.title || d.filename))))
      : h("a", { href: "#/study" }, "Upload your first notes →")));
  }
  if (problems.length) {
    items.push(todayItem("Recent problems", null, h("ul", { class: "today-list" }, problems.map((p) => h("li", {},
      h("a", { href: `#/solve/${p.id}` }, plainQuestion(p.question, 70) || "(photo)"))))));
  }
  if (!items.length) return;
  box.hidden = false;
  box.append(h("div", { class: "section-head" }, h("h2", {}, "Today"), h("span", { class: "zh" }, "今日")),
    h("div", { class: "today-grid" }, items));
}

export async function render(view, { navigate, onCleanup }) {
  const health = store.health;
  const canSolve = store.can("solve:use");
  const hero = h("section", { class: "hero home-hero" },
    h("p", { class: "kicker" }, "維多利亞港 Victoria Harbour"),
    h("h1", {}, "Snap it. Solve it.", h("br"), h("span", { class: "gold" }, "Study it.")),
    h("p", { class: "lede" }, "Step-by-step homework help and revision made from your own course material, with an AI that runs on this computer."));
  view.append(hero);

  if (canSolve) {
    hero.append(quickComposer({ navigate, onCleanup }));
  } else if (!store.signedIn()) {
    hero.append(h("div", { class: "row hero-cta" },
      h("button", { class: "btn primary big", type: "button", onclick: () => openSignIn(health?.needs_setup ? "register" : "signin") },
        health?.needs_setup ? "Create the owner account" : "Sign in to start"),
      health?.needs_setup ? null : h("button", { class: "btn big", type: "button", onclick: () => openSignIn("register") }, "Create an account")));
  }
  if (health?.needs_setup) {
    view.append(h("section", { class: "panel gold section" },
      h("div", { class: "row between" },
        h("div", {}, h("h3", {}, "Welcome to Learnly"), h("p", { class: "muted", style: { margin: 0 } }, "Create the owner account first. It becomes the administrator for this computer.")),
        h("button", { class: "btn primary", onclick: () => openSignIn("register") }, "Create the owner account"))));
  }
  if (health && !health.ai.ok) {
    view.append(h("section", { class: "panel neon section" }, h("h3", {}, "Get your local AI running"), aiSetupSteps(health)));
  }

  view.append(h("section", { class: "grid two journeys section", "aria-label": "What you can do" }, JOURNEYS.map(journeyPanel)));

  if (store.can("study:use") || canSolve) {
    const today = h("section", { class: "panel today section", hidden: true, "aria-label": "Today" });
    view.append(today);
    todayPanel(today);
  } else if (!store.signedIn()) {
    view.append(h("section", { class: "panel section guest-cta" },
      h("div", { class: "row between" },
        h("div", {}, h("h3", {}, "Your work stays on this computer"), h("p", { class: "muted", style: { margin: 0 } },
          "Sign in to save your problems, notes, flashcards and quiz results. Nothing is sent to the internet.")),
        h("button", { class: "btn neon", type: "button", onclick: () => openSignIn() }, "Sign in"))));
  }
}
