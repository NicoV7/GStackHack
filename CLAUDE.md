# Project Agent Instructions

LearnGraph — AI-powered learning search engine. Hackathon project (gstack).

## Commands

```bash
npm run dev      # Start dev server on localhost:3000
npm test         # Run vitest tests
npm run build    # Production build
```

## Architecture

Hybrid: vanilla JS frontend (public/) + Next.js API routes (src/app/api/).
- `POST /api/learn` — SSE pipeline: GBrain Profile → Browser Agent (Tavily) → Decomposition Agent → Lesson Agents (parallel, Ollama/qwen with Anthropic fallback) → Visualization Agent + Graph Agent (parallel) → GBrain Persist
- `POST /api/rewire` — Rewire Agent: wrong quiz answer → prerequisite node

## Environment Variables

Copy `.env.example` to `.env.local` and fill in:
- `TAVILY_API_KEY` — Tavily search API key (optional — falls back to demo cache)
- `OLLAMA_URL` — Azure Ollama/qwen endpoint for the web backend (`http://learngraph-ollama.westus2.azurecontainer.io:11434` in production)
- `OLLAMA_MODEL` — Ollama model name (default: qwen3:8b)
- `LLM_TIMEOUT_MS` — provider timeout before fallback (default: 25000)
- `ANTHROPIC_API_KEY` — optional paid fallback if Ollama/Azure is unavailable
- `GBRAIN_URL` — Azure GBrain MCP server origin (`http://learngraph-gbrain.westus2.azurecontainer.io:4100` in production); the app calls `${GBRAIN_URL}/mcp`

## Prerequisites

- Ollama/qwen running on Azure and reachable from the web app container
- GBrain running on Azure and reachable from the web app container
- Localhost defaults are for local dev only; Azure should communicate through Azure endpoints.

## Testing

Tests are in `tests/` using vitest. Run with `npm test`.

This repo is being used by a team during the GStack/GBrain hackathon.

## GStack Documents

Store team-facing GStack artifacts in `docs/gstack/`.

This includes:

- Office-hours design docs
- Product plans
- System maps
- Engineering review plans
- Design review notes
- Demo scripts
- Handoff summaries

Local GStack state may still exist under `~/.gstack/`, but any document that the
team needs to read, review, or commit should also be written into this repo.
