import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { LearnerProfile, Source, Lesson } from "./types";

const exec = promisify(execFile);

const SESSION_TTL_MS = Number(process.env.GBRAIN_SESSION_TTL_MS || 72 * 60 * 60 * 1000);

const DEFAULT_PROFILE: LearnerProfile = {
  languageLevel: "intermediate",
  visualPreference: "diagrams",
  weakAreas: [],
  completedTopics: [],
};

let lastGbrainError: string | null = null;

type StoredProfile = LearnerProfile & {
  sessionId?: string;
  currentGoal?: string;
  createdAt?: string;
  updatedAt?: string;
  expiresAt?: string;
};

let clientP: Promise<Client> | null = null;
let oauthToken:
  | { accessToken: string; expiresAt: number }
  | null = null;

export function safeSessionId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "anonymous";
}

function gbrainUrl(): string | undefined {
  return process.env.GBRAIN_URL?.trim() || undefined;
}

function gbrainSharedSecret(): string | undefined {
  return process.env.GBRAIN_SHARED_SECRET?.trim() || undefined;
}

function gbrainClientCredentials(): { id: string; secret: string } | null {
  const id = process.env.GBRAIN_CLIENT_ID?.trim();
  const secret = process.env.GBRAIN_CLIENT_SECRET?.trim();
  return id && secret ? { id, secret } : null;
}

function allowLocalCliFallback(): boolean {
  return !gbrainUrl() && process.env.NODE_ENV !== "production";
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function userRoot(sessionId: string): string {
  return `users/${safeSessionId(sessionId)}`;
}

function cliSlug(path: string): string {
  return path.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/(^-|-$)/g, "");
}

function ttlMetadata(sessionId: string, type: string, title: string): string {
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_TTL_MS);
  return [
    "---",
    `type: ${type}`,
    `title: ${title}`,
    `sessionId: ${safeSessionId(sessionId)}`,
    `createdAt: ${now.toISOString()}`,
    `expiresAt: ${expires.toISOString()}`,
    "---",
    "",
  ].join("\n");
}

function stripFrontmatter(text: string): string {
  return text.replace(/^---[\s\S]*?---\n*/m, "");
}

function recordGbrainError(scope: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  lastGbrainError = `${scope}: ${message}`.slice(0, 240);
  console.warn(`[gbrain] ${lastGbrainError}`);
}

export function getGbrainDiagnostic(): { configured: boolean; mode: "mcp" | "cli"; lastError: string | null } {
  const url = gbrainUrl();
  return {
    configured: Boolean(url),
    mode: url ? "mcp" : "cli",
    lastError: lastGbrainError,
  };
}

async function getClient(): Promise<Client> {
  const url = gbrainUrl();
  if (!url) throw new Error("GBRAIN_URL is not configured");
  if (!clientP) {
    clientP = (async () => {
      const token = await gbrainBearerToken(url);
      const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
      const transport = new StreamableHTTPClientTransport(new URL("/mcp", url), {
        requestInit: headers ? { headers } : undefined,
      });
      const client = new Client({ name: "learngraph", version: "0.1.0" });
      await client.connect(transport);
      return client;
    })();
  }
  return clientP;
}

async function gbrainBearerToken(url: string): Promise<string | undefined> {
  const credentials = gbrainClientCredentials();
  if (credentials) {
    const now = Date.now();
    if (oauthToken && oauthToken.expiresAt > now + 60_000) return oauthToken.accessToken;

    const params = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: credentials.id,
      client_secret: credentials.secret,
      scope: "read write",
    });
    const res = await fetch(new URL("/token", url), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });
    if (!res.ok) {
      throw new Error(`GBrain token error: ${res.status} ${await res.text()}`);
    }
    const data = await res.json() as { access_token?: string; expires_in?: number };
    if (!data.access_token) throw new Error("GBrain token response missing access_token");
    oauthToken = {
      accessToken: data.access_token,
      expiresAt: now + Math.max(60, data.expires_in || 3600) * 1000,
    };
    return oauthToken.accessToken;
  }

  return gbrainSharedSecret();
}

