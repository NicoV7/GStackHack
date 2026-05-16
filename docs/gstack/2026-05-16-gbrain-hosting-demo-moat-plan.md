# Plan: Local GBrain tunnel demo moat

Date: 2026-05-16
Repo: NicoV7/GStackHack
Status: implementation plan

## Goal

Make LearnGraph feel like a full web app with a real memory moat while keeping hackathon infra free:

> The learner answers a quiz. GBrain remembers the mistake. The next lesson changes because of that memory.

The demo does not need production-grade accounts, billing, or unlimited storage. It needs one credible loop that proves GBrain is not just a cache. We will not host GBrain on Fly.io; we will run GBrain locally and expose it through a temporary tunnel.

## The 4-item hosting plan

### 1. Local GBrain service behind a tunnel

Run one local GBrain MCP service for the hackathon machine. Expose it with a tunnel so the web app can call it during the demo. Do not run one GBrain instance per user.

Web app flow:

```txt
Browser
  -> Next.js API routes
    -> tunnel URL
      -> local GBrain MCP service
      -> scoped memory pages
```

Environment:

```txt
GBRAIN_URL=https://<temporary-tunnel-domain>
```

Rules:

- Browser never calls GBrain directly.
- `GBRAIN_URL` is only used from server-side routes.
- All GBrain writes go through app-owned API routes.
- If `GBRAIN_URL` is missing, the app uses the local `gbrain` CLI from the Next.js server process.
- If `GBRAIN_URL` is unreachable and the CLI is unavailable, the app uses fallback memory.
- The tunnel is temporary demo infrastructure, not production hosting.

Why this works for the hackathon:

- It avoids Fly.io cost.
- One local service is easy to debug during demo.
- User isolation happens by namespace, not infrastructure duplication.

Runbook:

```txt
gbrain serve --http --port 4100
cloudflared tunnel --url http://localhost:4100
# or: ngrok http 4100

GBRAIN_URL=https://<tunnel-domain>
npm run dev
```

### 2. Session-scoped memory

Give every anonymous learner a `sessionId`. Store it in localStorage or a cookie.

Every GBrain path is scoped:

```txt
users/{sessionId}/profile
users/{sessionId}/concepts/{topic}
users/{sessionId}/sessions/{timestamp}
users/{sessionId}/lessons/{topic}/{lessonId}
users/{sessionId}/research/{topic}
```

API contract:

```ts
type LearnRequest = {
  topic: string;
  sessionId: string;
};

type RewireRequest = {
  sessionId: string;
  currentTopic: string;
  wrongAnswer: string;
  question: Question;
  existingNodes: string[];
};
```

Server-side guardrails:

- Reject missing `sessionId`.
- Normalize `sessionId` to a safe slug.
- Prefix every GBrain query and write with `users/{sessionId}/`.
- Never let the client supply a raw GBrain path.

Demo proof:

1. Search `derivatives`.
2. Answer derivative quiz incorrectly.
3. Rewire agent writes `users/demo-session/concepts/limits`.
4. Search or continue again.
5. GBrain context says limits are weak, so the next card starts with limits.

### 3. TTL cleanup

Anonymous demo memory should expire. Use a simple TTL policy instead of full account lifecycle.

Recommended hackathon TTL:

```txt
anonymous sessions: 72 hours
demo session: keep pinned
```

Implementation options:

- Current path: Next.js writes `expiresAt` metadata and cleanup is manual after demo.
- Simplest demo path: use one pinned `demo-session` and clear it before the presentation.
- Later hosted path: add a cleanup job that deletes `users/{sessionId}` after `expiresAt`.

Each session profile should include:

```markdown
# Learner profile

sessionId: demo-session
createdAt: 2026-05-16T00:00:00Z
expiresAt: 2026-05-19T00:00:00Z

Current goal: learn derivatives visually.
Weak concepts: limits
Preferred lesson format: animated graph, then one quiz.
```

Cost control:

- TTL keeps indexed memory small.
- Cache search/lesson/graph results by `{sessionId}:{topic}`.
- Use demo-cache if Tavily, Gemini, Ollama, or GBrain fails.

