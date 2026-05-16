/* LearnGraph — Main Application Logic */

// --- DOM References ---
const subjectForm = document.querySelector("#subjectForm");
const subjectInput = document.querySelector("#subjectInput");
const agentFeed = document.querySelector("#agentFeed");
const lessonPanel = document.querySelector("#lessonPanel");
const graphEmpty = document.querySelector("#graphEmpty");
const graphStats = document.querySelector("#graphStats");
const pipelineStatus = document.querySelector("#pipelineStatus");

// --- State ---
let pipelineRunning = false;
let currentTopic = "";
let currentLesson = null;

// --- Fallback concept seeds (used when API is unreachable) ---
const fallbackSeeds = {
  "chain rule": ["Function composition", "Local slope", "Outer change", "Inner change", "Chain rule", "Product rule"],
  vectors: ["Magnitude", "Direction", "Components", "Dot product", "Projection", "Basis change"],
  probability: ["Sample space", "Events", "Conditional probability", "Bayes update", "Expected value", "Variance"],
};

// --- Initialize GraphState ---
GraphState.init(
  document.querySelector("#graphArea"),
  document.querySelector("#graphEdges"),
  document.querySelector("#graphNodes"),
  (node) => {
    // On node click — show lesson if available
    if (node.lesson) {
      renderLessonPanel(node.lesson, node.topic);
    }
  }
);

// --- Agent Feed ---
function addAgentEvent(icon, text, status) {
  if (!agentFeed) return;
  const el = document.createElement("div");
  el.className = "agent-event";
  el.innerHTML = `
    <span class="agent-icon ${icon}">${icon === "search" ? "\u{1F50D}" : icon === "lesson" ? "\u{1F4DD}" : icon === "graph" ? "\u{1F578}\uFE0F" : "\u2139\uFE0F"}</span>
    <span class="agent-text">${text}</span>
    <span class="agent-status ${status}">${status === "done" ? "\u2713" : status === "working" ? "\u21BB" : ""}</span>
  `;
  agentFeed.appendChild(el);
  agentFeed.scrollTop = agentFeed.scrollHeight;
}

function clearAgentFeed() {
  if (agentFeed) agentFeed.innerHTML = "";
}

// --- Lesson Panel ---
function renderLessonPanel(lesson, topic) {
  if (!lessonPanel) return;
  currentLesson = lesson;

  const sourcesHtml = lesson.sources && lesson.sources.length > 0
    ? `<div class="lesson-sources">
        <h4>Sources</h4>
        ${lesson.sources.map((s) => `<a href="${s.url}" target="_blank" rel="noopener">${s.title}</a>`).join("")}
      </div>`
    : "";

  const quizHtml = lesson.quiz && lesson.quiz.length > 0
    ? `<div class="quiz-section">
        <p class="quiz-question">${lesson.quiz[0].text}</p>
        <div class="quiz-options">
          ${lesson.quiz[0].options.map((opt, i) =>
            `<button class="quiz-option" data-index="${i}" data-correct="${opt.correct}" data-qid="${lesson.quiz[0].id}">${opt.label}</button>`
          ).join("")}
        </div>
        <p class="quiz-feedback" id="quizFeedback"></p>
      </div>`
    : "";

  lessonPanel.innerHTML = `
    <h2 class="lesson-title">${lesson.title || topic}</h2>
    <div class="lesson-content">${lesson.content || ""}</div>
    ${sourcesHtml}
    ${quizHtml}
  `;

  // Wire quiz buttons
  lessonPanel.querySelectorAll(".quiz-option").forEach((btn) => {
    btn.addEventListener("click", () => handleQuizAnswer(btn, lesson));
  });
}

function handleQuizAnswer(btn, lesson) {
  const isCorrect = btn.dataset.correct === "true";
  const feedback = document.querySelector("#quizFeedback");
  const allButtons = lessonPanel.querySelectorAll(".quiz-option");

  // Disable all buttons
  allButtons.forEach((b) => {
    b.disabled = true;
    if (b.dataset.correct === "true") b.classList.add("correct");
    if (b === btn && !isCorrect) b.classList.add("wrong");
  });

  if (isCorrect) {
    if (feedback) feedback.textContent = "Correct! Node marked as learned.";
    if (GraphState.activeNodeId) {
      GraphState.markCompleted(GraphState.activeNodeId);
    }
    addAgentEvent("graph", `${currentTopic} marked as learned`, "done");
    updateStats();
  } else {
    if (feedback) feedback.textContent = "Incorrect — checking for missing prerequisites...";
    addAgentEvent("graph", "Quiz result: misconception detected", "working");

    // Trigger rewire agent
    const question = lesson.quiz[0];
    triggerRewire(question, btn.textContent);
  }
}

async function triggerRewire(question, wrongAnswer) {
  try {
    const res = await fetch("/api/rewire", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        wrongAnswer,
        question,
        currentTopic,
        existingNodes: Array.from(GraphState.nodes.keys()),
      }),
    });

    if (!res.ok) {
      // Fallback: use prerequisiteTopic hint from the question
      handleDeterministicRewire(question);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const event = JSON.parse(line.slice(6));
            handleSSEEvent(event);
          } catch { /* skip */ }
        }
      }
    }
  } catch {
    handleDeterministicRewire(question);
  }
}

