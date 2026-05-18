# Security

## Secret Scanning

This repo includes a gitleaks config. Before publishing or opening a pull request, run:

```bash
npm run security:secrets
```

Install gitleaks first if needed:

```bash
brew install gitleaks
```

The scan uses [.gitleaks.toml](.gitleaks.toml) and allows only documented placeholder values in examples.

## Environment Secrets

Do not commit `.env`, `.env.local`, or provider tokens. `.env.example` should contain placeholders only.

Production GBrain MCP access requires `GBRAIN_SHARED_SECRET` on both the web app and GBrain server. The GBrain server refuses authenticated-proxy startup unless the secret is set.
