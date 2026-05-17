/* LearnGraph — Main Application Logic */

// --- App State Machine ---
const appEl = document.querySelector(".app");

function setAppState(state) {
  appEl.dataset.appState = state;
  if (state === "app") {
    appEl.querySelector(".search-area").removeAttribute("aria-hidden");
    appEl.querySelector(".main").removeAttribute("aria-hidden");
    appEl.querySelector(".hero-overlay").setAttribute("aria-hidden", "true");
  }
}

// --- Lesson Drawer ---
const lessonDrawer = document.querySelector("#lessonDrawer");
const lessonBackdrop = document.querySelector("#lessonBackdrop");
const lessonDrawerClose = document.querySelector("#lessonDrawerClose");

function openLessonDrawer() {
  lessonDrawer.classList.add("open");
  lessonDrawer.removeAttribute("aria-hidden");
  lessonDrawerClose?.focus();
}

function closeLessonDrawer() {
  lessonDrawer.classList.remove("open");
  lessonDrawer.setAttribute("aria-hidden", "true");
}

lessonBackdrop?.addEventListener("click", closeLessonDrawer);
lessonDrawerClose?.addEventListener("click", closeLessonDrawer);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && lessonDrawer.classList.contains("open")) closeLessonDrawer();
});

// --- Bento Drawer ---
const bentoDrawer = document.querySelector("#bentoDrawer");
const bentoHandle = document.querySelector("#bentoHandle");
const agentTrigger = document.querySelector("#agentTrigger");
const agentTriggerCount = document.querySelector("#agentTriggerCount");

function openBentoDrawer() {
  bentoDrawer.classList.add("open");
  bentoHandle.setAttribute("aria-expanded", "true");
  agentTrigger?.classList.add("hidden");
}

function closeBentoDrawer() {
  bentoDrawer.classList.remove("open");
  bentoHandle.setAttribute("aria-expanded", "false");
  agentTrigger?.classList.remove("hidden");
}

function toggleBentoDrawer() {
  bentoDrawer.classList.contains("open") ? closeBentoDrawer() : openBentoDrawer();
}

agentTrigger?.addEventListener("click", toggleBentoDrawer);
bentoHandle?.addEventListener("click", toggleBentoDrawer);
bentoHandle?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleBentoDrawer(); }
});

// --- Hero Search ---
const heroSearchForm = document.querySelector("#heroSearchForm");
const heroInput = document.querySelector("#heroInput");

function handleHeroSearch(topic) {
  const t = topic.trim();
  if (!t) return;
  if (subjectInput) subjectInput.value = t;
  visibleSourceCount = 0;
  updateSourceStats(0);
  setAppState("app");
  startPipeline(t);
}

heroSearchForm?.addEventListener("submit", (e) => {
  e.preventDefault();
  handleHeroSearch(heroInput.value);
});

document.querySelectorAll(".hero-quick-searches button").forEach((btn) => {
  btn.addEventListener("click", () => handleHeroSearch(btn.dataset.topic));
});

// --- Gallery Tab (graph-embedded dropdown) ---
const graphGalleryTab = document.querySelector("#graphGalleryTab");
const graphGalleryToggle = document.querySelector("#graphGalleryToggle");
const galleryCount = document.querySelector("#galleryCount");

function toggleGalleryTab() {
  const isOpen = graphGalleryTab.classList.contains("open");
  graphGalleryTab.classList.toggle("open", !isOpen);
  graphGalleryToggle?.setAttribute("aria-expanded", String(!isOpen));
}

graphGalleryToggle?.addEventListener("click", toggleGalleryTab);

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

// --- State ---
let pipelineRunning = false;
let currentTopic = "";
let currentLesson = null;
const nodeLessonRequests = new Set();

// --- Session Identity ---
const SESSION_ID_STORAGE_KEY = "learnGraphSessionId";
const MEMORY_STORAGE_KEY = "learnGraphMemoryV1";
const GRAPH_STORAGE_KEY = "learnGraphSnapshotV1";
const learnGraphSessionId = getOrCreateSessionId();
let learnGraphMemory = loadPersistentMemory();

function getOrCreateSessionId() {
  const nextId = makeSessionId();

  try {
    const existingId = localStorage.getItem(SESSION_ID_STORAGE_KEY);
    if (existingId) return existingId;
    localStorage.setItem(SESSION_ID_STORAGE_KEY, nextId);
  } catch {
    // Storage can fail in restricted browser modes; the request still gets a stable id for this page load.
  }

  return nextId;
}

