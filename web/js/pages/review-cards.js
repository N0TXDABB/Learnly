// #/review/cards/<deck id | due>: one card at a time. Tap the card (or press Space) to flip it,
// then say how well you remembered: Again / Hard / Good / Easy (keys 1–4). Each button shows when
// the card will come back. Cards marked Again come round once more before the session ends.

import { api } from "../api.js";
import { markdownToHtml } from "../markdown.js";
import { clear, empty, h, notice, spinner, toast } from "../ui.js";

const GRADES = [
  { key: "again", label: "Again", hint: "Forgot" },
  { key: "hard", label: "Hard", hint: "Barely" },
  { key: "good", label: "Good", hint: "Remembered" },
  { key: "easy", label: "Easy", hint: "Instantly" },
];

function prose(markdown) {
  const el = h("div", { class: "prose" });
  el.innerHTML = markdownToHtml(markdown);
  return el;
}

export async function renderCards(view, { scenes, onCleanup, refreshHealth, navigate }, deckId) {
  const due = deckId === "due";
  const head = h("section", { class: "hero short" },
    h("p", { class: "kicker" }, "旺角 Mong Kok · Flashcards"),
    h("h1", { class: "doc-heading" }, due ? "Due today" : "Flashcards"));
  const body = h("div", { class: "section" }, spinner());
  view.append(head, body);

  async function load(all = false) {
    const query = new URLSearchParams({ limit: "50" });
    if (!due) query.set("material_id", deckId);
    if (all) query.set("all", "true");
    return api.get(`/study/cards/due?${query}`);
  }

  let data;
  try {
    data = await load();
  } catch (err) {
    clear(body).append(notice("bad", err.message, " ", h("a", { href: "#/review" }, "Back to Review")));
    return;
  }
  if (!due && data.cards[0]) head.querySelector("h1").textContent = data.cards[0].deck;
  if (!data.cards.length) {
    if (!due) {
      try {
        data = await load(true);
      } catch {
        data = { cards: [] };
      }
      if (data.cards[0]) head.querySelector("h1").textContent = data.cards[0].deck;
    }
    clear(body).append(h("div", { class: "panel gold" }, empty("Nothing due right now",
      due ? "Every card is scheduled for later. Come back tomorrow, or practise a deck anyway." : "These cards aren't due yet. You can still practise them now.",
      h("div", { class: "row", style: { justifyContent: "center" } },
        !due && data.cards.length ? h("button", { class: "btn primary", type: "button", onclick: () => start(data.cards, true) }, `Practise all ${data.cards.length} cards`) : null,
        h("a", { class: "btn", href: "#/review" }, "Back to Review")))));
    return;
  }
  start(data.cards, false);

  function start(cards, practice) {
    const queue = [...cards];
    const total = cards.length;
    const seen = new Set();
    const tally = { again: 0, hard: 0, good: 0, easy: 0 };
    let current = null;
    let flipped = false;
    let busy = false;

    const bar = h("span", { style: { width: "0%" } });
    const counter = h("span", { class: "small muted" });
    const front = h("div", { class: "face front" });
    const back = h("div", { class: "face back", "aria-hidden": "true" });
    const inner = h("div", { class: "inner" }, front, back);
    // A div rather than a <button>: Space and Enter are handled once, below, for the whole page.
    const card = h("div", { class: "flashcard", role: "button", tabindex: "0", "aria-label": "Flashcard: press Space to flip", onclick: () => flip() }, inner);
    const meta = h("div", { class: "small faint card-meta" });
    const hint = h("p", { class: "small muted flip-hint" }, "Tap the card or press Space to see the answer.");
    const live = h("div", { class: "sr-only", "aria-live": "polite" });
    const buttons = GRADES.map((g, i) => h("button", { class: `btn grade grade-${g.key}`, type: "button", dataset: { grade: g.key }, onclick: () => grade(g.key) },
      h("span", { class: "grade-key", "aria-hidden": "true" }, String(i + 1)),
      h("b", {}, g.label), h("span", { class: "grade-when small" })));
    const grades = h("div", { class: "grades", hidden: true }, buttons);

    clear(body).append(h("section", { class: "card-session" },
      h("div", { class: "row between" }, counter, practice ? h("span", { class: "tag" }, "Extra practice") : null),
      h("div", { class: "progress session-progress" }, bar),
      card, meta, hint, grades, live));

    function show() {
      current = queue.shift();
      flipped = false;
      card.classList.remove("flipped");
      back.setAttribute("aria-hidden", "true");
      front.removeAttribute("aria-hidden");
      clear(front).append(h("span", { class: "face-label" }, "Question"), prose(current.front));
      clear(back).append(h("span", { class: "face-label" }, "Answer"), prose(current.back));
      meta.textContent = [current.topic, current.source, due ? current.deck : ""].filter(Boolean).join(" · ");
      GRADES.forEach((g, i) => (buttons[i].querySelector(".grade-when").textContent = current.intervals?.[g.key] || ""));
      grades.hidden = true;
      hint.hidden = false;
      counter.textContent = `Card ${Math.min(seen.size + 1, total)} of ${total}`;
      bar.style.width = `${Math.round((seen.size / total) * 100)}%`;
      live.textContent = `Question: ${current.front}`;
      card.focus({ preventScroll: true });
    }

    function flip() {
      if (!current || busy) return;
      flipped = !flipped;
      card.classList.toggle("flipped", flipped);
      back.toggleAttribute("aria-hidden", !flipped);
      front.toggleAttribute("aria-hidden", flipped);
      if (flipped) {
        grades.hidden = false;
        hint.hidden = true;
        live.textContent = `Answer: ${current.back}. How well did you remember it? Press 1 to 4.`;
      }
    }

    async function grade(key) {
      if (!current || !flipped || busy) return;
      busy = true;
      buttons.forEach((b) => (b.disabled = true));
      try {
        const updated = await api.post(`/study/cards/${current.id}/review`, { grade: key });
        tally[key] += 1;
        seen.add(current.id);
        if (key === "good" || key === "easy") scenes.pulse("correct");
        // See it once more before the end, with its new box's labels ("Good · 1 day").
        if (key === "again") queue.push({ ...current, ...updated });
      } catch (err) {
        toast(err.message, "bad");
        busy = false;
        buttons.forEach((b) => (b.disabled = false));
        return;
      }
      busy = false;
      buttons.forEach((b) => (b.disabled = false));
      if (queue.length) show();
      else finish();
    }

    async function finish() {
      current = null;
      document.removeEventListener("keydown", onKey);
      bar.style.width = "100%";
      let overview = null;
      try {
        overview = await api.get("/study/overview");
        scenes.setData({ cardsMastered: overview.cards_mastered });
        refreshHealth?.();
      } catch {
        overview = null;
      }
      clear(body).append(h("section", { class: "panel gold session-summary" },
        h("h2", {}, "Session done"),
        h("p", { class: "lede" }, `You reviewed ${total} card${total === 1 ? "" : "s"}. Each one comes back when it's due.`),
        h("div", { class: "grid four section" }, GRADES.map((g) => h("div", { class: `panel stat grade-${g.key}` },
          h("div", { class: "label" }, g.label), h("div", { class: "value" }, String(tally[g.key]))))),
        overview ? h("p", { class: "muted section" }, `${overview.cards_mastered} of ${overview.cards_total} cards mastered · ${overview.cards_due} still due.`) : null,
        h("div", { class: "row section" },
          h("a", { class: "btn primary", href: "#/review" }, "Back to Review"),
          overview?.cards_due ? h("button", { class: "btn", type: "button", onclick: () => navigate("#/review/cards/due") }, "Keep going") : null)));
    }

    function onKey(e) {
      if (e.target.closest("input, textarea, select, dialog")) return;
      if (e.key === " " || e.key === "Enter") {
        if (e.target.closest("button, a")) return; // their own click happens
        e.preventDefault();
        flip();
      } else if (["1", "2", "3", "4"].includes(e.key) && flipped) {
        e.preventDefault();
        grade(GRADES[Number(e.key) - 1].key);
      }
    }
    document.addEventListener("keydown", onKey);
    onCleanup(() => document.removeEventListener("keydown", onKey));
    show();
  }
}
