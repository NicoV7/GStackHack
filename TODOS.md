# TODOS

## Pending

### Demo Script
**Priority:** P1 (before demo day)
**What:** Write a demo script with known-good queries ("derivatives", "vectors"), expected outputs, latency expectations, and recovery steps when vendors fail.
**Why:** Hackathon demos fail from unrehearsed paths, not from bad code. A rehearsed demo with fallback plans wins.
**Context:** Codex flagged this during eng review. The app has fallback data for when APIs fail — the demo script should specify when to use them and how to recover gracefully on stage.
**Depends on:** API routes must be working first.

### Response Caching for Development
**Priority:** P2 (during development)
**What:** Add in-memory cache (Map keyed by topic) for Tavily and Claude responses during development.
**Why:** Same query should not re-call APIs during dev/testing/judging. Saves Tavily free tier quota (1000 calls/month) and makes dev iteration instant.
**Context:** ~10 lines of code. Simple `const cache = new Map()` in the API route. No invalidation needed for hackathon scope.
**Depends on:** API route structure must exist.
