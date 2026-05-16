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

export interface LearnerProfile {
  languageLevel: "beginner" | "intermediate" | "advanced";
  visualPreference: "graphs" | "diagrams" | "animations" | "examples";
  weakAreas: string[];
  completedTopics: string[];
}

export type SSEEventType =
  | "browser.searching"
  | "browser.source_found"
  | "decomposition.started"
  | "decomposition.plan_created"
  | "decomposition.complete"
  | "lesson.writing"
  | "lesson.visualization"
  | "lesson.quiz_generated"
  | "graph.node_added"
  | "graph.edge_added"
  | "graph.prerequisite_suggested"
  | "visualization.started"
  | "visualization.complete"
  | "gbrain.context_loaded"
  | "gbrain.memory_written"
  | "gbrain.offline"
  | "pipeline.complete"
  | "pipeline.error";

export interface SSEEvent {
  type: SSEEventType;
  [key: string]: unknown;
}
