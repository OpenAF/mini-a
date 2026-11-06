// Per-run authorization glue, without a provider or HTTP server.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const contract = require('../public/web-extension-contract.js')
const id = '11111111-1111-4111-8111-111111111111'
const session = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const links = [], saves = [], events = [], scopes = []
let enabled = true, revision = 2
const context = {
  __: undefined, isString: v => typeof v === 'string', isDef: v => v !== undefined && v !== null,
  isArray: Array.isArray, isFunction: v => typeof v === 'function', merge: (...args) => Object.assign({}, ...args),
  stringify: JSON.stringify, MiniAWebExtensionContract: contract,
  MiniAWebExtensions: { enabled: () => enabled },
  MiniAWebDocuments: {
    read: requested => { assert.equal(requested, id); return { artifact: { id, revision, title: 'Untrusted title', native: { mimeType: 'text/plain' } } } },
    link: (document, uuid) => links.push({ document, uuid }),
    save: params => { assert.equal(params.authorize(), true); saves.push(params); return { id, revision: ++revision } }
  },
  MiniADocumentTools: {
    create: options => {
      scopes.push(options)
      return {
        read: params => { assert.ok(options.allowedIds.includes(params.artifactId)); return options.store.read(params.artifactId) },
        create: params => { assert.equal(options.allowCreate, true); return options.store.save(params) },
        inspect: () => ({ scope: options.allowedIds }),
        patch: () => ({ write: options.allowWrite })
      }
    }
  },
  maArgs: { webextensionsagent: true }, __webtoken: 'test-token',
  _mini_a_web_transcript: (...args) => events.push(args)
}
context.global = context
vm.createContext(context)
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/web/mini-a-web-document-agent.js'), 'utf8'), context)
const agentApi = context.MiniAWebDocumentAgent
const request = { header: { 'x-mini-a-token': 'test-token' } }
const data = { artifactReferences: [{ id, revision: 2 }], artifactPermissions: { create: true, write: false } }
assert.throws(() => agentApi.prepare({ header: {} }, data, session), /header authentication/)
assert.throws(() => agentApi.prepare(request, data, '../session'), /identifier/)
assert.throws(() => agentApi.prepare(request, { ...data, artifactReferences: [{ id, revision: 1 }] }, session), /changed/)
assert.throws(() => agentApi.prepare(request, { ...data, artifactReferences: [data.artifactReferences[0], data.artifactReferences[0]] }, session), /Duplicate/)
assert.throws(() => agentApi.prepare(request, { artifactPermissions: { write: 'true' } }, session), /permissions/)
assert.throws(() => agentApi.prepare(request, { artifactPermissions: { filesystem: true } }, session))
assert.equal(links.length, 0, 'rejected scopes must not attach documents')
const scope = agentApi.prepare(request, data, session.toUpperCase())
assert.equal(links[0].uuid, session, 'session IDs canonicalized')
assert.equal(scope.allowWrite, false)
assert.equal(scope.allowCreate, true)
let live = true
const agent = {}, binding = agentApi.bind(agent, scope, () => live)
const mcp = agentApi.config(binding)
assert.equal(mcp.type, 'dummy')
assert.equal(Object.keys(mcp.options.fns).length, 4)
assert.equal(mcp.options.fns.web_document_read({ artifactId: id }).artifact.revision, 2)
mcp.options.fns.web_document_create({ title: 'Test' })
assert.equal(saves.length, 1)
assert.equal(saves[0].uuid, session)
assert.equal(typeof saves[0].authorize, 'function', 'store rechecks the live grant at commit')
assert.equal(JSON.parse(events[0][2].message).artifactId, id)
assert.equal(mcp.options.fnsMeta.web_document_create.cacheable, false)
live = false
assert.equal(mcp.options.fns.web_document_read({ artifactId: id }).error, 'document_operation_rejected')
const next = agentApi.prepare(request, {}, session)
agentApi.bind(agent, next, () => true)
assert.equal(agent._webDocumentBinding, binding, 'MCP closures follow the existing per-agent binding')
assert.equal(mcp.options.fns.web_document_read({ artifactId: id }).error, 'document_operation_rejected', 'next run cannot retain prior IDs')
assert.equal(mcp.options.fns.web_document_create({ title: 'No grant' }).error, 'document_operation_rejected')
assert.equal(mcp.options.fns.web_document_patch({}).write, false)
context.maArgs.webextensionsagent = false
assert.equal(agentApi.prepare(request, {}, session), null)
assert.throws(() => agentApi.prepare(request, data, session), /disabled/)
context.maArgs.webextensionsagent = true
enabled = false
assert.throws(() => agentApi.prepare(request, {}, session), /unavailable/)
console.log('PASS per-run document grants, header authentication, revisions, cancellation, reuse and typed references')
