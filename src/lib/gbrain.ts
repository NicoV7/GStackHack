import { execFile, spawn } from "child_process";
import { promisify } from "util";
import type { LearnerProfile, Source, Lesson } from "./types";

const exec = promisify(execFile);

const DEFAULT_PROFILE: LearnerProfile = {
  languageLevel: "intermediate",
  visualPreference: "diagrams",
  weakAreas: [],
  completedTopics: [],
};

const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const safeSessionId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "anonymous";

async function gbrainGet(pageSlug: string): Promise<string | null> {
  try {
    const { stdout } = await exec("gbrain", ["get", pageSlug]);
    return stdout || null;
  } catch { return null; }
}

function gbrainPut(pageSlug: string, content: string, type = "concept"): Promise<void> {
  return new Promise((resolve) => {
    const frontmatter = `---\ntype: ${type}\ntitle: ${pageSlug}\n---\n\n`;
    const child = spawn("gbrain", ["put", pageSlug]);
    child.stdin.write(frontmatter + content);
    child.stdin.end();
    child.on("close", () => resolve());
    child.on("error", () => resolve());
  });
}

async function gbrainQuery(question: string): Promise<string | null> {
  try {
    const { stdout } = await exec("gbrain", ["query", question]);
    return stdout || null;
  } catch { return null; }
}

export async function getProfile(sessionId: string): Promise<LearnerProfile> {
  const sid = safeSessionId(sessionId);
  const text = await gbrainGet(`users-${sid}-profile`);
  if (!text) return DEFAULT_PROFILE;
  try { return JSON.parse(text.replace(/^---[\s\S]*?---\n*/m, "")) as LearnerProfile; }
  catch { return DEFAULT_PROFILE; }
}

export async function putResearch(sessionId: string, topic: string, sources: Source[]): Promise<void> {
  const sid = safeSessionId(sessionId);
  await gbrainPut(`users-${sid}-research-${slug(topic)}`, JSON.stringify(sources, null, 2), "research");
}

export async function putLesson(sessionId: string, topic: string, subId: string, lesson: Lesson): Promise<void> {
  const sid = safeSessionId(sessionId);
  await gbrainPut(`users-${sid}-lessons-${slug(topic)}-${subId}`, lesson.content, "lesson");
}

export async function putConceptMemory(sessionId: string, topic: string, body: string): Promise<void> {
  const sid = safeSessionId(sessionId);
  await gbrainPut(`users-${sid}-concepts-${slug(topic)}`, body, "concept");
}

export async function queryContext(sessionId: string, topic: string): Promise<string[]> {
  const sid = safeSessionId(sessionId);
  const text = await gbrainQuery(`${topic} user:${sid}`);
  if (!text) return [];
  return text.split("\n").filter(Boolean).slice(0, 5);
}
