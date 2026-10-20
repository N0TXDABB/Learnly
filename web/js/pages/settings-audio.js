// AI setup → Lecture recordings: speech-to-text for uploaded recordings. Whisper runs on this
// computer (faster-whisper, an optional install), so recordings never leave it.

import { api } from "../api.js";
import { store } from "../store.js";
import { clear, command, field, h, notice, spinner, toast } from "../ui.js";

const MODELS = [
  ["tiny", "Tiny · 75 MB · fastest, rough on accents and technical words"],
  ["base", "Base · 145 MB · fast, good for clear lectures (recommended)"],
  ["small", "Small · 480 MB · about 3× slower, noticeably more accurate"],
  ["medium", "Medium · 1.5 GB · slow on a laptop, very accurate"],
  ["large-v3", "Large · 3 GB · very slow without a graphics card, the most accurate"],
];

/** Draws the speech-to-text settings into `box`. ctx: { settings, save(changes, button), scenes }. */
export function renderAudioSettings(box, { settings, save, scenes }) {
  const statusBox = h("div", { class: "stack" }, h("p", { class: "row muted" }, spinner(), "Checking speech-to-text…"));
  const model = h("select", {}, MODELS.map(([value, label]) => h("option", { value }, label)));
  model.value = settings.whisper_model || "base";
  const log = h("div", { class: "board install-log", hidden: true, role: "log", "aria-live": "polite", "aria-label": "Install log" });

  box.replaceChildren(h("section", { class: "panel section audio-settings" },
    h("div", { class: "panel-title" }, h("h3", {}, "Lecture recordings"), h("span", { class: "zh muted" }, "講課錄音")),
    h("p", { class: "muted small" }, "Recordings uploaded on the Study page are turned into text on this computer with Whisper speech-to-text, "
      + "so they can be searched and made into outlines, flashcards and quizzes. The first recording also downloads the chosen model."),
    statusBox,
    log,
    h("div", { class: "grid two section" },
      field("Speech-to-text model", model, { hint: "Bigger models are more accurate but slower. A one-hour lecture takes roughly 5–15 minutes with Base on a laptop." }),
      h("div", { class: "row", style: { alignSelf: "center" } },
        h("button", { class: "btn primary", type: "button", onclick: (e) => save({ whisper_model: model.value }, e.currentTarget) }, "Save model")))));

  async function refresh() {
    let status;
    try {
      status = await api.get("/study/transcriber");
    } catch (err) {
      clear(statusBox).append(notice("bad", err.message));
      return;
    }
    clear(statusBox);
    if (status.available) {
      statusBox.append(h("div", { class: "row" }, h("span", { class: "tag green" }, "Installed ✓"), h("span", { class: "small muted" }, status.message)));
      return;
    }
    const install = h("button", { class: "btn neon", type: "button", disabled: status.installing, onclick: () => runInstall(install) },
      status.installing ? "Installing…" : "Install speech-to-text");
    statusBox.append(
      notice("warn", h("b", {}, "Not installed yet. "), "Recordings can still be uploaded; they wait until speech-to-text is installed."),
      store.can("admin:settings")
        ? h("div", { class: "row" }, install, h("span", { class: "small muted" }, "Downloads about 100 MB. Takes a few minutes."))
        : h("p", { class: "small muted" }, "Ask the administrator to install it here."),
      h("p", { class: "small faint" }, "Or in a terminal, in the Learnly folder:"),
      command("pip install -r requirements-audio.txt"));
  }

  async function runInstall(button) {
    button.disabled = true;
    button.textContent = "Installing…";
    log.hidden = false;
    clear(log);
    const line = (text, cls = "") => {
      log.append(h("div", { class: cls }, text));
      log.scrollTop = log.scrollHeight;
    };
    try {
      await api.stream("/study/transcriber/install", {}, (event, data) => {
        if (event === "log") {
          line(data.line, /error|failed/i.test(data.line) ? "warn" : /successfully/i.test(data.line) ? "ok" : "");
          scenes?.pulse("tokens");
        } else if (event === "done") {
          line(data.message, data.available ? "ok" : "warn");
          toast(data.message, data.available ? "good" : "bad");
        } else if (event === "error") {
          line(data.message, "warn");
        }
      });
    } catch (err) {
      line(err.message, "warn");
      toast(err.message, "bad");
    }
    refresh();
  }

  refresh();
}
