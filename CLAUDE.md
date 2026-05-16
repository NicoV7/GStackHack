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
- `POST /api/learn` — SSE pipeline: GBrain Profile → Browser Agent (Tavily) → Decomposition Agent → Lesson Agents (parallel, Gemini/Ollama) → Visualization Agent + Graph Agent (parallel) → GBrain Persist
- `POST /api/rewire` — Rewire Agent: wrong quiz answer → prerequisite node

## Environment Variables

Copy `.env.example` to `.env.local` and fill in:
- `TAVILY_API_KEY` — Tavily search API key (optional — falls back to demo cache)
- `GEMINI_API_KEY` — Gemini API key for cloud LLM
- `OLLAMA_URL` — Ollama server URL (default: http://localhost:11434)
- `OLLAMA_MODEL` — Ollama model name (default: qwen3:8b)
- `GBRAIN_URL` — GBrain MCP server URL (default: http://localhost:4100)

## Prerequisites

- Ollama running locally: `ollama serve` (OR set GEMINI_API_KEY for cloud)
- GBrain serving: `gbrain serve --http --port 4100` (optional — app falls back to defaults)

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
