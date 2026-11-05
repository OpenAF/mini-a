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
  info: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16ZM12 11v5M12 8v.01"
};
function svgIcon(name, size = 14) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [k, v] of Object.entries({ viewBox: "0 0 24 24", width: size, height: size, fill: "none", stroke: "currentColor", "stroke-width": "1.8", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", focusable: "false", class: "studio-icon" })) svg.setAttribute(k, v);
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path"); path.setAttribute("d", ICONS[name] || ICONS.info); svg.append(path); return svg;
}
const withIcon = (node, name) => { if (name) node.prepend(svgIcon(name)); return node; };
const VIEW_ICONS = { Overview: "overview", Pages: "pages", Graph: "graph", Sources: "sources", Absorb: "absorb", Dreams: "dreams", Jobs: "jobs", Health: "health", Settings: "settings" };
const BUTTON_ICONS = [[/^all wikis|^first page|^previous/i, "back"], [/cancel|unregister|^delete/i, "trash"], [/^add |^new |^create|^queue|^stage/i, "add"], [/^save/i, "save"], [/^revert|reload|^restore|^apply|rerun/i, "reset"], [/refresh|^search/i, "refresh"], [/download/i, "download"], [/^open|^inspect|^next|^use /i, "open"], [/^move|^rename/i, "move"], [/^preview|^generate/i, "play"], [/^snapshot/i, "snapshot"], [/^folder tree/i, "tree"], [/^status$/i, "info"], [/^show$/i, "open"], [/^resume$/i, "play"], [/\.md$/i, "pages"]];
const STATE_ICONS = { completed: "check", succeeded: "check", done: "check", failed: "cross", error: "cross", cancelled: "stop", canceled: "stop", running: "jobs", queued: "clock" };
const message = (text, error = false) => { const node = document.getElementById("message"); node.textContent = text; node.className = error ? "error" : ""; };
const safely = fn => async (...args) => { try { await fn(...args); } catch (error) { message(error.message, true); } };
async function unlock(token) {
  StudioApi.token = token; await StudioApi.request("session");
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
let currentWiki, activePage, dirty = false, graphBlob;
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
function button(parent, title, action, icon) { const b = el("button", title, parent); b.type = "button"; b.onclick = safely(action); const hit = BUTTON_ICONS.find(([re]) => re.test(title)); return withIcon(b, icon || (hit ? hit[1] : "pages")); }
function navButton(nav, name, action) { return button(nav, name, action, VIEW_ICONS[name]); }
function wikiPath(suffix = "") { return "wikis/" + encodeURIComponent(currentWiki.id) + (suffix ? "/" + suffix : ""); }
StudioApi.wiki = function(suffix, method, body) { return this.request(wikiPath(suffix), method, body); };
async function openWiki(wiki) {
  if (!(await mayLeave())) return;
  currentWiki = wiki; activePage = null; dirty = false;
  const host = document.getElementById("workspace"); host.replaceChildren();
  button(host, "All wikis", async () => { if (await mayLeave()) { dirty = false; await dashboard(); } });
  withIcon(el("h2", wiki.name + " · " + wiki.access, host), wiki.access === "rw" ? "edit" : "lock");
  const nav = el("nav", undefined, host); nav.setAttribute("aria-label", "Wiki views");
  const content = el("div", undefined, host); content.id = "view";
  for (const name of ["Overview", "Pages", "Graph", "Sources", "Absorb", "Dreams", "Jobs", "Health", "Settings"]) navButton(nav, name, async () => {
    if (!(await mayLeave())) return; dirty = false; activePage = null; if (graphBlob) { URL.revokeObjectURL(graphBlob); graphBlob = null; }
    content.replaceChildren(); message(""); await showView(name, content);
  });
  await showView("Overview", content);
}
async function showView(name, content) {
  withIcon(el("h3", name, content), VIEW_ICONS[name]);
  if (name === "Pages") return pagesView(content);
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
    el("p", "Studio coordinates its own readers and writers. Stop external CLI readers/writers before offline maintenance.", content);
    for (const [route, title, icon] of [["overview", "Wiki context", "overview"], ["graph/stats", "Graph status", "graph"], ["lint", "Lint findings", "health"]]) {
      const section = el("section", undefined, content); withIcon(el("h4", title, section), icon);
      try { jsonView(await StudioApi.wiki(route), section); } catch (e) { el("p", e.message, section); }
    }
    return;
  }
  if (name === "Settings") {
    jsonView(currentWiki, content);
    button(content, "Rename display name", async () => { const name = await askText("Display name", currentWiki.name); if (name) { await StudioApi.wiki("", "PATCH", { name }); currentWiki.name = name; await openWiki(currentWiki); } }, "edit");
    button(content, currentWiki.access === "rw" ? "Make read-only" : "Enable writes", async () => { const access = currentWiki.access === "rw" ? "ro" : "rw"; await StudioApi.wiki("", "PATCH", { access }); currentWiki.access = access; await openWiki(currentWiki); }, currentWiki.access === "rw" ? "lock" : "unlock");
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
  const toolbar = el("div", undefined, content); toolbar.className = "row";
  const searchLabel = el("label", "Search this wiki", toolbar); const search = el("input", undefined, searchLabel); search.type = "search";
  const scope = field(toolbar,"Scope",["This wiki","All registered wikis"]);
  const split = el("div", undefined, content); split.className = "split";
  const list = el("aside", undefined, split); list.id = "page-list";
  const editor = el("div", undefined, split); editor.id = "page-editor";
  let offset = 0;
  async function refresh() {
    list.replaceChildren(); const response = search.value&&scope.value==="All registered wikis" ? await StudioApi.request("search?q="+encodeURIComponent(search.value)) : await StudioApi.wiki(search.value ? "search?q=" + encodeURIComponent(search.value) : "pages?limit=100&offset=" + offset);
    const items = Array.isArray(response) ? response : response.results || response.items || response.pages || [];
    if (response.warning) el("p", response.warning, list);
    if(response.coverage){const coverage=el("details",undefined,list);el("summary","Per-wiki search coverage",coverage);jsonView(response.coverage,coverage)}
    for (const item of items) { const path = typeof item === "string" ? item : item.path; if (path && !/(^|\/)AGENTS\.md$/i.test(path)) button(list, (item.wikiId?item.wikiId+" / ":"")+path, async () => { if (await mayLeave()) { dirty = false;if(item.wikiId&&item.wikiId!==currentWiki.id){const wiki=await StudioApi.request("wikis/"+item.wikiId);await openWiki(wiki);const view=document.getElementById("view");view.replaceChildren();await pagesView(view)} await loadPage(path); } }); }
    if (!items.length) el("p", "No pages found. Search can have incomplete coverage; check Health.", list);
    if (!search.value && items.length === 100) button(list, "Next 100", async () => { offset += 100; await refresh(); });
    if (offset) button(list, "First page", async () => { offset = 0; await refresh(); });
  }
  button(toolbar, "Search / refresh", refresh);
  button(toolbar,"Folder tree",async()=>{
    const tree=await StudioApi.wiki("tree");list.replaceChildren();let count=0;
    const draw=(node,parent)=>{if(count++>=1000)return;const details=el("details",undefined,parent);details.open=!node.path;el("summary",(node.name||currentWiki.name)+" · "+node.page_count,details);if(node.index?.exists)button(details,"index.md",async()=>{if(await mayLeave()){dirty=false;await loadPage(node.index.path)}});for(const page of node.pages||[]){if(!/(^|\/)AGENTS\.md$/i.test(page.path))button(details,page.title||page.path,async()=>{if(await mayLeave()){dirty=false;await loadPage(page.path)}})}for(const section of node.sections||[])draw(section,details)};
    draw(tree,list);if(tree.truncated||count>=1000)el("p","Tree is bounded; use search or the paginated page list for remaining pages.",list);
  });
  button(toolbar, "New page", async () => {
    if (!(await mayLeave())) return; const path = await askText("New Markdown path", "new-page.md"); if (!path) return;
    activePage = { path, content: "# New page\n", revision: null, creating: true }; dirty = true; drawEditor();
  }).disabled = currentWiki.access !== "rw";
  await refresh();
  list.studioRefresh = refresh;
}
async function loadPage(path) { activePage = await StudioApi.wiki("page?path=" + encodeURIComponent(path)); dirty = false; drawEditor(); }
function drawEditor() {
  const editor = document.getElementById("page-editor"); if (!editor) return;
  editor.replaceChildren(); const page = activePage; el("h4", page.path, editor);
  if (page.sourceManaged) el("p", "Source-managed page: future imports may conflict with manual edits. " + (page.sourceIds || []).join(", "), editor);
  const toolbar = el("div", undefined, editor); toolbar.className = "row";
  const columns = el("div", undefined, editor); columns.className = "editor";
  const source = el("textarea", undefined, columns); source.setAttribute("aria-label", "Complete raw Markdown including frontmatter"); source.value = page.content; source.readOnly = currentWiki.access !== "rw";
  const preview = el("article", undefined, columns); preview.setAttribute("aria-label", "Safe Markdown preview"); renderMarkdown(source.value, preview);
  source.oninput = () => { dirty = true; message("Unsaved changes"); renderMarkdown(source.value, preview); };
  async function save() {
    try {
      const result = await StudioApi.wiki(page.creating ? "pages" : "page?path=" + encodeURIComponent(page.path), page.creating ? "POST" : "PUT", { path: page.path, content: source.value, expectedRevision: page.revision });
      activePage = result; dirty = false; message("Saved"); await document.getElementById("page-list")?.studioRefresh?.(); drawEditor();
    } catch (e) {
      if (e.status === 409) {
        message("Conflict: your local text is preserved. Compare with the current server copy, copy/merge, then reload before retrying.", true);
        const server = await StudioApi.wiki("page?path=" + encodeURIComponent(page.path));
        const compare = el("section", undefined, editor); el("h4", "Server copy · " + server.revision, compare); el("pre", server.content, compare);
        button(compare, "Use current revision with my merged text", async () => { if (await askConfirmation("Have you merged the server changes into your local text?")) { page.revision = server.revision; message("Merged revision selected; review text and Save."); } });
      } else throw e;
    }
  }
  button(toolbar, "Save ⌘/Ctrl+S", save).disabled = currentWiki.access !== "rw";
  button(toolbar, "Revert / reload", async () => { if (await mayLeave()) await loadPage(page.path); });
  button(toolbar, "Move / rename", async () => { if (dirty) throw new Error("Save or revert before moving"); const destination = await askText("Destination Markdown path", page.path); if (destination && destination !== page.path) { activePage = await StudioApi.wiki("pages/move", "POST", { source: page.path, destination, expectedRevision: page.revision }); drawEditor(); } }).disabled = currentWiki.access !== "rw" || page.creating;
  button(toolbar, "Delete", async () => { if (await askConfirmation("Delete " + page.path + "?")) { await StudioApi.wiki("page?path=" + encodeURIComponent(page.path), "DELETE", { expectedRevision: page.revision, confirmation: page.path }); dirty = false; activePage = null; editor.replaceChildren(); message("Deleted"); } }).disabled = currentWiki.access !== "rw" || page.creating;
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
function check(parent, title) { const label = el("label", title, parent), input = el("input", undefined, label); input.type = "checkbox"; return input; }
async function queue(suffix, body) { const job = await StudioApi.wiki(suffix, "POST", body); message("Queued job " + job.id); await jobDetail(job.id); return job; }
window.studioToolsView = async function(name, content) {
  if (name === "Graph") {
    const semantic = check(content, "Opt in to model semantic extraction");
    button(content, "Queue graph rebuild", () => queue("graph/rebuild", { semantic: semantic.checked })).disabled = currentWiki.access !== "rw";
    await graphView(content); return;
  }
  if (name === "Jobs") return jobsView(content);
  if (name === "Sources") return sourcesView(content);
  if (name === "Absorb") return absorbView(content);
  if (name === "Dreams") return dreamsView(content);
};
async function jobsView(content, offset = 0) {
  const result = await StudioApi.request("jobs?wikiId=" + encodeURIComponent(currentWiki.id) + "&limit=100&offset=" + offset);
  if (!result.items.length) el("p", "No jobs yet. History is persisted outside your wiki.", content);
  button(content, "Refresh jobs", async () => { content.replaceChildren(); await jobsView(content); });
  for (const job of result.items) { const card = el("section", undefined, content); el("h4", job.operation + " · " + job.status, card); el("p", job.createdAt, card); button(card, "Inspect " + job.id, () => jobDetail(job.id)); }
  if (offset) button(content,"Previous jobs",async()=>{content.replaceChildren();await jobsView(content,Math.max(0,offset-100));});
  if (result.truncated) button(content,"Next jobs",async()=>{content.replaceChildren();await jobsView(content,offset+100);});
}
async function jobDetail(id) {
  const view = document.getElementById("view"); view.replaceChildren(); el("h3", "Job " + id, view);
  const summary = el("div", undefined, view), events = el("pre", "", view); events.setAttribute("aria-label", "Job events");
  const key = currentWiki.id;
  const cancelButton = button(view, "Request cancellation", async () => { await StudioApi.request("jobs/" + id + "/cancel", "POST", {}); message("Cancellation requested. Active engines may finish with writes; no rollback is implied."); });
  let cursor = 0;
  async function refresh() {
    if (!summary.isConnected || currentWiki.id !== key) return;
    const job = await StudioApi.request("jobs/" + id); summary.replaceChildren(); const state = String(job.status || job.state || "unknown"); const badge = withIcon(el("p", state, summary), STATE_ICONS[state] || "info"); badge.className = "badge"; badge.dataset.state = state; jsonView(job, summary);
    const finished = ["completed", "failed", "partial", "recovery-required", "interrupted", "cancelled"].includes(job.status);
    cancelButton.disabled = finished || job.cancelRequested === true;
    if (!finished) {
      const activity = el("div", undefined, summary); activity.className = "job-activity";
      const progress = el("progress", undefined, activity); progress.setAttribute("aria-label", "Job in progress");
      el("p", job.cancelRequested ? "Cancellation requested — waiting for the engine to finish safely." : "Processing · " + (job.phase || state) + ". This view updates automatically.", activity);
    }
    let received;
    do {
    received = 0;
    for (const frame of (await StudioApi.events(id,cursor)).split("\n\n")) {
      const line = frame.split("\n").find(l => l.startsWith("data: ")); if (!line) continue;
      const event = JSON.parse(line.slice(6)); if (event.seq <= cursor) continue; cursor = event.seq; received++;
      events.textContent = (events.textContent + event.time + " [" + event.phase + "] " + event.message + "\n").slice(-100000);
    }
    } while (received === 200 && summary.isConnected);
    if (finished) {
      message(job.operation + " · " + job.status, ["failed", "partial", "recovery-required", "interrupted"].includes(job.status));
      const changes = await StudioApi.wiki("changes?jobId=" + id); const details = el("details", undefined, view); el("summary", "Actual before/after Markdown changes", details); jsonView(changes, details);
      if (["recovery-required", "interrupted"].includes(job.status)) el("p", "No automatic retry was performed. Inspect engine journals and follow the recovery instructions in docs/WIKI-STUDIO.md before submitting another operation.", view);
    } else setTimeout(safely(refresh), 1500);
  }
  await refresh();
}
async function sourcesView(content) {
  el("p", "Destination: " + currentWiki.name + ". Files are staged outside the wiki and are ingested only after Preview or Apply.", content);
  const catalog = await StudioApi.wiki("sources");
  for (const source of catalog.items) {
    const card = el("section", undefined, content); el("h4", source.name + " · " + (source.lastStatus || source.status), card);
    const details = el("details", undefined, card); el("summary", "Inventory and revision lineage", details); jsonView(source, details);
    const mode = field(card, "Mode", ["auto", "normalize", "raw", "distill"]), layout = field(card, "Layout", ["source", "flat"]), section = field(card, "Section"), include = field(card, "Include patterns"), exclude = field(card, "Exclude patterns");
    const semantic = check(card, "Semantic extraction (requires configured model)"), prune = check(card, "Prune missing source pages (never automatic)");
    async function run(preview) {
      if (!preview && prune.checked && !(await askConfirmation("Prune source-owned pages missing from this revision? Manual edits remain subject to engine conflict checks."))) return;
      await queue("ingestions", { sourceId: source.id, revision: source.revision, preview, options: { mode: mode.value, layout: layout.value, section: section.value, include: include.value, exclude: exclude.value, semantic: semantic.checked, prune: prune.checked }, confirmation: { acknowledgePrune: prune.checked } });
    }
    button(card, "Preview ingestion", () => run(true)); button(card, "Apply / rerun this revision", () => run(false)).disabled = currentWiki.access !== "rw";
  }
  const upload = el("section", undefined, content); el("h4", "Upload a source revision", upload);
  const sourceId = field(upload, "Stable source ID", null, "documents"), display = field(upload, "Display name", null, "Documents");
  el("p", "Reuse a stable source ID when uploading a later revision. Directory paths are preserved. Supported staged formats: Markdown, text and PDF; engine converters determine ingestion support.", upload);
  const folderLabel = el("label", "Choose directory", upload), folder = el("input", undefined, folderLabel); folder.type = "file"; folder.multiple = true; folder.setAttribute("webkitdirectory", "");
  const zipLabel = el("label", "Or choose ZIP", upload), zip = el("input", undefined, zipLabel); zip.type = "file"; zip.accept = ".zip";
  const status = el("pre", "No files selected.", upload);
  function selected() { return zip.files.length ? [...zip.files] : [...folder.files]; }
  function inventory() { status.textContent = selected().map(f => (f.webkitRelativePath || f.name) + " · " + f.size + " bytes").join("\n"); }
  folder.onchange = inventory; zip.onchange = inventory;
  button(upload, "Stage and register source revision", async () => {
    const files = selected(); if (!files.length) throw new Error("Select a directory or ZIP");
    const uploadId = crypto.randomUUID();
    for (let i = 0; i < files.length; i++) {
      const file = files[i], path = file.webkitRelativePath || file.name;
      status.textContent = "Uploading " + (i + 1) + "/" + files.length + " · " + path;
      await StudioApi.upload(uploadId,path,file);
    }
    const source = await StudioApi.wiki("sources", "POST", { id: sourceId.value, name: display.value, type: "upload", uploadId });
    status.textContent = "Staged revision " + source.revision + ". Preview ingestion to review engine-discovered changes.";
    content.replaceChildren(); await sourcesView(content);
  }).disabled = currentWiki.access !== "rw";
  const unavailable = el("section", undefined, content); el("h4", "Additional adapters", unavailable);
  const session = await StudioApi.request("session"), directories = session.adapters.directory || [];
  if (directories.length) {
    const selected = field(unavailable, "Operator source directory", directories.map(d => d.id)), kind = field(unavailable, "Source kind", ["directory", "git"]);
    button(unavailable, "Snapshot allowlisted directory / local checkout", async () => { await StudioApi.wiki("sources", "POST", { id: sourceId.value, name: display.value, type: kind.value, directoryId: selected.value }); content.replaceChildren(); await sourcesView(content); });
  } else el("p", "Local directory / Git checkout intake requires operator studiosourcedirs configuration.", unavailable);
  const web = el("section", undefined, content); el("h4", "Fetch from the web", web);
  el("p", "The Studio server fetches the page or captions over a bounded, public-network-only transport (ports 80/443, private addresses refused, redirects revalidated, 5 MiB cap). Content is staged as Markdown and ingested only after Preview or Apply. Remote Git clones are not supported; upload a reviewed checkout or ZIP.", web);
  const pageUrl = field(web, "Webpage URL", null, "https://example.com/article"), video = field(web, "YouTube URL or video ID", null, "https://youtu.be/l6ZcFa8pybE"), lang = field(web, "Caption language", null, "en");
  const fetchSource = (type, body) => async () => { if (!sourceId.value || !display.value) throw new Error("Fill the stable source ID and display name above"); await StudioApi.wiki("sources", "POST", Object.assign({ id: sourceId.value, name: display.value, type }, body())); content.replaceChildren(); await sourcesView(content); };
  button(web, "Download webpage as Markdown", fetchSource("web", () => ({ url: pageUrl.value.trim() })), "download").disabled = currentWiki.access !== "rw";
  button(web, "Download YouTube captions", fetchSource("youtube", () => ({ video: video.value.trim(), lang: lang.value.trim() || "en" })), "download").disabled = currentWiki.access !== "rw";
}
async function absorbView(content) {
  el("p", "Absorption uses Mini-A saved plans and recovery journals. Source wikis remain unchanged. A plan may require a model; apply reuses the saved plan.", content);
  const wikis = await StudioApi.wikis(), choices = el("div", undefined, content), selected = [];
  for (const wiki of wikis.items.filter(w => w.id !== currentWiki.id)) selected.push([wiki.id, check(choices, wiki.name)]);
  const paths = field(content, "Paths (comma-separated; empty means all)"), tags = field(content, "Tags (comma-separated)"), topic = field(content, "Topic"), exclude = field(content, "Exclusions (comma-separated)");
  button(content, "Generate saved plan", async () => {
    const body = { action: "plan", sourceWikiIds: selected.filter(([, box]) => box.checked).map(([id]) => id) };
    for (const [k, input] of [["paths", paths], ["tags", tags], ["exclude", exclude]]) if (input.value.trim()) body[k] = input.value.split(",").map(s => s.trim()).filter(Boolean);
    if (topic.value) body.topic = topic.value; await queue("absorptions", body);
  }).disabled = currentWiki.access !== "rw";
  const plan = field(content, "Saved plan ID");
  for (const action of ["status", "show", "apply", "resume", "delete", "cancel"]) button(content, action, async () => {
    if (["apply", "resume", "delete", "cancel"].includes(action) && !(await askConfirmation(action + " saved plan " + plan.value + "? Deleting a plan does not undo applied pages."))) return;
    await queue("absorptions", { action, planId: plan.value, confirmation: { applySavedPlan: true } });
  }).disabled = currentWiki.access !== "rw";
}
async function dreamsView(content) {
  el("p", "Plan is model-free maintenance diagnostics. It is not an exact preview of future LLM reorganization. Reorg performs live structural changes and can move, merge or delete pages.", content);
  const mode = field(content, "Mode", ["plan", "apply", "repair", "reindex", "graph", "indexes", "auto", "reorg"]), semantic = check(content, "Opt in to model semantic extraction"), organize = field(content, "Organization", ["none", "topics"]), instructions = field(content, "Reorg guidance"), steps = field(content, "Maximum model steps", null, "40"), compact = check(content, "Compact after success (offline)"), external = check(content, "External CLI readers and writers are stopped"), confirmReorg = check(content, "I authorize live structural changes after a verified backup"), mutateAuto = check(content, "Auto: apply repairs (otherwise preview)");
  el("p", "Verified backups are mandatory before page-mutating modes. Model credentials are inherited from the operator environment. Usage is reported only when the engine reports it.", content);
  button(content, "Queue selected dream", () => queue("dreams", { mode: mode.value, options: { semantic: semantic.checked, organize: organize.value, instructions: instructions.value, dreammaxsteps: Number(steps.value), compact: compact.checked, dryrun: mode.value === "auto" ? !mutateAuto.checked : mode.value === "plan" }, confirmation: { acknowledgeStructuralChanges: confirmReorg.checked, externalProcessesStopped: external.checked } })).disabled = currentWiki.access !== "rw";
  const maintenance = el("section", undefined, content); el("h4", "Offline maintenance", maintenance);
  for (const action of ["reindex", "indexes", "compact"]) button(maintenance, "Queue " + action, () => queue("maintenance", { action, externalProcessesStopped: external.checked })).disabled = currentWiki.access !== "rw";
  await backupsView(content);
}
async function backupsView(content) {
  const section = el("section", undefined, content); el("h4", "Verified snapshots", section);
  button(section, "Create snapshot", () => queue("backups", {})).disabled = currentWiki.access !== "rw";
  const result = await StudioApi.wiki("backups");
  if (!result.items.length) el("p", "No tracked backups yet.", section);
  for (const backup of result.items) {
    el("p", backup.createdAt + " · " + backup.id + " · " + backup.size + " bytes · " + (backup.verified ? "verified at creation" : "not verified"), section);
    button(section, "Restore this snapshot", async () => {
      if (!(await askConfirmation("Stop external readers and writers. Restore replaces the wiki tree after a verified pre-restore backup. Continue?"))) return;
      const overview = await StudioApi.wiki("overview"), fingerprint = overview.studio.fingerprint;
      await queue("backups/" + backup.id + "/restore", { expectedFingerprint: fingerprint, confirmation: backup.id + ":" + fingerprint, externalProcessesStopped: true });
    }).disabled = currentWiki.access !== "rw" || !backup.verified;
  }
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
