# TODOS

## Pending

### Hosted GBrain Demo Moat
**Priority:** P0 (demo moat)
**What:** Implement the hosted GBrain loop from `docs/gstack/2026-05-16-gbrain-hosting-demo-moat-plan.md`: one shared GBrain service, session-scoped memory, TTL cleanup, and honest fallback mode.
**Why:** The product moat is not lesson generation. The moat is memory changing the next lesson after the learner gets stuck.
**Demo proof:** Search `derivatives` → answer quiz wrong with `area under the curve` → graph inserts `Limits` → next card explains that limits are blocking derivatives.
**Depends on:** `GBRAIN_URL` hosted MCP endpoint or fallback mode for the demo session.

### Demo Script
**Priority:** P1 (before demo day)
**What:** Write a demo script for the 5-agent pipeline: search → decomposition (topic shatters) → parallel lessons → visualization + graph. Include GBrain memory loop: wrong answer → memory written → next session adapts.
**Why:** Hackathon demos fail from unrehearsed paths, not from bad code. A rehearsed demo with fallback plans wins.
**Context:** Pipeline now has 5 agents with SSE streaming. Demo should show: (1) topic decomposition visible in real-time, (2) GBrain memory write after wrong quiz answer, (3) returning session gets personalized content. Fallback mode honest: "GBrain offline — using cached memory."
**Depends on:** 5-agent pipeline working (DONE), hosted GBrain service.

### Response Caching for Development
**Priority:** P2 — **DONE**
**What:** In-memory response cache exists in `src/app/api/learn/route.ts` (Map keyed by normalized topic).
**Status:** Implemented. Repeated queries replay cached SSE events instantly.
