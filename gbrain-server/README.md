# GBrain Azure Hosting

This container is the GBrain MCP backend for LearnGraph. Deploy it to Azure and point the web app at the Azure origin.

Runtime behavior:

- The container starts `gbrain serve --http`.
- It respects Azure's `PORT` env var, falling back to `4100` locally.
- The web app must set `GBRAIN_URL=http://learngraph-gbrain.westus2.azurecontainer.io:4100`.
- The web app calls the MCP endpoint at `${GBRAIN_URL}/mcp`.

Local development:

```bash
gbrain serve --http --port 4100
```

Then set:

```bash
GBRAIN_URL=http://localhost:4100
```
