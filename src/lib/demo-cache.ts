import type { Source, Lesson, GraphNode, GraphEdge } from "./types";
import type { VisualizationResult } from "./agents/visualization-agent";
import type { LessonPlan } from "./agents/schemas";

export const CACHED_SOURCES: Record<string, Source[]> = {
  derivatives: [
    {
      title: "Introduction to Derivatives - Khan Academy",
      url: "https://www.khanacademy.org/math/calculus-1/cs1-derivatives-definition-and-basic-rules",
      excerpt: "The derivative of a function describes the function's instantaneous rate of change at a certain point. Another common interpretation is that the derivative gives us the slope of the tangent line to the function's graph at that point.",
      relevance: 0.95,
    },
    {
      title: "Derivative Rules - Math is Fun",
      url: "https://www.mathsisfun.com/calculus/derivatives-rules.html",
      excerpt: "The Power Rule says that the derivative of x^n is nx^(n-1). The Sum Rule says the derivative of a sum is the sum of the derivatives. The Product Rule and Chain Rule handle more complex expressions.",
      relevance: 0.9,
    },
    {
      title: "Applications of Derivatives - MIT OpenCourseWare",
      url: "https://ocw.mit.edu/courses/18-01-single-variable-calculus",
      excerpt: "Derivatives are used to find rates of change, slopes of tangent lines, and to solve optimization problems. Key applications include velocity, acceleration, and finding maxima and minima of functions.",
      relevance: 0.85,
    },
    {
      title: "Understanding the Chain Rule - Brilliant.org",
      url: "https://brilliant.org/wiki/chain-rule/",
      excerpt: "The chain rule is a formula for computing the derivative of a composite function. If h(x) = f(g(x)), then h'(x) = f'(g(x)) * g'(x). It is one of the most important differentiation rules.",
      relevance: 0.8,
    },
  ],
  limits: [
    {
      title: "Limits - Paul's Online Notes",
      url: "https://tutorial.math.lamar.edu/classes/calci/limitsintro.aspx",
      excerpt: "A limit describes what value a function approaches as the input gets close to a point. This idea lets derivatives talk about instant change instead of average change.",
      relevance: 0.94,
    },
    {
      title: "Limits and Derivatives - OpenStax",
      url: "https://openstax.org/books/calculus-volume-1/pages/2-introduction",
      excerpt: "Limits are the foundation for continuity and derivatives. The derivative is built from the limit of average rates of change over smaller and smaller intervals.",
      relevance: 0.9,
    },
  ],
  integration: [
    {
      title: "Integration - Math is Fun",
      url: "https://www.mathsisfun.com/calculus/integration-introduction.html",
      excerpt: "Integration adds many small pieces to find a total amount. It can measure accumulated change, area under a curve, distance from velocity, or any quantity built from tiny contributions.",
      relevance: 0.96,
    },
    {
      title: "Definite and Indefinite Integrals",
      url: "https://openstax.org/books/calculus-volume-1/pages/5-introduction",
      excerpt: "A definite integral uses lower and upper bounds to produce one accumulated total. An indefinite integral represents a family of antiderivatives before bounds are applied.",
      relevance: 0.92,
    },
    {
      title: "Antiderivatives and Accumulation",
      url: "https://tutorial.math.lamar.edu/classes/calci/antiderivatives.aspx",
      excerpt: "An antiderivative works backward from a rate of change to a function whose derivative matches the original expression. This idea connects derivatives to integrals.",
      relevance: 0.88,
    },
  ],
  vectors: [
    {
      title: "Vectors - Khan Academy",
      url: "https://www.khanacademy.org/math/linear-algebra/vectors-and-spaces",
      excerpt: "Vectors are quantities that have both magnitude and direction. They can be represented as arrows in space or as ordered lists of numbers.",
      relevance: 0.95,
    },
    {
      title: "Vector Operations - 3Blue1Brown",
      url: "https://www.3blue1brown.com/topics/linear-algebra",
      excerpt: "Vector addition, scalar multiplication, and the dot product are fundamental operations. The dot product measures how much two vectors point in the same direction.",
      relevance: 0.9,
    },
    {
      title: "Applications of Vectors - MIT OpenCourseWare",
      url: "https://ocw.mit.edu/courses/18-02-multivariable-calculus",
      excerpt: "Vectors are used in physics for forces and velocities, in computer graphics for transformations, and in machine learning for representing data points in high-dimensional spaces.",
      relevance: 0.85,
    },
  ],
};

