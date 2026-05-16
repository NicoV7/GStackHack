const conceptSeeds = {
  "chain rule": [
    "Function composition",
    "Local slope",
    "Outer change",
    "Inner change",
    "Chain rule",
    "Product rule",
  ],
  vectors: [
    "Magnitude",
    "Direction",
    "Components",
    "Dot product",
    "Projection",
    "Basis change",
  ],
  probability: [
    "Sample space",
    "Events",
    "Conditional probability",
    "Bayes update",
    "Expected value",
    "Variance",
  ],
};

const graphPositions = [
  { x: 72, y: 58 },
  { x: 236, y: 58 },
  { x: 72, y: 170 },
  { x: 236, y: 170 },
  { x: 154, y: 282 },
  { x: 285, y: 330 },
];

const links = [
  [0, 2],
  [1, 3],
  [2, 4],
  [3, 4],
  [4, 5],
];

let lessons = [];
let activeLessonId = "";
let completed = new Set();
let currentSubject = "chain rule";

const lessonCard = document.querySelector("#lessonCard");
const galleryGrid = document.querySelector("#galleryGrid");
const lessonGraph = document.querySelector("#lessonGraph");
const progressPulse = document.querySelector("#progressPulse");
const subjectForm = document.querySelector("#subjectForm");
const subjectInput = document.querySelector("#subjectInput");
const chatForm = document.querySelector("#chatForm");
const chatInput = document.querySelector("#chatInput");
const chatLog = document.querySelector("#chatLog");
const memoryButton = document.querySelector("#memoryButton");
const memoryDrawer = document.querySelector("#memoryDrawer");
const closeMemory = document.querySelector("#closeMemory");
const memoryCopy = document.querySelector("#memoryCopy");

function normalizeSubject(value) {
  return value.trim().toLowerCase() || "chain rule";
}