function makeSessionId() {
  if (window.crypto?.randomUUID) return `lg-${window.crypto.randomUUID()}`;
  return `lg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function defaultPersistentMemory() {
  return {
    version: 1,
    profile: {
      languageLevel: "intermediate",
      visualPreference: "diagrams",
      weakAreas: [],
      completedTopics: [],
    },
    notes: [],
    topics: {},
    updatedAt: new Date().toISOString(),
  };
}

function loadPersistentMemory() {
  try {
    const raw = localStorage.getItem(MEMORY_STORAGE_KEY);
    if (!raw) return defaultPersistentMemory();
    const parsed = JSON.parse(raw);
    return {
      ...defaultPersistentMemory(),
      ...parsed,
      profile: { ...defaultPersistentMemory().profile, ...(parsed.profile || {}) },
      notes: Array.isArray(parsed.notes) ? parsed.notes.slice(-40) : [],
      topics: parsed.topics && typeof parsed.topics === "object" ? parsed.topics : {},
    };
  } catch {
    return defaultPersistentMemory();
  }
}

function savePersistentMemory() {
  learnGraphMemory.updatedAt = new Date().toISOString();
  learnGraphMemory.notes = learnGraphMemory.notes.slice(-40);
  learnGraphMemory.profile.weakAreas = uniqueStrings(learnGraphMemory.profile.weakAreas).slice(0, 12);
  learnGraphMemory.profile.completedTopics = uniqueStrings(learnGraphMemory.profile.completedTopics).slice(0, 24);
  try {
    localStorage.setItem(MEMORY_STORAGE_KEY, JSON.stringify(learnGraphMemory));
  } catch {
    // Ignore storage quota / private mode failures. The in-page memory still works for this run.
  }
}

function uniqueStrings(values) {
  return Array.from(new Set((values || []).filter(Boolean).map(String)));
}

function rememberSearch(topic) {
  const key = normalizeTopicKey(topic);
  learnGraphMemory.topics[key] = {
    ...(learnGraphMemory.topics[key] || {}),
    topic,
    lastSearchedAt: new Date().toISOString(),
  };
  appendMemoryNote(`Started a learning session on ${topic}.`);
  savePersistentMemory();
}

function rememberLessonReady(lesson, topic) {
  const key = normalizeTopicKey(topic || lesson?.title || currentTopic);
  learnGraphMemory.topics[key] = {
    ...(learnGraphMemory.topics[key] || {}),
    topic: topic || lesson?.title || currentTopic,
    lastLessonTitle: lesson?.title,
    lastSeenAt: new Date().toISOString(),
  };
  appendMemoryNote(`Saw lesson card: ${lesson?.title || topic || currentTopic}.`);
  savePersistentMemory();
}

function rememberQuizResult({ topic, correct, wrongAnswer, question }) {
  const safeTopic = topic || currentTopic;
  const key = normalizeTopicKey(safeTopic);
  const topicMemory = {
    ...(learnGraphMemory.topics[key] || {}),
    topic: safeTopic,
    lastAnsweredAt: new Date().toISOString(),
    lastResult: correct ? "correct" : "missed",
  };

  if (correct) {
    learnGraphMemory.profile.completedTopics = uniqueStrings([safeTopic, ...learnGraphMemory.profile.completedTopics]);
    appendMemoryNote(`Completed ${safeTopic}; next card can build on it.`);
  } else {
    const weakArea = question?.prerequisiteTopic || safeTopic;
    learnGraphMemory.profile.weakAreas = uniqueStrings([weakArea, ...learnGraphMemory.profile.weakAreas]);
    topicMemory.lastMisconception = `Answered "${wrongAnswer}" to "${question?.text || safeTopic}".`;
    appendMemoryNote(`Misconception on ${safeTopic}: answered "${wrongAnswer}". Review ${weakArea}.`);
  }

  learnGraphMemory.topics[key] = topicMemory;
  savePersistentMemory();
}

function appendMemoryNote(text) {
  learnGraphMemory.notes.push({
    at: new Date().toISOString(),
    text: String(text).slice(0, 240),
  });
}

function normalizeTopicKey(topic) {
  return String(topic || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "topic";
}

function buildClientMemoryPayload() {
  const topicSummaries = Object.values(learnGraphMemory.topics)
    .slice(-12)
    .map((item) => {
      const parts = [item.topic || "topic"];
      if (item.lastResult) parts.push(`last result: ${item.lastResult}`);
      if (item.lastMisconception) parts.push(item.lastMisconception);
      if (item.lastLessonTitle) parts.push(`last lesson: ${item.lastLessonTitle}`);
      return parts.join(" — ");
    });

  const profile = learnGraphMemory.profile;
  const context = [
    profile.completedTopics.length ? `Completed topics: ${profile.completedTopics.join(", ")}` : "",
    profile.weakAreas.length ? `Weak areas due for review: ${profile.weakAreas.join(", ")}` : "",
    ...learnGraphMemory.notes.slice(-12).map((note) => note.text),
    ...topicSummaries,
  ].filter(Boolean);

  return { profile, context };
}

function saveGraphSnapshot() {
  const nodes = Array.from(GraphState.nodes.values());
  if (nodes.length === 0) return;

  const snapshot = {
    version: 1,
    currentTopic,
    currentLesson,
    visibleSourceCount,
    rootId: GraphState.rootId,
    focusId: GraphState.focusId,
    activeNodeId: GraphState.activeNodeId,
    nodes: nodes.map(serializeGraphNode),
    edges: GraphState.edges.map((edge) => ({ ...edge })),
    savedAt: new Date().toISOString(),
  };

  try {
    localStorage.setItem(GRAPH_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Keep the live graph even if storage is unavailable or full.
  }
}

function loadGraphSnapshot() {
  try {
    const raw = localStorage.getItem(GRAPH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.nodes)) return null;
    return {
      currentTopic: typeof parsed.currentTopic === "string" ? parsed.currentTopic : "",
      currentLesson: parsed.currentLesson || null,
      visibleSourceCount: Number.isFinite(parsed.visibleSourceCount) ? parsed.visibleSourceCount : 0,
      rootId: typeof parsed.rootId === "string" ? parsed.rootId : parsed.nodes[0]?.id,
      focusId: typeof parsed.focusId === "string" ? parsed.focusId : parsed.rootId,
      activeNodeId: typeof parsed.activeNodeId === "string" ? parsed.activeNodeId : parsed.rootId,
      nodes: parsed.nodes.filter(isStoredGraphNode),
      edges: Array.isArray(parsed.edges) ? parsed.edges.filter(isStoredGraphEdge) : [],
    };
  } catch {
    return null;
  }
}

function restoreGraphSnapshot() {
  const snapshot = loadGraphSnapshot();
  if (!snapshot || snapshot.nodes.length === 0) return false;

  GraphState.reset();
  const nodeIds = new Set(snapshot.nodes.map((node) => node.id));
  GraphState.rootId = nodeIds.has(snapshot.rootId) ? snapshot.rootId : snapshot.nodes[0].id;
  GraphState.focusId = nodeIds.has(snapshot.focusId) ? snapshot.focusId : GraphState.rootId;
  GraphState.activeNodeId = nodeIds.has(snapshot.activeNodeId) ? snapshot.activeNodeId : GraphState.focusId;
  GraphState.edges = snapshot.edges;
  snapshot.nodes.forEach((node) => {
    GraphState.nodes.set(node.id, node);
  });

  currentTopic = snapshot.currentTopic || GraphState.nodes.get(GraphState.rootId)?.topic || "";
  visibleSourceCount = snapshot.visibleSourceCount || 0;
  currentLesson = snapshot.currentLesson
    || GraphState.nodes.get(GraphState.activeNodeId)?.lesson
    || snapshot.nodes.find((node) => node.lesson)?.lesson
    || null;

  if (subjectInput && currentTopic) subjectInput.value = currentTopic;
  if (graphEmpty) graphEmpty.classList.add("hidden");
  if (pipelineStatus) pipelineStatus.textContent = "Restored local graph";
  setAppState("app");
  GraphState._scheduleRender(true);
  updateStats();
  updateSourceStats(0);
  renderGallery();

  const activeNode = GraphState.nodes.get(GraphState.activeNodeId);
  if (activeNode?.lesson) {
    renderLessonPanel(activeNode.lesson, activeNode.topic);
  } else if (activeNode) {
    renderLessonPlaceholder(activeNode);
  }

  return true;
}

function serializeGraphNode(node) {
  return {
    id: node.id,
    topic: node.topic,
    status: node.status,
    position: node.position || { x: 0, y: 0 },
    lesson: node.lesson ? serializeLesson(node.lesson) : null,
  };
}

function serializeLesson(lesson) {
  return {
    ...lesson,
    sources: Array.isArray(lesson.sources) ? lesson.sources.slice(0, 5) : [],
  };
}

function isStoredGraphNode(node) {
  return node
    && typeof node.id === "string"
    && typeof node.topic === "string"
    && typeof node.status === "string";
}

function isStoredGraphEdge(edge) {
  return edge
    && typeof edge.id === "string"
    && typeof edge.source === "string"
    && typeof edge.target === "string"
    && typeof edge.type === "string";
}

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
    openLessonDrawer();
    renderGallery();
    saveGraphSnapshot();
  }
);

// --- Agent Feed ---
function addAgentEvent(icon, text, status) {
  if (!agentFeed) return;
  const el = document.createElement("div");
  el.className = "agent-event";
  const iconLabel = icon === "search"
    ? "B"
    : icon === "lesson"
      ? "L"
      : icon === "graph"
        ? "G"
        : icon === "profile"
          ? "P"
          : icon === "eval"
            ? "E"
            : "i";
  el.innerHTML = `
    <span class="agent-icon ${icon}">${iconLabel}</span>
    <span class="agent-text">${escapeHtml(text)}</span>
    <span class="agent-status ${status}">${status === "done" ? "\u2713" : status === "working" ? "\u21BB" : ""}</span>
  `;
  agentFeed.appendChild(el);
  agentFeed.scrollTop = agentFeed.scrollHeight;
  // Keep trigger count badge in sync
  const count = agentFeed.querySelectorAll(".agent-event").length;
  if (agentTriggerCount) agentTriggerCount.textContent = count;
}

function clearAgentFeed() {
  if (agentFeed) agentFeed.innerHTML = "";
  if (agentTriggerCount) agentTriggerCount.textContent = "0";
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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
        <div class="lesson-sources-inner">
          <h4>Sources</h4>
          ${lesson.sources.map((s) => `<a href="${s.url}" target="_blank" rel="noopener">${s.title}</a>`).join("")}
        </div>
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
    <button class="deep-dive-btn" onclick="loadDeepDive('${(lesson.title || topic).replace(/'/g, "\\'")}')">Learn more \u2192</button>
  `;

  // Wire quiz buttons
  lessonPanel.querySelectorAll(".quiz-option").forEach((btn) => {
    btn.addEventListener("click", () => handleQuizAnswer(btn, lesson));
  });
}

