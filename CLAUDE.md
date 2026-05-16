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
- `POST /api/learn` — SSE pipeline: Browser Agent (Tavily) → Lesson Agent (Claude) → Graph Agent (Claude)
- `POST /api/rewire` — Rewire Agent: wrong quiz answer → prerequisite node

## Environment Variables

Copy `.env.example` to `.env.local` and fill in:
- `ANTHROPIC_API_KEY` — Claude API key
- `TAVILY_API_KEY` — Tavily search API key

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
