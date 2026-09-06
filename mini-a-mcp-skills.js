// Author: Nuno Aguiar
// License: Apache 2.0
// Description: Shared MCP bootstrap for the virtual skill-library MCP jobs
// (mcps/mcp-skills.yaml, mcps/mcp-skills-safe.yaml). Deliberately reuses the wiki
// MCP bootstrap and restricted-retrieval state machine from mini-a-mcp-wiki.js
// instead of re-implementing config/backend wiring or the safe-mode ledger.

loadLib("mini-a-mcp-wiki.js")
loadLib("mini-a-skills.js")

// Same init as mcp-wiki.yaml/mcp-wiki-safe.yaml -- a skills MCP is just a wiki MCP
// whose tool surface happens to be the skill facade instead of raw wiki ops. Any
// wiki (fs/s3/s3fs/es/http, with or without mounts, with or without the graph)
// works unchanged; pages without skill frontmatter simply never match type="skill".
function __miniAMcpSkillsInit(args, options) {
  return __miniAMcpWikiInit(args, options)
}

function __miniAMcpSkillsLogFn() {
  var prefix = (global.__miniAMcpWiki && global.__miniAMcpWiki.logPrefix) || "mcp-skills"
  return function(level, msg) { try { print("[" + prefix + "] " + String(msg)) } catch(e) {} }
}

// ── unrestricted passthrough (mcp-skills.yaml) ───────────────────────────────
function __miniAMcpSkillsContext(args) {
  return __miniASkillContext(global.__wikiManager, args, __miniAMcpSkillsLogFn())
}

function __miniAMcpSkillsSearch(args) {
  return __miniASkillSearch(global.__wikiManager, args, __miniAMcpSkillsLogFn())
}

function __miniAMcpSkillsRecommend(args) {
  return __miniASkillRecommend(global.__wikiManager, args, __miniAMcpSkillsLogFn())
}

function __miniAMcpSkillsOpen(args) {
  var ref = isString(args.ref) ? args.ref : args.reference
  return __miniASkillOpen(global.__wikiManager, ref, args, __miniAMcpSkillsLogFn())
}

function __miniAMcpSkillsRead(args) {
  var ref = isString(args.ref) ? args.ref : args.reference
  return __miniASkillRead(global.__wikiManager, ref, args, __miniAMcpSkillsLogFn())
}

function __miniAMcpSkillsRelated(args) {
  var ref = isString(args.ref) ? args.ref : args.reference
  return __miniASkillRelated(global.__wikiManager, ref, args, __miniAMcpSkillsLogFn())
}

// ── restricted / safe-mode (mcp-skills-safe.yaml) ────────────────────────────
// Reuses MiniAMcpWikiRestriction (mini-a-mcp-wiki.js) unmodified: opaque refs,
// per-window search/read/char budgets, per-page cooldowns, optional shared
// (redis/etc.) state channel for multi-replica deployments. Every operation here
// consumes the presented reference and, where the flow continues (open -> read,
// related -> open), issues a fresh one-shot reference for the next step -- refs
// are never reusable/idempotent, by design, same as mcp-wiki-safe.yaml.
function __miniAMcpSkillsRestrictedSearch(args) {
  var state = global.__miniAMcpWiki && global.__miniAMcpWiki.restriction
  if (!state || !state.enabled) return __miniAMcpSkillsSearch(args)
  var q = isString(args.query) ? args.query.trim() : ""
  if (q.length < state.policy.minQueryChars || !/[A-Za-z0-9À-￿]/.test(q) || /[*?]{2,}|^\*|^\.$/.test(q)) {
    return __miniAMcpWikiRestrictedError("restricted-query-rejected")
  }
  if (!state._can("search", 0)) return __miniAMcpWikiRestrictedBudgetError(state, "search", 0)
  state._event("search", q)
  var hits
  try {
    hits = __miniASkillSearch(global.__wikiManager, {
      query: q, limit: state.policy.searchLimit, tags: args.tags, appliesTo: args.appliesTo,
      compatibility: args.compatibility, maxRisk: args.maxRisk, type: isDef(args.type) ? args.type : "skill"
    })
  } catch(e) { return __miniAMcpWikiRestrictedError("restricted-unavailable") }

  var REF_LEN = 32
  var candidates = [], chars = 0
  for (var hi = 0; hi < hits.length && candidates.length < state.policy.searchLimit; hi++) {
    var hit = hits[hi]
    var fullPath = (hit.wiki && hit.wiki !== "primary") ? ("@" + hit.wiki + "/" + hit.path) : hit.path
    if (state._cooldownActive(sha1(String(fullPath)))) continue
    var title = __miniAMcpWikiSafeChars(hit.title, state.policy.metaChars)
    var description = __miniAMcpWikiSafeChars(hit.summary, Math.max(0, state.policy.metaChars - title.length))
    chars += title.length + description.length + REF_LEN
    candidates.push({ path: fullPath, title: title, description: description, tags: hit.tags, risk: hit.risk })
  }
  if (!state.charge("search", chars)) return __miniAMcpWikiRestrictedBudgetError(state, "search", chars)
  var results = []
  candidates.forEach(function(c) {
    var ref = state.issue(c.path)
    if (!ref) return
    results.push({ title: c.title, description: c.description, tags: c.tags, risk: c.risk, reference: ref })
  })
  return { results: results }
}