async function loadDeepDive(topic) {
  const btn = document.querySelector('.deep-dive-btn');
  if (btn) btn.textContent = 'Loading deep dive...';

  try {
    const sources = currentLesson?.sources || [];
    const res = await fetch('/api/deep-dive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, sources }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    renderDeepDive(data);
  } catch (e) {
    if (btn) btn.textContent = 'Deep dive failed \u2014 try again';
    console.error('Deep dive error:', e);
  }
}

function renderDeepDive(data) {
  if (!lessonPanel) return;

  const sectionsHtml = data.sections.map(section => {
    switch (section.type) {
      case 'mermaid':
        return `<div class="deep-dive-section mermaid-section"><pre class="mermaid">${section.content}</pre></div>`;
      case 'explanation':
        return `<div class="deep-dive-section explanation-section"><p>${section.content.replace(/\n\n/g, '</p><p>')}</p></div>`;
      case 'workedExample':
        return `<div class="deep-dive-section example-section"><h3>Worked Example</h3><pre class="worked-example">${section.content}</pre></div>`;
      case 'comparisonTable':
        return `<div class="deep-dive-section table-section">${markdownTableToHtml(section.content)}</div>`;
      case 'quiz':
        return `<div class="deep-dive-section quiz-section"><p><em>Quiz available in card view</em></p></div>`;
      default:
        return `<div class="deep-dive-section"><p>${section.content}</p></div>`;
    }
  }).join('');

  lessonPanel.innerHTML = `
    <h2 class="lesson-title">${data.title}</h2>
    <div class="deep-dive-content">${sectionsHtml}</div>
    <button class="deep-dive-btn" onclick="backToCard()">← Back to card</button>
  `;

  // Render Mermaid diagrams
  mermaid.run({ nodes: lessonPanel.querySelectorAll('.mermaid') });
}

function backToCard() {
  if (currentLesson) {
    renderLessonPanel(currentLesson, currentLesson.title || currentTopic);
  }
}

function markdownTableToHtml(md) {
  const lines = md.trim().split('\n').filter(l => !l.match(/^\|[-\s|]+\|$/));
  if (lines.length === 0) return '<p>' + md + '</p>';

  const rows = lines.map(line =>
    line.split('|').filter(cell => cell.trim()).map(cell => cell.trim())
  );

  let html = '<table class="comparison-table">';
  html += '<thead><tr>' + rows[0].map(c => `<th>${c}</th>`).join('') + '</tr></thead>';
  html += '<tbody>' + rows.slice(1).map(row =>
    '<tr>' + row.map(c => `<td>${c}</td>`).join('') + '</tr>'
  ).join('') + '</tbody></table>';

  return html;
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
    if (feedback) feedback.textContent = "Correct! Moving to the next concept...";
    const completedId = GraphState.activeNodeId;
    const completedTopic = GraphState.nodes.get(completedId)?.topic || currentTopic;
    rememberQuizResult({ topic: completedTopic, correct: true, question: lesson.quiz?.[0] });
    const nextId = GraphState.markCompleted(completedId);
    addAgentEvent("graph", `${GraphState.nodes.get(completedId)?.topic || currentTopic} learned`, "done");
    updateStats();
    renderGallery();
    saveGraphSnapshot();

    // Auto-open lesson for the newly focused node
    if (nextId) {
      const nextNode = GraphState.nodes.get(nextId);
      setTimeout(() => {
        if (nextNode?.lesson) renderLessonPanel(nextNode.lesson, nextNode.topic);
        else {
          renderLessonPlaceholder(nextNode);
          generateLessonForNode(nextNode);
        }
        openLessonDrawer();
      }, 520); // wait for graph animation to start
    }
  } else {
    if (feedback) feedback.textContent = "Incorrect — finding a prerequisite to fill the gap...";
    addAgentEvent("graph", "Quiz result: misconception detected", "working");

    // Trigger rewire agent
    const question = lesson.quiz[0];
    rememberQuizResult({
      topic: GraphState.nodes.get(GraphState.activeNodeId)?.topic || currentTopic,
      correct: false,
      wrongAnswer: btn.textContent,
      question,
    });
    triggerRewire(question, btn.textContent);
    saveGraphSnapshot();
  }
}

