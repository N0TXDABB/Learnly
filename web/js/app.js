// Learnly shell: navigation, sign-in state, status polling, and the page router.

import { api, refreshSession } from "./api.js";
import { openSignIn, signOut } from "./auth.js";
import { central } from "./scenes/central.js";
import { SceneManager } from "./scenes/engine.js";
import { harbour } from "./scenes/harbour.js";
import { mongkok } from "./scenes/mongkok.js";
import { peak } from "./scenes/peak.js";
import { tsingma } from "./scenes/tsingma.js";
import { wanchai } from "./scenes/wanchai.js";
import { store } from "./store.js";
import { clear, fmt, h, initials, logo, svgIcon, toast } from "./ui.js";

const scenes = new SceneManager(document.getElementById("scene"));
scenes.register("harbour", harbour);
scenes.register("central", central);
scenes.register("peak", peak);
scenes.register("wanchai", wanchai);
scenes.register("mongkok", mongkok);
scenes.register("tsingma", tsingma);
window.__scenes = scenes;

const NAV = [
  { key: "home", href: "#/", en: "Home", zh: "維港", district: "Victoria Harbour" },
  { key: "solve", href: "#/solve", en: "Solve", zh: "中環", district: "Central" },
  { key: "study", href: "#/study", en: "Study", zh: "山頂", district: "The Peak" },
  { key: "review", href: "#/review", en: "Review", zh: "旺角", district: "Mong Kok" },
  { key: "tutor", href: "#/tutor", en: "Tutor", zh: "灣仔", district: "Wan Chai" },
  { key: "settings", href: "#/settings", en: "AI setup", zh: "青馬", district: "Tsing Ma Bridge" },
  { key: "admin", href: "#/admin", en: "Admin", zh: "金鐘", district: "Admiralty", show: () => store.can("admin:read") },
];

// params passed to a page are the regex groups, in order.
const ROUTES = [
  { re: /^\/?$/, page: "home", scene: "harbour", nav: "home" },
  // #/solve (new problem) · #/solve/<problem id>
  { re: /^\/solve(?:\/([\w-]+))?$/, page: "solve", scene: "central", nav: "solve" },
  // #/study (documents and material) · #/study/doc/<id> · #/study/material/<id>
  { re: /^\/study(?:\/(doc|material)\/([\w-]+))?$/, page: "study", scene: "peak", nav: "study" },
  // #/review (due cards, quizzes, weak topics) · #/review/cards/<material id or "due"> · #/review/quiz/<material id> · #/review/attempt/<attempt id>
  { re: /^\/review(?:\/(cards|quiz|attempt)\/([\w-]+))?$/, page: "review", scene: "mongkok", nav: "review" },
  { re: /^\/tutor(?:\/([\w-]+))?$/, page: "tutor", scene: "wanchai", nav: "tutor" },
  { re: /^\/settings$/, page: "settings", scene: "tsingma", nav: "settings" },
  { re: /^\/admin$/, page: "admin", scene: "tsingma", nav: "admin" },
  { re: /^\/account$/, page: "account", scene: "harbour", variant: "night", nav: null },
];

const main = document.getElementById("main");
let cleanup = [];
let renderToken = 0;

