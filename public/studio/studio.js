/* Studio uses a single authenticated client; token is held only in memory. */
"use strict";
const StudioActivity = {
  pending: 0,
  update(delta) {
    this.pending += delta;
    const node = document.getElementById("studio-activity");
    node.hidden = this.pending === 0;
    document.getElementById("studio-activity-text").textContent = this.pending > 1 ? "Processing requests… (" + this.pending + " pending)" : "Processing request…";
  }
};
const StudioApi = {
  token: "",
  tail: Promise.resolve(),
  request(path, method = "GET", body) {
    StudioActivity.update(1);
    const result = this.tail.then(() => this.send(path, method, body)).finally(() => StudioActivity.update(-1));
    this.tail = result.catch(() => {}); return result;
  },
  async send(path, method = "GET", body) {
    const response = await fetch("/api/v1/" + path, { method, headers: { Authorization: "Bearer " + this.token, "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: body === undefined ? undefined : JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) { const error = new Error(result.error?.message || "Request failed"); error.details = result.error?.details; error.status = response.status; throw error; }
    return result;
  },
  async raw(path, options = {}) {
    StudioActivity.update(1);
    try {
    const response = await fetch("/api/v1/" + path, { ...options, headers: { ...options.headers, Authorization: "Bearer " + this.token } });
    if (!response.ok) throw new Error((await response.json()).error?.message || "Request failed");
    return response;
    } finally { StudioActivity.update(-1); }
  },
  async graphHtml(wikiId) { return (await this.raw("wikis/" + encodeURIComponent(wikiId) + "/graph/html")).text(); },
  async events(jobId, cursor) { return (await this.raw("jobs/" + encodeURIComponent(jobId) + "/events", { headers: { "Last-Event-ID": String(cursor) } })).text(); },
  async upload(uploadId, path, file) { return (await this.raw("uploads", { method: "POST", headers: { "X-Upload-ID": uploadId, "X-Upload-Path": encodeURIComponent(path) }, body: file })).json(); },
  wikis(offset = 0) { return this.request("wikis?limit=100&offset=" + offset); },
  register(wiki) { return this.request("wikis", "POST", wiki); }
};
const el = (tag, text, parent) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (parent) parent.append(node); return node; };

// JSON is rendered with nJSMap (as in Mini-A web Advanced). Values are escaped first because nJSMap emits HTML,
// and inline style attributes are removed because Studio's CSP forbids them; studio.css themes the classes instead.
const escapeHtml = v => String(v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function jsonView(value, parent) {
  const view = el("div", undefined, parent); view.className = "json-view";
  const prepare = v => v === null || v === undefined ? "—" : typeof v === "string" ? escapeHtml(v) : Array.isArray(v) ? v.map(prepare) : typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [escapeHtml(k), prepare(x)])) : v;
  try {
    if (typeof window.nJSMap !== "function" || value === null || typeof value !== "object") throw new Error("nJSMap unavailable");
    view.innerHTML = window.nJSMap(prepare(value), undefined, matchMedia("(prefers-color-scheme: dark)").matches).replace(/ style="[^"]*"/g, "");
  } catch (_) { view.textContent = JSON.stringify(value, null, 2); view.classList.add("json-fallback"); }
  return view;
}
// Line icons share Mini-A web Advanced's 24px, rounded, currentColor style (see public/advanced.js tabIcons).
const ICONS = {
  logo: "M12 5v16M12 5C9 3 5 3 3 4v15c3-1 6-1 9 2 3-3 6-3 9-2V4c-2-1-6-1-9 1Z",
  overview: "m3 11 9-8 9 8M5 9.5V20h14V9.5M10 20v-6h4v6",
  pages: "M5 3h14v18H5ZM8 7h8m-8 4h8m-8 4h6",
  graph: "M10 6a2 2 0 1 0 4 0 2 2 0 1 0-4 0M3 18a2 2 0 1 0 4 0 2 2 0 1 0-4 0m12 0a2 2 0 1 0 4 0 2 2 0 1 0-4 0M11 8l-5 8m7-8 5 8M7 18h10",
  sources: "M12 3v12m-4-4 4 4 4-4M4 15v5h16v-5",
  absorb: "M3 6h5v5M8 6l-5 5m18-5h-5v5m0-5 5 5M8 17h8m-6 3h4",
  dreams: "M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10Z",
  jobs: "M3 12h4l3-7 4 14 3-7h4",
  health: "M12 20s-8-4.5-8-10a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 5.500-8 10-8 10ZM8 12h2l1.500-2.500 2 4L15 12h1",
  settings: "M4 7h7m4 0h5M4 17h3m4 0h9M11 4v6M7 14v6",
  lock: "M6 11h12v10H6ZM8 11V7a4 4 0 0 1 8 0v4",
  edit: "m4 16 12-12 4 4-12 12H4ZM13 7l4 4",
  back: "m11 6-6 6 6 6M5 12h14",
  add: "M12 5v14M5 12h14",
  check: "m5 12 4 4L19 6",
  cross: "m6 6 12 12M18 6 6 18",
  stop: "M7 7h10v10H7Z",
  save: "M4 3h13l3 3v15H4V3ZM8 3v6h8V3M8 21v-8h8v8",
  reset: "M3 5v5h5M3 10a9 9 0 1 1 1 7",
  refresh: "M21 5v5h-5M21 10a9 9 0 1 0-1 7",
  search: "M10 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12ZM15 15l5 5",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6m4-6v6",
  download: "M12 3v12m-4-4 4 4 4-4M4 15v6h16v-6",
  upload: "M12 15V3m-4 4 4-4 4 4M4 15v6h16v-6",
  move: "M5 12h14m-4-4 4 4-4 4M5 5v14",
  open: "M14 4h6v6M20 4l-9 9M18 14v6H4V6h6",
  play: "m8 5 11 7-11 7Z",
  snapshot: "M3 7h4l2-3h6l2 3h4v13H3ZM12 10a3.500 3.500 0 1 0 0 7 3.500 3.500 0 0 0 0-7Z",
  unlock: "M6 11h12v10H6ZM8 11V7a4 4 0 0 1 7.500-2",
  clock: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16ZM12 8v4l3 2",
  tree: "M3 5h6v4H3ZM15 11h6v4h-6ZM15 17h6v4h-6ZM6 9v10h9M6 13h9",
  folder: "M3 6h7l2 3h9v11H3ZM3 6V4h7l2 2",
  info: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16ZM12 11v5M12 8v.01"
};
function svgIcon(name, size = 14) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [k, v] of Object.entries({ viewBox: "0 0 24 24", width: size, height: size, fill: "none", stroke: "currentColor", "stroke-width": "1.8", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", focusable: "false", class: "studio-icon" })) svg.setAttribute(k, v);
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path"); path.setAttribute("d", ICONS[name] || ICONS.info); svg.append(path); return svg;
}
const withIcon = (node, name) => { if (name) node.prepend(svgIcon(name)); return node; };
const VIEW_ICONS = { Import: "sources", Maintenance: "health", Activity: "jobs", Overview: "overview", Pages: "pages", Graph: "graph", Sources: "sources", Absorb: "absorb", Dreams: "dreams", Jobs: "jobs", Health: "health", Settings: "settings" };
const BUTTON_ICONS = [[/^all wikis|^first page|^previous/i, "back"], [/cancel|unregister|^delete/i, "trash"], [/^add |^new |^create|^queue|^stage/i, "add"], [/^save/i, "save"], [/^revert|reload|^restore|^apply|rerun/i, "reset"], [/refresh|^search/i, "refresh"], [/download/i, "download"], [/^open|^inspect|^next|^use /i, "open"], [/^move|^rename/i, "move"], [/^preview|^generate/i, "play"], [/^snapshot/i, "snapshot"], [/^folder tree/i, "tree"], [/^status$/i, "info"], [/^show$/i, "open"], [/^resume$/i, "play"], [/\.md$/i, "pages"]];
const STATE_ICONS = { completed: "check", succeeded: "check", done: "check", failed: "cross", error: "cross", cancelled: "stop", canceled: "stop", running: "jobs", queued: "clock" };
const message = (text, error = false) => { const node = document.getElementById("message"); node.textContent = text; node.className = error ? "error" : ""; };
const safely = fn => async (...args) => { try { await fn(...args); } catch (error) { message(error.message, true); } };
async function unlock(token) {
  StudioApi.token = token; studioSession = await StudioApi.request("session");
  document.getElementById("token").value = ""; document.getElementById("login").hidden = true; await dashboard();
}
withIcon(document.querySelector("#login button"), "unlock");
document.getElementById("login").addEventListener("submit", safely(async event => { event.preventDefault(); await unlock(document.getElementById("token").value); }));
// The launcher opens the browser with #token=...; fragments are never sent to the server. Clear it immediately.
{ const match = /^#token=([^&]+)/.exec(location.hash); if (match) { history.replaceState(null, "", location.pathname); safely(() => unlock(decodeURIComponent(match[1])))(); } }
async function dashboard(offset = 0) {
  const host = document.getElementById("workspace"); host.hidden = false; host.replaceChildren();
  const wikis = await StudioApi.wikis(offset);
  withIcon(el("h2", "Your wikis", host), "logo");
  button(host, "Build web command", () => webCommandWizard(), "open");
  if (!wikis.items.length) el("p", "Register an existing wiki or create one in an operator-allowlisted directory.", host);
  wikis.items.forEach(wiki => { const b = withIcon(el("button", wiki.name + " · " + wiki.access, host), wiki.access === "rw" ? "edit" : "lock"); b.onclick = safely(() => openWiki(wiki)); });
  if (offset) button(host,"Previous wikis",()=>dashboard(Math.max(0,offset-100)));
  if (wikis.truncated) button(host,"Next wikis",()=>dashboard(offset+100));
  const form = el("form", undefined, host); form.className = "card"; withIcon(el("h3", "Add wiki", form), "add");
  const fields = {};
  for (const [key, title] of [["id", "Stable ID"], ["name", "Display name"], ["root", "Absolute root"]]) { const label = el("label", title, form); fields[key] = el("input", undefined, label); fields[key].required = true; }
  const label = el("label", "Access", form); fields.access = el("select", undefined, label); ["rw", "ro"].forEach(s => { const o = el("option", s, fields.access); o.value = s; });
  const createLabel = el("label", "Create new directory", form); const create = el("input", undefined, createLabel); create.type = "checkbox";
  withIcon(el("button", "Add wiki", form), "add");
  form.onsubmit = safely(async event => { event.preventDefault(); const body = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.value])); body.create = create.checked; await StudioApi.register(body); message("Wiki registered"); await dashboard(); });
}
let currentWiki, activePage, dirty = false, graphBlob, studioSession, editing = false;
let activeView = "Pages", navigationVersion = 0, navigating = false;
const pageStates = new Map(), importPanes = new Map(), charts = new Set();
const terminalStates = ["completed", "failed", "partial", "recovery-required", "interrupted", "cancelled"];
function pageState() {
  if (!pageStates.has(currentWiki.id)) pageStates.set(currentWiki.id, {expanded: new Set([""]), selected: "", folder: "", scroll: 0});
  return pageStates.get(currentWiki.id);
}
function row(parent) { const node = el("div", undefined, parent); node.className = "row"; return node; }
function technical(value, parent, title = "Technical details") { const d = el("details", undefined, parent); el("summary", title, d); jsonView(value, d); return d; }
function human(value) { return String(value || "").replace(/[._-]+/g, " ").replace(/^./, c => c.toUpperCase()); }
function bytes(value) { return new Intl.NumberFormat(undefined, {maximumFractionDigits: 1}).format(value / (value >= 1048576 ? 1048576 : 1024)) + (value >= 1048576 ? " MiB" : " KiB"); }
function date(value) { return value ? new Date(value).toLocaleString() : "—"; }
function disable(control, reason) { control.disabled = !!reason; control.title = reason || ""; if (reason) { const note = el("small", reason, control.parentElement); note.className = "muted control-reason"; } return control; }
function writeReason(model = false) { return currentWiki.access !== "rw" ? "This wiki is read-only" : model && !studioSession?.canTestWiki ? "Configure OAF_MODEL to use this action" : ""; }
async function allItems(path) {
  let result, offset = 0, items = [];
  do { result = await StudioApi.request(path + (path.includes("?") ? "&" : "?") + "limit=100&offset=" + offset); items.push(...result.items); offset += result.items.length; } while (result.truncated && result.items.length);
  return items;
}
function dataTable(parent, headings) {
  const wrap = el("div", undefined, parent); wrap.className = "table-scroll";
  const table = el("table", undefined, wrap); table.className = "studio-table";
  const header = el("tr", undefined, el("thead", undefined, table)); headings.forEach(h => el("th", h, header).scope = "col");
  return el("tbody", undefined, table);
}
function metricChart(parent, title, values, unit = "Count") {
  const section = el("section", undefined, parent); el("h4", title, section);
  const entries = Object.entries(values).filter(([,v]) => Number.isFinite(v));
  if (!entries.length) { el("p", "No data yet.", section); return; }
  const valuesNode = el("details", undefined, section); el("summary", "View values", valuesNode);
  const body = dataTable(valuesNode, ["Category", unit]); entries.forEach(([k,v]) => { const r = el("tr", undefined, body); el("td", human(k), r); el("td", String(v), r); });
  if (typeof window.Chart !== "function") { valuesNode.open = true; return; }
  const frame = el("div", undefined, section); frame.className = "chart-frame";
  const canvas = el("canvas", undefined, frame); canvas.setAttribute("role", "img"); canvas.setAttribute("aria-label", title + ". Exact values in the accompanying table.");
  const color = key => getComputedStyle(document.documentElement).getPropertyValue(key).trim();
  try { const chart = new window.Chart(canvas, {type:"bar", data:{labels:entries.map(([k])=>human(k)),datasets:[{label:unit,data:entries.map(([,v])=>v),backgroundColor:color("--green")}]}, options:{indexAxis:"y",responsive:true,maintainAspectRatio:false,animation:false,plugins:{legend:{display:false}},scales:{x:{beginAtZero:true,ticks:{color:color("--ink")},grid:{color:color("--line")}},y:{ticks:{color:color("--ink")},grid:{display:false}}}}}); charts.add(chart); } catch (_) { frame.remove(); valuesNode.open = true; }
}
function destroyDetachedCharts() { for (const chart of charts) if (!chart.canvas?.isConnected) { chart.destroy(); charts.delete(chart); } }
function outcome(parent, result) {
  if (!result) return;
  const scalar = Object.entries(result).filter(([k,v]) => ["string","number","boolean"].includes(typeof v) && !/^(?:id|version)$/.test(k));
  for (const [key,value] of scalar) el("p", human(key) + ": " + String(value), parent);
  for (const key of ["changes","findings","issues","conflicts","warnings","proposals"]) if (Array.isArray(result[key]) && result[key].length) {
    const section = el("section",undefined,parent); el("h4",human(key),section);
    result[key].slice(0,100).forEach(item => { if (typeof item === "string") el("p",item,section); else { el("p",[item.path,item.action || item.type || item.classification,item.message || item.reason].filter(Boolean).join(" · ") || human(key),section); if (item.unifiedDiff) el("pre",item.unifiedDiff,section); technical(item,section); } });
    if (result[key].length>100) el("p","Showing the first 100 entries; the complete result is in Technical details.",section);
  }
  technical(result,parent);
}

