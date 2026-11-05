"""Fresh-process startup markers; run from the repository root with Python 3."""
import argparse
import json
import statistics
import subprocess
import time
import threading

parser = argparse.ArgumentParser()
parser.add_argument('--runs', type=int, default=10)
parser.add_argument('--case', action='append', dest='selected', help='Run only these cases (repeatable)')
args = parser.parse_args()
if args.runs < 1:
    parser.error('--runs must be positive')
cases = {
    'runtime': '',
    'session_parse': 'loadLib("js/session/mini-a-session.js");',
    'agent_load': 'loadLib("mini-a.js");',
    'agent_construct': 'loadLib("mini-a.js"); new MiniA();',
    'console_no_prewarm': 'loadLib("js/session/mini-a-session.js"); __initializeCon(); Console.prototype.readLinePrompt=function(){print("MINIA_BENCH_READY");exit(0,true)}; MiniAInteractiveSession({sessionprewarm:false});',
}
cases['console_prewarm'] = cases['console_no_prewarm'].replace('sessionprewarm:false', 'sessionprewarm:true')
cases['immediate_command'] = 'loadLib("js/session/mini-a-session.js"); __initializeCon(); var reads=0; Console.prototype.readLinePrompt=function(){if(++reads===1)return "/set verbose false";print("MINIA_BENCH_READY");return "/exit"}; MiniAInteractiveSession({sessionprewarm:true});'
if args.selected and any(name not in cases for name in args.selected):
    parser.error('Unknown case; choose from ' + ', '.join(cases))
for name, code in cases.items():
    if args.selected and name not in args.selected:
        continue
    samples = []
    for _ in range(args.runs):
        started = time.perf_counter()
        process = subprocess.Popen(['oaf', '-c', code + ' print("MINIA_BENCH_READY");'],
                                   stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        try:
            # Timestamp the emitted marker independently of shutdown latency.
            ready = []
            def read_output():
                for line in process.stdout:
                    if line.strip() == 'MINIA_BENCH_READY':
                        ready.append((time.perf_counter() - started) * 1000)
            reader = threading.Thread(target=read_output, daemon=True)
            reader.start()
            process.wait(timeout=45)
            reader.join(timeout=2)
            if process.returncode or not ready:
                raise RuntimeError(name + ': missing readiness marker or failed process')
            samples.append(round(ready[0], 1))
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()
            process.stdout.close()
    print(json.dumps({'case': name, 'median_ms': statistics.median(samples),
                      'min_ms': min(samples), 'max_ms': max(samples), 'samples_ms': samples}), flush=True)
