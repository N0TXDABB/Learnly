// Sign-in, account creation, two-step codes, and "confirm it's you" prompts.

import { api, ApiError } from "./api.js";
import { store } from "./store.js";
import { field, h, modal, toast } from "./ui.js";

function errorLine() {
  return h("div", { class: "field error", role: "alert", hidden: true });
}

function showError(el, err) {
  el.hidden = false;
  el.textContent = err instanceof ApiError ? err.message : String(err.message || err);
}

/** Opens the sign-in dialog. Resolves true when signed in. */
export function openSignIn(mode = "signin") {
  const firstRun = store.health?.needs_setup;
  if (firstRun) mode = "register";
  return modal((close) => {
    const wrap = h("div");
    const render = (which) => {
      wrap.replaceChildren(which === "register" ? registerForm(close, render, firstRun) : signInForm(close, render));
    };
    render(mode);
    return wrap;
  }, { label: "Sign in" });
}

function signInForm(close, switchTo) {
  const email = h("input", { type: "email", autocomplete: "username", required: true });
  const password = h("input", { type: "password", autocomplete: "current-password", required: true });
  const err = errorLine();
  const submit = h("button", { class: "btn primary big", type: "submit", style: { width: "100%" } }, "Sign in");
  const form = h("form", {
    onsubmit: async (e) => {
      e.preventDefault();
      submit.disabled = true;
      err.hidden = true;
      try {
        const data = await api.post("/auth/login", { email: email.value, password: password.value });
        if (data.mfa_required) {
          form.replaceWith(mfaForm(data.mfa_token, close));
          return;
        }
        finish(data, close);
      } catch (ex) {
        showError(err, ex);
      } finally {
        submit.disabled = false;
      }
    },
  },
  h("p", { class: "kicker" }, "歡迎回來 Welcome back"),
  h("h2", {}, "Sign in"),
  h("p", { class: "muted small" }, "Your account lives on this computer only."),
  field("Email", email),
  field("Password", password),
  err,
  submit,
  h("p", { class: "small muted", style: { marginTop: "14px" } }, "New here? ", h("a", { href: "#", onclick: (e) => { e.preventDefault(); switchTo("register"); } }, "Create an account")));
  return form;
}

function registerForm(close, switchTo, firstRun) {
  const name = h("input", { type: "text", autocomplete: "name" });
  const email = h("input", { type: "email", autocomplete: "username", required: true });
  const password = h("input", { type: "password", autocomplete: "new-password", required: true, minlength: 10 });
  const err = errorLine();
  const submit = h("button", { class: "btn primary big", type: "submit", style: { width: "100%" } }, firstRun ? "Create the owner account" : "Create account");
  return h("form", {
    onsubmit: async (e) => {
      e.preventDefault();
      submit.disabled = true;
      err.hidden = true;
      try {
        const data = await api.post("/auth/register", { email: email.value, password: password.value, full_name: name.value });
        finish(data, close);
        if (data.first_user) toast("You're the administrator of this Learnly. Welcome!", "good");
      } catch (ex) {
        showError(err, ex);
      } finally {
        submit.disabled = false;
      }
    },
  },
  h("p", { class: "kicker" }, firstRun ? "第一次使用 First run" : "新帳戶 New account"),
  h("h2", {}, firstRun ? "Set up Learnly" : "Create account"),
  h("p", { class: "muted small" }, firstRun
    ? "The first account on this computer becomes the administrator. Nothing is sent anywhere."
    : "Accounts are stored on this computer."),
  field("Your name", name),
  field("Email", email),
  field("Password", password, { hint: "At least 10 characters." }),
  err,
  submit,
  firstRun ? null : h("p", { class: "small muted", style: { marginTop: "14px" } }, "Already have an account? ", h("a", { href: "#", onclick: (e) => { e.preventDefault(); switchTo("signin"); } }, "Sign in")));
}

function mfaForm(token, close) {
  const code = h("input", { type: "text", inputmode: "numeric", autocomplete: "one-time-code", maxlength: 6, pattern: "\\d{6}", required: true, style: { fontSize: "26px", letterSpacing: "0.4em", textAlign: "center" } });
  const err = errorLine();
  const submit = h("button", { class: "btn primary big", type: "submit", style: { width: "100%" } }, "Verify");
  return h("form", {
    onsubmit: async (e) => {
      e.preventDefault();
      submit.disabled = true;
      try {
        finish(await api.post("/auth/mfa/verify", { mfa_token: token, code: code.value }), close);
      } catch (ex) {
        showError(err, ex);
        code.select();
      } finally {
        submit.disabled = false;
      }
    },
  },
  h("p", { class: "kicker" }, "雙重驗證 Two-step"),
  h("h2", {}, "Enter your code"),
  h("p", { class: "muted small" }, "Open your authenticator app and type the 6-digit code for Learnly."),
  field("Code", code), err, submit);
}

function finish(data, close) {
  store.set({ user: data.user, token: data.access_token, amr: data.amr || [] });
  close(true);
}

export async function requireSignIn() {
  if (store.signedIn()) return true;
  return !!(await openSignIn());
}

/**
 * Ask the user to confirm it's them (password or authenticator code).
 * Returns headers to send with the protected request, or null if cancelled.
 */
export function stepUp({ needOtp = false, reason = "Confirm it's you to continue." } = {}) {
  const mfa = store.user?.mfa_enabled;
  if (needOtp && !mfa) {
    toast("Turn on two-step sign-in in Account first.", "bad");
    return Promise.resolve(null);
  }
  return modal((close) => {
    const useCode = mfa;
    const input = useCode
      ? h("input", { type: "text", inputmode: "numeric", autocomplete: "one-time-code", maxlength: 6, required: true, style: { fontSize: "24px", letterSpacing: "0.4em", textAlign: "center" } })
      : h("input", { type: "password", autocomplete: "current-password", required: true });
    const err = errorLine();
    const submit = h("button", { class: "btn primary big", type: "submit", style: { width: "100%" } }, "Confirm");
    return h("form", {
      onsubmit: async (e) => {
        e.preventDefault();
        submit.disabled = true;
        try {
          const data = await api.post("/auth/step-up", useCode ? { code: input.value } : { password: input.value });
          close({ "X-Step-Up": data.step_up_token });
        } catch (ex) {
          showError(err, ex);
        } finally {
          submit.disabled = false;
        }
      },
    },
    h("p", { class: "kicker" }, "確認身份 Confirm"),
    h("h2", {}, "Is it you?"),
    h("p", { class: "muted small" }, reason),
    field(useCode ? "Code from your authenticator app" : "Your password", input),
    err, submit);
  }, { label: "Confirm it's you" });
}

export async function signOut() {
  try {
    await api.post("/auth/logout", {}, { headers: { "X-Requested-With": "learnly" } });
  } catch {
    /* signed out locally either way */
  }
  store.set({ user: null, token: null, amr: [] });
  toast("Signed out");
  location.hash = "#/";
}
