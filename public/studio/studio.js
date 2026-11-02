/* Studio uses a single authenticated client; token is held only in memory. */
"use strict";
const StudioApi = {
  token: "",
  tail: Promise.resolve(),
  request(path, method = "GET", body) {
    const result = this.tail.then(() => this.send(path, method, body));
    this.tail = result.catch(() => {}); return result;
  },
  async send(path, method = "GET", body) {
    const response = await fetch("/api/v1/" + path, { method, headers: { Authorization: "Bearer " + this.token, "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: body === undefined ? undefined : JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) { const error = new Error(result.error?.message || "Request failed"); error.details = result.error?.details; error.status = response.status; throw error; }
    return result;
  },
  async raw(path, options = {}) {
    const response = await fetch("/api/v1/" + path, { ...options, headers: { ...options.headers, Authorization: "Bearer " + this.token } });
    if (!response.ok) throw new Error((await response.json()).error?.message || "Request failed");
    return response;
  },
  async graphHtml(wikiId) { return (await this.raw("wikis/" + encodeURIComponent(wikiId) + "/graph/html")).text(); },
  async events(jobId, cursor) { return (await this.raw("jobs/" + encodeURIComponent(jobId) + "/events", { headers: { "Last-Event-ID": String(cursor) } })).text(); },
  async upload(uploadId, path, file) { return (await this.raw("uploads", { method: "POST", headers: { "X-Upload-ID": uploadId, "X-Upload-Path": encodeURIComponent(path) }, body: file })).json(); },
  wikis(offset = 0) { return this.request("wikis?limit=100&offset=" + offset); },
  register(wiki) { return this.request("wikis", "POST", wiki); }
};
const el = (tag, text, parent) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (parent) parent.append(node); return node; };
const message = (text, error = false) => { const node = document.getElementById("message"); node.textContent = text; node.className = error ? "error" : ""; };
const safely = fn => async (...args) => { try { await fn(...args); } catch (error) { message(error.message, true); } };
document.getElementById("login").addEventListener("submit", safely(async event => {
  event.preventDefault(); StudioApi.token = document.getElementById("token").value; await StudioApi.request("session");
  document.getElementById("token").value = ""; document.getElementById("login").hidden = true; await dashboard();
}));
async function dashboard(offset = 0) {
  const host = document.getElementById("workspace"); host.hidden = false; host.replaceChildren();
  const wikis = await StudioApi.wikis(offset);
  el("h2", "Your wikis", host);
  if (!wikis.items.length) el("p", "Register an existing wiki or create one in an operator-allowlisted directory.", host);
  wikis.items.forEach(wiki => { const b = el("button", wiki.name + " · " + wiki.access, host); b.onclick = safely(() => openWiki(wiki)); });
  if (offset) button(host,"Previous wikis",()=>dashboard(Math.max(0,offset-100)));
  if (wikis.truncated) button(host,"Next wikis",()=>dashboard(offset+100));
  const form = el("form", undefined, host); form.className = "card"; el("h3", "Add wiki", form);
  const fields = {};
  for (const [key, title] of [["id", "Stable ID"], ["name", "Display name"], ["root", "Absolute root"]]) { const label = el("label", title, form); fields[key] = el("input", undefined, label); fields[key].required = true; }
  const label = el("label", "Access", form); fields.access = el("select", undefined, label); ["rw", "ro"].forEach(s => { const o = el("option", s, fields.access); o.value = s; });
  const createLabel = el("label", "Create new directory", form); const create = el("input", undefined, createLabel); create.type = "checkbox";
  el("button", "Add wiki", form);
  form.onsubmit = safely(async event => { event.preventDefault(); const body = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.value])); body.create = create.checked; await StudioApi.register(body); message("Wiki registered"); await dashboard(); });
}
let currentWiki, activePage, dirty = false, graphBlob;
async function studioDialog(title, initial, confirmation) {
  const previous = document.activeElement, dialog = el("dialog", undefined, document.body), form = el("form", undefined, dialog);
  form.method = "dialog"; const heading = el("h3", title, form); heading.id = "studio-dialog-title"; dialog.setAttribute("aria-labelledby", heading.id);
  let input;
  if (!confirmation) { const label = el("label", title, form); input = el("input", undefined, label); input.value = initial || ""; input.required = true; }
  const row = el("div", undefined, form); row.className = "row";
  const cancel = el("button", "Cancel", row); cancel.value = "cancel"; cancel.type = "button"; cancel.onclick = () => dialog.close("cancel");
  const accept = el("button", confirmation ? "Confirm" : "Continue", row); accept.value = "accept";
  const result = new Promise(resolve => dialog.addEventListener("close", () => { const value = dialog.returnValue === "accept" ? confirmation ? true : input.value : confirmation ? false : null; dialog.remove(); previous?.focus(); resolve(value); }, { once: true }));
  dialog.showModal(); (input || cancel).focus(); if (input) input.select(); return result;
}
const askText = (title, initial) => studioDialog(title, initial, false);
const askConfirmation = title => studioDialog(title, "", true);
async function mayLeave() { return !dirty || await askConfirmation("Discard unsaved changes?"); }
function button(parent, title, action) { const b = el("button", title, parent); b.type = "button"; b.onclick = safely(action); return b; }
function wikiPath(suffix = "") { return "wikis/" + encodeURIComponent(currentWiki.id) + (suffix ? "/" + suffix : ""); }
StudioApi.wiki = function(suffix, method, body) { return this.request(wikiPath(suffix), method, body); };
async function openWiki(wiki) {
  if (!(await mayLeave())) return;
  currentWiki = wiki; activePage = null; dirty = false;
  const host = document.getElementById("workspace"); host.replaceChildren();
  button(host, "← All wikis", async () => { if (await mayLeave()) { dirty = false; await dashboard(); } });
  el("h2", wiki.name + " · " + wiki.access, host);
  const nav = el("nav", undefined, host); nav.setAttribute("aria-label", "Wiki views");
  const content = el("div", undefined, host); content.id = "view";
  for (const name of ["Overview", "Pages", "Graph", "Sources", "Absorb", "Dreams", "Jobs", "Health", "Settings"]) button(nav, name, async () => {
    if (!(await mayLeave())) return; dirty = false; activePage = null; if (graphBlob) { URL.revokeObjectURL(graphBlob); graphBlob = null; }
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
    button(content, "Rename display name", async () => { const name = await askText("Display name", currentWiki.name); if (name) { await StudioApi.wiki("", "PATCH", { name }); currentWiki.name = name; await openWiki(currentWiki); } });
    button(content, currentWiki.access === "rw" ? "Make read-only" : "Enable writes", async () => { const access = currentWiki.access === "rw" ? "ro" : "rw"; await StudioApi.wiki("", "PATCH", { access }); currentWiki.access = access; await openWiki(currentWiki); });
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
    if(response.coverage){const coverage=el("details",undefined,list);el("summary","Per-wiki search coverage",coverage);el("pre",JSON.stringify(response.coverage,null,2),coverage)}
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
  const metadata = el("details", undefined, editor); el("summary", "Frontmatter, outgoing links and provenance", metadata); el("pre", JSON.stringify({ metadata: page.metadata, links: page.links, sourceIds: page.sourceIds, warnings: page.warnings }, null, 2), metadata);
  if (!page.creating) StudioApi.wiki("backlinks?path=" + encodeURIComponent(page.path)).then(result => { const details = el("details", undefined, editor); el("summary", "Incoming backlinks", details); el("pre", JSON.stringify(result, null, 2), details); }).catch(e => message(e.message, true));
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
  const summary = el("pre", "Loading…", view), events = el("pre", "", view); events.setAttribute("aria-label", "Job events");
  const key = currentWiki.id;
  button(view, "Request cancellation", async () => { await StudioApi.request("jobs/" + id + "/cancel", "POST", {}); message("Cancellation requested. Active engines may finish with writes; no rollback is implied."); });
  let cursor = 0;
  async function refresh() {
    if (!summary.isConnected || currentWiki.id !== key) return;
    const job = await StudioApi.request("jobs/" + id); summary.textContent = JSON.stringify(job, null, 2);
    let received;
    do {
    received = 0;
    for (const frame of (await StudioApi.events(id,cursor)).split("\n\n")) {
      const line = frame.split("\n").find(l => l.startsWith("data: ")); if (!line) continue;
      const event = JSON.parse(line.slice(6)); if (event.seq <= cursor) continue; cursor = event.seq; received++;
      events.textContent = (events.textContent + event.time + " [" + event.phase + "] " + event.message + "\n").slice(-100000);
    }
    } while (received === 200 && summary.isConnected);
    if (["completed", "failed", "partial", "recovery-required", "interrupted", "cancelled"].includes(job.status)) {
      const changes = await StudioApi.wiki("changes?jobId=" + id); const details = el("details", undefined, view); el("summary", "Actual before/after Markdown changes", details); el("pre", JSON.stringify(changes, null, 2), details);
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
    const details = el("details", undefined, card); el("summary", "Inventory and revision lineage", details); el("pre", JSON.stringify(source, null, 2), details);
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
  for (const name of ["Remote Git repository", "Webpage URL", "YouTube captions"]) { const b = button(unavailable, name + " · unavailable", () => {}); b.disabled = true; b.title = "This build lacks a DNS-pinned bounded outbound transport / operator adapter configuration. Upload a reviewed directory or ZIP export."; }
  el("p", "Outbound adapters are not implemented in this build. No private scripts are bundled. YouTube requires an operator-installed caption adapter and retrieves captions, not speech-to-text; see documentation.", unavailable);
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