function titleCase(value) {
  return value
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function conceptsForSubject(subject) {
  if (conceptSeeds[subject]) return conceptSeeds[subject];

  const root = titleCase(subject);
  return [
    `${root} intuition`,
    `${root} parts`,
    `${root} pattern`,
    `${root} trap`,
    `${root} application`,
    `${root} review`,
  ];
}

function createLessonPath(subject) {
  currentSubject = subject;
  completed = new Set();
  lessons = conceptsForSubject(subject).map((concept, index) => {
    const id = concept.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const position = graphPositions[index];
    const visualTypes = ["curve", "split", "stack", "pulse", "bridge", "review"];

    return {
      id,
      concept,
      index,
      x: position.x,
      y: position.y,
      visual: visualTypes[index % visualTypes.length],
      status: index === 0 ? "Ready" : "Queued",
      explanation: buildExplanation(subject, concept, index),
      problem: buildProblem(concept, index),
      answer: 1,
    };
  });
  activeLessonId = lessons[0].id;
  renderAll();
  addMessage(
    "ai",
    `I built a ${lessons.length}-card path for ${titleCase(subject)}. I will branch if your answer shows a missing prerequisite.`,
  );
}

function buildExplanation(subject, concept, index) {
  const subjectName = titleCase(subject);
  const lines = [
    `${concept} is the first visual anchor for ${subjectName}. Watch how the highlighted part moves before you look at symbols.`,
    `This card keeps one idea on screen: what changes, what stays fixed, and what that means for the next step.`,
    `GBrain will use your answer to decide whether to advance or regenerate this concept with a different visual.`,
  ];
  return index < 2 ? `${lines[0]} ${lines[1]}` : `${lines[1]} ${lines[2]}`;
}

function buildProblem(concept, index) {
  const stems = [
    `Which part should you identify first in ${concept}?`,
    `What does this visual make easier to notice?`,
    `If this step feels confusing, what should the AI branch back to?`,
  ];

  return {
    prompt: stems[index % stems.length],
    choices: [
      "The final answer before the structure",
      "The moving relationship between the parts",
      "A longer definition with more notation",
    ],
  };
}

function renderAll() {
  renderLesson();
  renderGraph();
  renderGallery();
  renderPulse();
}

function activeLesson() {
  return lessons.find((lesson) => lesson.id === activeLessonId) || lessons[0];
}

function renderPulse() {
  const lesson = activeLesson();
  const completeCount = completed.size;
  const next = lessons.find((item) => !completed.has(item.id) && item.id !== lesson.id);
  progressPulse.textContent = next
    ? `You got ${completeCount} card${completeCount === 1 ? "" : "s"}. Current: ${lesson.concept}. Next branch: ${next.concept}.`
    : `Path complete. GBrain would schedule review cards for ${titleCase(currentSubject)}.`;
}

function renderLesson() {
  const lesson = activeLesson();
  lessonCard.innerHTML = `
    <div class="lesson-visual">
      ${visualMarkup(lesson)}
    </div>
    <div class="lesson-body">
      <div class="lesson-kicker">
        <span>${titleCase(currentSubject)} / Card ${lesson.index + 1}</span>
        <span class="status-pill">${completed.has(lesson.id) ? "Learned" : lesson.status}</span>
      </div>
      <h2 class="lesson-title">${lesson.concept}</h2>
      <p class="lesson-copy">${lesson.explanation}</p>
      <div class="practice">
        <h3>${lesson.problem.prompt}</h3>
        <div class="choice-list">
          ${lesson.problem.choices
            .map(
              (choice, index) =>
                `<button class="choice" data-answer="${index}" type="button">${choice}</button>`,
            )
            .join("")}
        </div>
        <p class="feedback" id="feedback"></p>
      </div>
    </div>
  `;

  lessonCard.querySelectorAll(".choice").forEach((button) => {
    button.addEventListener("click", () => handleAnswer(Number(button.dataset.answer)));
  });
}

function visualMarkup(lesson) {
  const accent = lesson.index % 2 === 0 ? "#7ee7c1" : "#9eb6ff";
  const warm = lesson.index % 2 === 0 ? "#ffca6d" : "#ff8d6d";

  return `
    <svg viewBox="0 0 330 205" aria-hidden="true">
      <rect x="0" y="0" width="330" height="205" rx="10" fill="#151815"></rect>
      <path d="M28 162 C78 72, 118 184, 164 102 S244 38, 302 122" fill="none" stroke="#3b4340" stroke-width="8" stroke-linecap="round"></path>
      <path class="trace-line" d="M28 162 C78 72, 118 184, 164 102 S244 38, 302 122" fill="none" stroke="${accent}" stroke-width="4" stroke-linecap="round"></path>
      <line x1="32" y1="166" x2="306" y2="166" stroke="#59615d" stroke-width="1"></line>
      <line x1="42" y1="26" x2="42" y2="172" stroke="#59615d" stroke-width="1"></line>
      <circle class="node-dot" cx="${72 + lesson.index * 34}" cy="${152 - (lesson.index % 3) * 34}" r="11" fill="${warm}"></circle>
      <circle class="node-dot" cx="${118 + lesson.index * 24}" cy="${86 + (lesson.index % 2) * 34}" r="7" fill="${accent}" style="animation-delay: 80ms"></circle>
      <text x="24" y="24" fill="#f8f6ee" font-size="12" font-weight="800">${lesson.concept}</text>
      <text x="24" y="190" fill="#9aa29e" font-size="10">one visual, one idea, one check</text>
    </svg>
  `;
}

function handleAnswer(answerIndex) {
  const lesson = activeLesson();
  const feedback = document.querySelector("#feedback");
  const buttons = lessonCard.querySelectorAll(".choice");

  buttons.forEach((button) => {
    button.disabled = true;
    const isCorrect = Number(button.dataset.answer) === lesson.answer;
    button.classList.toggle("correct", isCorrect);
    button.classList.toggle("incorrect", Number(button.dataset.answer) === answerIndex && !isCorrect);
  });

  if (answerIndex === lesson.answer) {
    completed.add(lesson.id);
    feedback.textContent = `GBrain marked ${lesson.concept} as landed. Advancing the graph.`;
    addMessage("ai", `Nice. ${lesson.concept} landed, so I moved the path forward.`);
    const nextLesson = lessons.find((item) => !completed.has(item.id));
    setTimeout(() => {
      if (nextLesson) activeLessonId = nextLesson.id;
      renderAll();
    }, 720);
  } else {
    feedback.textContent = "GBrain detected a misconception. It will branch to a simpler visual.";
    addMessage(
      "ai",
      `That answer says ${lesson.concept} needs another visual. I created a branch instead of pushing ahead.`,
    );
    branchFromLesson(lesson);
    setTimeout(renderAll, 720);
  }
}

function branchFromLesson(lesson) {
  const branchId = `${lesson.id}-visual-branch`;
  if (lessons.some((item) => item.id === branchId)) {
    activeLessonId = branchId;
    return;
  }

  const branch = {
    ...lesson,
    id: branchId,
    concept: `${lesson.concept} visual branch`,
    index: lessons.length,
    x: Math.max(58, lesson.x - 24),
    y: Math.min(360, lesson.y + 92),
    status: "Generated",
    explanation:
      "This branch removes notation and keeps the relationship visible. The AI generated it because your answer showed the first card moved too fast.",
    problem: {
      prompt: "What changed in this branch?",
      choices: ["More symbols", "A slower visual path", "A harder final problem"],
    },
  };

  lessons.push(branch);
  activeLessonId = branch.id;
}

function renderGraph() {
  const nodes = lessons
    .map((lesson) => {
      const classes = [
        "graph-node",
        lesson.id === activeLessonId ? "active" : "",
        completed.has(lesson.id) ? "done" : "",
      ]
        .filter(Boolean)
        .join(" ");
      const label = lesson.concept.length > 17 ? `${lesson.concept.slice(0, 15)}...` : lesson.concept;

      return `
        <g class="${classes}" data-id="${lesson.id}" transform="translate(${lesson.x} ${lesson.y})">
          <circle r="34"></circle>
          <text y="-2">${label.split(" ")[0] || "Lesson"}</text>
          <text y="12">${label.split(" ").slice(1, 3).join(" ")}</text>
        </g>
      `;
    })
    .join("");

  const staticLinks = links
    .filter(([from, to]) => lessons[from] && lessons[to])
    .map(([from, to]) => lineMarkup(lessons[from], lessons[to]))
    .join("");

  const branchLinks = lessons
    .filter((lesson) => lesson.id.endsWith("-visual-branch"))
    .map((lesson) => {
      const parent = lessons.find((item) => lesson.id.startsWith(item.id) && item.id !== lesson.id);
      return parent ? lineMarkup(parent, lesson) : "";
    })
    .join("");

  lessonGraph.innerHTML = `${staticLinks}${branchLinks}${nodes}`;
  lessonGraph.querySelectorAll(".graph-node").forEach((node) => {
    node.addEventListener("click", () => {
      activeLessonId = node.dataset.id;
      showView("learn");
      renderAll();
    });
  });
}

function lineMarkup(from, to) {
  return `<line class="graph-link" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}"></line>`;
}

function renderGallery() {
  galleryGrid.innerHTML = lessons
    .map((lesson) => {
      const state = completed.has(lesson.id)
        ? "Learned"
        : lesson.id === activeLessonId
          ? "Now"
          : lesson.status;
      return `
        <button class="gallery-item" type="button" data-id="${lesson.id}">
          <span class="gallery-thumb">${lesson.concept.charAt(0)}</span>
          <span>
            <h3>${lesson.concept}</h3>
            <p>${lesson.explanation.split(".").slice(0, 1).join(".")}.</p>
          </span>
          <span class="gallery-state">${state}</span>
        </button>
      `;
    })
    .join("");

  galleryGrid.querySelectorAll(".gallery-item").forEach((item) => {
    item.addEventListener("click", () => {
      activeLessonId = item.dataset.id;
      showView("learn");
      renderAll();
    });
  });
}

function showView(viewName) {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.view === viewName);
  });
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("active", view.id === `${viewName}View`);
  });
}