async function triggerRewire(question, wrongAnswer) {
  try {
    const res = await fetch("/api/rewire", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: learnGraphSessionId,
        wrongAnswer,
        question,
        currentTopic,
        existingNodes: Array.from(GraphState.nodes.keys()),
        clientMemory: buildClientMemoryPayload(),
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
  const targetId = GraphState.activeNodeId || GraphState.rootId;

  GraphState.addPrerequisite(
    { id: prereqId, topic: prereqTopic, status: "prerequisite-suggested" },
    targetId
  );

  addAgentEvent("graph", `Prerequisite pulled in: ${prereqTopic}`, "done");
  updateStats();
  renderGallery();
  saveGraphSnapshot();

  // Open the prerequisite lesson so the learner sees what to do next
  setTimeout(() => {
    const prereqNode = GraphState.nodes.get(prereqId);
    if (prereqNode) {
      if (prereqNode.lesson) renderLessonPanel(prereqNode.lesson, prereqNode.topic);
      else renderLessonPlaceholder(prereqNode);
      openLessonDrawer();
    }
  }, 520);
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
        const isFirstLesson = !currentLesson;
        currentLesson = event.lesson;
        const lessonNodeId = event.nodeId || GraphState.activeNodeId;
        if (lessonNodeId) {
          GraphState.setLesson(lessonNodeId, event.lesson);
          GraphState.setActive(lessonNodeId);
          nodeLessonRequests.delete(lessonNodeId);
        }
        const lessonNode = lessonNodeId ? GraphState.nodes.get(lessonNodeId) : null;
        rememberLessonReady(event.lesson, lessonNode?.topic || currentTopic);
        renderLessonPanel(event.lesson, lessonNode?.topic || currentTopic);
        renderGallery();
        // Auto-open the drawer when the first lesson arrives
        if (isFirstLesson) openLessonDrawer();
        saveGraphSnapshot();
      }
      break;
    case "graph.node_added":
      if (graphEmpty) graphEmpty.classList.add("hidden");
      GraphState.addNode(event.node);
      updateStats();
      renderGallery();
      saveGraphSnapshot();
      break;
    case "graph.edge_added":
      GraphState.addEdge(event.edge);
      updateStats();
      saveGraphSnapshot();
      break;
    case "graph.prerequisite_suggested":
      GraphState.addPrerequisite(
        { ...event.node, status: "prerequisite-suggested" },
        GraphState.activeNodeId || GraphState.rootId
      );
      addAgentEvent("graph", `Prerequisite: ${event.node.topic} — ${event.reason || ""}`, "done");
      updateStats();
      renderGallery();
      saveGraphSnapshot();
      break;
    case "decomposition.started":
      addAgentEvent("graph", `Planning branches for "${event.topic || currentTopic}"`, "working");
      break;
    case "decomposition.plan_created":
      addAgentEvent("graph", `Branch: ${event.plan?.subTopic || ""}`, "done");
      break;
    case "decomposition.complete":
      addAgentEvent("graph", `${event.count} branches planned`, "done");
      break;
    case "visualization.started":
      addAgentEvent("lesson", `Designing visual: ${event.lessonTitle || currentTopic}`, "working");
      break;
    case "visualization.complete":
      addAgentEvent("lesson", "Visual ready", "done");
      break;
    case "gbrain.context_loaded":
      addAgentEvent("info", `Memory loaded (${event.count || 0} notes)`, "done");
      break;
    case "gbrain.memory_queued":
      addAgentEvent("info", `Memory queued: ${event.topic || "session"}`, "working");
      break;
    case "gbrain.memory_written":
      addAgentEvent("info", `Memory saved: ${event.topic || "session"}`, "done");
      break;
    case "gbrain.offline":
      addAgentEvent("info", "GBrain offline — local fallback active", "error");
      break;
    case "pipeline.complete":
      addAgentEvent("info", `Pipeline complete (${event.totalMs}ms)`, "done");
      pipelineRunning = false;
      if (pipelineStatus) pipelineStatus.textContent = `Done in ${(event.totalMs / 1000).toFixed(1)}s`;
      saveGraphSnapshot();
      break;
    case "pipeline.error":
      addAgentEvent("info", `Error: ${event.error}`, "error");
      pipelineRunning = false;
      if (pipelineStatus) pipelineStatus.textContent = "Error";
      break;
    default:
      renderAuxiliarySSEEvent(event);
      break;
  }
}

