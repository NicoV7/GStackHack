import { z } from "zod";

export const SourceSchema = z.object({
  title: z.string(),
  url: z.string(),
  excerpt: z.string(),
  relevance: z.number().min(0).max(1),
});

export const QuestionSchema = z.object({
  id: z.string(),
  text: z.string(),
  options: z.array(
    z.object({
      label: z.string(),
      correct: z.boolean(),
    })
  ),
  prerequisiteTopic: z.string().optional(),
});

export const LessonSchema = z.object({
  title: z.string(),
  content: z.string(),
  visualization: z.string().optional(),
  quiz: z.array(QuestionSchema),
});

export const GraphNodeOutputSchema = z.object({
  id: z.string(),
  topic: z.string(),
  status: z.enum(["active", "completed", "locked", "prerequisite-suggested"]),
});

export const GraphEdgeOutputSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  type: z.enum(["prerequisite", "branch", "suggested"]),
});

export const GraphOutputSchema = z.object({
  newNodes: z.array(GraphNodeOutputSchema),
  newEdges: z.array(GraphEdgeOutputSchema),
  suggestedPrerequisites: z.array(GraphNodeOutputSchema),
});

export const RewireOutputSchema = z.object({
  prerequisiteTopic: z.string(),
  reason: z.string(),
});

export const VisualizationOutputSchema = z.object({
  type: z.enum(["svg", "diagram", "graph", "animation"]),
  spec: z.string(),
  description: z.string(),
  interactiveHint: z.string().nullable(),
});

export const LessonPlanSchema = z.object({
  subTopic: z.string(),
  focus: z.string(),
  visualStyle: z.enum(["graph", "diagram", "animation", "example"]),
  prerequisiteOf: z.string().nullable(),
});

export const DecompositionOutputSchema = z.object({
  plans: z.array(LessonPlanSchema).min(1).max(4),
});

export type SourceOutput = z.infer<typeof SourceSchema>;
export type LessonOutput = z.infer<typeof LessonSchema>;
export type GraphOutput = z.infer<typeof GraphOutputSchema>;
export type RewireOutput = z.infer<typeof RewireOutputSchema>;
export type VisualizationOutput = z.infer<typeof VisualizationOutputSchema>;
export type DecompositionOutput = z.infer<typeof DecompositionOutputSchema>;