### 4. Fallback mode

The demo must work when vendors fail.

Fallback layers:

1. Local `gbrain` CLI if `GBRAIN_URL` is absent.
2. Current in-memory response cache for repeated topics.
3. Existing `src/lib/demo-cache.ts` for known-good derivatives/vectors/probability.
4. Local client graph state for the current session.
5. A visible fallback message in the agent feed: `GBrain offline — using cached/local memory`.

Fallback is honest:

- The UI still shows the memory loop.
- The agent feed names when cached memory is used.
- The demo script says: "GBrain is running locally behind a tunnel. If the tunnel drops, the app falls back so the user experience does not break."

## Implementation sequence

### Step 1: Add session identity

Frontend:

- Generate `lg_session_id` if absent.
- Send it with `/api/learn` and `/api/rewire`.
- Show the session id in a small demo/debug chip if useful.

Server:

- Add `getSessionId(reqBody)` helper.
- Sanitize to `[a-zA-Z0-9_-]`.
- Reject empty IDs.

### Step 2: Make GBrain adapter tenant-aware

Current file: `src/lib/gbrain.ts`

Change:

```ts
getProfile(sessionId)
putResearch(sessionId, topic, sources)
putLesson(sessionId, topic, subId, lesson)
putConceptMemory(sessionId, topic, body)
queryContext(sessionId, topic)
```

All paths must use:

```ts
const userRoot = `users/${safeSessionId(sessionId)}`;
```

### Step 3: Write memory on learn + rewire

On `/api/learn`:

- Query GBrain context before generating lesson.
- Emit an SSE event: `gbrain.context_loaded`.
- Write research and generated lesson after the pipeline completes.

On `/api/rewire`:

- Write the misconception to `users/{sessionId}/concepts/{currentTopic}`.
- Write the suggested prerequisite to `users/{sessionId}/concepts/{prerequisite}`.
- Emit an SSE event: `gbrain.memory_written`.

### Step 4: Add demo fallback

If GBrain call fails:

- Do not fail the route.
- Emit `gbrain.offline`.
- Continue with local cache/demo-cache.

### Step 5: Add one scripted demo session

Add a known-good path:

```txt
sessionId: demo-derivatives
topic: derivatives
wrong answer: "the total area under the curve"
expected rewire: Limits
next card reason: "Limits is blocking derivatives."
```

## Demo script

### Opening

"Most apps remember your streak. LearnGraph remembers why you got stuck."

### Run

1. Start local GBrain and the tunnel.
2. Open the app.
3. Search `derivatives`.
4. Point out Browser, Lesson, Graph, Visualization, and GBrain events streaming work.
5. Open the derivative lesson.
6. Answer the quiz wrong: choose `area under the curve`.
7. The graph inserts `Limits` as prerequisite.
8. Show the feed event: `GBrain memory saved`.
9. Search or continue again.
10. The next card starts from limits.

### Close

"Duolingo has streaks. We have memory."

## Definition of ready

The demo is ready when these pass:

- App loads from a local or public tunnel URL.
- `GBRAIN_URL` can be missing and the app still works.
- `GBRAIN_URL` can be present as a tunnel URL and the app writes scoped session memory.
- Wrong quiz answer creates a visible prerequisite node.
- Repeating the same session changes the next lesson because memory exists.
- Fresh session does not see the previous session's memory.
- Known-good `derivatives` path completes in under 60 seconds.

## Cost position

GBrain should not have a hosting cost for the hackathon because it runs locally and the tunnel is temporary demo infrastructure.

Expected cost drivers:

- LLM calls
- Search API calls
- Repeated uncached demo runs

Expected free/low-cost parts:

- Markdown memory pages
- Lesson HTML/text artifacts
- Session metadata
- Local GBrain process
- Temporary tunnel

Decision:

Use one local GBrain service with session namespaces and expose it through a tunnel for the hackathon. Do not build per-user GBrain instances, and do not pay for Fly.io.
