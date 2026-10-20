// Central (中環): homework help. #/solve starts a new problem (snap a photo or type it);
// #/solve/<id> shows one problem: its steps, the AI tutor for any step, and practice problems like it.

import { openSignIn } from "../auth.js";
import { store } from "../store.js";
import { empty, h } from "../ui.js";
import { renderComposer } from "./solve-composer.js";
import { renderProblem } from "./solve-problem.js";

export async function render(view, ctx) {
  if (!store.can("solve:use")) {
    view.append(h("section", { class: "hero short" },
      h("p", { class: "kicker" }, "中環 Central"),
      h("h1", {}, "Solve a problem"),
      h("p", { class: "lede" }, "Snap a photo of a homework question or type it, and get clear steps, a tutor for any line, and practice problems.")));
    view.append(h("div", { class: "panel gold section" }, store.signedIn()
      ? empty("Not for this account", "Homework help is for student and administrator accounts.")
      : empty("Sign in to start", "Your problems are saved to your account on this computer.",
        h("button", { class: "btn primary", type: "button", onclick: () => openSignIn() }, store.health?.needs_setup ? "Create the owner account" : "Sign in"))));
    return;
  }
  const problemId = ctx.params[0];
  if (problemId) await renderProblem(view, ctx, problemId);
  else await renderComposer(view, ctx);
}