function parseHash() {
  const raw = location.hash.replace(/^#/, "") || "/";
  const [path, qs] = raw.split("?");
  return { path, query: new URLSearchParams(qs || "") };
}

export function navigate(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

async function route() {
  closeDropdowns(); // following a link in the bell or account menu closes it
  const { path, query } = parseHash();
  const match = ROUTES.map((r) => ({ r, m: path.match(r.re) })).find((x) => x.m);
  for (const fn of cleanup.splice(0)) {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
  scenes.setZoom(1);
  const token = ++renderToken;
  if (!match) {
    renderNotFound();
    return;
  }
  const { r, m } = match;
  scenes.set(r.scene, r.variant);
  highlightNav(r.nav);
  const district = NAV.find((n) => n.key === r.nav);
  const statusDistrict = document.querySelector(".statusbar .district");
  if (statusDistrict) statusDistrict.textContent = district ? `${district.zh} ${district.district}` : "";
  const view = h("div", { class: "page" });
  clear(main).append(view);
  window.scrollTo(0, 0);
  try {
    const mod = await import(`./pages/${r.page}.js`);
    if (token !== renderToken) return;
    await mod.render(view, {
      params: m.slice(1),
      query,
      scenes,
      navigate,
      onCleanup: (fn) => cleanup.push(fn),
      refreshHealth: pollHealth,
    });
  } catch (err) {
    if (token !== renderToken) return;
    console.error(err);
    clear(view).append(h("div", { class: "hero short" }, h("h2", {}, "Something went wrong"), h("p", { class: "lede" }, err.message || String(err))));
  }
  if (token === renderToken && !query.get("q")) main.focus({ preventScroll: true });
}

function renderNotFound() {
  scenes.set("harbour", "night");
  clear(main).append(h("div", { class: "page" }, h("div", { class: "hero" },
    h("p", { class: "kicker" }, "迷路 Lost"),
    h("h1", {}, "Wrong turn"),
    h("p", { class: "lede" }, "That page doesn't exist. ", h("a", { href: "#/" }, "Back to the harbour.")))));
}

// -- top bar ---------------------------------------------------------------------
function renderNav() {
  const nav = document.getElementById("nav");
  clear(nav);
  for (const item of NAV) {
    if (item.show && !item.show()) continue;
    nav.append(h("a", { href: item.href, dataset: { key: item.key }, title: item.district, onclick: () => nav.classList.remove("open") },
      h("span", { class: "en" }, item.en), h("span", { class: "zh" }, item.zh)));
  }
  highlightNav(currentNav);
}

let currentNav = null;
function highlightNav(key) {
  currentNav = key;
  document.querySelectorAll("#nav a").forEach((a) => {
    const active = a.dataset.key === key;
    a.classList.toggle("active", active);
    if (active) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
}

function renderActions() {
  const box = document.getElementById("top-actions");
  // The top bar is redrawn on every status poll and when notifications are marked read; a menu the
  // student has open (the bell's list, the account menu) moves to the new bar instead of vanishing.
  const open = new Map([...box.querySelectorAll(".dropdown")].map((menu) => [menu.parentElement.dataset.menu, menu]));
  clear(box);
  const ai = store.health?.ai;
  const state = !ai ? "" : ai.ok ? "ok" : ai.reachable ? "warn" : "bad";
  const label = !ai ? "Checking AI…" : ai.ok ? ai.chat_model : ai.reachable ? "No model" : "AI offline";
  box.append(h("a", { class: "ai-pill", href: "#/settings", title: ai?.issues?.join(" ") || "Local AI status" },
    h("span", { class: `dot ${state}` }), h("span", { class: "label" }, label)));
  if (store.user) {
    const bell = h("button", { class: "icon-btn", "aria-label": `Notifications${store.unread ? `, ${store.unread} unread` : ""}`, onclick: (e) => toggleNotifications(e.currentTarget) },
      svgIcon("bell"), store.unread ? h("span", { class: "count-badge" }, String(store.unread)) : null);
    box.append(h("div", { style: { position: "relative" }, dataset: { menu: "notifications" } }, bell));
    const avatar = h("button", { class: "avatar", "aria-label": "Account menu", title: store.user.email, onclick: (e) => toggleAccountMenu(e.currentTarget) }, initials(store.user));
    box.append(h("div", { style: { position: "relative" }, dataset: { menu: "account" } }, avatar));
  } else {
    box.append(h("button", { class: "btn primary small", onclick: () => openSignIn() }, store.health?.needs_setup ? "Set up" : "Sign in"));
  }
  box.append(h("button", { class: "icon-btn menu-toggle", "aria-label": "Menu", onclick: () => document.getElementById("nav").classList.toggle("open") }, svgIcon("menu")));
  for (const wrap of box.querySelectorAll("[data-menu]")) {
    if (open.has(wrap.dataset.menu)) wrap.append(open.get(wrap.dataset.menu));
  }
}

function closeDropdowns() {
  document.querySelectorAll(".dropdown").forEach((d) => d.remove());
}

document.addEventListener("click", (e) => {
  if (!e.target.closest(".dropdown") && !e.target.closest(".icon-btn, .avatar")) closeDropdowns();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeDropdowns();
});

function toggleAccountMenu(button) {
  const open = button.parentElement.querySelector(".dropdown");
  closeDropdowns();
  if (open) return;
  const u = store.user;
  button.parentElement.append(h("div", { class: "dropdown", role: "menu" },
    h("div", { class: "item", style: { cursor: "default" } }, h("b", {}, u.full_name || u.email), h("small", {}, `${u.role_label} · ${u.email}`)),
    h("a", { class: "item", href: "#/account", role: "menuitem" }, "Account & security"),
    h("a", { class: "item", href: "#", role: "menuitem", onclick: (e) => { e.preventDefault(); closeDropdowns(); signOut(); } }, "Sign out")));
}

async function toggleNotifications(button) {
  const open = button.parentElement.querySelector(".dropdown");
  closeDropdowns();
  if (open) return;
  const box = h("div", { class: "dropdown", role: "menu" }, h("div", { class: "item muted" }, "Loading…"));
  button.parentElement.append(box);
  try {
    const data = await api.get("/notifications");
    clear(box);
    if (!data.items.length) box.append(h("div", { class: "item muted" }, "No notifications yet."));
    for (const n of data.items.slice(0, 12)) {
      box.append(h("a", { class: `item ${n.read_at ? "" : "unread"}`, href: n.link || "#", role: "menuitem" }, n.title, h("small", {}, `${n.body ? n.body + " · " : ""}${fmt.ago(n.created_at)}`)));
    }
    if (data.unread) {
      await api.post("/notifications/read", {});
      store.set({ unread: 0 });
    }
  } catch (err) {
    clear(box).append(h("div", { class: "item" }, err.message));
  }
}

// -- status bar & polling -------------------------------------------------------------
function renderStatus() {
  const bar = document.getElementById("statusbar");
  const district = bar.querySelector(".district")?.textContent || "";
  clear(bar);
  const hl = store.health;
  if (!hl) {
    bar.append(h("span", {}, "Connecting to Learnly…"), h("span", { class: "district" }, district));
    return;
  }
  const ai = hl.ai;
  const me = hl.me;
  bar.append(
    h("span", { class: "row", style: { gap: "6px" } }, h("span", { class: `dot ${ai.ok ? "ok" : ai.reachable ? "warn" : "bad"}` }),
      ai.ok ? `Local AI: ${ai.chat_model}${ai.vision ? " · reads photos" : ""}` : ai.reachable ? "Local AI running, no model yet" : "Local AI offline"),
    me ? h("span", {}, `${fmt.number(me.documents)} documents · ${fmt.number(me.cards)} flashcards`) : null,
    me?.cards_due ? h("a", { class: "tag amber", href: "#/review/cards/due" }, `${fmt.number(me.cards_due)} cards due`) : null,
    h("span", { class: "district" }, district),
  );
}

async function pollHealth() {
  try {
    const data = await api.get("/health");
    store.set({ health: data });
    scenes.setData({ documents: data.me?.documents ?? 0, cardsMastered: data.me?.cards_mastered ?? 0, cardsDue: data.me?.cards_due ?? 0, aiOk: data.ai.ok });
  } catch {
    store.set({ health: store.health ? { ...store.health, ai: { ...store.health.ai, ok: false, reachable: false } } : null });
  }
}

async function pollNotifications() {
  if (!store.user) return;
  try {
    const data = await api.get("/notifications");
    if (data.unread !== store.unread) store.set({ unread: data.unread });
  } catch {
    /* ignore */
  }
}

let lastUserId;
store.on(() => {
  renderActions();
  renderStatus();
  const uid = store.user?.id || null;
  if (uid !== lastUserId) {
    lastUserId = uid;
    renderNav();
    if (booted) pollHealth().then(route);
    pollNotifications();
    try {
      if (uid) localStorage.setItem("learnly-signed-in", "1");
      else localStorage.removeItem("learnly-signed-in");
    } catch {
      /* private mode: refresh is attempted every time */
    }
  }
});

let booted = false;
async function boot() {
  document.getElementById("logo").append(logo());
  renderNav();
  renderActions();
  renderStatus();
  let hadSession = true;
  try {
    hadSession = localStorage.getItem("learnly-signed-in") !== null;
  } catch {
    hadSession = true;
  }
  await Promise.all([pollHealth(), hadSession ? refreshSession() : null]);
  booted = true;
  lastUserId = store.user?.id || null;
  renderNav();
  window.addEventListener("hashchange", route);
  await route();
  setInterval(pollHealth, 20000);
  setInterval(pollNotifications, 60000);
  pollNotifications();
  if (store.health?.needs_setup) toast("Welcome! Create the owner account to start (top right).");
}

window.addEventListener("unhandledrejection", (e) => {
  const message = e.reason?.message;
  if (message) toast(message, "bad");
});

boot();
