const fs = require('fs');
const path = require('path');

const files = [
  'mini-a-common.js', 'mini-a-con.js', 'mini-a-dreams.js', 'mini-a-graph.js', 'mini-a-ingest.js',
  'mini-a-mcp-wiki.js', 'mini-a-mcptest.js', 'mini-a-memory.js', 'mini-a-memoryman.js', 'mini-a-modelman.js',
  'mini-a-progcall.js', 'mini-a-response.js', 'mini-a-router.js', 'mini-a-sandbox.js', 'mini-a-subtask.js',
  'mini-a-tool-selection.js', 'mini-a-utils.js', 'mini-a-wiki.js', 'mini-a.js'
];

const PATTERNS = {
  functions: /function\s+\w+|const\s+\w+\s*=\s*(async\s*)?\(|=>|class\s+\w+/g,
  classes: /class\s+\w+|interface\s+\w+|type\s+\w+\s*=/g,
  variables: /const\s+\w+|let\s+\w+|var\s+\w+/g,
  comments: /\/\/.*/g
};

const results = [];

files.forEach(file => {
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n');
  
  let totalLines = lines.length;
  let blankLines = 0;
  let commentLines = 0;
  let loc = 0;

  lines.forEach(line => {
    const trimmed = line.trim();
    if (trimmed === '') {
      blankLines++;
    } else if (trimmed.startsWith('//') || trimmed.startsWith('/*',)) {
      commentLines++;
    } else {
      loc++;
      if (trimmed.includes('//')) commentLines++;
    }
  });

  results.push({
    file,
    loc,
    totalLines,
    commentLines,
    blankLines,
    functions: (content.match(PATTERNS.functions) || []).length,
    classes: (content.match(PATTERNS.classes) || []).length,
    variables: (content.match(PATTERNS.variables) || []).length
  });
});

console.log(JSON.stringify(results, null, 2));