async function callMcp(name: string, args: Record<string, unknown>) {
  const client = await getClient();
  return client.callTool({ name, arguments: args });
}

type McpTextContent = Array<{ text?: string }>;

function extractMcpText(result: Awaited<ReturnType<typeof callMcp>>): string | null {
  return (result.content as McpTextContent)?.[0]?.text || null;
}

function parseMcpJson(text: string | null): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function pageBodyFromMcp(text: string | null): string | null {
  const parsed = parseMcpJson(text);
  if (!parsed) return null;
  if (typeof parsed === "string") return parsed;
  if (typeof parsed === "object") {
    const page = parsed as {
      compiled_truth?: string;
      timeline?: string;
      content?: string;
      body?: string;
    };
    return [
      page.compiled_truth || page.content || page.body || "",
      page.timeline || "",
    ].filter(Boolean).join("\n\n") || null;
  }
  return null;
}

async function getPage(path: string): Promise<string | null> {
  if (gbrainUrl()) {
    try {
      return pageBodyFromMcp(extractMcpText(await callMcp("get_page", { slug: cliSlug(path) })));
    } catch (error) {
      recordGbrainError("mcp get_page", error);
      clientP = null;
      return null;
    }
  }

  if (!allowLocalCliFallback()) {
    recordGbrainError("mcp get_page", "GBRAIN_URL is required in production");
    return null;
  }

  try {
    const { stdout } = await exec("gbrain", ["get", cliSlug(path)]);
    return stdout || null;
  } catch (error) {
    recordGbrainError("cli get", error);
    return null;
  }
}

async function putPage(sessionId: string, path: string, body: string, type: string): Promise<boolean> {
  const title = path.split("/").at(-1) || path;
  const content = ttlMetadata(sessionId, type, title) + body;

  if (gbrainUrl()) {
    try {
      await callMcp("put_page", { slug: cliSlug(path), content });
      return true;
    } catch (error) {
      recordGbrainError("mcp put_page", error);
      clientP = null;
      return false;
    }
  }

  if (!allowLocalCliFallback()) {
    recordGbrainError("mcp put_page", "GBRAIN_URL is required in production");
    return false;
  }

  return new Promise((resolve) => {
    const child = spawn("gbrain", ["put", cliSlug(path)]);
    child.stdin.write(content);
    child.stdin.end();
    child.on("close", (code) => {
      if (code !== 0) recordGbrainError("cli put", `gbrain exited ${code}`);
      resolve(code === 0);
    });
    child.on("error", (error) => {
      recordGbrainError("cli put", error);
      resolve(false);
    });
  });
}

async function queryPages(sessionId: string, topic: string): Promise<string[] | null> {
  const query = `${topic} ${userRoot(sessionId)}`;

  if (gbrainUrl()) {
    try {
      const parsed = parseMcpJson(extractMcpText(await callMcp("search", { query, limit: 5 })));
      if (!parsed) return [];
      if (Array.isArray(parsed)) {
        return parsed.map(formatSearchResult).filter(Boolean).slice(0, 5);
      }
      if (typeof parsed === "string") return parsed.split("\n").filter(Boolean).slice(0, 5);
      return [JSON.stringify(parsed)].slice(0, 5);
    } catch (error) {
      recordGbrainError("mcp search", error);
      clientP = null;
      return null;
    }
  }

  if (!allowLocalCliFallback()) {
    recordGbrainError("mcp query", "GBRAIN_URL is required in production");
    return null;
  }

  try {
    const { stdout } = await exec("gbrain", ["query", query]);
    return stdout ? stdout.split("\n").filter(Boolean).slice(0, 5) : [];
  } catch (error) {
    recordGbrainError("cli query", error);
    return null;
  }
}

