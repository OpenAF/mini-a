// Optional live-provider smoke check. Not included in automated suites.
// Configure OAF_DECIDE_MODEL, then: oaf -f tests/shellGuardLive.js
load("mini-a.js")
var agent = new MiniA()
agent._initDecisionRuntime({ shellguard: "decide", goal: "Print a fixed smoke-test marker" })
agent._shellBatch = true
agent._shellPrefix = ""
agent._shellSandboxMode = "off"
var result = agent._runCommand({ command: "echo mini-a-shell-guard-live", readwrite: false })
if (String(result.output).trim() !== "mini-a-shell-guard-live") throw new Error("Live shell guard smoke test did not allow the harmless command: " + result.output)
print("Live shell guard smoke test passed")