function handleDeterministicRewire(question) {
  const prereqTopic = question.prerequisiteTopic || "Foundations";
  const prereqId = prereqTopic.toLowerCase().replace(/[^a-z0-9]+/g, "-");

  GraphState.addNode({
    id: prereqId,
    topic: prereqTopic,
    status: "prerequisite-suggested",
    position: { x: 0, y: 0 },
  });
  GraphState.addEdge({
    id: `e-${prereqId}-${GraphState.activeNodeId}`,
    source: prereqId,
    target: GraphState.activeNodeId || currentTopic,
    type: "prerequisite",
  });

  addAgentEvent("graph", `Prerequisite suggested: ${prereqTopic}`, "done");
  updateStats();
}

// --- SSE Event Handler ---
function handleSSEEvent(event) {
  switch (event.type) {
    case "browser.searching":
      addAgentEvent("search", `Searching "${event.query}"`, "working");
      break;
    case "browser.source_found":
      addAgentEvent("search", `Found: ${event.source.title}`, "done");
      break;
    case "lesson.writing":
      addAgentEvent("lesson", `Writing lesson: ${event.topic || currentTopic}`, "working");
      break;
    case "lesson.visualization":
      addAgentEvent("lesson", "Generating visualization", "done");
      break;
    case "lesson.quiz_generated":
      addAgentEvent("lesson", `Lesson ready with ${event.lesson.quiz.length} questions`, "done");
      if (event.lesson) {
        currentLesson = event.lesson;
        // Store lesson on the active graph node
        if (GraphState.activeNodeId) {
          GraphState.setLesson(GraphState.activeNodeId, event.lesson);
        }
        renderLessonPanel(event.lesson, currentTopic);
      }
      break;
    case "graph.node_added":
      if (graphEmpty) graphEmpty.classList.add("hidden");
      GraphState.addNode(event.node);
      updateStats();
      break;
    case "graph.edge_added":
      GraphState.addEdge(event.edge);
      updateStats();
      break;
    case "graph.prerequisite_suggested":
      GraphState.addNode({ ...event.node, status: "prerequisite-suggested" });
      addAgentEvent("graph", `Prerequisite: ${event.node.topic} — ${event.reason || ""}`, "done");
      updateStats();
      break;
    case "pipeline.complete":
      addAgentEvent("info", `Pipeline complete (${event.totalMs}ms)`, "done");
      pipelineRunning = false;
      if (pipelineStatus) pipelineStatus.textContent = `Done in ${(event.totalMs / 1000).toFixed(1)}s`;
      break;
    case "pipeline.error":
      addAgentEvent("info", `Error: ${event.error}`, "error");
      pipelineRunning = false;
      if (pipelineStatus) pipelineStatus.textContent = "Error";
      break;
  }
}

// --- Pipeline ---
async function startPipeline(topic) {
  if (pipelineRunning) return;
  pipelineRunning = true;
  currentTopic = topic;
  clearAgentFeed();
  GraphState.reset();
  if (graphEmpty) graphEmpty.classList.add("hidden");
  if (pipelineStatus) pipelineStatus.textContent = "Running...";

  // Add root node
  const topicId = topic.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  GraphState.addRootNode(topicId, topic, null);
  updateStats();

  addAgentEvent("info", `Starting pipeline for "${topic}"`, "working");

  try {
    const res = await fetch("/api/learn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic }),
    });

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const event = JSON.parse(line.slice(6));
            handleSSEEvent(event);
          } catch { /* skip malformed */ }
        }
      }
    }
  } catch {
    addAgentEvent("info", "Connection failed — using fallback data", "error");
    useFallbackData(topic);
  }
  pipelineRunning = false;
}

function useFallbackData(topic) {
  const normalized = topic.toLowerCase();
  const concepts = fallbackSeeds[normalized] || [
    `${topic} intuition`, `${topic} parts`, `${topic} pattern`,
    `${topic} trap`, `${topic} application`, `${topic} review`
  ];

  concepts.forEach((concept, i) => {
    const id = concept.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    GraphState.addNode({
      id,
      topic: concept,
      status: "locked",
      position: { x: 0, y: 0 },
    });
    const rootId = topic.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    GraphState.addEdge({
      id: `e-${rootId}-${id}`,
      source: rootId,
      target: id,
      type: "branch",
    });
  });
  updateStats();
  if (pipelineStatus) pipelineStatus.textContent = "Fallback mode";
}

function updateStats() {
  if (graphStats) {
    graphStats.textContent = `Graph: ${GraphState.getNodeCount()} nodes · ${GraphState.getEdgeCount()} edges`;
  }
}

// --- Form Submit ---
subjectForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const topic = subjectInput.value.trim();
  if (!topic) return;
  startPipeline(topic);
});
