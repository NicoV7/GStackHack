/* LearnGraph — Main Application Logic */

// --- DOM References ---
const subjectForm = document.querySelector("#subjectForm");
const subjectInput = document.querySelector("#subjectInput");
const agentFeed = document.querySelector("#agentFeed");
const lessonPanel = document.querySelector("#lessonPanel");
const graphEmpty = document.querySelector("#graphEmpty");
const graphStats = document.querySelector("#graphStats");
const pipelineStatus = document.querySelector("#pipelineStatus");
const sourceStats = document.querySelector("#sourceStats");
const galleryGrid = document.querySelector("#galleryGrid");
const chatForm = document.querySelector("#chatForm");
const chatInput = document.querySelector("#chatInput");
const chatLog = document.querySelector("#chatLog");

// --- Session Identity ---
function getSessionId() {
  let id = localStorage.getItem('lg_session_id');
  if (!id) {
    id = 'session-' + crypto.randomUUID().slice(0, 8);
    localStorage.setItem('lg_session_id', id);
  }
  return id;
}

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
    if (node.lesson) {
      renderLessonPanel(node.lesson, node.topic);
    } else {
      renderLessonPlaceholder(node);
    }
    renderGallery();
  }
);

// --- Agent Feed ---
function addAgentEvent(icon, text, status) {
  if (!agentFeed) return;
  const el = document.createElement("div");
  el.className = "agent-event";
  const iconLabel = icon === "search" ? "B" : icon === "lesson" ? "L" : icon === "graph" ? "G" : "i";
  el.innerHTML = `
    <span class="agent-icon ${icon}">${iconLabel}</span>
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
function renderLessonPlaceholder(node) {
  if (!lessonPanel) return;
  lessonPanel.innerHTML = `
    <p class="lesson-kicker">Graph node</p>
    <h2 class="lesson-title">${node.topic}</h2>
    <div class="lesson-content">
      This node is in the map, but its lesson has not streamed in yet. The lesson agent will attach content, sources, and a quiz when generation completes.
    </div>
  `;
}

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
    renderGallery();
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
        sessionId: getSessionId(),
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
  renderGallery();
}

// --- SSE Event Handler ---
function handleSSEEvent(event) {
  switch (event.type) {
    case "browser.searching":
      addAgentEvent("search", `Searching "${event.query}"`, "working");
      break;
    case "browser.source_found":
      addAgentEvent("search", `Found: ${event.source.title}`, "done");
      updateSourceStats(1);
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
      renderGallery();
      break;
    case "graph.edge_added":
      GraphState.addEdge(event.edge);
      updateStats();
      break;
    case "graph.prerequisite_suggested":
      GraphState.addNode({ ...event.node, status: "prerequisite-suggested" });
      addAgentEvent("graph", `Prerequisite: ${event.node.topic} — ${event.reason || ""}`, "done");
      updateStats();
      renderGallery();
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
  renderGallery();

  addAgentEvent("info", `Starting pipeline for "${topic}"`, "working");
  addChatMessage("ai", `Building a graph for ${topic}. Watch the Browser, Lesson, and Graph agents populate the map.`);

  try {
    const res = await fetch("/api/learn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic, sessionId: getSessionId() }),
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
      lesson: {
        title: concept,
        content: `A cached micro-lesson for ${concept}. This fallback keeps the demo working when the live API is unavailable.`,
        sources: [],
        quiz: [
          {
            id: `q-${id}`,
            text: `What should you notice first about ${concept}?`,
            options: [
              { label: "The moving relationship", correct: true },
              { label: "Only the final answer", correct: false },
              { label: "A longer definition", correct: false },
            ],
            prerequisiteTopic: concepts[0],
          },
        ],
      },
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
  renderGallery();
  if (pipelineStatus) pipelineStatus.textContent = "Fallback mode";
}

function updateStats() {
  if (graphStats) {
    graphStats.textContent = `Graph: ${GraphState.getNodeCount()} nodes · ${GraphState.getEdgeCount()} edges`;
  }
}

let visibleSourceCount = 0;

function updateSourceStats(delta = 0) {
  visibleSourceCount += delta;
  if (sourceStats) sourceStats.textContent = `${visibleSourceCount} source${visibleSourceCount === 1 ? "" : "s"}`;
}

function renderGallery() {
  if (!galleryGrid) return;

  const nodes = Array.from(GraphState.nodes.values());
  if (nodes.length === 0) {
    galleryGrid.innerHTML = `<p class="gallery-empty">Generated lesson cards will appear here.</p>`;
    return;
  }

  galleryGrid.innerHTML = nodes
    .map((node) => {
      const status = node.status === "prerequisite-suggested" ? "prereq" : node.status;
      return `
        <button class="gallery-item" type="button" data-node-id="${node.id}">
          <span class="gallery-thumb">${node.topic.charAt(0)}</span>
          <span>
            <strong>${node.topic}</strong>
            <small>${node.lesson ? "Lesson ready" : "Waiting for lesson agent"}</small>
          </span>
          <em>${status}</em>
        </button>
      `;
    })
    .join("");

  galleryGrid.querySelectorAll(".gallery-item").forEach((item) => {
    item.addEventListener("click", () => {
      const node = GraphState.nodes.get(item.dataset.nodeId);
      if (!node) return;
      GraphState.setActive(node.id);
      if (node.lesson) renderLessonPanel(node.lesson, node.topic);
      else renderLessonPlaceholder(node);
      renderGallery();
    });
  });
}

function addChatMessage(role, text) {
  if (!chatLog) return;
  const message = document.createElement("div");
  message.className = `chat-message ${role}`;
  message.textContent = text;
  chatLog.appendChild(message);
  chatLog.scrollTop = chatLog.scrollHeight;
}

// --- Form Submit ---
subjectForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const topic = subjectInput.value.trim();
  if (!topic) return;
  visibleSourceCount = 0;
  updateSourceStats(0);
  startPipeline(topic);
});

document.querySelectorAll(".quick-searches button").forEach((button) => {
  button.addEventListener("click", () => {
    const topic = button.dataset.topic;
    subjectInput.value = topic;
    visibleSourceCount = 0;
    updateSourceStats(0);
    startPipeline(topic);
  });
});

if (chatForm) {
  chatForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = chatInput.value.trim();
    if (!text) return;

    addChatMessage("user", text);
    chatInput.value = "";

    const topicMatch = text.match(/(?:search|teach|learn|path|graph|lesson)\s+(?:me\s+)?(?:about|on|for)?\s*(.*)/i);
    if (topicMatch?.[1]) {
      const topic = topicMatch[1].trim();
      subjectInput.value = topic;
      visibleSourceCount = 0;
      updateSourceStats(0);
      startPipeline(topic);
      return;
    }

    if (/branch|rewire|prereq|stuck/i.test(text) && currentLesson?.quiz?.[0]) {
      addChatMessage("ai", "I will treat that as a misconception signal and ask the rewire agent for a prerequisite.");
      triggerRewire(currentLesson.quiz[0], text);
      return;
    }

    addChatMessage("ai", "Try: search derivatives, branch this lesson, or review prerequisites.");
  });
}

addChatMessage("ai", "Search a subject and I will research, write, map, quiz, and rewire the lesson graph.");
renderGallery();
