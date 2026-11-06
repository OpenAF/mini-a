// Apache-2.0. This example never fetches data or writes browser storage.
(function() {
  var input = document.getElementById('text'), sequence = 0, committedSequence = 0
  var sdk
  function text(content) {
    if (content.encoding === 'utf8') return content.text
    if (content.encoding === 'base64') {
      var raw = atob(content.data), bytes = new Uint8Array(raw.length)
      for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    }
    throw new Error('Unsupported text representation')
  }
  function open(params) {
    input.value = text(params.content)
    input.readOnly = params.artifact && params.artifact.readOnly === true
    committedSequence = sequence
    return { opened: true, revision: params.artifact ? params.artifact.revision : 0, editSequence: sequence }
  }
  function snapshot() {
    return { mimeType: 'text/plain', filename: 'document.txt', content: { encoding: 'utf8', text: input.value }, editSequence: sequence }
  }
  function changed() {
    sequence++
    sdk.emit('dirtyChanged', { dirty: sequence !== committedSequence, editSequence: sequence })
  }
  sdk = MiniAWebExtensionSDK.connect({ versions: ['1.0'], handlers: {
    initialize: function() { return { initialized: true } },
    open: open,
    update: open,
    create: function() { open({ content: { encoding: 'utf8', text: '' } }); changed(); return { created: true } },
    save: snapshot,
    export: function(params) {
      if (params.mimeType !== 'text/plain') throw new Error('Unsupported export format')
      return snapshot()
    },
    commit: function(params) {
      committedSequence = params.editSequence
      sdk.emit('dirtyChanged', { dirty: sequence !== committedSequence, editSequence: sequence })
    },
    focus: function() { input.focus(); return {} },
    dispose: function() { input.removeEventListener('input', changed); input.value = ''; return {} }
  }})
  input.addEventListener('input', changed)
})()
