# LearnGraph pathway/dedup handoff

Date: 2026-05-16
Branch: `main`
Current HEAD when written: `35f5e81 feat(llm): Azure Ollama backend with /no_think and cascading fallback`

## Context

The app is mostly functional end to end and is now targeting Azure for the service deployment. The issue reported was:

- Lesson topics were extracted correctly.
- Generated lessons were not behaving like connected pathways.
- Re-searching or typing a related term could duplicate lesson nodes instead of expanding the same knowledge graph.
- We need the graph to use GBrain semantic/BM25 context to connect new terms to existing nodes when related.

## Root Cause

The pipeline used decomposition output as a flat list.

`decompositionAgent` returned useful `LessonPlan.prerequisiteOf` relationships, but `/api/learn` discarded that dependency signal and emitted every plan as `root -> plan` branch edges. The frontend also reset `GraphState` on every new search, so it could not expand across searches or tell the backend what nodes already existed.

`lessonAgent` also only received the subtopic string, so fallback or weak LLM paths often generated generic standalone lessons instead of lessons that knew their position in the pathway.

## What Changed

### Pathway builder

File: `src/lib/lesson-pathway.ts`

Added:

- `slugTopic`
- `buildLessonPathway`
- `buildRelatedNodeEdges`
- `ExistingLessonNode`

`buildLessonPathway` converts decomposed plans into:

- stable node ids
- positioned pathway nodes
- prerequisite edges using `prerequisiteOf`
- ordered fallback prerequisite edges when `prerequisiteOf` is missing

`buildRelatedNodeEdges` scores existing graph nodes against the new topic/pathway nodes using:

- topic token overlap
- GBrain query context
- direct phrase containment

It emits `suggested` edges, capped to 6, to keep the expanding graph readable.

### Backend pipeline

File: `src/app/api/learn/route.ts`

Changed `/api/learn` to accept:

```ts
existingNodes?: {
  id: string;
  topic: string;
  hasLesson?: boolean;
}[];
```

Behavior now:

- Queries GBrain with the new topic plus existing node topics.
- Builds pathway nodes/edges from decomposition plans.
- Emits related `suggested` edges from existing nodes to new topic/pathway nodes.
- Skips lesson generation for pathway nodes that already have a lesson.
- Passes plan context into `lessonAgent`.

### Lesson generation

File: `src/lib/agents/lesson-agent.ts`

Added `LessonPlanContext`:

```ts
{
  focus: string;
  visualStyle: "graph" | "diagram" | "animation" | "example";
  prerequisiteOf: string | null;
  previousTopic?: string;
  nextTopic?: string;
}
```

The LLM prompt now includes:

- pathway role/focus
- visual style
- previous lesson
- next lesson
- prerequisite target

Fallback lessons now stay specific to the extracted pathway topic instead of falling back to the generic derivatives lesson for every derivative-like title.

### Frontend graph behavior

Files: `public/app.js`, `public/graph.js`

Changed:

- `startPipeline` no longer resets the graph on every search.
- Existing lesson topics open their saved lesson instead of regenerating.
- Frontend sends `GraphState.snapshotNodes()` with `/api/learn`.
- `GraphState.addRootNode` reuses existing nodes by id.
- `GraphState.addEdge` dedupes by id and by source/target/type.
- `GraphState.findByTopic` and `snapshotNodes` support dedup and backend relation checks.
- Related edges from backend show an agent feed event like `Related: Limits -> Derivatives`.
- Branch lessons no longer get incorrectly assigned to the root node.

## Tests Added

Files:

- `tests/lesson-pathway.test.ts`
- `tests/lesson-agent.test.ts`

Coverage:

- `prerequisiteOf` creates real pathway prerequisite edges.
- Missing `prerequisiteOf` falls back to ordered prerequisite edges.
- Related existing nodes connect to new topic/pathway nodes using GBrain context.
- `lessonAgent` passes pathway context into the LLM prompt.
- Fallback lessons remain specific to the extracted pathway topic.

## Verification Run

Passed:

```txt
node --check public/app.js
node --check public/graph.js
npm test
npm run build
```

Latest observed test result:

```txt
9 test files passed
28 tests passed
```

Production build passed with Next.js route output for:

- `/`
- `/api/learn`
- `/api/rewire`

## Known Caveat

A production HTTP smoke test against live lesson generation reached search/decomposition successfully, but the live LLM path can stall for a long time depending on provider latency. After this handoff was first written, the LLM provider chain was narrowed to Ollama/qwen first with Anthropic fallback only, and `LLM_TIMEOUT_MS` was added so the app does not fall through to Gemini or hang indefinitely.

## Suggested Next Steps

1. Confirm Azure has `OLLAMA_URL`, `OLLAMA_MODEL=qwen3:8b`, and a sane `LLM_TIMEOUT_MS`.
2. Persist graph node metadata to GBrain so semantic/BM25 related-edge checks can use richer stored node descriptions, not only titles.
3. Consider adding a small `graph.relationship_found` SSE event type instead of overloading `graph.edge_added` with `source: "gbrain.related"`.
4. Run a browser QA pass against the Azure URL once deployed.
