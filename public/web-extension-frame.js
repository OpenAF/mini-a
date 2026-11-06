// First-party containment. Guest code never runs in this document's origin.
(function() {
  var contract = MiniAWebExtensionContract, guest = null, active = true, mount = null, port = null, count = 0, connected = false
  var digest = location.pathname.split("/").filter(Boolean).pop()
  function notify(phase, extra, transfer) {
    if (!mount) return
    var value = { type: "mini-a:web-extension:container", phase: phase, instanceId: mount.instanceId, nonce: mount.nonce }
    Object.keys(extra || {}).forEach(function(k) { value[k] = extra[k] })
    parent.postMessage(value, location.origin, transfer || [])
  }
  function dispose(reason) {
    if (!active) return
    active = false; clearTimeout(timer)
    if (port) { port.close(); port = null }
    if (guest) { guest.remove(); guest = null }
    window.removeEventListener("message", receive)
    if (reason) notify("failed", { message: reason })
  }
  function receive(event) {
    var data = event.data
    if (!active || !contract.map(data)) return
    if (!mount) {
      if (event.source !== parent || parent === window || event.origin !== location.origin || data.type !== "mini-a:web-extension:container" || data.phase !== "mount") return
      try {
        contract.keys(data, ["type", "phase", "instanceId", "nonce", "entryUrl"], ["instanceId", "nonce", "entryUrl"])
        if (!/^[a-f0-9]{32,128}$/.test(data.nonce) || !/^[A-Za-z0-9-]{1,128}$/.test(data.instanceId)) return
        var entry = new URL(data.entryUrl, location.href)
        var base = location.pathname.replace(/web-extension-frame\/[^/]+\/?$/, "web-extension-assets/" + digest + "/")
        if (entry.origin !== location.origin || entry.pathname.indexOf(base) !== 0 || entry.search || entry.hash) return
        mount = data
        guest = document.createElement("iframe")
        guest.title = "Extension content"
        guest.setAttribute("sandbox", "allow-scripts")
        guest.setAttribute("referrerpolicy", "no-referrer")
        guest.setAttribute("allow", "camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; display-capture 'none'; fullscreen 'none'; payment 'none'; usb 'none'")
        guest.addEventListener("load", function() { if (++count > 1) dispose("Extension navigated; reopen it to continue") })
        guest.src = entry.href
        document.body.appendChild(guest)
      } catch (_) { dispose("Invalid extension mount") }
      return
    }
    if (event.source !== guest.contentWindow || event.origin !== "null" || data.type !== "mini-a:web-extension:bootstrap" || data.phase !== "ready" || port || connected) return
    try {
      contract.keys(data, ["type", "phase", "versions"], ["versions"])
      var version = contract.negotiate(data.versions), channel = new MessageChannel()
      port = channel.port1
      port.onmessage = function(reply) {
        var ack = reply.data
        if (!contract.map(ack) || ack.type !== "mini-a:web-extension:bootstrap" || ack.phase !== "connected" || ack.instanceId !== mount.instanceId || ack.nonce !== mount.nonce || ack.version !== version) { dispose("Invalid extension handshake"); return }
        port.onmessage = null
        connected = true
        notify("connected", { version: version }, [port])
        port = null; clearTimeout(timer)
      }
      port.start()
      guest.contentWindow.postMessage({ type: "mini-a:web-extension:bootstrap", phase: "connect", instanceId: mount.instanceId, nonce: mount.nonce, versions: [version] }, "*", [channel.port2])
    } catch (_) { dispose("Incompatible extension protocol") }
  }
  var timer = setTimeout(function() { dispose("Extension handshake timed out") }, 60000)
  window.addEventListener("message", receive)
  window.addEventListener("pagehide", function() { dispose() }, { once: true })
})()