async function studioDialog(title, initial, confirmation) {
  const previous = document.activeElement, dialog = el("dialog", undefined, document.body), form = el("form", undefined, dialog);
  form.method = "dialog"; const heading = el("h3", title, form); heading.id = "studio-dialog-title"; dialog.setAttribute("aria-labelledby", heading.id);
  let input;
  if (!confirmation) { const label = el("label", title, form); input = el("input", undefined, label); input.value = initial || ""; input.required = true; }
  const row = el("div", undefined, form); row.className = "row";
  const cancel = withIcon(el("button", "Cancel", row), "cross"); cancel.value = "cancel"; cancel.type = "button"; cancel.onclick = () => dialog.close("cancel");
  const accept = withIcon(el("button", confirmation ? "Confirm" : "Continue", row), "check"); accept.value = "accept";
  const result = new Promise(resolve => dialog.addEventListener("close", () => { const value = dialog.returnValue === "accept" ? confirmation ? true : input.value : confirmation ? false : null; dialog.remove(); previous?.focus(); resolve(value); }, { once: true }));
  dialog.showModal(); (input || cancel).focus(); if (input) input.select(); return result;
}
const askText = (title, initial) => studioDialog(title, initial, false);
const askConfirmation = title => studioDialog(title, "", true);
async function mayLeave() { return !dirty || await askConfirmation("Discard unsaved changes?"); }
function button(parent, title, action, icon) { const b = el("button", title, parent); if (/^(?:Delete|Clear eligible|Unregister)/.test(title)) b.classList.add("danger"); else if (/^(?:Save|Edit$|Preview changes|4\. Import|Download webpage|Download captions|Upload and prepare|Start )/.test(title)) b.classList.add("primary"); b.type = "button"; b.onclick = safely(action); const hit = BUTTON_ICONS.find(([re]) => re.test(title)); return withIcon(b, icon || (hit ? hit[1] : "pages")); }
function navButton(nav, name, action) { return button(nav, name, action, VIEW_ICONS[name]); }
function wikiPath(suffix = "") { return "wikis/" + encodeURIComponent(currentWiki.id) + (suffix ? "/" + suffix : ""); }
StudioApi.wiki = function(suffix, method, body) { return this.request(wikiPath(suffix), method, body); };
async function openWiki(wiki, target = "Pages", record = true) {
  if (navigating) return;
  if (!(await mayLeave())) return;
  currentWiki = wiki; activePage = null; dirty = false; editing = false;
  const host = document.getElementById("workspace"); host.replaceChildren();
  const heading = row(host); button(heading, "All wikis", async () => { if (!navigating && await mayLeave()) { dirty = false; history.pushState({dashboard:true}, "", location.pathname); await dashboard(); } });
  withIcon(el("h2", wiki.name, heading), wiki.access === "rw" ? "edit" : "lock"); el("span",wiki.access === "rw" ? "Editable wiki" : "Read-only wiki",heading).className="badge";
  const nav = el("nav", undefined, host); nav.setAttribute("aria-label", "Wiki views"); nav.id = "wiki-nav";
  const alerts = el("div",undefined,host); alerts.id="wiki-alerts";
  const content = el("div", undefined, host); content.id = "view";
  for (const name of ["Overview", "Pages", "Import", "Maintenance", "Activity", "Settings"]) { const b=navButton(nav,name,()=>navigate(name)); b.dataset.view=name; }
  await navigate(target,record);
}
async function navigate(name, record = true, path) {
  if (navigating || !(await mayLeave())) return;
  navigating=true;
  try {
  dirty = false; editing = false; activePage = null; activeView = name;
  const version = ++navigationVersion, wikiId = currentWiki.id, content = document.getElementById("view");
  if (graphBlob) { URL.revokeObjectURL(graphBlob); graphBlob = null; }
  content.replaceChildren(); destroyDetachedCharts(); message("");
  document.querySelectorAll("#wiki-nav button").forEach(b => { b.classList.toggle("selected",b.dataset.view===name); if (b.dataset.view===name) b.setAttribute("aria-current","page"); else b.removeAttribute("aria-current"); });
  if (record) history.pushState({wikiId,view:name,path},"", "#wiki="+encodeURIComponent(wikiId)+"&view="+encodeURIComponent(name)+(path?"&page="+encodeURIComponent(path):""));
  await showView(name,content);
  if (version!==navigationVersion) return;
  if (path && name==="Pages") await loadPage(path,false);
  const alerts=document.getElementById("wiki-alerts");
  try { const info=await StudioApi.wiki("overview"); if(version!==navigationVersion)return; alerts.replaceChildren(); if(info.studio.pendingRecovery?.length) { el("p","This wiki needs recovery before edits or imports can continue.",alerts).className="error"; button(alerts,"Review recovery",()=>navigate("Maintenance")); } } catch(error) { if(version===navigationVersion) alerts.textContent=error.message; }
  } finally { navigating=false; }
}
window.addEventListener("popstate",safely(async event=>{
  if (!(await mayLeave())) { history.pushState({wikiId:currentWiki?.id,view:activeView,path:activePage?.path},"",location.href); return; }
  dirty=false;
  if(!event.state?.wikiId){await dashboard();return;}
  const wiki=await StudioApi.request("wikis/"+encodeURIComponent(event.state.wikiId));
  await openWiki(wiki,event.state.view||"Pages",false);
  if(event.state.path)await loadPage(event.state.path,false);
}));
async function showView(name, content) {
  withIcon(el("h3", name, content), VIEW_ICONS[name]);
  if (name === "Pages") return pagesView(content);
  if (name === "Import") {
    if (importPanes.has(currentWiki.id)) { content.append(importPanes.get(currentWiki.id)); return; }
    const pane=el("div",undefined,content);importPanes.set(currentWiki.id,pane);return sourcesView(pane);
  }
  if (name === "Activity") return jobsView(content);
  if (name === "Maintenance") return maintenanceView(content);
  if (name === "Overview" || name === "Health") {
    if (name === "Overview") {
      button(content, "Build web command", () => webCommandWizard(currentWiki.id), "open");
      const session = await StudioApi.request("session");
      if (session.canTestWiki) {
        const test = el("section", undefined, content); el("h4", "Test this wiki", test);
        el("p", "Chat with this wiki in Mini-A Web. The wiki opens read-only; shell access is disabled. Test servers stop when Studio exits.", test);
        const servers = el("div", undefined, test);
        async function refreshTestServers() {
          const result = await StudioApi.wiki("test");
          servers.replaceChildren();
          if (!result.items.length) el("p", "No running test servers for this wiki.", servers);
          result.items.forEach(server => {
            const row = el("div", undefined, servers); row.className = "row";
            const link = el("a", server.advanced ? "Open test (Advanced view)" : "Open test (Simple view)", row);
            link.href = server.url; link.target = "_blank"; link.rel = "noopener noreferrer";
            button(row, "Stop server", async () => { await StudioApi.wiki("test", "DELETE", {advanced:server.advanced}); await refreshTestServers(); });
          });
        }
        button(test, "Refresh test servers", refreshTestServers);
        await refreshTestServers();
        const advanced = check(test, "Enable Advanced view (trusted console controls)");
        button(test, "Open wiki test in new tab", async () => {
          const tab = window.open("about:blank", "_blank");
          if (!tab) throw new Error("Allow pop-ups for Studio to open the wiki test.");
          tab.opener = null; tab.document.body.textContent = "Starting Mini-A Web…";
          try { const result = await StudioApi.wiki("test", "POST", {advanced:advanced.checked}); tab.location.replace(result.url); await refreshTestServers(); }
          catch(error) { tab.close(); throw error; }
        }, "open");
      }
    }
    await summaryView(content, name === "Health");
    return;
  }
  if (name === "Settings") {
    el("p", "Manage how this wiki is registered in Studio.", content);
    technical(currentWiki, content);
    button(content, "Build web command", () => webCommandWizard(currentWiki.id), "open");
    button(content, "Rename display name", async () => { const name = await askText("Display name", currentWiki.name); if (name) { await StudioApi.wiki("", "PATCH", { name }); currentWiki.name = name; await openWiki(currentWiki); } }, "edit");
    button(content, currentWiki.access === "rw" ? "Make read-only" : "Enable writes", async () => { const access = currentWiki.access === "rw" ? "ro" : "rw"; await StudioApi.wiki("", "PATCH", { access }); currentWiki.access = access; importPanes.delete(currentWiki.id); await openWiki(currentWiki); }, currentWiki.access === "rw" ? "lock" : "unlock");
    button(content, "Unregister (keep all files)", async () => { if (await askConfirmation("Remove this registry entry? Wiki files will remain.")) { await StudioApi.wiki("", "DELETE"); await dashboard(); } });
    return;
  }
  if (window.studioToolsView) return window.studioToolsView(name, content);
  el("p", "This feature is unavailable in this build.", content);
}
// A deliberately small DOM renderer: raw HTML is always text. No innerHTML,
// embedded media, remote images or executable links enter the Studio origin.
function renderMarkdown(raw, parent) {
  parent.replaceChildren();
  const text = raw.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, ""); let code = false, pre;
  for (const line of text.split(/\r?\n/)) {
    if (/^```|^~~~/.test(line)) { code = !code; if (code) pre = el("pre", "", parent); continue; }
    if (code) { pre.textContent += line + "\n"; continue; }
    const heading = line.match(/^(#{1,6})\s+(.+)/); const block = el(heading ? "h" + heading[1].length : "p", undefined, parent);
    const body = heading ? heading[2] : line; let last = 0;
    const re = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]|\[([^\]]+)\]\(([^\s)]+)\)/g; let m;
    while ((m = re.exec(body))) {
      block.append(document.createTextNode(body.slice(last, m.index))); const target = m[1] || m[4], label = m[2] || m[3] || m[1], wikiLink = !!m[1];
      if (/^https?:\/\//i.test(target)) { const a = el("a", label, block); a.href = target; a.target = "_blank"; a.rel = "noopener noreferrer"; }
      else if (!/^[a-z][a-z0-9+.-]*:|^\/\//i.test(target)) button(block, label, async () => {
        let path = target.split("#")[0];
        if (path.startsWith("@")) { message("Mounted links are read-only and unavailable in this Studio build."); return; }
        if (!wikiLink && activePage) path = activePage.path.slice(0, activePage.path.lastIndexOf("/") + 1) + path;
        const parts = []; for (const part of path.split("/")) { if (part === "..") parts.pop(); else if (part && part !== ".") parts.push(part); }
        path = parts.join("/"); if (!/\.md$/i.test(path)) path += ".md";
        if (await mayLeave()) { dirty = false; await loadPage(path); }
      }); else block.append(document.createTextNode(label + " (blocked link)"));
      last = re.lastIndex;
    }
    block.append(document.createTextNode(body.slice(last)));
  }
}
async function pagesView(content) {
  const state=pageState(), toolbar=row(content);
  const search=field(toolbar,"Search pages"); search.type="search";
  const scope=field(toolbar,"Search in",["This wiki","All registered wikis"]);
  button(toolbar,"Graph",()=>showGraph(content),"graph");
  const split=el("div",undefined,content);split.className="split";
  const aside=el("aside",undefined,split);aside.setAttribute("aria-label","Page explorer");
  const tree=el("div",undefined,aside);tree.className="page-tree";tree.setAttribute("role","tree");tree.setAttribute("aria-label","Folders and pages");tree.id="page-list";
  const results=el("section",undefined,aside);results.hidden=true;
  const editor=el("div",undefined,split);editor.id="page-editor";
  el("p","Select a page to read it, or select a folder to browse its files.",editor);
  let lastFocus, typeBuffer="", typeAt=0;
  function focus(item) { tree.querySelectorAll('[role="treeitem"]').forEach(n=>n.tabIndex=-1);item.tabIndex=0;item.focus();lastFocus=item; }
  function select(item,path) { state.selected=path;tree.querySelectorAll('[role="treeitem"]').forEach(n=>n.setAttribute("aria-selected",String(n===item))); }
  async function branch(parent,path,level,offset=0) {
    const response=await StudioApi.wiki("children?path="+encodeURIComponent(path)+"&offset="+offset+"&limit=100");
    for(const entry of response.items) {
      const item=el("div",undefined,parent);item.setAttribute("role","treeitem");item.setAttribute("aria-level",String(level));item.setAttribute("aria-selected",String(state.selected===entry.path));item.tabIndex=lastFocus?-1:0;lastFocus=lastFocus||item;item.dataset.path=entry.path;
      const label=el("div",undefined,item);label.className="tree-label";label.title=entry.path;
      const folder=entry.kind==="folder", arrow=el("span",folder?"▸":"",label);arrow.className="tree-arrow";arrow.setAttribute("aria-hidden","true");withIcon(el("span",entry.name,label),folder?"folder":"pages");
      let group,loaded=false;
      async function expand(open) {
        item.setAttribute("aria-expanded",String(open));arrow.textContent=open?"▾":"▸";group.hidden=!open;
        if(open){state.expanded.add(entry.path);if(!loaded){await branch(group,entry.path,level+1);loaded=true;}}else state.expanded.delete(entry.path);
      }
      if(folder){group=el("div",undefined,item);group.setAttribute("role","group");group.hidden=true;item.setAttribute("aria-expanded","false");arrow.onclick=safely(async event=>{event.stopPropagation();focus(item);await expand(group.hidden);});}
      const activate=async()=>{if(!(await mayLeave()))return;dirty=false;editing=false;focus(item);select(item,entry.path);if(folder){state.folder=entry.path;activePage=null;editor.replaceChildren();el("h4",entry.path,editor);el("p","Expand this folder to select a page. Its index.md file is its landing page.",editor);await expand(true);}else{state.folder=entry.path.includes("/")?entry.path.slice(0,entry.path.lastIndexOf("/")):"";await loadPage(entry.path);}};
      label.onclick=safely(activate);
      item.addEventListener("keydown",safely(async event=>{
        if(event.target!==item)return;
        const visible=[...tree.querySelectorAll('[role="treeitem"]')].filter(n=>!n.closest('[hidden]')),index=visible.indexOf(item);let next;
        if(event.key==="ArrowDown")next=visible[index+1];else if(event.key==="ArrowUp")next=visible[index-1];else if(event.key==="Home")next=visible[0];else if(event.key==="End")next=visible.at(-1);
        else if(event.key==="ArrowRight"&&folder){if(group.hidden)await expand(true);else next=group.querySelector('[role="treeitem"]');}
        else if(event.key==="ArrowLeft"){if(folder&&!group.hidden)await expand(false);else next=item.parentElement.closest('[role="treeitem"]');}
        else if(event.key==="Enter"||event.key===" ")await activate();
        else if(event.key.length===1&&!event.metaKey&&!event.ctrlKey){if(Date.now()-typeAt>700)typeBuffer="";typeAt=Date.now();typeBuffer+=event.key.toLowerCase();next=[...visible.slice(index+1),...visible.slice(0,index+1)].find(n=>n.querySelector('.tree-label').textContent.replace(/^[▸▾]/,"").toLowerCase().startsWith(typeBuffer));}
        else return;
        event.preventDefault();event.stopPropagation();if(next)focus(next);
      }));
      if(folder&&state.expanded.has(entry.path))await expand(true);
    }
    if(response.truncated){
      const childName=state.selected.startsWith(path?path+"/":"")?state.selected.slice(path?path.length+1:0).split("/")[0]:"";
      if(childName&&!response.items.some(e=>e.name===childName)){await branch(parent,path,level,offset+response.items.length);return;}
      const more=button(parent,"Load more in "+(path||currentWiki.name),async()=>{more.remove();await branch(parent,path,level,offset+response.items.length);});more.classList.add("tree-more");}
    if(!response.items.length&&!offset)el("p","Empty folder",parent).className="muted";
  }
  async function refresh(){state.scroll=aside.scrollTop;lastFocus=null;tree.replaceChildren();await branch(tree,"",1);aside.scrollTop=state.scroll;}
  tree.studioRefresh=refresh;
  tree.reveal=async path=>{const parts=path.split("/");for(let i=1;i<parts.length;i++)state.expanded.add(parts.slice(0,i).join("/"));state.selected=path;await refresh();const item=[...tree.querySelectorAll('[role="treeitem"]')].find(n=>n.dataset.path===path);if(item){focus(item);item.scrollIntoView({block:"nearest"});}else message("This folder has more entries. Use Load more to reveal the selected page.");};
  button(toolbar,"Refresh",refresh);
  const newPage=button(toolbar,"New page",async()=>{if(!(await mayLeave()))return;const path=await askText("New Markdown path",(state.folder?state.folder+"/":"")+"new-page.md");if(!path)return;activePage={path,content:"# New page\n",revision:null,creating:true};editing=true;dirty=true;drawEditor();});disable(newPage,writeReason());
  async function searchPages(offset=0){
    const query=search.value.trim();results.replaceChildren();results.hidden=!query;if(!query)return;
    el("h4","Search results",results);
    const response=await StudioApi.request((scope.value==="All registered wikis"?"search":wikiPath("search"))+"?q="+encodeURIComponent(query)+"&limit=100&offset="+offset);
    if(response.warning)el("p",response.warning,results);if(response.coverage)technical(response.coverage,results,"Search coverage");
    const items=response.results||response.items||[];
    for(const hit of items){const r=row(results);button(r,(hit.wikiId?hit.wikiId+" / ":"")+hit.path,async()=>{if(!(await mayLeave()))return;dirty=false;if(hit.wikiId&&hit.wikiId!==currentWiki.id){await openWiki(await StudioApi.request("wikis/"+hit.wikiId));}await loadPage(hit.path);});button(r,"Reveal in tree",async()=>{if(hit.wikiId&&hit.wikiId!==currentWiki.id){await openWiki(await StudioApi.request("wikis/"+hit.wikiId));}await document.getElementById("page-list").reveal(hit.path);});}
    if(!items.length)el("p","No matching pages in the reported search coverage.",results);
    if(offset)button(results,"Previous results",()=>searchPages(Math.max(0,offset-100)));if(response.truncated)button(results,"More results",()=>searchPages(offset+100));
  }
  button(toolbar,"Search",()=>searchPages());search.onkeydown=safely(async e=>{if(e.key==="Enter"){e.preventDefault();await searchPages();}});search.oninput=()=>{if(!search.value)results.hidden=true;};
  await refresh();aside.scrollTop=state.scroll;aside.onscroll=()=>{state.scroll=aside.scrollTop;};
  if(state.selected.endsWith(".md")){try{await loadPage(state.selected,false);}catch(e){message(e.message,true);}}
}
async function showGraph(content){if(!(await mayLeave()))return;dirty=false;content.replaceChildren();destroyDetachedCharts();button(content,"Back to pages",()=>navigate("Pages"));await window.studioToolsView("Graph",content);}
async function loadPage(path, record = true) {
  const wikiId=currentWiki.id, target=document.getElementById("page-editor");
  const page=await StudioApi.wiki("page?path="+encodeURIComponent(path));
  if(currentWiki.id!==wikiId||!target?.isConnected)return;
  activePage=page;dirty=false;editing=false;pageState().selected=path;
  document.querySelectorAll('#page-list [role="treeitem"]').forEach(n=>n.setAttribute("aria-selected",String(n.dataset.path===path)));
  if(record)history.pushState({wikiId,view:"Pages",path},"","#wiki="+encodeURIComponent(wikiId)+"&view=Pages&page="+encodeURIComponent(path));
  drawEditor();
}
function drawEditor() {
  const editor = document.getElementById("page-editor"); if (!editor) return;
  editor.replaceChildren(); const page = activePage, wikiId = currentWiki.id;
  const crumbs=row(editor);crumbs.classList.add("breadcrumbs");
  button(crumbs,currentWiki.name,()=>document.getElementById("page-list").reveal(page.path),"folder");el("span",page.path,crumbs);
  if(!editing) {
    const toolbar=row(editor);disable(button(toolbar,"Edit",()=>{editing=true;drawEditor();},"edit"),writeReason());
    button(toolbar,"Reveal in tree",()=>document.getElementById("page-list").reveal(page.path),"tree");
    const article=el("article",undefined,editor);article.className="page-preview";renderMarkdown(page.content,article);
    technical({metadata:page.metadata,links:page.links,sourceIds:page.sourceIds,warnings:page.warnings},editor,"Page details and provenance");
    StudioApi.wiki("backlinks?path="+encodeURIComponent(page.path)).then(result=>{if(article.isConnected)technical(result,editor,"Incoming links");}).catch(e=>message(e.message,true));
    return;
  }
  el("h4", "Editing " + page.path, editor);
  if (page.sourceManaged) el("p", "Source-managed page: future imports may conflict with manual edits. " + (page.sourceIds || []).join(", "), editor);
  const toolbar = el("div", undefined, editor); toolbar.className = "row";
  const columns = el("div", undefined, editor); columns.className = "editor";
  const source = el("textarea", undefined, columns); source.setAttribute("aria-label", "Complete raw Markdown including frontmatter"); source.value = page.content; source.readOnly = currentWiki.access !== "rw";
  const modes=row(editor);editor.insertBefore(modes,columns);
  for(const mode of ["Source and preview","Source","Preview"])button(modes,mode,()=>{columns.className="editor"+(mode==="Source and preview"?"":" single");source.hidden=mode==="Preview";preview.hidden=mode==="Source";});
  const preview = el("article", undefined, columns); preview.setAttribute("aria-label", "Safe Markdown preview"); renderMarkdown(source.value, preview);
  source.oninput = () => { dirty = true; message("Unsaved changes"); renderMarkdown(source.value, preview); };
  async function save() {
    try {
      const result = await StudioApi.wiki(page.creating ? "pages" : "page?path=" + encodeURIComponent(page.path), page.creating ? "POST" : "PUT", { path: page.path, content: source.value, expectedRevision: page.revision });
      if (!editor.isConnected || currentWiki.id !== wikiId || activePage !== page) { message("Page saved"); return; }
      activePage = result; dirty = false; editing = false; pageState().selected=result.path; message("Saved"); await document.getElementById("page-list")?.studioRefresh?.(); drawEditor();
    } catch (e) {
      if (!editor.isConnected || currentWiki.id !== wikiId || activePage !== page) { message(e.message, true); return; }
      if (e.status === 409) {
        message("Conflict: your local text is preserved. Compare with the current server copy, copy/merge, then reload before retrying.", true);
        const server = await StudioApi.wiki("page?path=" + encodeURIComponent(page.path));
        const compare = el("section", undefined, editor); el("h4", "Server copy · " + server.revision, compare); el("pre", server.content, compare);
        button(compare, "Use current revision with my merged text", async () => { if (await askConfirmation("Have you merged the server changes into your local text?")) { page.revision = server.revision; message("Merged revision selected; review text and Save."); } });
      } else throw e;
    }
  }
  button(toolbar, "Save ⌘/Ctrl+S", save).disabled = currentWiki.access !== "rw";
  button(toolbar, "Cancel editing", async () => { if (await mayLeave()) { if(page.creating){dirty=false;editing=false;activePage=null;editor.replaceChildren();}else await loadPage(page.path); } });
  button(toolbar, "Move / rename", async () => { if (dirty) throw new Error("Save or revert before moving"); const destination = await askText("Destination Markdown path", page.path); if (destination && destination !== page.path) { const moved = await StudioApi.wiki("pages/move", "POST", { source: page.path, destination, expectedRevision: page.revision }); if (!editor.isConnected || currentWiki.id !== wikiId || activePage !== page) return; activePage=moved; pageState().selected=activePage.path; await document.getElementById("page-list")?.studioRefresh?.(); drawEditor(); } }).disabled = currentWiki.access !== "rw" || page.creating;
  button(toolbar, "Delete", async () => { if (await askConfirmation("Delete " + page.path + "?")) { await StudioApi.wiki("page?path=" + encodeURIComponent(page.path), "DELETE", { expectedRevision: page.revision, confirmation: page.path }); if (!editor.isConnected || currentWiki.id !== wikiId || activePage !== page) return; dirty = false; activePage = null; editor.replaceChildren(); pageState().selected=""; await document.getElementById("page-list")?.studioRefresh?.(); message("Deleted"); } }).disabled = currentWiki.access !== "rw" || page.creating;
  source.onkeydown = safely(async event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); await save(); } });
  const metadata = el("details", undefined, editor); el("summary", "Frontmatter, outgoing links and provenance", metadata); jsonView({ metadata: page.metadata, links: page.links, sourceIds: page.sourceIds, warnings: page.warnings }, metadata);
  if (!page.creating) StudioApi.wiki("backlinks?path=" + encodeURIComponent(page.path)).then(result => { const details = el("details", undefined, editor); el("summary", "Incoming backlinks", details); jsonView(result, details); }).catch(e => message(e.message, true));
}
window.addEventListener("beforeunload", event => { if (dirty) { event.preventDefault(); event.returnValue = ""; } });
async function graphView(content) {
  const stats = await StudioApi.wiki("graph/stats"); el("p", stats.source + " · " + stats.freshness, content);
  button(content, "Open graph", async () => {
    const html = await StudioApi.graphHtml(currentWiki.id);
    if (graphBlob) URL.revokeObjectURL(graphBlob);
    graphBlob = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    let frame = content.querySelector("iframe"); if (!frame) frame = el("iframe", undefined, content);
    frame.title = "Wiki graph; accessible filters and node list inside"; frame.setAttribute("sandbox", "allow-scripts allow-downloads"); frame.src = graphBlob;
    const notice = el("p", "Waiting for the isolated renderer…", content); notice.id = "graph-ready-status";
    button(content, "Download offline HTML", () => { const a = el("a", undefined, content); a.href = graphBlob; a.download = currentWiki.id + "-graph.html"; a.click(); a.remove(); });
    setTimeout(() => { if (notice.isConnected && !frame.dataset.ready) notice.textContent = "This browser did not report renderer readiness. It may block sandboxed Blob frames. Download the self-contained HTML or use the Pages list."; }, 8000);
  });
  el("p", "Graph opens with no network or parent DOM access. Pages remains an accessible list alternative.", content);
}
window.addEventListener("message", safely(async event => {
  const frame = document.querySelector("#view iframe"), d = event.data;
  if (frame && event.source === frame.contentWindow && event.origin === "null" && d?.type === "mini-a-wiki-graph-ready" && d.version === 1) { frame.dataset.ready = "true"; const status = document.getElementById("graph-ready-status"); if (status) status.textContent = "Isolated renderer ready"; return; }
  if (!frame || event.source !== frame.contentWindow || event.origin !== "null" || !d || d.type !== "mini-a-wiki-graph-node" || d.version !== 1 || typeof d.path !== "string" || d.nodeId !== "doc:" + d.path || d.path.length > 512 || /[\\%:\x00-\x1f?#]/.test(d.path) || !/\.md$/i.test(d.path) || d.path.split("/").some(p => !p || p === "." || p === ".." || p.startsWith(".") || /^AGENTS\.md$/i.test(p))) return;
  if (!(await mayLeave())) return; dirty = false; const view = document.getElementById("view"); view.replaceChildren(); await pagesView(view); await loadPage(d.path);
}));
function field(parent, name, choices, initial) {
  const label = el("label", name, parent), input = el(choices ? "select" : "input", undefined, label);
  if (choices) choices.forEach(value => { const o = el("option", value, input); o.value = value; });
  if (initial !== undefined) input.value = initial;
  return input;
}
function check(parent, title) { const label = el("label", title, parent), input = el("input", undefined, label); label.className="check-field"; input.type = "checkbox"; label.prepend(input); return input; }
const trackedJobs = new Map();
async function queue(suffix, body) {
  const wikiId=currentWiki.id, job=await StudioApi.wiki(suffix,"POST",body);
  message(human(job.operation)+" started");
  const host=document.getElementById("background-jobs");
  const status=row(host);status.classList.add("background-job");const text=el("span",human(job.operation)+" · Queued",status);
  button(status,"View activity",()=>jobDetail(job.id),"jobs");
  async function poll(){
    try {const latest=await StudioApi.request("jobs/"+job.id);trackedJobs.set(job.id,latest);text.textContent=human(latest.operation)+" · "+human(latest.status)+(latest.phase!==latest.status?" · "+human(latest.phase):"");
      if(terminalStates.includes(latest.status)){if(["failed","partial","recovery-required","interrupted"].includes(latest.status))status.classList.add("error");button(status,"Dismiss",()=>status.remove(),"cross");return latest;}
    }catch(e){text.textContent=e.message;button(status,"Dismiss",()=>status.remove(),"cross");return {status:"unavailable"};}
    return new Promise(resolve=>setTimeout(()=>resolve(poll()),1500));
  }
  job.finished=poll();job.wikiId=wikiId;return job;
}
window.studioToolsView = async function(name, content) {
  if (name === "Graph") {
    const semantic = check(content, "Opt in to model semantic extraction"); disable(semantic, writeReason(true));
    button(content, "Queue graph rebuild", () => queue("graph/rebuild", { semantic: semantic.checked })).disabled = currentWiki.access !== "rw";
    await graphView(content); return;
  }
  if (name === "Jobs") return jobsView(content);
  if (name === "Sources") return sourcesView(content);
  if (name === "Absorb") return absorbView(content);
  if (name === "Dreams") return dreamsView(content);
};
async function jobsView(content) {
  const wikiId=currentWiki.id;
  const jobs=await allItems("jobs?wikiId="+encodeURIComponent(wikiId));
  const toolbar=row(content), filter=field(toolbar,"Status",["All",...new Set(jobs.map(j=>j.status))]), search=field(toolbar,"Find operation");
  button(toolbar,"Refresh",()=>navigate("Activity"));
  const selection=new Set(), tableHost=el("div",undefined,content);
  async function remove(ids){
    const selected=jobs.filter(j=>ids.includes(j.id)),eligible=selected.filter(j=>j.deletion?.allowed),blocked=selected.filter(j=>!j.deletion?.allowed);
    if(!eligible.length){message("No selected jobs can be deleted. Resolve recovery or wait for active jobs.",true);return;}
    const explanation=blocked.map(j=>human(j.operation)+": "+j.deletion.reason).join("\n");
    if(!(await askConfirmation("Delete history for "+eligible.length+" jobs in "+currentWiki.name+"? Logs and results will be removed permanently. Wiki pages, sources, snapshots and saved plans remain."+(blocked.length?"\nExcluded "+blocked.length+" jobs:\n"+explanation:""))))return;
    await StudioApi.request("jobs","DELETE",{wikiId,ids:eligible.map(j=>j.id),confirmation:"delete-history"});await navigate("Activity");
  }
  button(toolbar,"Delete selected",()=>remove([...selection]),"trash");button(toolbar,"Clear eligible history",()=>remove(jobs.map(j=>j.id)),"trash");
  function draw(){
    tableHost.replaceChildren();const body=dataTable(tableHost,["Select","Operation","Status","Started","Duration","Outcome","Actions"]);
    const matching=jobs.filter(j=>(filter.value==="All"||j.status===filter.value)&&human(j.operation).toLowerCase().includes(search.value.toLowerCase()));
    for(const j of matching){const r=el("tr",undefined,body),cell=el("td",undefined,r),box=check(cell,"Select "+human(j.operation));box.checked=selection.has(j.id);box.onchange=()=>box.checked?selection.add(j.id):selection.delete(j.id);
      el("td",human(j.operation),r);const status=el("td",undefined,r);el("span",human(j.status),status).className="badge";
      el("td",date(j.createdAt),r);el("td",j.completedAt?Math.max(0,Math.round((Date.parse(j.completedAt)-Date.parse(j.createdAt))/1000))+" s":"—",r);el("td",j.warning|| (j.changedPageCount!==undefined?j.changedPageCount+" pages changed":"—"),r);
      const actions=el("td",undefined,r);button(actions,"Details",()=>jobDetail(j.id),"info");const del=button(actions,"Delete history",()=>remove([j.id]),"trash");disable(del,j.deletion?.allowed?"":j.deletion?.reason||"Unavailable");
    }
    if(!matching.length)el("p","No matching jobs.",tableHost);
  }
  filter.onchange=draw;search.oninput=draw;draw();
  const counts={};jobs.forEach(j=>counts[j.status]=(counts[j.status]||0)+1);metricChart(content,"Outcomes in retained job history",counts);
}
async function jobDetail(id) {
  const previous=document.activeElement, dialog=el("dialog",undefined,document.body);dialog.className="job-dialog";
  el("h3","Activity details",dialog);button(dialog,"Close",()=>dialog.close(),"cross");
  const summary=el("div",undefined,dialog),log=el("details",undefined,dialog);el("summary","Processing log",log);const events=el("pre","",log);
  const controls=row(dialog),cancel=button(controls,"Request cancellation",async()=>{await StudioApi.request("jobs/"+id+"/cancel","POST",{});cancel.disabled=true;message("Cancellation requested. The engine may finish its current writes.");});
  let cursor=0;
  dialog.addEventListener("close",()=>{dialog.remove();previous?.focus();destroyDetachedCharts();},{once:true});dialog.showModal();
  async function refresh(){
    if(!dialog.isConnected)return;
    try {
      const job=await StudioApi.request("jobs/"+id);if(!dialog.isConnected)return;
      summary.replaceChildren();el("h4",human(job.operation),summary);el("p",human(job.status)+" · "+date(job.createdAt),summary);
      if(job.warning)el("p",job.warning,summary).className="error";
      if(job.changedPageCount!==undefined)el("p",job.changedPageCount+" pages changed",summary);
      const finished=terminalStates.includes(job.status);cancel.disabled=finished||job.cancelRequested;
      if(!finished){const progress=el("progress",undefined,summary);progress.setAttribute("aria-label","Job in progress");el("p",human(job.phase)+". Updates automatically.",summary);}
      technical(job,summary);
      let received;
      do {received=0;for(const frame of (await StudioApi.events(id,cursor)).split("\n\n")){const line=frame.split("\n").find(l=>l.startsWith("data: "));if(!line)continue;const event=JSON.parse(line.slice(6));if(event.seq<=cursor)continue;cursor=event.seq;received++;events.textContent=(events.textContent+date(event.time)+" · "+event.message+"\n").slice(-100000);}}while(received===200&&dialog.isConnected);
      if(finished){
        outcome(summary,job.result);
        const changes=await StudioApi.request("wikis/"+encodeURIComponent(job.wikiId)+"/changes?jobId="+id);
        if(!dialog.isConnected)return;
        for(const change of changes.changes||[]){const r=row(summary);el("span",human(change.type||change.action)+" · "+change.path,r);if(change.path&&!/delete|removed/i.test(change.type||change.action||""))button(r,"Open page",async()=>{if(!(await mayLeave()))return;dirty=false;dialog.close();if(currentWiki.id!==job.wikiId)await openWiki(await StudioApi.request("wikis/"+job.wikiId));await navigate("Pages",true,change.path);});}
        technical(changes,summary,"Before and after changes");
        if(["partial","interrupted","recovery-required"].includes(job.status)&&!job.recoveryReviewedAt){el("p","Resolve engine recovery or restore a snapshot before marking this job reviewed. This action does not undo changes or remove journals.",summary);button(summary,"Mark recovery reviewed",async()=>{if(!(await askConfirmation("Have you resolved and checked recovery for this job? This acknowledges recovery; it does not repair the wiki.")))return;await StudioApi.request("jobs/"+id+"/review-recovery","POST",{confirmation:id});dialog.close();message("Recovery reviewed. History is eligible for cleanup when no journals remain.");});}
      }else setTimeout(refresh,1500);
    }catch(error){el("p",error.message,summary).className="error";}
  }
  await refresh();
}
async function sourcesView(content) {
  content.replaceChildren();el("p","Add content to "+currentWiki.name+". Review changes before importing them into your wiki.",content);
  const nav=row(content),body=el("div",undefined,content);
  button(nav,"Source library",()=>library());button(nav,"Add source",()=>prepare());button(nav,"Import from another wiki",async()=>{body.replaceChildren();await absorbView(body);});
  async function library(){
    body.replaceChildren();const sources=await allItems(wikiPath("sources"));
    if(!sources.length){el("p","No sources yet. Add files, a webpage or video captions to begin.",body);button(body,"Add your first source",()=>prepare());return;}
    const table=dataTable(body,["Source","Revision","Status","Actions"]);
    for(const source of sources){const r=el("tr",undefined,table);el("td",source.name,r);el("td",String(source.revision).slice(0,12),r);el("td",human(source.lastStatus||source.status),r);const actions=el("td",undefined,r);button(actions,"Preview and import",()=>review(source));button(actions,"Update source",()=>prepare(source));button(actions,"Details",()=>{body.replaceChildren();button(body,"Back to sources",library);technical(source,body,"Inventory and revision lineage").open=true;});}
  }
  async function prepare(existing){
    body.replaceChildren();el("h4",existing?"Update source: "+existing.name:"1. Choose a source",body);
    const method=field(body,"Source method",["Files or ZIP","Folder","Webpage","YouTube captions","Local directory / checkout"]);
    const panel=el("section",undefined,body);
    function draw(){
      panel.replaceChildren();el("h4","2. Prepare "+method.value.toLowerCase(),panel);
      const identity=row(panel),name=field(identity,"Source name",null,existing?.name||""),id=field(identity,"Stable source ID",null,existing?.id||"");id.readOnly=!!existing;
      el("p",existing?"This creates a new revision of the existing source.":"Use a descriptive name. The source ID identifies future updates.",panel).className="muted";
      let idEdited=!!existing;id.oninput=()=>{idEdited=true;};name.oninput=()=>{if(!idEdited)id.value=name.value.toLowerCase().replace(/[^a-z0-9_-]+/g,"-").replace(/^-|-$/g,"").slice(0,64);};
      const inputRow=row(panel),status=el("p","",panel);status.setAttribute("role","status");let submit;
      async function stage(payload){
        if(!name.value.trim()||!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id.value))throw new Error("Enter a source name and a valid lower-case source ID.");
        if(!existing){const known=await allItems(wikiPath("sources"));if(known.some(source=>source.id===id.value))throw new Error("That source ID already exists. Choose Update source from the library.");}
        const source=await StudioApi.wiki("sources","POST",{id:id.value,name:name.value.trim(),...payload});await review(source);
      }
      if(method.value==="Webpage"){
        const url=field(inputRow,"Webpage URL");url.type="url";url.placeholder="https://example.com/article";
        submit=button(inputRow,"Download webpage",()=>stage({type:"web",url:url.value.trim()}),"download");
      }else if(method.value==="YouTube captions"){
        const video=field(inputRow,"YouTube URL or video ID"),lang=field(inputRow,"Caption language",null,"en");
        submit=button(inputRow,"Download captions",()=>stage({type:"youtube",video:video.value.trim(),lang:lang.value.trim()||"en"}),"download");
      }else if(method.value==="Local directory / checkout"){
        const dirs=studioSession.adapters.directory||[];
        if(!dirs.length){el("p","Configure studiosourcedirs to select a trusted local directory or Git checkout.",inputRow);return;}
        const dir=field(inputRow,"Configured directory",dirs.map(d=>d.id)),kind=field(inputRow,"Kind",["directory","git"]);submit=button(inputRow,"Prepare source",()=>stage({type:kind.value,directoryId:dir.value}));
      }else{
        const file=field(inputRow,method.value==="Folder"?"Choose folder":"Choose files or one ZIP");file.type="file";file.multiple=true;if(method.value==="Folder")file.setAttribute("webkitdirectory","");
        const inventory=el("p","No files selected.",panel);file.onchange=()=>{inventory.textContent=file.files.length+" files · "+bytes([...file.files].reduce((n,f)=>n+f.size,0));};
        submit=button(inputRow,"Upload and prepare",async()=>{
          if(!file.files.length)throw new Error("Select files first");
          if(!name.value.trim()||!id.value)throw new Error("Enter a source name and ID before uploading");
          const uploadId=crypto.randomUUID();let index=0;
          for(const f of file.files){status.textContent="Uploading "+(++index)+" / "+file.files.length+" · "+f.name;await StudioApi.upload(uploadId,f.webkitRelativePath||f.name,f);}
          await stage({type:"upload",uploadId});
        },"upload");
      }
      disable(submit,writeReason());
      const action=submit.onclick;submit.onclick=async event=>{status.className="";submit.disabled=true;try{await action(event);}finally{if(submit.isConnected)submit.disabled=!!writeReason();}};
      // Errors stay with their form as well as in the global status line.
      const original=submit.onclick;submit.onclick=async event=>{await original(event);if(document.getElementById("message").classList.contains("error")){status.textContent=document.getElementById("message").textContent;status.className="error";}};
      if(["Webpage","YouTube captions"].includes(method.value))technical({network:"Public HTTP/HTTPS only; redirects checked; private addresses refused; 5 MiB limit",result:"Staged Markdown. Downloading does not import into the wiki."},panel,"Download details");
    }
    method.onchange=draw;draw();
  }
  async function review(source){
    body.replaceChildren();el("h4","3. Preview changes · "+source.name,body);
    el("p","Review this source revision before importing. Preview reports engine estimates; application revalidates the current source.",body);
    const advanced=el("details",undefined,body);el("summary","Advanced options",advanced);
    const mode=field(advanced,"Processing",["auto","normalize","raw","distill"]),layout=field(advanced,"Layout",["source","flat"]),section=field(advanced,"Destination section"),include=field(advanced,"Include patterns"),exclude=field(advanced,"Exclude patterns");
    const semantic=check(advanced,"Semantic extraction"),prune=check(advanced,"Remove source-owned pages missing from this revision");disable(semantic,writeReason(true));
    const actions=row(body),result=el("div",undefined,body);let approved=null,working=false;
    const options=()=>({mode:mode.value,layout:layout.value,section:section.value,include:include.value,exclude:exclude.value,semantic:semantic.checked,prune:prune.checked});
    const signature=()=>JSON.stringify(options());
    const preview=button(actions,"Preview changes",async()=>{
      working=true;preview.disabled=true;apply.disabled=true;const requested=signature();result.replaceChildren();el("p","Preparing preview…",result);
      try {const job=await queue("ingestions",{sourceId:source.id,revision:source.revision,preview:true,options:options(),confirmation:{acknowledgePrune:prune.checked}});const finished=await job.finished;
        result.replaceChildren();outcome(result,finished.result);
        if(finished.status==="completed"&&requested===signature()){approved=requested;apply.disabled=!!writeReason();el("p","Preview ready. Review the result, then import.",result);}else el("p","Preview is unavailable or options changed. Run Preview changes again.",result);
      }finally{working=false;if(preview.isConnected)preview.disabled=!!writeReason();}
    });disable(preview,writeReason());
    const apply=button(actions,"4. Import into wiki",async()=>{
      if(!approved||approved!==signature())throw new Error("Run a fresh preview first");
      const latest=await allItems(wikiPath("sources"));if(latest.find(x=>x.id===source.id)?.revision!==source.revision){approved=null;apply.disabled=true;throw new Error("Source revision changed. Select the current source from the library and preview again.");}
      if(prune.checked&&!(await askConfirmation("Remove source-owned pages missing from this revision? Engine conflict checks still protect manual edits.")))return;
      apply.disabled=true;const job=await queue("ingestions",{sourceId:source.id,revision:source.revision,preview:false,options:options(),confirmation:{acknowledgePrune:prune.checked}});approved=null;
      const finished=await job.finished;if(result.isConnected){result.replaceChildren();el("h4",human(finished.status),result);outcome(result,finished.result);button(result,"Inspect activity",()=>jobDetail(job.id));}
    });apply.disabled=true;
    advanced.addEventListener("input",()=>{approved=null;apply.disabled=true;if(!working){result.replaceChildren();el("p","Options changed. Preview again before importing.",result);}});
    technical(source,body,"Source revision details");
  }
  await library();
}
async function absorbView(content) {
  el("p", "Absorption uses Mini-A saved plans and recovery journals. Source wikis remain unchanged. A plan may require a model; apply reuses the saved plan.", content);
  const wikis = {items:await allItems("wikis")}, choices = el("div", undefined, content), selected = [];
  for (const wiki of wikis.items.filter(w => w.id !== currentWiki.id)) selected.push([wiki.id, check(choices, wiki.name)]);
  const paths = field(content, "Paths (comma-separated; empty means all)"), tags = field(content, "Tags (comma-separated)"), topic = field(content, "Topic"), exclude = field(content, "Exclusions (comma-separated)");
  button(content, "Generate saved plan", async () => {
    const body = { action: "plan", sourceWikiIds: selected.filter(([, box]) => box.checked).map(([id]) => id) };
    for (const [k, input] of [["paths", paths], ["tags", tags], ["exclude", exclude]]) if (input.value.trim()) body[k] = input.value.split(",").map(s => s.trim()).filter(Boolean);
    if (topic.value) body.topic = topic.value; await queue("absorptions", body);
  }).disabled = currentWiki.access !== "rw" || !studioSession?.canTestWiki;
  if(!studioSession?.canTestWiki)el("p","Configure OAF_MODEL to generate a plan. Existing saved plans can still be applied.",content).className="muted";
  const plan = field(content, "Saved plan ID");
  for (const action of ["status", "show", "apply", "resume", "delete", "cancel"]) button(content, action, async () => {
    if (["apply", "resume", "delete", "cancel"].includes(action) && !(await askConfirmation(action + " saved plan " + plan.value + "? Deleting a plan does not undo applied pages."))) return;
    await queue("absorptions", { action, planId: plan.value, confirmation: { applySavedPlan: true } });
  }).disabled = currentWiki.access !== "rw";
}
async function summaryView(content, health = false) {
  const reports=await Promise.allSettled([StudioApi.wiki("overview"),StudioApi.wiki("lint"),StudioApi.wiki("graph/stats")]);
  reports.forEach((report,index)=>{if(report.status==="rejected")el("p",["Wiki context","Health check","Graph status"][index]+": "+report.reason.message,content).className="error";});
  const info=reports[0].status==="fulfilled"?reports[0].value:{studio:{pageCount:"Unavailable",pendingRecovery:[]}},lint=reports[1].status==="fulfilled"?reports[1].value:{issues:[],total_issues:"Unavailable"},graph=reports[2].status==="fulfilled"?reports[2].value:{freshness:"Graph status unavailable"};
  const metrics=row(content);metrics.classList.add("metrics");
  for(const [label,value] of [["Pages",info.studio.pageCount],["Findings",lint.total_issues ?? lint.issues?.length ?? 0],["Pending recovery",info.studio.pendingRecovery.length]]){const card=el("section",undefined,metrics);el("strong",String(value),card);el("span",label,card);}
  if(info.studio.pendingRecovery.length)el("p","Recovery needs attention before further edits or imports.",content).className="error";
  if(health){
    const findings=lint.issues||[],counts={};findings.forEach(issue=>{const k=issue.type||issue.code||issue.kind||"Other";counts[k]=(counts[k]||0)+1;});
    metricChart(content,lint.truncated?"Issue categories (loaded findings only)":"Issue categories",counts);
    const groups={};
    for(const issue of findings){const type=issue.type||issue.code||issue.kind||"Other";(groups[type] ||= []).push(issue);}
    for(const [type,issues] of Object.entries(groups)){
      const category=el("details",undefined,content);el("summary",human(type)+" · "+issues.length+" findings",category);
      const body=dataTable(category,["Page","Details","Actions"]),pages={};
      issues.forEach(issue=>{const path=issue.page||issue.path||issue.section||"Wiki";(pages[path] ||= []).push(issue);});
      for(const [path,items] of Object.entries(pages)){
        const r=el("tr",undefined,body);el("td",path,r);const detail=el("td",undefined,r);
        el("p",items.map(issue=>issue.message||issue.reason||(issue.field||issue.key?"Missing "+(issue.field||issue.key):issue.target?"Link to "+issue.target:issue.parent?"Link from "+issue.parent:human(type))).filter((v,i,all)=>all.indexOf(v)===i).join("; "),detail);
        technical(items,detail);const actions=el("td",undefined,r);
        if(/\.md$/i.test(path)&&type!=="missing_index")button(actions,"Open page",()=>navigate("Pages",true,path));
        if(type==="missing_index")disable(button(actions,"Create landing page",async()=>{await navigate("Pages");activePage={path,content:"# "+(items[0].section||currentWiki.name)+"\n",revision:null,creating:true};editing=true;dirty=true;drawEditor();}),writeReason());
      }
    }
    if(lint.truncated){el("p","More findings are available.",content);button(content,"Load all findings",async()=>{let offset=findings.length,next;do{next=await StudioApi.wiki("lint?limit=100&offset="+offset);(next.issues||[]).forEach(issue=>{const section=el("section",undefined,content);el("p",issue.message||issue.path||human(issue.type),section);technical(issue,section);});offset+=(next.issues||[]).length;}while(next.truncated&&next.issues?.length);});}
    if(!findings.length&&reports[1].status==="fulfilled")el("p","No findings in the reported check coverage.",content);
  }else{
    const jobs=await allItems("jobs?wikiId="+encodeURIComponent(currentWiki.id));const active=jobs.filter(j=>!terminalStates.includes(j.status));
    el("h4","Current activity",content);if(!active.length)el("p","No running jobs.",content);active.forEach(j=>button(content,human(j.operation)+" · "+human(j.status),()=>jobDetail(j.id)));
    button(content,"Review wiki health",()=>navigate("Maintenance"));
  }
  el("p",graph.freshness,content);technical(info,content,"Wiki context");technical(graph,content,"Graph details");technical(lint,content,"Complete check result");
}
async function maintenanceView(content){
  const tabs=row(content),panel=el("div",undefined,content);
  for(const [label,render] of [["Health",()=>summaryView(panel,true)],["Tasks",()=>dreamsView(panel)],["Backups",()=>backupsView(panel)],["Recovery",()=>recoveryView(panel)]])button(tabs,label,async()=>{panel.replaceChildren();destroyDetachedCharts();await render();});
  await summaryView(panel,true);
}
async function recoveryView(content){
  el("p","Review engine recovery before retrying partial work. Cancelling a job does not roll back changes.",content);
  button(content,"Inspect ingestion recovery",()=>queue("ingestions",{action:"recovery"}));const recovery=field(content,"Ingestion recovery ID");
  for(const action of ["resume","discard"])disable(button(content,human(action)+" ingestion recovery",async()=>{if(await askConfirmation(human(action)+" this recovery journal? Discarding a journal does not undo imported pages."))await queue("ingestions",{action,recoveryId:recovery.value});}),writeReason());
  el("p","For absorption, use the saved plan controls in Import from another wiki. Backups can restore a verified earlier state.",content);button(content,"Open activity",()=>navigate("Activity"));
}
async function dreamsView(content) {
  el("p","Choose a maintenance task. Checks are diagnostics; reorganization makes live changes and is not an exact replay of a preview.",content);
  const cards=el("div",undefined,content);cards.className="task-grid";const optionsPanel=el("section",undefined,content);
  const tasks=[["Check wiki","plan","Read-only maintenance diagnostics."],["Repair","repair","Repair wiki consistency."],["Apply maintenance","apply","Apply engine maintenance changes."],["Rebuild search","reindex","Rebuild the search index."],["Update indexes","indexes","Refresh wiki index pages."],["Rebuild graph","graph","Rebuild page relationships."],["Automatic maintenance","auto","Diagnose, or explicitly apply repairs."],["Reorganize pages","reorg","Use the model to move, merge or remove pages."],["Compact storage","compact","Offline storage maintenance."]];
  function select(task){
    optionsPanel.replaceChildren();const [title,mode,description]=task;el("h4",title,optionsPanel);el("p",description,optionsPanel);
    const semantic=["graph","reorg"].includes(mode)?check(optionsPanel,"Use model semantic extraction"):null;if(semantic)disable(semantic,writeReason(true));
    const organize=mode==="reorg"?field(optionsPanel,"Organization",["none","topics"]):null,instructions=mode==="reorg"?field(optionsPanel,"Reorganization guidance"):null,steps=mode==="reorg"?field(optionsPanel,"Maximum model steps",null,"40"):null;if(steps){steps.type="number";steps.min="1";}
    const mutate=mode==="auto"?check(optionsPanel,"Apply repairs (otherwise only preview)"):null;
    const compact=!["plan","compact"].includes(mode)?check(optionsPanel,"Compact storage after success"):null;
    const external=mode!=="plan"?check(optionsPanel,"External CLI readers and writers are stopped"):null;
    const structural=mode==="reorg"?check(optionsPanel,"Allow structural changes after a verified backup"):null;
    if(mode!=="plan")el("p","Page-changing tasks create a verified backup first. Keep external writers stopped while the task runs.",optionsPanel);
    const actions=row(optionsPanel);disable(button(actions,"Start "+title.toLowerCase(),()=>mode==="compact"?queue("maintenance",{action:"compact",externalProcessesStopped:external.checked}):queue("dreams",{mode,options:{semantic:semantic?.checked||false,organize:organize?.value||"none",instructions:instructions?.value||"",dreammaxsteps:Number(steps?.value||40),compact:compact?.checked||false,dryrun:mode==="plan"||mode==="auto"&&!mutate.checked},confirmation:{acknowledgeStructuralChanges:structural?.checked||false,externalProcessesStopped:external?.checked||false}})),writeReason(mode==="reorg"));
    technical({engineMode:mode},optionsPanel);
  }
  for(const task of tasks){const card=el("section",undefined,cards);button(card,task[0],()=>select(task));el("p",task[2],card);}select(tasks[0]);
}
async function backupsView(content) {
  const section=el("section",undefined,content);el("h4","Backups",section);
  el("p","Verification checks snapshot integrity automatically. Manual and automatic snapshots can be removed when no active work or recovery depends on them.",section);
  disable(button(section,"Create snapshot",async()=>{const job=await queue("backups",{});await job.finished;if(section.isConnected){content.replaceChildren();destroyDetachedCharts();await backupsView(content);}}),writeReason());
  button(section,"Refresh",async()=>{content.replaceChildren();destroyDetachedCharts();await backupsView(content);});
  const backups=await allItems(wikiPath("backups")),table=dataTable(section,["Created","Origin","Size","Verification","Actions"]);
  if(!backups.length)el("p","No snapshots yet.",section);
  for(const backup of backups){const r=el("tr",undefined,table);el("td",date(backup.createdAt),r);el("td",human(backup.origin),r);el("td",bytes(backup.size),r);el("td",backup.verified?"Integrity checked at creation":"Not verified",r);const actions=el("td",undefined,r);
    disable(button(actions,"Restore",async()=>{if(!(await askConfirmation("Stop external readers and writers. Restore replaces the wiki tree after creating a verified pre-restore backup. Continue?")))return;const overview=await StudioApi.wiki("overview"),fingerprint=overview.studio.fingerprint;await queue("backups/"+backup.id+"/restore",{expectedFingerprint:fingerprint,confirmation:backup.id+":"+fingerprint,externalProcessesStopped:true});}),writeReason()||(!backup.verified?"Snapshot is not verified":""));
    disable(button(actions,"Delete",async()=>{const last=backup.verified&&backups.filter(b=>b.verified).length===1;if(!(await askConfirmation("Permanently delete the "+date(backup.createdAt)+" snapshot ("+bytes(backup.size)+")?"+(last?" This is the last verified backup. You will have no verified restore point.":""))))return;await StudioApi.wiki("backups/"+backup.id,"DELETE",{confirmation:backup.id,acknowledgeLast:last});content.replaceChildren();destroyDetachedCharts();await backupsView(content);}),writeReason()||(backup.deletion?.allowed?"":backup.deletion?.reason||"Unavailable"));
    technical(backup,actions);
  }
  const sizes={};backups.slice(0,10).forEach(b=>sizes[date(b.createdAt)+" · "+b.id.slice(0,8)]=Math.round(b.size/1024));metricChart(content,"Storage used by the 10 most recent snapshots",sizes,"KiB");
}

// Quote complete argv values for macOS/Linux shells, including apostrophes.
function studioShellQuote(value) { return "'" + String(value).replace(/'/g, "'\"'\"'") + "'"; }
function studioWebCommand(job, wikis, mode, port, advanced) {
  const args = [job, "mode=" + mode, "onport=" + port, "usewiki=true", "wikiaccess=ro", "wikiretrievalv2=true", "useshell=false", "webadvanced=" + advanced];
  if (wikis.length === 1) args.push("wikiroot=" + wikis[0].root);
  else args.push("wikimounts=" + JSON.stringify(wikis.map(w => ({name:w.id, backend:"fs", root:w.root}))));
  return "ojob " + args.map(studioShellQuote).join(" ");
}
async function webCommandWizard(selectedId) {
  const session = await StudioApi.request("session"), wikis = [];
  let page, offset = 0;
  do { page = await StudioApi.wikis(offset); wikis.push(...page.items); offset += page.items.length; } while (page.truncated && page.items.length);
  const previous = document.activeElement, dialog = el("dialog", undefined, document.body); dialog.className = "web-command-wizard";
  const heading = el("h3", "Build a Mini-A Web command", dialog); heading.id = "web-command-title"; dialog.setAttribute("aria-labelledby", heading.id);
  el("p", "1. Choose one or more wikis. Multiple wikis become read-only named mounts.", dialog);
  const choices = wikis.map(wiki => { const input = check(dialog, wiki.name + " (" + wiki.id + ")"); input.checked = wiki.id === selectedId; return {wiki,input}; });
  if (!wikis.length) el("p", "Register a wiki first to build a command.", dialog);
  el("p", "2. Choose launch options.", dialog);
  const mode = field(dialog, "Mode", ["webini", "web"]), port = field(dialog, "Port"); port.type = "number"; port.min = "1"; port.max = "65535"; port.value = "8888";
  const advanced = check(dialog, "Enable Advanced view (trusted console controls)");
  el("p", "3. Copy and run in a terminal with OAF_MODEL configured. Wiki access is read-only and shell access is disabled. This preview does not start a server.", dialog);
  const preview = el("textarea", undefined, dialog); preview.readOnly = true; preview.setAttribute("aria-label", "Command preview");
  const status = el("p", "", dialog); status.setAttribute("role", "status");
  const copy = button(dialog, "Copy command", async () => { try { await navigator.clipboard.writeText(preview.value); status.textContent = "Command copied."; } catch (_) { preview.focus(); preview.select(); status.textContent = "Select Copy from your browser or press Command-C / Ctrl-C."; } }, "save");
  button(dialog, "Close", () => dialog.close(), "cross");
  function update() {
    const selected = choices.filter(c => c.input.checked).map(c => c.wiki), valid = selected.length > 0 && /^\d+$/.test(port.value) && Number(port.value) >= 1 && Number(port.value) <= 65535;
    copy.disabled = !valid; preview.value = valid ? studioWebCommand(session.webJob, selected, mode.value, port.value, advanced.checked) : "";
    status.textContent = valid ? "After startup, open http://localhost:" + port.value + (advanced.checked ? " using the generated access URL printed in your terminal." : ".") : "Select at least one wiki and a port between 1 and 65535.";
  }
  dialog.addEventListener("input", update); dialog.addEventListener("change", update);
  dialog.addEventListener("close", () => { dialog.remove(); previous?.focus(); }, {once:true});
  update(); dialog.showModal();
}
