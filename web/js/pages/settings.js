// Tsing Ma Bridge: connecting the website to the AI on this computer, and other settings.

import { api } from "../api.js";
import { openSignIn } from "../auth.js";
import { store } from "../store.js";
import { clear, command, field, fmt, h, notice, spinner, toast } from "../ui.js";
import { aiSetupSteps } from "./home.js";
import { renderAudioSettings } from "./settings-audio.js";

const SUGGESTED = [
  ["qwen3.5:4b", "Recommended · 3.4 GB · reads photos of questions and notes"],
  ["qwen3.5:9b", "Stronger at maths · 6.6 GB · 16 GB RAM or a GPU"],
  ["qwen3.5:2b", "For older laptops · 2.7 GB · reads photos"],
  ["qwen3:4b", "Text only · 2.5 GB · for older Ollama versions"],
];

export async function render(view, { scenes, refreshHealth }) {
  view.append(h("section", { class: "hero short" },
    h("p", { class: "kicker" }, "青馬大橋 Tsing Ma Bridge"),
    h("h1", {}, "AI setup"),
    h("p", { class: "lede" }, "The bridge between this website and the AI on your computer. When the model is working, traffic flows across the bridge.")));

  const statusBox = h("div", { class: "section" });
  view.append(statusBox);

  function drawStatus() {
    const ai = store.health?.ai;
    if (!ai) return;
    scenes.setData({ aiOk: ai.ok });
    clear(statusBox).append(h("div", { class: "grid three" },
      h("div", { class: "panel stat" }, h("div", { class: "label" }, "Connection"),
        h("div", { class: "row", style: { marginTop: "6px" } }, h("span", { class: `dot ${ai.ok ? "ok" : ai.reachable ? "warn" : "bad"}` }), h("b", {}, ai.reachable ? `${ai.provider === "ollama" ? "Ollama" : "OpenAI-compatible server"} ${ai.version && ai.version !== "openai-compatible" ? ai.version : ""}` : "Not reachable")),
        h("div", { class: "sub mono" }, ai.base_url)),
      h("div", { class: "panel stat" }, h("div", { class: "label" }, "Model"), h("div", { class: "value gold", style: { fontSize: "26px" } }, ai.chat_model || "—"),
        h("div", { class: "sub" }, ai.chat_model ? "solves, explains, writes flashcards and quizzes" : "install one below")),
      h("div", { class: "panel stat" }, h("div", { class: "label" }, "Can it…"),
        h("div", { class: "row", style: { marginTop: "6px", flexWrap: "wrap" } },
          h("span", { class: `tag ${ai.vision ? "green" : ""}` }, ai.vision ? "Read photos ✓" : "Read photos ✗"),
          h("span", { class: `tag ${ai.thinking ? "green" : ""}` }, ai.thinking ? "Think it through ✓" : "Think it through ✗")),
        h("div", { class: "sub" }, ai.vision ? "Photos of questions and notes work" : "Type questions, or install a model that reads photos"))),
      ai.issues?.length ? h("div", { class: "stack section" }, ai.issues.map((i) => notice("warn", i))) : null);
  }
  drawStatus();

  if (!store.can("admin:settings")) {
    view.append(h("section", { class: "panel neon section" }, h("h3", {}, "Set up the local AI"), aiSetupSteps(store.health),
      h("p", { class: "muted small section" }, store.signedIn() ? "Only the administrator can change these settings." : h("span", {}, h("a", { href: "#", onclick: (e) => { e.preventDefault(); openSignIn(); } }, "Sign in"), " as the administrator to change settings."))));
    return;
  }

  let settings;
  let models = { models: [] };
  try {
    [settings, models] = await Promise.all([api.get("/admin/settings"), api.get("/ai/models").catch(() => ({ models: [] }))]);
  } catch (err) {
    view.append(notice("bad", err.message));
    return;
  }

  // -- local AI -------------------------------------------------------------------
  const provider = h("select", {}, h("option", { value: "ollama" }, "Ollama"), h("option", { value: "openai" }, "LM Studio, llama.cpp, Jan or another OpenAI-compatible server"));
  provider.value = settings.ai_provider;
  const baseUrl = h("input", { type: "url", value: settings.ai_base_url });
  provider.addEventListener("change", () => {
    baseUrl.value = provider.value === "ollama" ? "http://127.0.0.1:11434" : "http://127.0.0.1:1234/v1";
  });
  const modelOptions = (kind, current) => {
    const select = h("select", {}, h("option", { value: "" }, "Automatic (best installed)"));
    for (const m of models.models.filter((x) => x.kind === kind)) select.append(h("option", { value: m.name }, `${m.name}${m.size ? ` · ${fmt.bytes(m.size)}` : ""}`));
    if (current && ![...select.options].some((o) => o.value === current)) select.append(h("option", { value: current }, `${current} (not installed)`));
    select.value = current || "";
    return select;
  };
  const chatModel = modelOptions("chat", settings.chat_model);
  const timeout = h("input", { type: "number", min: 10, max: 1800, value: settings.ai_timeout_s });
  const testOut = h("div");

  const save = async (changes, button) => {
    button && (button.disabled = true);
    try {
      await api.put("/admin/settings", { changes });
      toast("Saved", "good");
      await refreshHealth();
      drawStatus();
    } catch (err) {
      toast(err.message, "bad");
    } finally {
      button && (button.disabled = false);
    }
  };

  view.append(h("section", { class: "panel gold section" },
    h("div", { class: "panel-title" }, h("h3", {}, "Local AI"), h("span", { class: "zh muted" }, "本機人工智能")),
    h("div", { class: "grid two" },
      field("AI app", provider, { hint: "Ollama is easiest. LM Studio works too: turn on its local server." }),
      field("Address", baseUrl, { hint: "Ollama: http://127.0.0.1:11434 · LM Studio: http://127.0.0.1:1234/v1" }),
      field("Model", chatModel, { hint: "Solutions, explanations, flashcards, quizzes and the tutor" }),
      field("Wait up to (seconds)", timeout, { hint: "Slow computers need longer" })),
    h("div", { class: "row" },
      h("button", { class: "btn primary", onclick: (e) => save({ ai_provider: provider.value, ai_base_url: baseUrl.value, chat_model: chatModel.value, ai_timeout_s: Number(timeout.value) }, e.currentTarget) }, "Save"),
      h("button", { class: "btn neon", onclick: async (e) => {
        const b = e.currentTarget;
        b.disabled = true;
        clear(testOut).append(h("div", { class: "section" }, spinner(), " Testing the bridge…"));
        try {
          const r = await api.post("/admin/ai/test");
          scenes.pulse("ai");
          clear(testOut).append(h("div", { class: "stack section" },
            r.chat ? notice(r.chat.ok ? "good" : "bad", r.chat.ok ? `${r.chat.model} answered “${r.chat.reply}” in ${r.chat.seconds} s.` : `The model failed: ${r.chat.error}`) : notice("warn", "No model to test yet.")));
          await refreshHealth();
          drawStatus();
        } catch (err) {
          clear(testOut).append(h("div", { class: "section" }, notice("bad", err.message)));
        } finally {
          b.disabled = false;
        }
      } }, "Test connection")),
    testOut));

  // -- model downloads ----------------------------------------------------------------
  if (settings.ai_provider === "ollama") {
    const name = h("input", { type: "text", placeholder: "e.g. qwen3.5:4b", "aria-label": "Model to download" });
    const bar = h("div", { class: "progress", hidden: true }, h("span", { style: { width: "0%" } }));
    const status = h("div", { class: "small muted" });
    const download = async (model) => {
      bar.hidden = false;
      status.textContent = `Starting ${model}…`;
      try {
        await api.stream("/admin/ai/pull", { model }, (event, data) => {
          if (event === "progress") {
            if (data.total && data.completed) bar.firstChild.style.width = `${Math.round((data.completed / data.total) * 100)}%`;
            status.textContent = `${data.status}${data.total ? ` · ${fmt.bytes(data.completed || 0)} of ${fmt.bytes(data.total)}` : ""}`;
            scenes.pulse("tokens");
          } else if (event === "done") {
            status.textContent = `${model} is ready.`;
            toast(`${model} downloaded`, "good");
          } else if (event === "error") {
            status.textContent = data.message;
          }
        });
        await refreshHealth();
        drawStatus();
      } catch (err) {
        status.textContent = err.message;
      }
    };
    view.append(h("section", { class: "panel section" },
      h("div", { class: "panel-title" }, h("h3", {}, "Download models"), h("span", { class: "zh muted" }, "下載模型")),
      h("p", { class: "muted small" }, "Downloads through Ollama on this computer. Pick by your computer's memory: 8 GB RAM → 4b or smaller, 16 GB+ → 9b."),
      h("div", { class: "stack" }, SUGGESTED.map(([m, why]) => h("div", { class: "row between" },
        h("div", {}, h("b", { class: "mono" }, m), h("div", { class: "small muted" }, why)),
        models.models.some((x) => x.name === m) ? h("span", { class: "tag green" }, "Installed") : h("button", { class: "btn small", onclick: () => download(m) }, "Download")))),
      h("form", { class: "row section", onsubmit: (e) => { e.preventDefault(); if (name.value.trim()) download(name.value.trim()); } },
        h("div", { style: { flex: 1 } }, name), h("button", { class: "btn", type: "submit" }, "Download")),
      bar, status,
      h("p", { class: "small faint section" }, "Or in a terminal:"), command("ollama pull qwen3.5:4b")));
  }

  // -- tutor prompt -----------------------------------------------------------------------------
  const prompt = h("textarea", { rows: 9, placeholder: "Paste the OmniSolve tutor prompt here (leave empty to use docs/source/omnisolve-tutor-prompt.txt or the built-in prompt)." });
  prompt.value = settings.tutor_prompt || "";
  view.append(h("section", { class: "panel section" },
    h("div", { class: "panel-title" }, h("h3", {}, "Tutor prompt"), h("span", { class: "zh muted" }, "導師提示")),
    h("p", { class: "muted small" }, "This is how the tutor teaches. A short note about maths formatting is always added so formulas display properly."),
    prompt,
    h("div", { class: "row section" }, h("button", { class: "btn primary", onclick: (e) => save({ tutor_prompt: prompt.value }, e.currentTarget) }, "Save prompt"), h("span", { class: "small muted" }, `${prompt.value.length} characters`))));

  // -- lecture recordings (speech to text) ---------------------------------------------------------
  const audioBox = h("div");
  view.append(audioBox);
  renderAudioSettings(audioBox, { settings, save, scenes });

  // -- security ---------------------------------------------------------------------------------------
  const mfa = h("input", { type: "checkbox", checked: !!settings.require_admin_mfa });
  const maxUpload = h("input", { type: "number", min: 1, max: 500, value: settings.max_upload_mb });
  view.append(h("section", { class: "grid two section" },
    h("div", { class: "panel" }, h("h3", {}, "Uploads"),
      field("Largest document (MB)", maxUpload, { hint: "Lecture recordings may be up to 10 times this" }),
      h("button", { class: "btn primary", onclick: (e) => save({ max_upload_mb: Number(maxUpload.value) }, e.currentTarget) }, "Save")),
    h("div", { class: "panel" }, h("h3", {}, "Security"),
      h("label", { class: "check" }, mfa, "Require an authenticator code for role changes"),
      h("p", { class: "small muted" }, "Recommended. Set up two-step sign-in in Account first."),
      h("button", { class: "btn primary", onclick: (e) => save({ require_admin_mfa: mfa.checked }, e.currentTarget) }, "Save"))));
}
