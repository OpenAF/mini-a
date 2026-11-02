"""Provider-free OpenAF integration checks for console bootstrap."""
import subprocess

prefix = 'loadLib("mini-a-session.js"); __initializeCon(); '
cases = {
    'help_without_core': prefix + '''
      var reads=0;
      Console.prototype.readLinePrompt=function(){
        reads++;
        if(reads===1){ if(typeof MiniA!=="undefined") throw "Core loaded before input"; return "/help" }
        if(typeof MiniA!=="undefined") throw "Help loaded the core";
        print("BOOTSTRAP_PASS"); return "/exit"
      };
      MiniAInteractiveSession({sessionprewarm:false});''',
    'immediate_command': prefix + '''
      var reads=0;
      Console.prototype.readLinePrompt=function(){
        reads++;
        if(reads===1) return "/set verbose false";
        if(typeof MiniA!=="function" || typeof MiniA.prototype.start!=="function") throw "Core incomplete";
        print("BOOTSTRAP_PASS"); return "/exit"
      };
      MiniAInteractiveSession({sessionprewarm:true});''',
    'early_exit': prefix + '''
      Console.prototype.readLinePrompt=function(){print("BOOTSTRAP_PASS");return "/exit"};
      MiniAInteractiveSession({sessionprewarm:true});''',
}
for name, code in cases.items():
    result = subprocess.run(['oaf', '-c', code], capture_output=True, text=True, timeout=45)
    output = result.stdout + result.stderr
    if result.returncode or 'BOOTSTRAP_PASS' not in output or 'ReferenceError' in output or 'TypeError' in output:
        raise RuntimeError(name + '\n' + output)
    print('PASS ' + name)