export async function touchSession(sessionId: string, topic: string): Promise<boolean> {
  const sid = safeSessionId(sessionId);
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_TTL_MS);
  const existing = await getPage(`${userRoot(sid)}/profile`);
  let profile: StoredProfile = DEFAULT_PROFILE;

  if (existing) {
    try {
      profile = JSON.parse(stripFrontmatter(existing)) as StoredProfile;
    } catch {
      profile = DEFAULT_PROFILE;
    }
  }

  return putPage(
    sid,
    `${userRoot(sid)}/profile`,
    JSON.stringify(
      {
        ...profile,
        sessionId: sid,
        currentGoal: `Learn ${topic} visually`,
        createdAt: profile.createdAt || now.toISOString(),
        updatedAt: now.toISOString(),
        expiresAt: expires.toISOString(),
      },
      null,
      2
    ),
    "learner-profile"
  );
}

export async function getProfile(sessionId: string): Promise<LearnerProfile> {
  const text = await getPage(`${userRoot(sessionId)}/profile`);
  if (!text) return DEFAULT_PROFILE;
  try {
    return JSON.parse(stripFrontmatter(text)) as LearnerProfile;
  } catch {
    return DEFAULT_PROFILE;
  }
}

export async function addWeakArea(sessionId: string, topic: string): Promise<boolean> {
  const sid = safeSessionId(sessionId);
  const text = await getPage(`${userRoot(sid)}/profile`);
  let profile: StoredProfile = DEFAULT_PROFILE;

  if (text) {
    try {
      profile = JSON.parse(stripFrontmatter(text)) as StoredProfile;
    } catch {
      profile = DEFAULT_PROFILE;
    }
  }

  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_TTL_MS);
  const weakAreas = Array.from(new Set([topic, ...profile.weakAreas])).slice(0, 12);

  return putPage(
    sid,
    `${userRoot(sid)}/profile`,
    JSON.stringify(
      {
        ...profile,
        sessionId: sid,
        weakAreas,
        updatedAt: now.toISOString(),
        expiresAt: expires.toISOString(),
      },
      null,
      2
    ),
    "learner-profile"
  );
}

export async function putResearch(sessionId: string, topic: string, sources: Source[]): Promise<boolean> {
  return putPage(
    sessionId,
    `${userRoot(sessionId)}/research/${slug(topic)}`,
    JSON.stringify(sources, null, 2),
    "research"
  );
}

export async function putLesson(sessionId: string, topic: string, subId: string, lesson: Lesson): Promise<boolean> {
  return putPage(
    sessionId,
    `${userRoot(sessionId)}/lessons/${slug(topic)}/${slug(subId)}`,
    [
      `# ${lesson.title}`,
      "",
      lesson.content,
      "",
      "## Quiz",
      ...lesson.quiz.map((question) => `- ${question.text}`),
    ].join("\n"),
    "lesson"
  );
}

export async function putConceptMemory(sessionId: string, topic: string, body: string): Promise<boolean> {
  const path = `${userRoot(sessionId)}/concepts/${slug(topic)}`;
  const existing = await getPage(path);
  const previous = existing ? stripFrontmatter(existing).trim() : `# ${topic}`;
  const entry = [`## ${new Date().toISOString()}`, body].join("\n");
  return putPage(sessionId, path, [previous, entry].filter(Boolean).join("\n\n"), "concept");
}

export async function queryContext(sessionId: string, topic: string): Promise<string[]> {
  return (await queryPages(sessionId, topic)) ?? [];
}

function formatSearchResult(result: unknown): string {
  if (!result || typeof result !== "object") return String(result || "");
  const item = result as {
    slug?: string;
    title?: string;
    type?: string;
    compiled_truth?: string;
    excerpt?: string;
    text?: string;
    score?: number;
  };
  return [
    item.slug || item.title || item.type || "memory",
    item.compiled_truth || item.excerpt || item.text || "",
  ].filter(Boolean).join(": ");
}
