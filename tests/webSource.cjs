const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const prompt = fs.readFileSync(path.join(root, 'mini-a-web-session.js'), 'utf8');
const body = prompt.slice(prompt.indexOf('{') + 1, prompt.lastIndexOf('}')).trimEnd().replace(/^  /gm, '    ');
module.exports = fs.readFileSync(path.join(root, 'mini-a-web.yaml'), 'utf8').replace('    return MiniAWebPrompt(request)', body.trimStart().replace(/^/, '    '));
