import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { LearnerProfile, Source, Lesson } from "./types";

const GBRAIN_URL = process.env.GBRAIN_URL || "http://localhost:4100";

const DEFAULT_PROFILE: LearnerProfile = {
  languageLevel: "intermediate",
  visualPreference: "diagrams",
  weakAreas: [],
  completedTopics: [],
};

let clientP: Promise<Client> | null = null;

function getClient(): Promise<Client> {
  if (!clientP) {
    clientP = (async () => {
      const t = new StreamableHTTPClientTransport(new URL("/mcp", GBRAIN_URL));
      const c = new Client({ name: "learngraph", version: "0.1.0" });
      await c.connect(t);
      return c;
    })();
  }
  return clientP;
}

async function call(name: string, args: Record<string, unknown>) {
  return (await getClient()).callTool({ name, arguments: args });
}

const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

const safeSessionId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "anonymous";

type Content = Array<{ text?: string }>;
const extractText = (res: Awaited<ReturnType<typeof call>>) =>
  (res.content as Content)?.[0]?.text || null;

export async function getProfile(sessionId: string): Promise<LearnerProfile> {
  try {
    const sid = safeSessionId(sessionId);
    const text = extractText(await call("get_page", { path: `users/${sid}/profile` }));
    return text ? (JSON.parse(text) as LearnerProfile) : DEFAULT_PROFILE;
  } catch { clientP = null; return DEFAULT_PROFILE; }
}

export async function putResearch(sessionId: string, topic: string, sources: Source[]): Promise<void> {
  try {
    const sid = safeSessionId(sessionId);
    await call("put_page", { path: `users/${sid}/research/${slug(topic)}`, type: "research", body: JSON.stringify(sources) });
  } catch { clientP = null; }
}

export async function putLesson(sessionId: string, topic: string, subId: string, lesson: Lesson): Promise<void> {
  try {
    const sid = safeSessionId(sessionId);
    await call("put_page", { path: `users/${sid}/lessons/${slug(topic)}/${subId}`, type: "lesson", body: lesson.content });
  } catch { clientP = null; }
}

export async function putConceptMemory(sessionId: string, topic: string, body: string): Promise<void> {
  try {
    const sid = safeSessionId(sessionId);
    await call("put_page", { path: `users/${sid}/concepts/${slug(topic)}`, type: "concept", body });
  } catch { clientP = null; }
}

export async function queryContext(sessionId: string, topic: string): Promise<string[]> {
  try {
    const sid = safeSessionId(sessionId);
    const text = extractText(await call("query", { query: topic, prefix: `users/${sid}/` }));
    if (!text) return [];
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch { clientP = null; return []; }
}
