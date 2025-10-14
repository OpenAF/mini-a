# Tests

## "Files" test

Using just shell commands without any tooling APIs both in agent and chatbot mode.

### Results

| Model      | Files md | Files oafp | Files chat | Files oafp chat | 
|------------|----------|------------|------------|-----------------|
| gpt-5-nano | ✅       | ✅         | ✅         | ✅              |
| gpt-5-mini | ✅       | ✅         | ✅         | ✅              |
| gpt-5      | ✅       | ✅         | ✅         | ✅              |
| openai/gpt-oss-20b | ✅ | ✅ | ❌ | ❌ |
| openai/gpt-oss-120b | ✅ | ✅ | ✅ | ❌ |
| llama-3.1-8b | ❌ | ❌ | ❌ | ❌ |
| amazon nova pro | ✅ | ✅ | ❌ | ❌ |
| amazon nova micro | ❌ | ❌ | ❌ | ❌ | 

### Tests

| Test | Command |
|------|---------|
| **files md**   | ```mini-a.sh goal="list the filenames in the current folder" useshell=true format=md``` |
| **files oafp** | ```oafp in=minia data="(goal: 'list the filenames in the current folder', useshell: true)" out=ctree``` |
| **files chat** | ```mini-a.sh goal="list the filenames in the current folder" useshell=true format=md chatbotmode=true``` |
| **files oafp chat** | ```oafp in=minia data="(goal: 'list the filenames in the current folder', useshell: true, chatbotmode: true)" out=ctree``` |

## "Tools" tests

### Results

| Model      | Emb tool | API tool | Emb tool chat | API tool chat |
|------------|----------|----------|---------------|---------------|
| gpt-5-nano | ✅       | ✅         | ❌         | ✅            |
| gpt-5-mini | ✅ | ✅ | ✅ | ✅ |
| gpt-5      | ✅ | ✅ | ✅ | ✅ |
| openai/gpt-oss-20b | ✅ | ✅ | ❌ | ✅ |
| openai/gpt-oss-120b | ✅ | ✅ | ❌ | ❌ |
| amazon nova pro   | ✅ | ❌ | ❌ | ❌ |
| amazon nova micro | ❌ | ❌ | ❌ | ❌ |

### Tests

| Test | Command |
|------|---------|
| **Emb tool** | ```mini-a.sh goal="what is the port 443 latency for host yahoo.co.jp" mcp="(cmd: 'ojob mcps/mcp-net.yaml')" format=md``` |
| **API tool** | ```mini-a.sh goal="what is the port 443 latency for host yahoo.co.jp" mcp="(cmd: 'ojob mcps/mcp-net.yaml')" format=md usetools=true``` |
| **Emb tool chat** | ```mini-a.sh goal="what is the port 443 latency for host yahoo.co.jp" mcp="(cmd: 'ojob mcps/mcp-net.yaml')" chatbotmode=true format=md``` |
| **API tool chat** | ```mini-a.sh goal="what is the port 443 latency for host yahoo.co.jp" mcp="(cmd: 'ojob mcps/mcp-net.yaml')" format=md chatbotmode=true usetools=true``` |