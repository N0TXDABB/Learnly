// Wan Chai: the tutor. Step-by-step answers with proper maths, from the model on this computer.

import { api } from "../api.js";
import { openSignIn } from "../auth.js";
import { imageFromTransfer, prepareImage } from "../images.js";
import { markdownToHtml } from "../markdown.js";
import { store } from "../store.js";
import { clear, empty, fmt, h, notice, svgIcon, toast } from "../ui.js";
import { aiSetupSteps } from "./home.js";

const STARTERS = [
  "Explain how to solve 2x² − 7x + 3 = 0 step by step.",
  "Why does the derivative of sin x equal cos x?",
  "Explain photosynthesis like I'm 15, then quiz me.",
  "How do I structure a DSE English argumentative essay?",
];

export async function render(view, { params, scenes, navigate, onCleanup }) {
  view.append(h("section", { class: "hero short" },
    h("p", { class: "kicker" }, "灣仔 Wan Chai"),
    h("h1", {}, "Your tutor"),
    h("p", { class: "lede" }, "Ask anything you're studying: maths, sciences, languages, humanities. It runs on your computer, so it works offline and your questions stay private.")));

  if (!store.signedIn()) {
    view.append(h("div", { class: "panel gold" }, empty("Sign in to start", "Tutor sessions are saved to your account on this computer.",
      h("button", { class: "btn primary", onclick: () => openSignIn() }, "Sign in"))));
    return;
  }

  let info;
  try {
    info = await api.get("/tutor/info");
  } catch (err) {
    view.append(notice("bad", err.message));
    return;
  }
  if (!info.ready) {
    view.append(h("section", { class: "panel neon" }, h("h3", {}, "The tutor needs the local AI"), h("p", { class: "muted" }, (info.issues || [])[0] || ""), aiSetupSteps(store.health)));
    return;
  }

  const sessionList = h("div", { class: "session-list" });
  const log = h("div", { class: "chat-log", "aria-live": "polite" });
  const text = h("textarea", { rows: 2, placeholder: "Ask a question, or paste a problem…", "aria-label": "Your question" });
  const think = h("input", { type: "checkbox" });
  const fileInput = h("input", { type: "file", accept: "image/*", hidden: true });
  const preview = h("div", { class: "row" });
  let imageB64 = null;
  const send = h("button", { class: "btn primary", type: "submit", "aria-label": "Send" }, svgIcon("send"), "Send");
  let sessionId = params[0] || null;
  let busy = false;
  let controller = null;
  onCleanup(() => {
    controller?.abort();
    scenes.setData({ tutorBusy: false });
  });

  const attach = async (file) => {
    if (!file) return;
    try {
      const photo = await prepareImage(file);
      imageB64 = photo.b64;
      clear(preview).append(h("img", { class: "thumb", src: photo.dataUrl, alt: "Attached photo" }),
        h("button", { class: "btn small", type: "button", onclick: () => { imageB64 = null; fileInput.value = ""; clear(preview); } }, "Remove"));
    } catch (err) {
      toast(err.message, "bad");
    }
  };
  fileInput.addEventListener("change", () => attach(fileInput.files[0]));
  if (info.vision) text.addEventListener("paste", (e) => {
    const file = imageFromTransfer(e.clipboardData);
    if (file) {
      e.preventDefault();
      attach(file);
    }
  });

  const composer = h("form", { class: "composer", onsubmit: (e) => { e.preventDefault(); ask(); } },
    h("div", {}, text, preview,
      h("div", { class: "row", style: { marginTop: "8px" } },
        info.thinking ? h("label", { class: "check small" }, think, "Think it through (slower, more careful)") : null,
        info.vision ? h("button", { class: "btn small", type: "button", onclick: () => fileInput.click() }, svgIcon("image"), "Photo of the question") : null,
        fileInput)),
    send);
  text.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      ask();
    }
  });

  view.append(h("section", { class: "grid sidebar-left" },
    h("aside", { class: "panel" },
      h("button", { class: "btn primary", style: { width: "100%" }, onclick: () => navigate("#/tutor") }, "New session"),
      h("div", { class: "section" }, sessionList),
      h("hr"),
      h("div", { class: "small muted" }, h("div", {}, h("b", {}, "Model: "), info.model),
        h("div", {}, h("b", {}, "Teaching style: "), info.prompt_label),
        info.prompt_source === "built-in" && store.can("admin:settings") ? h("div", { style: { marginTop: "6px" } }, "Have the OmniSolve prompt? ", h("a", { href: "#/settings" }, "Paste it in AI setup")) : null)),
    h("div", { class: "panel chat" }, log, composer)));

  async function loadSessions() {
    const list = await api.get("/tutor/sessions");
    clear(sessionList);
    if (!list.length) sessionList.append(h("p", { class: "muted small" }, "No sessions yet."));
    for (const s of list) {
      sessionList.append(h("button", { "aria-current": s.id === sessionId ? "true" : "false", onclick: () => navigate(`#/tutor/${s.id}`) },
        s.title, h("small", {}, `${s.messages} messages · ${fmt.ago(s.updated_at)}`)));
    }
  }

  function bubble(role, content, { hasImage = false } = {}) {
    const body = h("div", { class: role === "assistant" ? "prose" : "" });
    if (role === "assistant") body.innerHTML = markdownToHtml(content);
    else body.textContent = content;
    return h("div", { class: `msg ${role}` }, h("div", { class: "who" }, role === "assistant" ? "Tutor" : "You", hasImage ? " · photo" : ""), body);
  }

  async function loadMessages() {
    clear(log);
    if (!sessionId) {
      log.append(h("div", { class: "empty" }, h("div", { class: "display" }, "What shall we learn?"),
        h("div", { class: "chips", style: { justifyContent: "center", marginTop: "12px" } }, STARTERS.map((s) =>
          h("button", { class: "chip", type: "button", onclick: () => { text.value = s; text.focus(); } }, s)))));
      return;
    }
    try {
      const s = await api.get(`/tutor/sessions/${sessionId}`);
      for (const m of s.messages) log.append(bubble(m.role, m.content, { hasImage: !!m.has_image }));
      log.scrollTop = log.scrollHeight;
    } catch (err) {
      log.append(notice("bad", err.message));
    }
  }

  async function ask() {
    if (busy) return;
    const question = text.value.trim();
    if (!question && !imageB64) return;
    busy = true;
    send.disabled = true;
    if (!sessionId) {
      const s = await api.post("/tutor/sessions", { title: question.slice(0, 70) });
      sessionId = s.id;
      history.replaceState(null, "", `#/tutor/${sessionId}`);
      clear(log);
    }
    log.append(bubble("user", question || "(photo)", { hasImage: !!imageB64 }));
    const thinkingBox = h("pre", {});
    const details = h("details", { hidden: true }, h("summary", {}, "Reasoning"), thinkingBox);
    const body = h("div", { class: "prose cursor" });
    const msg = h("div", { class: "msg assistant" }, h("div", { class: "who" }, "Tutor"), details, body);
    log.append(msg);
    log.scrollTop = log.scrollHeight;
    const payload = { text: question, image_b64: imageB64, think: think.checked };
    text.value = "";
    imageB64 = null;
    fileInput.value = "";
    clear(preview);
    scenes.setData({ tutorBusy: true });
    scenes.pulse("ask");
    let answer = "";
    let pending = false;
    const paint = () => {
      pending = false;
      body.innerHTML = markdownToHtml(answer);
      log.scrollTop = log.scrollHeight;
    };
    controller = new AbortController();
    try {
      await api.stream(`/tutor/sessions/${sessionId}/messages`, payload, (event, data) => {
        if (event === "token") {
          answer += data.text;
          if (!pending) {
            pending = true;
            requestAnimationFrame(paint);
          }
        } else if (event === "thinking") {
          details.hidden = false;
          thinkingBox.textContent += data.text;
        } else if (event === "error") {
          body.append(notice("bad", data.message));
        } else if (event === "done") {
          scenes.pulse("answer");
        }
      }, { signal: controller.signal });
      paint();
    } catch (err) {
      if (err.name !== "AbortError") body.append(notice("bad", err.message));
    } finally {
      body.classList.remove("cursor");
      busy = false;
      send.disabled = false;
      scenes.setData({ tutorBusy: false });
      loadSessions();
    }
  }

  await Promise.all([loadSessions(), loadMessages()]);
  text.focus({ preventScroll: true });
}
