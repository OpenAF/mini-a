// Run from the checkout: oaf -f tests/optionalLibraries.js
loadLib("mini-a.js")
function check(value, message) { if (!value) throw new Error(message) }
check(typeof MiniAMemoryManager === "undefined", "Memory loaded eagerly")
check(typeof MiniAHistoryVM === "undefined", "History VM loaded eagerly")
__miniAEnsureOptionalLibrary("memory")
var memoryConstructor = MiniAMemoryManager
var memory = new MiniAMemoryManager({})
check(isObject(memory), "Memory construction failed")
__miniAEnsureOptionalLibrary("memory")
check(memoryConstructor === MiniAMemoryManager, "Memory library evaluated twice")
__miniAEnsureOptionalLibrary("history")
var historyConstructor = MiniAHistoryVM
__miniAEnsureOptionalLibrary("history")
check(historyConstructor === MiniAHistoryVM, "History library evaluated twice")
print("Optional library loading checks passed")
