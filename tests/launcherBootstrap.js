// Run from the checkout: oaf -f tests/launcherBootstrap.js
loadLib("mini-a-launcher.js")
function check(value, message) { if (!value) throw new Error(message) }
check(typeof MiniA === "undefined", "Launcher loaded the core")
var args = MiniALauncher.applyLauncherEnvDefaults({ OAF_MINI_A_MODE: "test-mode", OAF_MINI_A_LIBS: "test-library" })
check(args.mode === "test-mode" && args.libs === "test-library", "Launcher defaults changed")
check(MiniALauncher.findClosestKnownArg("verbos", ["verbose"], 3).match === "verbose", "Argument suggestions changed")
check(MiniALauncher.shouldWarnUnknownArgs({}) === true, "Console warnings disabled")
check(MiniALauncher.shouldWarnUnknownArgs({ goal: "test" }) === false, "Goal warning behavior changed")
var root = String(new java.io.File(".").getCanonicalPath())
var rejected = false
try { MiniALauncher.loadAgent(root + "/__missing_bootstrap_fixture__") } catch(expected) { rejected = true }
check(rejected, "Missing bundle should fail")
var failures = new java.util.concurrent.ConcurrentLinkedQueue()
var threads = []
for (var i = 0; i < 2; i++) {
  var thread = new java.lang.Thread(new JavaAdapter(java.lang.Runnable, {
    run: function() { try { MiniALauncher.loadAgent(root) } catch(e) { failures.add(String(e)) } }
  }))
  threads.push(thread)
  thread.start()
}
threads.forEach(function(thread) { thread.join() })
check(failures.isEmpty(), "Concurrent load failed: " + failures)
check(typeof MiniA.prototype.start === "function", "Core did not finish loading")
check(MiniA.applyLauncherEnvDefaults === MiniALauncher.applyLauncherEnvDefaults, "Public launcher alias changed")
var constructor = MiniA
MiniALauncher.loadAgent(root)
check(constructor === MiniA, "Core evaluated twice")
load(root + "/mini-a.js")
check(typeof MiniA.prototype._extractResponseTextCandidates === "function", "Explicit core reload lost response methods")
print("Launcher bootstrap, concurrent loading and core reload checks passed")