function addMessage(role, text) {
  const message = document.createElement("div");
  message.className = `message ${role === "user" ? "user" : "ai"}`;
  message.textContent = text;
  chatLog.appendChild(message);
  chatLog.scrollTop = chatLog.scrollHeight;
}

subjectForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const subject = normalizeSubject(subjectInput.value);
  subjectInput.value = titleCase(subject);
  createLessonPath(subject);
});

chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;

  addMessage("user", text);
  chatInput.value = "";

  const subjectMatch = text.match(/(?:lesson|path|teach|learn|search)\s+(?:on|about|for)?\s*(.*)/i);
  if (subjectMatch && subjectMatch[1]) {
    const subject = normalizeSubject(subjectMatch[1]);
    subjectInput.value = titleCase(subject);
    createLessonPath(subject);
    showView("learn");
    return;
  }

  addMessage(
    "ai",
    "Ask me to make a path on a subject, or answer the current card so I can branch the lesson graph from your memory.",
  );
});

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => showView(tab.dataset.view));
});

memoryButton.addEventListener("click", () => {
  const lesson = activeLesson();
  memoryCopy.textContent = completed.has(lesson.id)
    ? `${lesson.concept} is marked learned. GBrain will schedule a review after the next branch.`
    : `${lesson.concept} is active. GBrain is waiting for one practice signal before choosing the next card.`;
  memoryDrawer.classList.add("open");
  memoryDrawer.setAttribute("aria-hidden", "false");
});

closeMemory.addEventListener("click", () => {
  memoryDrawer.classList.remove("open");
  memoryDrawer.setAttribute("aria-hidden", "true");
});

addMessage(
  "ai",
  "Tell me a subject and I will create lesson cards, branches, a graph, and a gallery.",
);
createLessonPath("chain rule");
