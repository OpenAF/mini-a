# External MCPs

This is a sample list of external MCPs that you can use with Mini-A.

| MCP | Description | Mini-A mcp parameter |
|-----|-------------|----------------------|
| mcp/dockerhub | Interact with Docker Hub API | ```(cmd: 'docker run --rm -i mcp/dockerhub')``` |
| mcp/wikipedia | Interact with Wikipedia API | ```(cmd: 'docker run --rm -i mcp/wikipedia-mcp')``` |
| mcp/duckduckgo | Interact with DuckDuckGo API | ```(cmd: 'docker run --rm -i mcp/duckduckgo')``` |
| mcp/fetch | Fetch URLs | ```(cmd: 'docker run --rm -i mcp/fetch')``` |
| mcp/openweather | Interact with OpenWeather API | ```(cmd: 'docker run --rm -i mcp/openweather')``` |
| mcp/aws-documentation | Search AWS Documentation | ```(cmd: 'docker run --rm -i mcp/aws-documentation')``` |

> For container based MCPs first pull the corresponding image with `docker pull <image>` before using it.

> Check [Docker MCP Hub](https://hub.docker.com/mcp)