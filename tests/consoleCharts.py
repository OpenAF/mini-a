"""Provider-free OpenAF regression for restored console charts and diagnostics."""
import json
from pathlib import Path
import subprocess
import tempfile


# Exercise /last before any agent has initialized the utility tools.
with tempfile.TemporaryDirectory(prefix="mini-a-console-charts-") as directory:
    conversation = Path(directory) / "conversation.json"
    chart = '```oafPrintChart\n' + json.dumps({
        "type": "bars",
        "data": [
            { "value": 54, "color": "b", "label": "Senate Democratic" },
            { "value": 44, "color": "r", "label": "Senate Republican" },
            { "value": 254, "color": "b", "label": "House Democratic" },
            { "value": 162, "color": "r", "label": "House Republican" },
        ],
        "options": { "unit": "int" },
        "title": "Restored chart",
    }) + '\n```'
    invalid = '```oafPrintChart\n{"type":"unsupported","data":[1]}\n```'
    original = "Before\n\n" + chart + "\n\n" + invalid + "\n\nAfter"
    conversation.write_text(json.dumps({
        "u": {},
        "c": [],
        "last": {
            "goal": "Restore a chart without a model call",
            "result": "PREVIOUSLY_FORMATTED_OUTPUT",
            "original": original,
        },
    }))
    options = {
        "resume": True,
        "sessionprewarm": False,
        "conversation": str(conversation),
        "historykeep": False,
        "usehistory": False,
        "historypath": directory,
        "useasciiviz": True,
        "usememory": False,
        "memorymd": False,
        "useskills": False,
    }
    code = '''
      loadLib("js/session/mini-a-session.js");
      __initializeCon();
      // Exercise the real ANSI renderer even when subprocess output is piped.
      __conAnsi = true;
      __conConsole = true;
      __ansiColorFlag = true;
      var reads = 0;
      Console.prototype.readLinePrompt = function() {
        reads++;
        if (reads === 1) {
          if (typeof MiniUtilsTool !== "undefined") throw "Utility tools loaded before /last";
          print("RENDERED_BEGIN");
          return "/last";
        }
        if (reads === 2) {
          if (typeof MiniUtilsTool !== "function") throw "Chart utility was not loaded";
          print("RAW_BEGIN");
          return "/last md";
        }
        print("RAW_END");
        return "/exit";
      };
      MiniAInteractiveSession(''' + json.dumps(options) + ''');
    '''
    result = subprocess.run(["oaf", "-c", code], capture_output=True, text=True, timeout=45)
    output = result.stdout + result.stderr
    assert result.returncode == 0 and "RAW_END" in output, output
    rendered = output.split("RENDERED_BEGIN", 1)[1].split("RAW_BEGIN", 1)[0]
    raw = output.split("RAW_BEGIN", 1)[1].split("RAW_END", 1)[0]
    assert "Restored chart" in rendered, rendered
    for label, value in [("Senate Democratic", 54), ("Senate Republican", 44),
                         ("House Democratic", 254), ("House Republican", 162)]:
        assert label in rendered and str(value) in rendered, rendered
    assert "\x1b[34m" in rendered and "\x1b[31m" in rendered, rendered
    assert chart not in rendered and "PREVIOUSLY_FORMATTED_OUTPUT" not in rendered, rendered
    assert rendered.count("Console chart could not be rendered:") == 1, rendered
    assert "Unknown type 'unsupported'" in rendered and '{"type":"unsupported","data":[1]}' in rendered, rendered
    assert original in raw and "Console chart could not be rendered:" not in raw, raw
    assert json.loads(conversation.read_text())["last"]["original"] == original
    print("PASS restored /last charts, visible failures, and unchanged /last md source")
