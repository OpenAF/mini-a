/* Studio uses a single authenticated client; token is held only in memory. */
"use strict";
const StudioApi = {
  token: "",
  async request(path, method = "GET", body) {
    const response = await fetch("/api/v1/" + path, { method, headers: { Authorization: "Bearer " + this.token, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) { const error = new Error(result.error?.message || "Request failed"); error.details = result.error?.details; error.status = response.status; throw error; }
    return result;
  },
  wikis() { return this.request("wikis"); },
  register(wiki) { return this.request("wikis", "POST", wiki); }
};
const el = (tag, text, parent) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (parent) parent.append(node); return node; };
const message = (text, error = false) => { const node = document.getElementById("message"); node.textContent = text; node.className = error ? "error" : ""; };
const safely = fn => async (...args) => { try { await fn(...args); } catch (error) { message(error.message, true); } };
document.getElementById("login").addEventListener("submit", safely(async event => {
  event.preventDefault(); StudioApi.token = document.getElementById("token").value; await StudioApi.request("session");
  document.getElementById("token").value = ""; document.getElementById("login").hidden = true; await dashboard();
}));
async function dashboard() {
  const host = document.getElementById("workspace"); host.hidden = false; host.replaceChildren();
  const wikis = await StudioApi.wikis();
  el("h2", "Your wikis", host);
  if (!wikis.items.length) el("p", "Register an existing wiki or create one in an operator-allowlisted directory.", host);
  wikis.items.forEach(wiki => { const b = el("button", wiki.name + " · " + wiki.access, host); b.onclick = safely(() => openWiki(wiki)); });
  const form = el("form", undefined, host); form.className = "card"; el("h3", "Add wiki", form);
  const fields = {};
  for (const [key, title] of [["id", "Stable ID"], ["name", "Display name"], ["root", "Absolute root"]]) { const label = el("label", title, form); fields[key] = el("input", undefined, label); fields[key].required = true; }
  const label = el("label", "Access", form); fields.access = el("select", undefined, label); ["rw", "ro"].forEach(s => { const o = el("option", s, fields.access); o.value = s; });
  const createLabel = el("label", "Create new directory", form); const create = el("input", undefined, createLabel); create.type = "checkbox";
  el("button", "Add wiki", form);
  form.onsubmit = safely(async event => { event.preventDefault(); const body = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.value])); body.create = create.checked; await StudioApi.register(body); message("Wiki registered"); await dashboard(); });
}
async function openWiki(wiki) { message("Registered " + wiki.name + ". Page tools are loading."); }
