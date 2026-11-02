# Contributors Guide
`mini-a` welcomes your contribution. Below steps can be followed to create a pull request.

* Fork this mini-a repository into your account.
* Create a feature branch in your fork (`$ git checkout -b my-new-feature`).
* Hack, hack, hack...
* Test, test, tes....
* Commit your changes (`$ git commit -am 'Add some feature'`).
* Push the feature branch into your fork (`$ git push origin -u my-new-feature`).
* Create new pull request to `main` branch.


## Running tests

Execute the full test suite from the repository root directory using oJob:

```
ojob tests/autoTestAll.yaml
```

Notes:

- Run the command from the main repo folder (where this README/CONTRIBUTING lives) so relative paths resolve correctly.
- Ensure you have OpenAF installed and the `ojob` command available in your PATH.
- The test run will produce an `autoTestAll.results.json` file with the results; review it locally and remove it before your final commit.

### Startup measurements

Run `python3 tests/benchmarkStartup.py --runs 10` from the checkout with OpenAF
on PATH. The harness reports fresh-process readiness markers (excluding shutdown)
for runtime, session parsing, agent loading/construction, and console input with
prewarming disabled. It makes no provider requests. Run sequentially on an idle
machine; these are warm-filesystem measurements, not cold-disk or live-provider
latency. `oaf -f tests/optionalLibraries.js` checks deferred memory/history loading
and repeated-load constructor identity.

For selected scenarios, use `--case console_no_prewarm`, `--case console_prewarm`,
or `--case immediate_command` (repeatable). The immediate-command case measures
launch through completion of a local `/set` command, including any core-loading
wait. It is not a first-provider latency measurement.

Run `python3 tests/consoleStartup.py` for bootstrap, help without the core,
immediate command submission, and early-exit checks. Run
`oaf -f tests/launcherBootstrap.js` for launcher compatibility, failed-load recovery,
and concurrent loading. The console loads launcher helpers first; with prewarming
enabled it loads the core and prepares eligible resources in the background.
Commands that need the agent wait for completion. With prewarming disabled the
core loads on demand. `loadLib` uses OpenAF's configured precompilation policy;
keep that policy unchanged when comparing runs and distinguish the first run
following a source edit from subsequent cache-warm runs.

Local reference measurements (ten fresh processes, warm filesystem/compiled caches)
put console input readiness at about 1.26 seconds with prewarming off and 1.27
seconds with it on, versus 2.52 seconds in the preceding marker-based run.
An immediate local command still waits for core preparation (about 2.75 seconds
from launch); earlier prompt readiness does not eliminate that work. Discovery
was 0–1 ms for the default local directories, and subsequent agent construction
was about 1 ms, so no additional discovery or constructor cache was introduced.
These figures are checkout measurements, not installed-package or provider timings.
