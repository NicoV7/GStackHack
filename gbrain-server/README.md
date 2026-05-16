# GBrain Hosting (Hackathon)

One-command deploy:

```bash
cd gbrain-server
fly launch --name learngraph-gbrain --region sjc
fly deploy
```

Then set the env var on Vercel:
```bash
vercel env add GBRAIN_URL https://learngraph-gbrain.fly.dev
```

Local development:
```bash
gbrain serve --http --port 4100
```
