// Admiralty: system health, activity, users and the audit log.

import { api } from "../api.js";
import { areaChart } from "../charts.js";
import { store } from "../store.js";
import { clear, empty, fmt, h, notice, spinner, toast } from "../ui.js";

export async function render(view, { scenes }) {
  view.append(h("section", { class: "hero short" },
    h("p", { class: "kicker" }, "金鐘 Admiralty"),
    h("h1", {}, "Control room"),
    h("p", { class: "lede" }, "Health of the local AI and the background work, how Learnly is being used, the accounts on this computer and the tamper-evident audit log.")));
  if (!store.can("admin:read")) {
    view.append(h("div", { class: "panel" }, empty("Administrators only", "Sign in with an administrator or auditor account.")));
    return;
  }
  const sys = h("div");
  const users = h("div");
  const audit = h("div");
  view.append(sys, users, audit);

  async function loadSystem() {
    clear(sys).append(spinner());
    let s;
    try {
      s = await api.get("/admin/system");
    } catch (err) {
      clear(sys).append(notice("bad", err.message));
      return;
    }
    scenes.setData({ aiOk: s.ai.ok });
    const tile = (label, ok, value, sub) => h("div", { class: "panel stat" }, h("div", { class: "label" }, label),
      h("div", { class: "row", style: { marginTop: "6px" } }, h("span", { class: `dot ${ok === true ? "ok" : ok === false ? "bad" : "warn"}` }), h("b", {}, value)), h("div", { class: "sub" }, sub));
    const tasks = Object.entries(s.scheduler);
    const c = s.counts;
    clear(sys).append(
      h("section", { class: "grid four" },
        tile("Local AI", s.ai.ok, s.ai.chat_model || (s.ai.reachable ? "No model" : "Offline"), s.ai_last_activity?.model ? `last answer ${s.ai_last_activity.seconds}s · ${s.ai_last_activity.tokens ?? "?"} tokens` : s.ai.base_url),
        tile("Photos", s.ai.vision ? true : null, s.ai.vision ? "Can read photos" : "Text only", s.ai.vision ? "questions and notes from the camera" : "install a vision model such as qwen3.5:4b"),
        tile("Uploads", true, `${c.documents} documents`, fmt.bytes(s.uploads_bytes) || "nothing uploaded yet"),
        tile("Accounts", true, `${c.users} ${c.users === 1 ? "person" : "people"}`, `${c.audit_log} audit entries`)),
      h("section", { class: "grid two section" },
        h("div", { class: "panel" }, h("div", { class: "panel-title" }, h("h3", {}, "Activity per day"), h("span", { class: "muted small" }, "problems solved and questions answered")),
          s.activity_by_day.length ? areaChart(s.activity_by_day.map((d) => ({ label: d.day.slice(5), value: d.problems + d.answers }))) : h("p", { class: "muted" }, "Nothing yet."),
          h("div", { class: "row small muted" }, `Problems ${c.problems} · practice sets ${c.practice_sets} · tutor sessions ${c.tutor_sessions}`)),
        h("div", { class: "panel" }, h("div", { class: "panel-title" }, h("h3", {}, "Study material"), h("span", { class: "muted small" }, "everyone on this computer")),
          h("div", { class: "grid three" },
            h("div", { class: "stat" }, h("div", { class: "label" }, "Materials"), h("div", { class: "value", style: { fontSize: "24px" } }, fmt.number(c.materials))),
            h("div", { class: "stat" }, h("div", { class: "label" }, "Flashcards"), h("div", { class: "value", style: { fontSize: "24px" } }, fmt.number(c.flashcards))),
            h("div", { class: "stat" }, h("div", { class: "label" }, "Quizzes taken"), h("div", { class: "value gold", style: { fontSize: "24px" } }, fmt.number(c.quiz_attempts)))),
          h("div", { class: "section" }, h("h4", {}, "Recent background jobs"),
            s.jobs.length ? h("div", { class: "stack small" }, s.jobs.slice(0, 6).map((j) => h("div", { class: "row between" },
              h("span", { class: "mono" }, j.kind), h("span", { class: j.status === "failed" ? "tag red" : j.status === "done" ? "tag green" : "tag amber" }, j.status),
              h("span", { class: "muted" }, fmt.ago(j.created_at))))) : h("p", { class: "muted small" }, "None yet.")))),
      h("section", { class: "panel section" }, h("div", { class: "panel-title" }, h("h3", {}, "Background tasks"), h("span", { class: "muted small" }, "run every few minutes while Learnly is open")),
        h("div", { class: "table-wrap" }, h("table", {},
          h("tr", {}, h("th", {}, "Task"), h("th", {}, "Last run"), h("th", {}, "Result"), h("th", {}, "")),
          tasks.map(([name, st]) => h("tr", {},
            h("td", { class: "mono" }, name),
            h("td", { class: "small" }, st.last_run ? fmt.ago(st.last_run) : "not yet"),
            h("td", { class: "small muted" }, st.last_error ? h("span", { style: { color: "var(--red)" } }, st.last_error) : st.last_result ? JSON.stringify(st.last_result).slice(0, 120) : "—"),
            h("td", {}, store.can("admin:system") ? h("button", { class: "btn small", onclick: async (e) => {
              e.currentTarget.disabled = true;
              try {
                const r = await api.post(`/admin/system/run/${name}`);
                toast(`${name}: ${r.result.ok ? "done" : r.result.error}`, r.result.ok ? "good" : "bad");
              } catch (err) {
                toast(err.message, "bad");
              }
              loadSystem();
            } }, "Run now") : null)))))));
  }

  async function loadUsers() {
    try {
      const list = await api.get("/admin/users");
      clear(users).append(h("section", { class: "panel section" },
        h("div", { class: "panel-title" }, h("h3", {}, "Users & roles"), h("span", { class: "muted small" }, "Role changes need an authenticator code and sign the user out")),
        h("div", { class: "table-wrap" }, h("table", {},
          h("tr", {}, h("th", {}, "User"), h("th", {}, "Role"), h("th", {}, "Two-step"), h("th", {}, "Last sign-in")),
          list.map((u) => {
            const select = h("select", { "aria-label": `Role for ${u.email}`, disabled: !store.can("admin:users") },
              ["student", "admin", "auditor"].map((r) => h("option", { value: r }, { student: "Student", admin: "Administrator", auditor: "Auditor" }[r])));
            select.value = u.role;
            select.addEventListener("change", async () => {
              try {
                await api.patch(`/admin/users/${u.id}`, { role: select.value });
                toast(`${u.email} is now ${select.selectedOptions[0].textContent}`, "good");
              } catch (err) {
                toast(err.message, "bad");
                select.value = u.role;
              }
            });
            return h("tr", {}, h("td", {}, h("b", {}, u.full_name || u.email), h("div", { class: "small muted" }, u.email)), h("td", {}, select),
              h("td", {}, u.mfa_enabled ? h("span", { class: "tag green" }, "On") : h("span", { class: "tag" }, "Off")), h("td", { class: "small" }, fmt.ago(u.last_login_at)));
          })))));
    } catch (err) {
      clear(users).append(notice("bad", err.message));
    }
  }

  async function loadAudit(before = null) {
    if (!store.can("audit:read")) return;
    const filter = h("input", { type: "search", placeholder: "Filter by action, e.g. auth.", "aria-label": "Filter audit log" });
    const tableBox = h("div");
    const verifyOut = h("span");
    clear(audit).append(h("section", { class: "panel section" },
      h("div", { class: "panel-title" }, h("h3", {}, "Audit log"), h("div", { class: "row" }, filter,
        h("button", { class: "btn small", onclick: async () => {
          const r = await api.get("/audit/verify");
          clear(verifyOut).append(r.ok ? h("span", { class: "tag green" }, `Chain intact · ${r.entries} entries`) : h("span", { class: "tag red" }, `Broken at #${r.broken_at}: ${r.reason}`));
        } }, "Verify chain"), verifyOut,
        store.can("audit:export") ? h("a", { class: "btn small", href: "#", onclick: async (e) => {
          e.preventDefault();
          const resp = await api.raw("GET", "/audit/export?format=csv");
          const blob = await resp.blob();
          const a = h("a", { href: URL.createObjectURL(blob), download: "learnly-audit-log.csv" });
          document.body.append(a);
          a.click();
          a.remove();
        } }, "Export CSV") : null)),
      h("p", { class: "small muted" }, "Every entry includes the hash of the one before it, so any edit breaks the chain. The database refuses edits and deletions."),
      tableBox));
    const load = async () => {
      const data = await api.get(`/audit?limit=40&action=${encodeURIComponent(filter.value.trim())}${before ? `&before=${before}` : ""}`);
      clear(tableBox).append(h("div", { class: "table-wrap" }, h("table", {},
        h("tr", {}, h("th", {}, "#"), h("th", {}, "When"), h("th", {}, "Who"), h("th", {}, "Action"), h("th", {}, "Details"), h("th", {}, "Hash")),
        data.entries.map((e) => h("tr", {}, h("td", { class: "num" }, e.seq), h("td", { class: "small nowrap" }, fmt.dateTime(e.at)), h("td", { class: "small" }, e.actor_email || "system"),
          h("td", { class: "mono small" }, e.action), h("td", { class: "small muted" }, JSON.stringify(e.details).slice(0, 140)), h("td", { class: "mono small faint" }, e.hash.slice(0, 10)))))));
    };
    filter.addEventListener("change", load);
    await load();
  }

  await Promise.all([loadSystem(), loadUsers(), loadAudit()]);
}
