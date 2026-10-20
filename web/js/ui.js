// Small DOM helpers. Text always goes in through textContent, never as HTML.

// Pages build conditional content like `cond ? node : null`. The DOM's own append()
// would print "null", so make append()/prepend() skip empty values, as h() does.
for (const name of ["append", "prepend"]) {
  const native = Element.prototype[name];
  Element.prototype[name] = function (...nodes) {
    return native.apply(this, nodes.filter((n) => n !== null && n !== undefined && n !== false));
  };
}

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "style" && typeof value === "object") Object.assign(el.style, value);
    else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === "dataset") Object.assign(el.dataset, value);
    else if (value === true) el.setAttribute(key, "");
    else el.setAttribute(key, String(value));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function svgIcon(name) {
  const paths = {
    bell: "M12 22a2.5 2.5 0 0 0 2.4-2h-4.8A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5-6.7V3.5a2 2 0 1 0-4 0v.8A7 7 0 0 0 5 11v5l-2 2v1h18v-1Z",
    menu: "M3 6h18v2H3zm0 5h18v2H3zm0 5h18v2H3z",
    search: "M10 2a8 8 0 0 1 6.3 12.9l5.4 5.4-1.4 1.4-5.4-5.4A8 8 0 1 1 10 2Zm0 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12Z",
    copy: "M8 3h11a2 2 0 0 1 2 2v11h-2V5H8Zm-3 4h11a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Zm0 2v11h11V9Z",
    close: "M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4Z",
    send: "M3 20.5 21 12 3 3.5v6.6L15 12 3 13.9Z",
    image: "M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm1 2v8.6l4-4 3 3 2-2 5 5V7Zm11 1a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z",
    external: "M14 3h7v7h-2V6.4l-9.3 9.3-1.4-1.4L17.6 5H14ZM5 5h6v2H5v12h12v-6h2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z",
  };
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", paths[name] || "");
  path.setAttribute("fill", "currentColor");
  svg.append(path);
  return svg;
}

/** The Learnly mark: a gold IFC-style tower beside a Bank-of-China prism. */
export function logo() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 40 40");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = `
    <defs><linearGradient id="lg-g" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#F0D27A"/><stop offset="1" stop-color="#B8912A"/></linearGradient></defs>
    <rect x="1" y="1" width="38" height="38" rx="10" fill="#0D1630" stroke="#D4AF37" stroke-opacity=".5"/>
    <path d="M12 33V12l3-3 3 3v21z" fill="url(#lg-g)"/>
    <path d="M14.2 7.5v-3M15.8 7.5v-2" stroke="#F0D27A" stroke-width="1"/>
    <path d="M21 33V19l7-8v22z" fill="none" stroke="#00F0FF" stroke-width="1.6"/>
    <path d="M21 25l7-6M21 19l7 6M21 33l7-6M21 27l7 6" stroke="#00F0FF" stroke-width=".9" opacity=".8"/>
    <path d="M7 33h26" stroke="#D4AF37" stroke-width="1.4"/>`;
  return svg;
}

let toastRoot = null;
export function toast(message, kind = "") {
  toastRoot = toastRoot || document.getElementById("toasts");
  const el = h("div", { class: `toast ${kind}`, role: kind === "bad" ? "alert" : "status" }, message);
  toastRoot.append(el);
  setTimeout(() => el.remove(), kind === "bad" ? 7000 : 4200);
}

/** Open a dialog. `build(close)` returns its content. Resolves with the value passed to close(). */
export function modal(build, { label = "Dialog", wide = false } = {}) {
  return new Promise((resolve) => {
    // A fresh <dialog> each time, so a closing dialog's late "close" event can't shut the next one.
    const dialog = document.createElement("dialog");
    if (wide) dialog.style.width = "min(820px, calc(100vw - 32px))";
    dialog.setAttribute("aria-label", label);
    let done = false;
    const close = (value) => {
      if (done) return;
      done = true;
      resolve(value);
      if (dialog.open) dialog.close();
      dialog.remove();
    };
    const body = h("div", { class: "dialog-body" });
    const x = h("button", { class: "icon-btn close", "aria-label": "Close", onclick: () => close(undefined) }, svgIcon("close"));
    body.append(build(close));
    dialog.append(x, body);
    dialog.addEventListener("close", () => close(undefined)); // Escape key
    document.body.append(dialog);
    dialog.showModal();
    const first = body.querySelector("input, textarea, select, button.primary");
    first?.focus();
  });
}

export function field(labelText, input, { hint, id } = {}) {
  const inputId = id || input.id || `f-${Math.random().toString(36).slice(2, 9)}`;
  input.id = inputId;
  return h("div", { class: "field" }, h("label", { for: inputId }, labelText), input, hint ? h("div", { class: "hint" }, hint) : null);
}

export function spinner(label = "Loading") {
  return h("span", { class: "spinner", role: "status", "aria-label": label });
}

export function empty(title, text, action) {
  return h("div", { class: "empty" }, h("div", { class: "display" }, title), text ? h("p", {}, text) : null, action || null);
}

export function notice(kind, ...children) {
  return h("div", { class: `notice ${kind}` }, h("span", { class: `dot ${kind === "good" ? "ok" : kind === "bad" ? "bad" : "warn"}` }), h("div", {}, ...children));
}

export function copyButton(text) {
  return h("button", {
    class: "btn small",
    type: "button",
    onclick: async () => {
      try {
        await navigator.clipboard.writeText(text);
        toast("Copied");
      } catch {
        toast("Select the text and copy it", "bad");
      }
    },
  }, svgIcon("copy"), "Copy");
}

export function command(text) {
  return h("div", { class: "cmd" }, h("code", {}, text), copyButton(text));
}

export const fmt = {
  date(value) {
    if (!value) return "—";
    const d = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleDateString("en-HK", { year: "numeric", month: "short", day: "numeric" });
  },
  dateTime(value) {
    if (!value) return "—";
    const d = new Date(value);
    return d.toLocaleString("en-HK", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  },
  ago(value) {
    if (!value) return "";
    const s = (Date.now() - new Date(value).getTime()) / 1000;
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    return fmt.date(value);
  },
  number(n, digits = 0) {
    return Number(n).toLocaleString("en-HK", { maximumFractionDigits: digits, minimumFractionDigits: digits });
  },
  bytes(n) {
    if (!n) return "";
    const gb = n / 1e9;
    return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(n / 1e6)} MB`;
  },
};

export function statusTag(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  const kind = /ready|done|solved|graded|mastered/.test(lower) ? "green" : /failed|error/.test(lower) ? "red" : /queued|processing|generating|solving|grading|needs/.test(lower) ? "amber" : "";
  return h("span", { class: `tag ${kind}` }, text);
}

export function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export function initials(user) {
  const name = (user.full_name || user.email || "?").trim();
  const parts = name.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] || "?") + (parts[1]?.[0] || "")).toUpperCase();
}