function renderAuxiliarySSEEvent(event) {
  if (!event?.type) return;

  const type = String(event.type);
  const normalizedType = type.toLowerCase();
  const category = normalizedType.split(".")[0];
  const isProfile = category === "profile" || normalizedType.includes("profile");
  const isEval = category === "eval" || normalizedType.includes("eval");
  const isMetric = category === "metric" || normalizedType.includes("metric");
  if (!isProfile && !isEval && !isMetric) return;

  const label = isProfile ? "Profile" : isEval ? "Eval" : "Metric";
  const detail = formatAuxiliaryEventDetail(event);
  const status = /error|fail/i.test(type) ? "error" : /start|running|progress/i.test(type) ? "working" : "done";
  const text = detail ? `${label}: ${detail}` : `${label}: ${type}`;

  addAgentEvent(isProfile ? "profile" : "eval", text, status);
  if (pipelineStatus && (isEval || isMetric)) pipelineStatus.textContent = text.slice(0, 80);
}

function formatAuxiliaryEventDetail(event) {
  const detail =
    event.message ||
    event.summary ||
    event.name ||
    event.metric ||
    event.label ||
    event.stage ||
    event.profile?.summary ||
    event.profile?.goal ||
    event.result;

  if (detail) {
    const value = event.value ?? event.score ?? event.ms ?? event.durationMs;
    return value === undefined ? String(detail) : `${detail}: ${formatMetricValue(value)}`;
  }

  const value = event.value ?? event.score ?? event.ms ?? event.durationMs ?? event.count;
  if (value !== undefined) return `${String(event.type).split(".").pop()}: ${formatMetricValue(value)}`;

  return "";
}

