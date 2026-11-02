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
let currentWiki, activePage, dirty = false, graphBlob;
function mayLeave() { return !dirty || confirm("Discard unsaved changes?"); }
function button(parent, title, action) { const b = el("button", title, parent); b.type = "button"; b.onclick = safely(action); return b; }
function wikiPath(suffix = "") { return "wikis/" + encodeURIComponent(currentWiki.id) + (suffix ? "/" + suffix : ""); }
StudioApi.wiki = function(suffix, method, body) { return this.request(wikiPath(suffix), method, body); };
async function openWiki(wiki) {
  if (!mayLeave()) return;
  currentWiki = wiki; activePage = null; dirty = false;
  const host = document.getElementById("workspace"); host.replaceChildren();
  button(host, "← All wikis", async () => { if (mayLeave()) { dirty = false; await dashboard(); } });
  el("h2", wiki.name + " · " + wiki.access, host);
  const nav = el("nav", undefined, host); nav.setAttribute("aria-label", "Wiki views");
  const content = el("div", undefined, host); content.id = "view";
  for (const name of ["Overview", "Pages", "Graph", "Sources", "Absorb", "Dreams", "Jobs", "Health", "Settings"]) button(nav, name, async () => {
    if (!mayLeave()) return; dirty = false; activePage = null; if (graphBlob) { URL.revokeObjectURL(graphBlob); graphBlob = null; }
    content.replaceChildren(); message(""); await showView(name, content);
  });
  await showView("Overview", content);
}
async function showView(name, content) {
  el("h3", name, content);
  if (name === "Pages") return pagesView(content);
  if (name === "Overview" || name === "Health") {
    el("p", "Studio coordinates its own readers and writers. Stop external CLI readers/writers before offline maintenance.", content);
    for (const [route, title] of [["overview", "Wiki context"], ["graph/stats", "Graph status"], ["lint", "Lint findings"]]) {
      const section = el("section", undefined, content); el("h4", title, section);
      try { el("pre", JSON.stringify(await StudioApi.wiki(route), null, 2), section); } catch (e) { el("p", e.message, section); }
    }
    return;
  }
  if (name === "Settings") {
    el("pre", JSON.stringify(currentWiki, null, 2), content);
    button(content, "Rename display name", async () => { const name = prompt("Display name", currentWiki.name); if (name) { await StudioApi.wiki("", "PATCH", { name }); currentWiki.name = name; await openWiki(currentWiki); } });
    button(content, currentWiki.access === "rw" ? "Make read-only" : "Enable writes", async () => { const access = currentWiki.access === "rw" ? "ro" : "rw"; await StudioApi.wiki("", "PATCH", { access }); currentWiki.access = access; await openWiki(currentWiki); });
    button(content, "Unregister (keep all files)", async () => { if (confirm("Remove this registry entry? Wiki files will remain.")) { await StudioApi.wiki("", "DELETE"); await dashboard(); } });
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
        if (mayLeave()) { dirty = false; await loadPage(path); }
      }); else block.append(document.createTextNode(label + " (blocked link)"));
      last = re.lastIndex;
    }
    block.append(document.createTextNode(body.slice(last)));
  }
}
async function pagesView(content) {
  const toolbar = el("div", undefined, content); toolbar.className = "row";
  const searchLabel = el("label", "Search this wiki", toolbar); const search = el("input", undefined, searchLabel); search.type = "search";
  const split = el("div", undefined, content); split.className = "split";
  const list = el("aside", undefined, split); list.id = "page-list";
  const editor = el("div", undefined, split); editor.id = "page-editor";
  let offset = 0;
  async function refresh() {
    list.replaceChildren(); const response = await StudioApi.wiki(search.value ? "search?q=" + encodeURIComponent(search.value) : "pages?limit=100&offset=" + offset);
    const items = Array.isArray(response) ? response : response.results || response.items || response.pages || [];
    if (response.warning) el("p", response.warning, list);
    for (const item of items) { const path = typeof item === "string" ? item : item.path; if (path && !/(^|\/)AGENTS\.md$/i.test(path)) button(list, path, async () => { if (mayLeave()) { dirty = false; await loadPage(path); } }); }
    if (!items.length) el("p", "No pages found. Search can have incomplete coverage; check Health.", list);
    if (!search.value && items.length === 100) button(list, "Next 100", async () => { offset += 100; await refresh(); });
    if (offset) button(list, "First page", async () => { offset = 0; await refresh(); });
  }
  button(toolbar, "Search / refresh", refresh);
  button(toolbar, "New page", async () => {
    if (!mayLeave()) return; const path = prompt("New Markdown path", "new-page.md"); if (!path) return;
    activePage = { path, content: "# New page\n", revision: null, creating: true }; dirty = true; drawEditor();
  }).disabled = currentWiki.access !== "rw";
  await refresh();
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
      activePage = result; dirty = false; message("Saved"); drawEditor();
    } catch (e) {
      if (e.status === 409) {
        message("Conflict: your local text is preserved. Compare with the current server copy, copy/merge, then reload before retrying.", true);
        const server = await StudioApi.wiki("page?path=" + encodeURIComponent(page.path));
        const compare = el("section", undefined, editor); el("h4", "Server copy · " + server.revision, compare); el("pre", server.content, compare);
        button(compare, "Use current revision with my merged text", () => { if (confirm("Have you merged the server changes into your local text?")) { page.revision = server.revision; message("Merged revision selected; review text and Save."); } });
      } else throw e;
    }
  }
  button(toolbar, "Save ⌘/Ctrl+S", save).disabled = currentWiki.access !== "rw";
  button(toolbar, "Revert / reload", async () => { if (mayLeave()) await loadPage(page.path); });
  button(toolbar, "Move / rename", async () => { if (dirty) throw new Error("Save or revert before moving"); const destination = prompt("Destination Markdown path", page.path); if (destination && destination !== page.path) { activePage = await StudioApi.wiki("pages/move", "POST", { source: page.path, destination, expectedRevision: page.revision }); drawEditor(); } }).disabled = currentWiki.access !== "rw" || page.creating;
  button(toolbar, "Delete", async () => { if (confirm("Delete " + page.path + "?")) { await StudioApi.wiki("page?path=" + encodeURIComponent(page.path), "DELETE", { expectedRevision: page.revision, confirmation: page.path }); dirty = false; activePage = null; editor.replaceChildren(); message("Deleted"); } }).disabled = currentWiki.access !== "rw" || page.creating;
  source.onkeydown = safely(async event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); await save(); } });
  const metadata = el("details", undefined, editor); el("summary", "Frontmatter, outgoing links and provenance", metadata); el("pre", JSON.stringify({ metadata: page.metadata, links: page.links, sourceIds: page.sourceIds, warnings: page.warnings }, null, 2), metadata);
  if (!page.creating) StudioApi.wiki("backlinks?path=" + encodeURIComponent(page.path)).then(result => { const details = el("details", undefined, editor); el("summary", "Incoming backlinks", details); el("pre", JSON.stringify(result, null, 2), details); }).catch(e => message(e.message, true));
}
window.addEventListener("beforeunload", event => { if (dirty) { event.preventDefault(); event.returnValue = ""; } });
async function graphView(content) {
  const stats = await StudioApi.wiki("graph/stats"); el("p", stats.source + " · " + stats.freshness, content);
  button(content, "Open graph", async () => {
    const response = await fetch("/api/v1/" + wikiPath("graph/html"), { headers: { Authorization: "Bearer " + StudioApi.token } });
    if (!response.ok) throw new Error((await response.json()).error.message);
    if (graphBlob) URL.revokeObjectURL(graphBlob);
    graphBlob = URL.createObjectURL(new Blob([await response.text()], { type: "text/html" }));
    let frame = content.querySelector("iframe"); if (!frame) frame = el("iframe", undefined, content);
    frame.title = "Wiki graph; accessible filters and node list inside"; frame.setAttribute("sandbox", "allow-scripts allow-downloads"); frame.src = graphBlob;
  });
  el("p", "Graph opens with no network or parent DOM access. Pages remains an accessible list alternative.", content);
}
window.addEventListener("message", safely(async event => {
  const frame = document.querySelector("#view iframe"), d = event.data;
  if (!frame || event.source !== frame.contentWindow || event.origin !== "null" || !d || d.type !== "mini-a-wiki-graph-node" || d.version !== 1 || typeof d.path !== "string" || d.nodeId !== "doc:" + d.path || d.path.length > 512 || /[\\%:\x00-\x1f?#]/.test(d.path) || !/\.md$/i.test(d.path) || d.path.split("/").some(p => !p || p === "." || p === ".." || p.startsWith(".") || /^AGENTS\.md$/i.test(p))) return;
  if (!mayLeave()) return; dirty = false; const view = document.getElementById("view"); view.replaceChildren(); await pagesView(view); await loadPage(d.path);
}));
