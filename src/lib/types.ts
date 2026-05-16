export interface Source {
  title: string;
  url: string;
  excerpt: string;
  relevance: number;
}

export interface Question {
  id: string;
  text: string;
  options: { label: string; correct: boolean }[];
  prerequisiteTopic?: string;
}

export interface Lesson {
  title: string;
  content: string;
  visualization?: string;
  quiz: Question[];
  sources: Source[];
}

export interface GraphNode {
  id: string;
  topic: string;
  status: "active" | "completed" | "locked" | "prerequisite-suggested";
  lesson?: Lesson;
  position: { x: number; y: number };
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: "prerequisite" | "branch" | "suggested";
}

export type SSEEventType =
  | "browser.searching"
  | "browser.source_found"
  | "lesson.writing"
  | "lesson.visualization"
  | "lesson.quiz_generated"
  | "graph.node_added"
  | "graph.edge_added"
  | "graph.prerequisite_suggested"
  | "pipeline.complete"
  | "pipeline.error";

export interface SSEEvent {
  type: SSEEventType;
  [key: string]: unknown;
}
