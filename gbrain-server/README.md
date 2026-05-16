# GBrain Azure Hosting

This container is the GBrain MCP backend for LearnGraph. Deploy it to Azure and point the web app at the Azure origin.

Runtime behavior:

- The image clones the official `garrytan/gbrain` repo and runs `src/cli.ts` with Bun.
- It intentionally does not install the npm package named `gbrain`; that package is unrelated to the official project.
- The container starts `gbrain serve --http`.
- It respects Azure's `PORT` env var, falling back to `4100` locally.
- PGLite runs on local container disk. If `GBRAIN_PERSIST_DIR` is set, the container restores from that directory at boot and syncs `$HOME/.gbrain` back periodically. Do not mount Azure Files directly at `/root/.gbrain`; PGLite can hang on the SMB filesystem.
- The web app must set `GBRAIN_URL=http://learngraph-gbrain.westus2.azurecontainer.io:4100`.
- The web app calls the MCP endpoint at `${GBRAIN_URL}/mcp`.

Azure build/deploy shape:

```bash
az acr build --registry ca8b188738a8acr --image learngraph-gbrain:demo ./gbrain-server
az container create \
  --resource-group learngraph \
  --name gbrain-learngraph \
  --image ca8b188738a8acr.azurecr.io/learngraph-gbrain:demo \
  --dns-name-label learngraph-gbrain \
  --ports 4100 \
  --ip-address Public \
  --os-type Linux \
  --restart-policy Always \
  --environment-variables PORT=4100 GBRAIN_PERSIST_DIR=/mnt/gbrain-persist \
  --azure-file-volume-account-name learngraphbrainstore \
  --azure-file-volume-account-key "$STORAGE_KEY" \
  --azure-file-volume-share-name gbrain-backup \
  --azure-file-volume-mount-path /mnt/gbrain-persist
```

Local development:

```bash
gbrain serve --http --port 4100
```

Then set:

```bash
GBRAIN_URL=http://localhost:4100
```