export const CACHED_LESSONS: Record<string, Lesson> = {
  derivatives: {
    title: "What is a Derivative?",
    content:
      "A derivative measures how a function changes as its input changes. Think of driving a car: your position changes over time, and the derivative of your position is your speed — how fast your position is changing at any instant.\n\nThe formal definition uses limits: f'(x) = lim(h→0) [f(x+h) - f(x)] / h. But the intuition is simple: zoom in on any smooth curve enough, and it looks like a straight line. The derivative is the slope of that line. For example, if f(x) = x², then f'(x) = 2x — at x=3, the slope is 6.",
    visualization: "A curve y=x² with a tangent line at x=3 showing slope=6. As you zoom in, the curve flattens to match the tangent.",
    quiz: [
      {
        id: "deriv-q1",
        text: "What does the derivative of a function tell you?",
        options: [
          { label: "The area under the curve", correct: false },
          { label: "The instantaneous rate of change", correct: true },
          { label: "The maximum value of the function", correct: false },
          { label: "The average of the function", correct: false },
        ],
        prerequisiteTopic: "Limits",
      },
      {
        id: "deriv-q2",
        text: "What is the derivative of f(x) = x³?",
        options: [
          { label: "3x²", correct: true },
          { label: "x²", correct: false },
          { label: "3x³", correct: false },
          { label: "x⁴/4", correct: false },
        ],
        prerequisiteTopic: "Power Rule",
      },
    ],
    sources: CACHED_SOURCES.derivatives,
  },
  limits: {
    title: "Limits: The Zoom-In Idea",
    content:
      "A limit asks where a function is heading as x gets close to a value, even before you care about the exact value at that point.\n\nFor derivatives, this is the missing step: average slope becomes instant slope by shrinking the interval until it is almost zero.",
    visualization: "A secant line between two nearby points on y=x² shrinks into one tangent line as the second point slides closer.",
    quiz: [
      {
        id: "limits-q1",
        text: "Why do limits matter for derivatives?",
        options: [
          { label: "They turn average change into instant change", correct: true },
          { label: "They measure total area under a curve", correct: false },
          { label: "They only find maximum values", correct: false },
        ],
        prerequisiteTopic: "Average Rate of Change",
      },
    ],
    sources: CACHED_SOURCES.limits,
  },
};

export const CACHED_GRAPH_NODES: Record<string, GraphNode[]> = {
  derivatives: [
    { id: "limits", topic: "Limits", status: "locked", position: { x: 0, y: -180 } },
    { id: "power-rule", topic: "Power Rule", status: "locked", position: { x: 180, y: 60 } },
    { id: "chain-rule", topic: "Chain Rule", status: "locked", position: { x: -180, y: 60 } },
    { id: "product-rule", topic: "Product Rule", status: "locked", position: { x: 120, y: 180 } },
  ],
};

export const CACHED_GRAPH_EDGES: Record<string, GraphEdge[]> = {
  derivatives: [
    { id: "e-limits-deriv", source: "limits", target: "derivatives", type: "prerequisite" },
    { id: "e-deriv-power", source: "derivatives", target: "power-rule", type: "branch" },
    { id: "e-deriv-chain", source: "derivatives", target: "chain-rule", type: "branch" },
    { id: "e-deriv-product", source: "derivatives", target: "product-rule", type: "branch" },
  ],
};

export const CACHED_DECOMPOSITION: Record<string, LessonPlan[]> = {
  derivatives: [
    { subTopic: "Limits & Continuity", focus: "Understanding the foundation of derivatives through limits", visualStyle: "graph", prerequisiteOf: "Power Rule" },
    { subTopic: "Power Rule", focus: "The most common derivative rule with examples", visualStyle: "example", prerequisiteOf: "Chain Rule" },
    { subTopic: "Chain Rule", focus: "Differentiating composed functions", visualStyle: "diagram", prerequisiteOf: null },
  ],
};

export const CACHED_VISUALIZATIONS: Record<string, VisualizationResult> = {
  derivatives: {
    type: "graph",
    spec: "SVG showing f(x)=x² and its derivative f'(x)=2x as tangent lines at multiple points",
    description: "Interactive graph showing how the slope of tangent lines changes along a parabola",
    interactiveHint: "Drag the point along the curve to see how the tangent slope changes",
  },
};
