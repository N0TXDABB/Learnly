// Account: profile, two-step sign-in, password, and what each role may do.

import { api } from "../api.js";
import { openSignIn, signOut } from "../auth.js";
import { store } from "../store.js";
import { clear, empty, field, h, notice, spinner, toast } from "../ui.js";
import qrcode from "../../vendor/qrcode.mjs";

function qrSvg(text) {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const box = h("div", { class: "qr", role: "img", "aria-label": "QR code for your authenticator app" });
  box.innerHTML = qr.createSvgTag({ cellSize: 5, margin: 2, scalable: true }); // generated markup: only rectangles
  return box;
}

export async function render(view) {
  view.append(h("section", { class: "hero short" }, h("p", { class: "kicker" }, "帳戶 Account"), h("h1", {}, "Account & security")));
  if (!store.signedIn()) {
    view.append(h("div", { class: "panel" }, empty("You're not signed in", "", h("button", { class: "btn primary", onclick: () => openSignIn() }, "Sign in"))));
    return;
  }
  const u = store.user;
  const mfaBox = h("div");
  view.append(h("section", { class: "grid two" },
    h("div", { class: "panel gold" },
      h("h3", {}, u.full_name || u.email),
      h("p", { class: "muted" }, u.email),
      h("div", { class: "row" }, h("span", { class: "tag gold" }, u.role_label), h("span", { class: "tag" }, `${u.rate_limit_per_min} requests / minute`),
        store.amr.includes("otp") ? h("span", { class: "tag green" }, "Signed in with two-step code") : null),
      h("div", { class: "section" }, h("b", { class: "small" }, "You can:"), h("div", { class: "chips", style: { marginTop: "8px" } }, u.permissions.map((p) => h("span", { class: "tag" }, p)))),
      h("div", { class: "section" }, h("button", { class: "btn", onclick: () => signOut() }, "Sign out"))),
    h("div", { class: "panel" }, h("div", { class: "panel-title" }, h("h3", {}, "Two-step sign-in"), h("span", { class: "zh muted" }, "雙重驗證")), mfaBox)));

  function drawMfa() {
    clear(mfaBox);
    if (store.user.mfa_enabled) {
      const code = h("input", { type: "text", inputmode: "numeric", maxlength: 6, placeholder: "Current code" });
      mfaBox.append(notice("good", "On. Signing in asks for a code from your authenticator app."),
        h("form", { class: "row section", onsubmit: async (e) => {
          e.preventDefault();
          try {
            const data = await api.post("/auth/mfa/disable", { code: code.value });
            store.set({ user: data.user });
            toast("Two-step sign-in turned off");
            drawMfa();
          } catch (err) {
            toast(err.message, "bad");
          }
        } }, h("div", { style: { flex: 1 } }, code), h("button", { class: "btn danger", type: "submit" }, "Turn off")));
      return;
    }
    mfaBox.append(h("p", { class: "muted" }, "Use any authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…). Administrators need it to change people's roles."),
      h("button", { class: "btn primary", onclick: async (e) => {
        e.currentTarget.disabled = true;
        try {
          const setup = await api.post("/auth/mfa/setup");
          const code = h("input", { type: "text", inputmode: "numeric", autocomplete: "one-time-code", maxlength: 6, required: true, style: { fontSize: "22px", letterSpacing: "0.3em" } });
          clear(mfaBox).append(
            h("ol", { class: "steps" },
              h("li", {}, "Scan this with your authenticator app:", h("div", { class: "section" }, qrSvg(setup.otpauth_uri)),
                h("div", { class: "small muted" }, "Can't scan? Enter this key: ", h("code", { class: "mono" }, setup.secret))),
              h("li", {}, "Type the 6-digit code it shows:", h("form", { class: "row section", onsubmit: async (ev) => {
                ev.preventDefault();
                try {
                  const data = await api.post("/auth/mfa/enable", { code: code.value });
                  store.set({ user: data.user, token: data.access_token || store.token, amr: data.amr });
                  toast("Two-step sign-in is on", "good");
                  drawMfa();
                } catch (err) {
                  toast(err.message, "bad");
                }
              } }, h("div", { style: { flex: 1 } }, code), h("button", { class: "btn primary", type: "submit" }, "Turn on")))));
        } catch (err) {
          toast(err.message, "bad");
        }
      } }, "Set up two-step sign-in"));
  }
  drawMfa();

  const current = h("input", { type: "password", autocomplete: "current-password" });
  const next = h("input", { type: "password", autocomplete: "new-password", minlength: 10 });
  view.append(h("section", { class: "grid two section" },
    h("form", { class: "panel", onsubmit: async (e) => {
      e.preventDefault();
      try {
        await api.post("/auth/password", { current_password: current.value, new_password: next.value });
        toast("Password changed. Other sessions were signed out.", "good");
        current.value = next.value = "";
      } catch (err) {
        toast(err.message, "bad");
      }
    } }, h("h3", {}, "Change password"), field("Current password", current), field("New password", next, { hint: "At least 10 characters" }), h("button", { class: "btn primary", type: "submit" }, "Change password")),
    roleMatrix()));
}

function roleMatrix() {
  const box = h("div", { class: "panel" }, h("h3", {}, "Who can do what"), spinner());
  api.get("/auth/roles").then((data) => {
    box.lastChild.remove();
    const roles = data.roles;
    box.append(h("p", { class: "small muted" }, "★ also needs an authenticator code."),
      h("div", { class: "table-wrap" }, h("table", {},
        h("tr", {}, h("th", {}, "Permission"), roles.map((r) => h("th", { class: "num" }, r.label))),
        h("tr", {}, h("td", { class: "muted small" }, "requests / min"), roles.map((r) => h("td", { class: "num small" }, r.rate_limit_per_min))),
        data.matrix.map((row) => h("tr", {}, h("td", { class: "mono small" }, row.permission, row.mfa ? " ★" : ""),
          roles.map((r) => h("td", { class: "num", style: { color: row[r.role] ? "var(--green)" : "var(--faint)" } }, row[r.role] ? "●" : "·")))))));
  }).catch((err) => box.append(notice("bad", err.message)));
  return box;
}
