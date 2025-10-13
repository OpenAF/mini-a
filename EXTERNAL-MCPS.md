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
| public.ecr.aws/awslabs-mcp/awslabs/aws-api-mcp-server | AWS API MCP Server | ```(cmd: 'docker run --rm -i -e AWS_REGION=some-region -e AWS_ACCESS_KEY_ID=xxx -e AWS_SECRET_ACCESS_KEY=yyy public.ecr.aws/awslabs-mcp/awslabs/aws-api-mcp-server')``` | 
| public.ecr.aws/awslabs-mcp/awslabs/cost-analysis-mcp-server | AWS Cost Analysis MCP Server | ```(cmd: 'docker run --rm -i -e AWS_REGION=some-region -e AWS_ACCESS_KEY_ID=xxx -e AWS_SECRET_ACCESS_KEY=yyy public.ecr.aws/awslabs-mcp/awslabs/cost-analysis-mcp-server')``` |
| public.ecr.aws/awslabs-mcp/awslabs/cost-explorer-mcp-server | AWS Cost Explorer MCP Server | ```(cmd: 'docker run --rm -i -e AWS_REGION=some-region -e AWS_ACCESS_KEY_ID=xxx -e AWS_SECRET_ACCESS_KEY=yyy public.ecr.aws/awslabs-mcp/awslabs/cost-explorer-mcp-server')``` |
| public.ecr.aws/awslabs-mcp/awslabs/eks-mcp-server | AWS EKS MCP Server | ```(cmd: 'docker run --rm -i -e AWS_REGION=some-region -e AWS_ACCESS_KEY_ID=xxx -e AWS_SECRET_ACCESS_KEY=yyy public.ecr.aws/awslabs-mcp/awslabs/eks-mcp-server')``` |
| public.ecr.aws/awslabs-mcp/awslabs/aws-pricing-mcp-server | AWS Pricing MCP Server | ```(cmd: 'docker run --rm -i -e AWS_REGION=some-region -e AWS_ACCESS_KEY_ID=xxx -e AWS_SECRET_ACCESS_KEY=yyy public.ecr.aws/awslabs-mcp/awslabs/aws-pricing-mcp-server')``` |
| public.ecr.aws/awslabs-mcp/awslabs/dynamodb-mcp-server | AWS DynamoDB MCP Server | ```(cmd: 'docker run --rm -i -e AWS_REGION=some-region -e AWS_ACCESS_KEY_ID=xxx -e AWS_SECRET_ACCESS_KEY=yyy public.ecr.aws/awslabs-mcp/awslabs/dynamodb-mcp-server')``` |

> For container based MCPs first pull the corresponding image with `docker pull <image>` before using it.

> Check [Docker MCP Hub](https://hub.docker.com/mcp)
> Check [AWS MCP Servers](https://gallery.ecr.aws/awslabs-mcp)

## Using external MCPs as HTTP remote

Some external MCP servers also expose an HTTP endpoint. When available, you can connect to them remotely the same way as Mini‑A’s built‑in MCPs that support `onport`.

Example (replace URL with the MCP’s endpoint):

```bash
mini-a.sh goal="query the external MCP" \
	mcp="(type: remote, url: 'http://external.mcp.local:1234/mcp')" \
	rpm=20 tpm=80000 __format=md
```
Adjust `rpm` and `tpm` to stay within the MCP server's published limits.

Refer to the external MCP’s documentation to confirm whether it exposes an HTTP endpoint and the path (commonly `/mcp`).

When connecting to remote MCPs you may also need to provide credentials or API keys. Use standard oJob argument syntax, for example:

```bash
mini-a.sh goal="use the private MCP" \
        mcp="(type: remote, url: 'https://example/mcp', headers: (authorization: 'Bearer ${MY_TOKEN}'))"
```

Prefer environment variables for sensitive data and confirm the external MCP's rate limits before automating high-frequency calls.
