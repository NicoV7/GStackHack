import { NextRequest, NextResponse } from "next/server";
import { deepDiveAgent } from "@/lib/agents/deep-dive-agent";

export async function POST(req: NextRequest) {
  try {
    const { topic, sources } = await req.json();

    if (!topic || typeof topic !== "string") {
      return NextResponse.json(
        { error: "topic is required and must be a string" },
        { status: 400 }
      );
    }

    const result = await deepDiveAgent(topic, sources || []);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: "Deep dive generation failed", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
