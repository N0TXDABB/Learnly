// Central: the "new problem" composer. Snap a photo (camera on phones), choose a picture, paste a
// screenshot or drop one, or type the problem. A photo is read by the AI first, and the student
// checks the text before solving, because small models sometimes misread a digit.

import { api } from "../api.js";
import { imageFromTransfer, prepareImage } from "../images.js";
import { markdownToHtml } from "../markdown.js";
import { store } from "../store.js";
import { clear, debounce, field, fmt, h, notice, spinner, statusTag, svgIcon, toast } from "../ui.js";
import { aiSetupSteps } from "./home.js";

// A photo picked on the Home page, waiting to be read here.
let handedOff = null;

/** Called by the Home page: open #/solve and read this photo there. */
export function handOffPhoto(file) {
  handedOff = file;
}

function takeHandOff() {
  const file = handedOff;
  handedOff = null;
  return file;
}

/** Hidden file inputs plus the two buttons that open them: the camera (phones) and the file picker. */
export function photoButtons(onFile, { disabled = false, small = false } = {}) {
  const make = (label, capture) => {
    const input = h("input", { type: "file", accept: "image/*", capture: capture ? "environment" : null, hidden: true, "aria-label": label, tabindex: "-1" });
    input.addEventListener("change", () => {
      const file = input.files[0];
      input.value = "";
      if (file) onFile(file);
    });
    return input;
  };
  const camera = make("Take a photo of the question", true);
  const chooser = make("Choose a photo of the question", false);
  const cls = `btn${small ? " small" : ""}`;
  return [
    h("button", { class: `${cls} neon`, type: "button", disabled, onclick: () => camera.click() }, svgIcon("image"), "Snap a photo"),
    h("button", { class: cls, type: "button", disabled, onclick: () => chooser.click() }, "Choose a picture"),
    camera,
    chooser,
  ];
}