function __miniAMcpSkillsRestrictedOpen(args) {
  if (isMap(args) && !isString(args.ref) && isString(args.reference)) args.ref = args.reference
  var state = global.__miniAMcpWiki && global.__miniAMcpWiki.restriction
  if (!state || !state.enabled) return __miniAMcpSkillsOpen(args)
  var grant = state.consume(args.ref)
  if (!grant) return __miniAMcpWikiRestrictedError("invalid-or-expired-reference")
  if (!state._can("read", 0)) return __miniAMcpWikiRestrictedBudgetError(state, "read", 0)
  state._event("open", grant.path)
  var descriptor
  try { descriptor = __miniASkillOpen(global.__wikiManager, grant.path, { cacheTtlMs: 0 }) } catch(e) { descriptor = __ }
  if (!isObject(descriptor) || isDef(descriptor.error)) return __miniAMcpWikiRestrictedError("invalid-or-expired-reference")
  var safe = {
    name    : descriptor.name,
    title   : __miniAMcpWikiSafeChars(descriptor.title, state.policy.metaChars),
    summary : __miniAMcpWikiSafeChars(descriptor.summary, state.policy.metaChars),
    headings: descriptor.headings,
    tags    : descriptor.tags,
    appliesTo: descriptor.appliesTo,
    requires: descriptor.requires,
    risk    : descriptor.risk,
    compatibility: descriptor.compatibility,
    version : descriptor.version
  }
  if (!state.charge("read", JSON.stringify(safe).length)) return __miniAMcpWikiRestrictedBudgetError(state, "read", 0)
  var nextRef = state.issue(grant.path) // one-shot refs: hand back a fresh token for the follow-up read()
  if (nextRef) safe.reference = nextRef
  return safe
}

function __miniAMcpSkillsRestrictedRead(args) {
  if (isMap(args) && !isString(args.ref) && isString(args.reference)) args.ref = args.reference
  var state = global.__miniAMcpWiki && global.__miniAMcpWiki.restriction
  if (!state || !state.enabled) return __miniAMcpSkillsRead(args)
  var grant = state.consume(args.ref)
  if (!grant) return __miniAMcpWikiRestrictedError("invalid-or-expired-reference")
  if (!state._can("read", 0)) return __miniAMcpWikiRestrictedBudgetError(state, "read", 0)
  state._event("read", grant.path)
  var out
  try {
    out = __miniASkillRead(global.__wikiManager, grant.path, {
      section: args.section, startLine: args.startLine, endLine: args.endLine,
      maxChars: Math.min(isNumber(args.maxChars) ? args.maxChars : state.policy.readChars, state.policy.readChars),
      cacheTtlMs: 0
    })
  } catch(e) { out = __ }
  if (!isObject(out) || isDef(out.error)) return __miniAMcpWikiRestrictedError("invalid-or-expired-reference")
  var content = __miniAMcpWikiSafeChars(out.body, state.policy.readChars)
  if (!state.charge("read", content.length)) return __miniAMcpWikiRestrictedBudgetError(state, "read", content.length)
  var safe = { content: content }
  if (out.truncated === true) {
    var nextRef = state.issue(grant.path)
    if (nextRef) safe.next = { reference: nextRef, startLine: out.next && out.next.startLine }
  }
  return safe
}

function __miniAMcpSkillsRestrictedRelated(args) {
  if (isMap(args) && !isString(args.ref) && isString(args.reference)) args.ref = args.reference
  var state = global.__miniAMcpWiki && global.__miniAMcpWiki.restriction
  if (!state || !state.enabled) return __miniAMcpSkillsRelated(args)
  var grant = state.consume(args.ref)
  if (!grant) return __miniAMcpWikiRestrictedError("invalid-or-expired-reference")
  if (!state._can("search", 0)) return __miniAMcpWikiRestrictedBudgetError(state, "search", 0)
  state._event("related", grant.path)
  var raw
  try { raw = __miniASkillRelated(global.__wikiManager, grant.path, args) } catch(e) { raw = __ }
  if (!isObject(raw) || isDef(raw.error)) return __miniAMcpWikiRestrictedError("invalid-or-expired-reference")
  function issueEntries(list) {
    return (isArray(list) ? list : []).map(function(e) {
      var p = isString(e.path) ? e.path : ""
      if (p.length === 0) return __
      var ref = state.issue(p)
      if (!ref) return __
      return { title: __miniAMcpWikiSafeChars(e.title || "", state.policy.metaChars), reference: ref }
    }).filter(function(e) { return isDef(e) })
  }
  return { backlinks: issueEntries(raw.backlinks), graph: issueEntries(raw.graph), cross: issueEntries(raw.cross) }
}