function formatMetricValue(value) {
  if (typeof value === "number") {
    if (Number.isInteger(value)) return String(value);
    return value.toFixed(2);
  }
  return String(value);
}

function formatGbrainReason(event) {
  const diagnostic = event.diagnostic || {};
  const detail = diagnostic.lastError || event.reason;
  if (!detail) return "";
  return ` (${String(detail).slice(0, 96)})`;
}

// --- Pipeline ---
async function startPipeline(topic) {
  if (pipelineRunning) return;
  pipelineRunning = true;
  currentTopic = topic;
  rememberSearch(topic);
  clearAgentFeed();
  GraphState.reset();
  openBentoDrawer();
  if (graphEmpty) graphEmpty.classList.add("hidden");
  if (pipelineStatus) pipelineStatus.textContent = "Running...";

  // Add root node
  const topicId = topic.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  GraphState.addRootNode(topicId, topic, null);
  updateStats();
  renderGallery();
  saveGraphSnapshot();

  addAgentEvent("info", `Starting pipeline for "${topic}"`, "working");
  addChatMessage("ai", `Building a graph for ${topic}. Watch the Browser, Lesson, and Graph agents populate the map.`);

  try {
    const res = await fetch("/api/learn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic, sessionId: learnGraphSessionId, clientMemory: buildClientMemoryPayload() }),
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

  concepts.forEach((concept) => {
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
  saveGraphSnapshot();
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

  // Sync count badge on gallery toggle button
  if (galleryCount) galleryCount.textContent = nodes.length;

  if (nodes.length === 0) {
    galleryGrid.innerHTML = `<p class="gallery-empty">Generated lesson cards will appear here.</p>`;
    return;
  }

  galleryGrid.innerHTML = nodes
    .map((node) => {
      const status = node.status === "prerequisite-suggested" ? "prereq" : node.status;
      const statusClass = status === "completed" ? "done" : status === "active" ? "active" : "";
      return `
        <button class="gallery-item" type="button" data-node-id="${node.id}" role="listitem">
          <div class="gallery-item-inner">
            <span class="gallery-thumb">${node.topic.charAt(0).toUpperCase()}</span>
            <span class="gallery-item-text">
              <strong>${node.topic}</strong>
              <small>${node.lesson ? "Lesson ready" : "Generating..."}</small>
            </span>
            <span class="gallery-item-status ${statusClass}"></span>
          </div>
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
      else {
        renderLessonPlaceholder(node);
        generateLessonForNode(node);
      }
      openLessonDrawer();
      renderGallery();
      saveGraphSnapshot();
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

async function generateLessonForNode(node) {
  if (!node || node.lesson || nodeLessonRequests.has(node.id)) return;
  nodeLessonRequests.add(node.id);
  addAgentEvent("lesson", `Writing branch lesson: ${node.topic}`, "working");

  try {
    const res = await fetch("/api/learn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: node.topic,
        nodeId: node.id,
        mode: "single",
        sessionId: learnGraphSessionId,
        existingNodes: getExistingLessonNodes(),
        clientMemory: buildClientMemoryPayload(),
      }),
    });

    if (!res.ok || !res.body) throw new Error(`Lesson request failed: ${res.status}`);

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
            handleSSEEvent(JSON.parse(line.slice(6)));
          } catch { /* skip malformed */ }
        }
      }
    }
  } catch {
    addAgentEvent("lesson", `Could not load ${node.topic}`, "error");
    nodeLessonRequests.delete(node.id);
  }
}

function getExistingLessonNodes() {
  return Array.from(GraphState.nodes.values()).map((node) => ({
    id: node.id,
    topic: node.topic,
    hasLesson: Boolean(node.lesson),
  }));
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
    if (subjectInput) subjectInput.value = topic;
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

if (restoreGraphSnapshot()) {
  addChatMessage("ai", "Restored your local lesson graph.");
} else {
  addChatMessage("ai", "Search a subject and I will research, write, map, quiz, and rewire the lesson graph.");
  renderGallery();
}

// ── Hero Graph: scripted demo of the real app behavior ────────────
(function heroGraphDemo() {
  const svg = document.getElementById("heroGraphSvg");
  const container = document.getElementById("heroNodesPreview");
  if (!svg || !container) return;

  // Nodes placed at fixed % positions — corners + sides, never center, never off-screen.
  // pct values are [left%, top%] of the container.
  const NODE_SLOTS = [
    [0.10, 0.14],  // top-left
    [0.88, 0.12],  // top-right
    [0.06, 0.52],  // mid-left
    [0.92, 0.50],  // mid-right
    [0.18, 0.84],  // bottom-left
    [0.80, 0.82],  // bottom-right
  ];

  let nodes = [];    // { id, label, status, slotIdx }
  let edges = [];    // { a, b }

  function initGraph() {
    nodes = [
      { id: "n0", label: "Derivatives",  status: "focus",     slotIdx: 0 },
      { id: "n1", label: "Limits",       status: "idle",      slotIdx: 1 },
      { id: "n2", label: "Slope",        status: "idle",      slotIdx: 2 },
      { id: "n3", label: "Chain rule",   status: "idle",      slotIdx: 3 },
      { id: "n4", label: "Product rule", status: "idle",      slotIdx: 4 },
      { id: "n5", label: "Functions",    status: "idle",      slotIdx: 5 },
    ];
    edges = [
      { a: "n0", b: "n1" }, { a: "n0", b: "n2" },
      { a: "n0", b: "n3" }, { a: "n0", b: "n4" },
      { a: "n3", b: "n5" }, { a: "n4", b: "n5" },
    ];
    renderHeroGraph(true);
  }

  function getNodePx(n) {
    const w = container.offsetWidth;
    const h = container.offsetHeight;
    const [lp, tp] = NODE_SLOTS[n.slotIdx] || [0.5, 0.5];
    return { x: Math.round(w * lp), y: Math.round(h * tp) };
  }

  function renderHeroGraph(initial = false) {

    // Position DOM nodes
    nodes.forEach((n, i) => {
      const { x, y } = getNodePx(n);
      let el = document.getElementById("h_" + n.id);
      if (!el) {
        el = document.createElement("div");
        el.id = "h_" + n.id;
        el.className = "hero-node-dot";
        el.style.opacity = "0";
        el.style.transform = "translate(-50%, -50%) scale(0.7)";
        el.style.transition = [
          "left 520ms cubic-bezier(0.32,0.72,0,1)",
          "top 520ms cubic-bezier(0.32,0.72,0,1)",
          "opacity 300ms ease",
          "transform 300ms ease",
          "border-color 300ms ease",
          "background 300ms ease",
          "color 300ms ease",
        ].join(", ");
        container.appendChild(el);
        requestAnimationFrame(() => {
          el.style.opacity = "1";
          el.style.transform = "translate(-50%, -50%) scale(1)";
        });
      }
      el.textContent = n.label;
      el.style.left = `${x}px`;
      el.style.top  = `${y}px`;

      // Status classes
      el.classList.remove("root", "done", "hero-prereq");
      if (n.status === "focus")     el.classList.add("root");
      if (n.status === "completed") el.classList.add("done");
      if (n.status === "prereq")    el.classList.add("hero-prereq");

      // Entrance stagger on initial load
      if (initial) {
        el.style.transitionDelay = `${i * 120}ms`;
        setTimeout(() => { el.style.transitionDelay = ""; }, 800 + i * 120);
      }
    });

    // Redraw edges after position transition
    setTimeout(() => drawHeroEdgesSvg(), initial ? 500 : 340);
  }

  function drawHeroEdgesSvg() {
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    svg.innerHTML = edges.map(({ a, b, prereq }, i) => {
      const na = nodeMap.get(a);
      const nb = nodeMap.get(b);
      if (!na || !nb) return "";
      const pa = getNodePx(na);
      const pb = getNodePx(nb);
      const x1 = pa.x, y1 = pa.y;
      const x2 = pb.x, y2 = pb.y;
      const len = Math.hypot(x2 - x1, y2 - y1);
      const color = prereq ? "rgba(217,119,6,0.5)" : "rgba(242,240,220,0.18)";
      const dash  = prereq ? "4 3" : "none";
      return `<line
        x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"
        stroke="${color}" stroke-width="1.2" stroke-dasharray="${dash}"
        stroke-dashoffset="${len}" stroke-linecap="round"
        style="stroke-dasharray:${len};stroke-dashoffset:${len};
               animation:edgeDraw 500ms cubic-bezier(0.23,1,0.32,1) ${i * 80}ms forwards"/>`;
    }).join("");
  }

  // ── Demo script ────────────────────────────────────────────────
  // Each step: wait N ms, then mutate state and re-render

  function completeNode(id) {
    const n = nodes.find((x) => x.id === id);
    if (n) n.status = "completed";
    // New focus = first non-completed connected node
    const connected = edges
      .filter(({ a, b }) => a === id || b === id)
      .map(({ a, b }) => a === id ? b : a)
      .find((nid) => {
        const target = nodes.find((x) => x.id === nid);
        return target && target.status !== "completed";
      });
    if (connected) {
      const newFocus = nodes.find((x) => x.id === connected);
      if (newFocus) {
        nodes.forEach((x) => { if (x.status === "focus") x.status = "completed"; });
        newFocus.status = "focus";
      }
    }
    renderHeroGraph();
  }

  function injectPrereq(label, targetId) {
    // Pick an unused slot (prefer corners not yet taken)
    const usedSlots = new Set(nodes.map((x) => x.slotIdx));
    const freeSlot = NODE_SLOTS.findIndex((_, i) => !usedSlots.has(i));
    const slotIdx = freeSlot >= 0 ? freeSlot : 0;
    const prereqId = "prereq_" + Date.now();
    nodes.push({ id: prereqId, label, status: "prereq", slotIdx });
    edges.push({ a: prereqId, b: targetId, prereq: true });
    nodes.forEach((x) => { if (x.status === "focus") x.status = "idle"; });
    nodes.find((x) => x.id === prereqId).status = "focus";
    renderHeroGraph();
  }

  // Kick off
  initGraph();

  // Sequence: complete → re-center → fail → inject prereq → loop
  const script = [
    [2800,  () => completeNode("n0")],                              // complete Derivatives → center shifts to Limits
    [5400,  () => completeNode("n1")],                              // complete Limits → center shifts to Slope
    [8000,  () => injectPrereq("Epsilon-delta", "n2")],             // fail Slope → pull in prerequisite
    [11200, () => completeNode(nodes.find(n=>n.label==="Epsilon-delta")?.id)], // complete prereq → back to Slope
    [14000, () => completeNode("n2")],                              // complete Slope
    [17000, () => { initGraph(); }],                                // reset and loop
  ];

  function scheduleScript(offset = 0) {
    script.forEach(([delay, fn]) => {
      setTimeout(() => { fn(); }, delay + offset);
    });
    // Loop: restart after last step + buffer
    const total = script[script.length - 1][0] + 3200;
    setTimeout(() => scheduleScript(0), total + offset);
  }
  scheduleScript(0);
})();