/** The question as a short plain line for lists ($ signs and LaTeX backslashes removed). */
export function plainQuestion(text, max = 110) {
  const line = String(text || "").replace(/\$+/g, "").replace(/\\(?:frac|dfrac)\{([^{}]*)\}\{([^{}]*)\}/g, "$1/$2")
    .replace(/\\[a-zA-Z]+/g, " ").replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** Fill `box` with the student's recent problems. */
export async function loadRecent(box, currentId = null) {
  clear(box).append(h("h3", {}, "Recent problems"), spinner("Loading recent problems"));
  let list;
  try {
    list = await api.get("/problems?limit=12");
  } catch (err) {
    clear(box).append(h("h3", {}, "Recent problems"), h("p", { class: "muted small" }, err.message));
    return;
  }
  clear(box).append(h("h3", {}, "Recent problems"));
  if (!list.length) {
    box.append(h("p", { class: "muted small" }, "Problems you solve will appear here, so you can come back to them."));
    return;
  }
  box.append(h("ul", { class: "recent-list" }, list.map((p) => h("li", {},
    h("a", { href: `#/solve/${p.id}`, "aria-current": p.id === currentId ? "page" : null },
      h("span", { class: "q" }, plainQuestion(p.question) || "(photo)"),
      h("span", { class: "meta" }, statusTag(p.status), p.has_image ? h("span", { class: "tag" }, "photo") : null,
        p.source === "practice" ? h("span", { class: "tag gold" }, "practice") : null, h("span", {}, fmt.ago(p.created_at))))))));
}

/**
 * "Reading your photo… 12 s": a message for screen readers plus a counter that only sighted users see
 * (announcing every second would drown everything else out). Returns {el, stop()}.
 */
export function ticker(message) {
  const clock = h("span", { class: "clock", "aria-hidden": "true" });
  const started = Date.now();
  const tick = () => {
    clock.textContent = ` ${Math.round((Date.now() - started) / 1000)} s`;
  };
  tick();
  const id = setInterval(tick, 1000);
  return { el: h("span", {}, message, clock), stop: () => clearInterval(id) };
}

export async function renderComposer(view, { navigate, scenes, onCleanup }) {
  scenes.pulse("reset");
  const health = store.health;
  const ai = health?.ai || {};
  view.append(h("section", { class: "hero short" },
    h("p", { class: "kicker" }, "中環 Central"),
    h("h1", {}, "Solve a problem"),
    h("p", { class: "lede" }, "Snap a photo of the question or type it in. You get clear steps, an AI tutor for any line you're stuck on, and practice problems to check you've got it.")));

  if (health && !ai.ok) {
    view.append(h("section", { class: "panel neon section" },
      h("h3", {}, "The AI isn't ready yet"),
      ai.issues?.[0] ? h("p", { class: "muted" }, ai.issues[0]) : null,
      aiSetupSteps(health),
      h("p", { class: "small muted section" }, "You can type the problem now. It's solved as soon as the AI is running.")));
  }

  const vision = !!ai.vision;
  let photo = null; // { b64, dataUrl } once a photo is chosen
  let found = { subject: "", topic: "" };
  let reading = 0; // increases with every photo, so a slow read of an old photo is ignored

  const title = h("h2", { class: "composer-title" }, "What's the question?");
  const subtitle = h("p", { class: "muted", style: { margin: "6px 0 0" } }, "Snap it or type it. Both work.");
  const text = h("textarea", { rows: 5, maxlength: 8000, placeholder: "Type or paste the problem, e.g. Solve x^2 - 5x + 6 = 0", class: "question-input" });
  // LaTeX from a photo ($x^2$) is hard to check by eye, so show how it will look
  const previewBody = h("div", { class: "prose" });
  const preview = h("div", { class: "question-preview", hidden: true }, h("span", { class: "small muted" }, "How it looks"), previewBody);
  const drawPreview = () => {
    const maths = /[$\\]/.test(text.value);
    preview.hidden = !maths;
    if (maths) previewBody.innerHTML = markdownToHtml(text.value);
  };
  text.addEventListener("input", debounce(drawPreview, 250));
  const think = h("input", { type: "checkbox" });
  const solveButton = h("button", { class: "btn primary big", type: "submit" }, "Solve step by step");
  const error = h("div", { class: "field error", role: "alert", hidden: true });
  const photoImg = h("img", { alt: "Your photo of the question" });
  const photoStatus = h("div", { class: "photo-status", "aria-live": "polite" });
  const photoBox = h("figure", { class: "photo-preview", hidden: true }, photoImg, h("figcaption", {}, photoStatus,
    h("button", { class: "btn small", type: "button", onclick: () => removePhoto() }, "Remove photo")));

  const picker = h("div", { class: "photo-picker" },
    h("div", { class: "picker-text" }, h("b", {}, "Snap a photo"),
      h("span", { class: "small muted" }, vision ? "Use your phone's camera, choose a picture, paste a screenshot (Ctrl+V) or drop it here."
        : "Reading photos needs a model that can see.")),
    h("div", { class: "row" }, photoButtons(usePhoto, { disabled: !vision })),
    !vision && health ? notice("warn", `${ai.chat_model || "This AI model"} can't read photos, so type the question instead. `,
      h("a", { href: "#/settings" }, "Install a model that can")) : null);

  const card = h("form", { class: "panel gold composer-card", novalidate: true, onsubmit: (e) => { e.preventDefault(); submit(); } },
    h("div", {}, title, subtitle),
    picker,
    h("div", { class: "or-line", "aria-hidden": "true" }, h("span", {}, "or type it")),
    h("div", { class: "question-area" }, photoBox,
      h("div", {}, field("The question", text, { hint: "Maths can be typed plainly: x^2 - 5x + 6 = 0, sqrt(2), 3/4. Ctrl+Enter solves." }), preview)),
    error,
    h("div", { class: "row composer-actions" },
      ai.thinking ? h("label", { class: "check small" }, think, "Think it through (slower, more careful)") : null,
      h("span", { class: "spacer" }), solveButton));

  const recent = h("aside", { class: "panel recent-problems" });
  view.append(h("section", { class: "grid sidebar solve-layout section" }, card, recent));
  loadRecent(recent);

  text.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submit();
    }
  });

  // paste a screenshot anywhere on the page, or drop a picture on the card
  const onPaste = (e) => {
    const file = imageFromTransfer(e.clipboardData);
    if (!file) return;
    e.preventDefault();
    if (vision) usePhoto(file);
    else toast("This AI model can't read photos. Type the question instead.", "bad");
  };
  window.addEventListener("paste", onPaste);
  onCleanup(() => window.removeEventListener("paste", onPaste));
  card.addEventListener("dragover", (e) => {
    if (!vision || ![...(e.dataTransfer?.types || [])].includes("Files")) return;
    e.preventDefault();
    card.classList.add("dragging");
  });
  card.addEventListener("dragleave", (e) => {
    if (!card.contains(e.relatedTarget)) card.classList.remove("dragging");
  });
  card.addEventListener("drop", (e) => {
    card.classList.remove("dragging");
    const file = imageFromTransfer(e.dataTransfer);
    if (!file) return;
    e.preventDefault();
    usePhoto(file);
  });

  function setBusy(busy) {
    text.disabled = busy;
    solveButton.disabled = busy;
  }

  function removePhoto() {
    reading++; // a read still running for this photo is now ignored, so stop its scanning beam here
    scenes.pulse("reset");
    photo = null;
    found = { subject: "", topic: "" };
    card.classList.remove("has-photo");
    photoBox.hidden = true;
    title.textContent = "What's the question?";
    subtitle.textContent = "Snap it or type it. Both work.";
    setBusy(false);
  }

  async function usePhoto(file) {
    if (!vision) return;
    let prepared;
    try {
      prepared = await prepareImage(file);
    } catch (err) {
      toast(err.message, "bad");
      return;
    }
    const mine = ++reading;
    photo = prepared;
    card.classList.add("has-photo");
    photoBox.hidden = false;
    photoImg.src = prepared.dataUrl;
    title.textContent = "Reading your photo…";
    subtitle.textContent = "The AI is copying out the question. On a laptop this takes 10–60 seconds.";
    error.hidden = true;
    setBusy(true);
    const timer = ticker("Reading your photo…");
    clear(photoStatus).append(h("span", { class: "row", style: { gap: "8px" } }, spinner("Reading your photo"), timer.el));
    scenes.pulse("solve");
    try {
      const data = await api.post("/problems/read-photo", { image_b64: prepared.b64 });
      if (mine !== reading) return;
      found = { subject: data.subject || "", topic: data.topic || "" };
      if (data.question) text.value = data.question;
      drawPreview();
      title.textContent = "Check the question is right, then solve";
      subtitle.textContent = "Fix anything the AI misread: a wrong digit gives a wrong answer.";
      clear(photoStatus).append(data.readable
        ? h("span", { class: "tag green" }, "Read it ✓")
        : notice("warn", data.note || "I couldn't read it clearly. Type the question, or try a closer photo."));
    } catch (err) {
      if (mine !== reading) return;
      title.textContent = "Type the question";
      subtitle.textContent = "The photo couldn't be read, but it's kept with your question.";
      clear(photoStatus).append(notice("bad", err.message));
    } finally {
      timer.stop();
      if (mine === reading) {
        setBusy(false);
        scenes.pulse("reset");
        text.focus();
      }
    }
  }

  async function submit() {
    const question = text.value.trim();
    if (!question) {
      error.hidden = false;
      error.textContent = photo ? "Wait for the photo to be read, or type the question." : "Type the question, or snap a photo of it.";
      text.focus();
      return;
    }
    error.hidden = true;
    setBusy(true);
    try {
      const created = await api.post("/problems", {
        question, image_b64: photo?.b64 || null, source: photo ? "photo" : "text", subject: found.subject, topic: found.topic,
      });
      navigate(`#/solve/${created.id}?auto=1${think.checked ? "&think=1" : ""}`);
    } catch (err) {
      error.hidden = false;
      error.textContent = err.message;
      setBusy(false);
    }
  }

  const pending = takeHandOff();
  if (pending) usePhoto(pending);
  else text.focus({ preventScroll: true });
}
