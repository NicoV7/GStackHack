/**
 * GraphState — interactive, pannable knowledge graph.
 *
 * Architecture:
 *   .graph-area (overflow:hidden, position:relative)
 *     └─ .graph-canvas (position:absolute, transform: translate(panX, panY))
 *          ├─ svg.graph-edges   (absolute, inset 0, pointer-events:none)
 *          └─ div.graph-nodes   (absolute, inset 0)
 *
 * All node positions are stored as offsets from the logical center (0,0).
 * The canvas is panned by dragging. Re-centering animates panX/panY back to
 * (0,0) relative to a new focus node.
 */
const GraphState = {
  nodes: new Map(),
  edges: [],
  activeNodeId: null,
  rootId: null,
  focusId: null,
  container: null,
  canvas: null,          // the pannable inner div
  svgEdges: null,
  nodesContainer: null,
  onNodeClick: null,
  _renderTimer: null,
  _edgeTimer: null,
  _cachedPositions: new Map(),

  // Pan state
  panX: 0,
  panY: 0,
  _dragging: false,
  _dragStartX: 0,
  _dragStartY: 0,
  _dragStartPanX: 0,
  _dragStartPanY: 0,

  init(containerEl, svgEdgesEl, nodesContainerEl, onNodeClick) {
    this.container = containerEl;
    this.svgEdges = svgEdgesEl;
    this.nodesContainer = nodesContainerEl;
    this.onNodeClick = onNodeClick;

    // Wrap nodes + svg inside a pannable canvas div
    this._setupCanvas();
    this._initPan();
  },

  _setupCanvas() {
    // Create a canvas layer if it doesn't already exist
    let canvas = this.container.querySelector(".graph-canvas");
    if (!canvas) {
      canvas = document.createElement("div");
      canvas.className = "graph-canvas";
      // Move existing children (svg + nodes div) into the canvas
      while (this.container.firstChild) canvas.appendChild(this.container.firstChild);
      this.container.appendChild(canvas);
    }
    this.canvas = canvas;
    // Re-grab references (they moved into canvas)
    this.svgEdges     = canvas.querySelector("#graphEdges");
    this.nodesContainer = canvas.querySelector("#graphNodes");
    this._applyPan(0, 0, false);
  },

  _applyPan(x, y, animate = true) {
    this.panX = x;
    this.panY = y;
    if (!this.canvas) return;
    this.canvas.style.transition = animate
      ? "transform 480ms cubic-bezier(0.32, 0.72, 0, 1)"
      : "none";
    this.canvas.style.transform = `translate(${x}px, ${y}px)`;
    // Redraw edges after pan settles
    clearTimeout(this._edgeTimer);
    this._edgeTimer = setTimeout(() => this._renderEdges(), 10);
  },

  _initPan() {
    const el = this.container;

    const onDown = (e) => {
      // Don't start pan if click is on a node
      if (e.target.closest(".graph-node")) return;
      this._dragging = true;
      const pt = e.touches ? e.touches[0] : e;
      this._dragStartX = pt.clientX;
      this._dragStartY = pt.clientY;
      this._dragStartPanX = this.panX;
      this._dragStartPanY = this.panY;
      el.style.cursor = "grabbing";
      if (this.canvas) this.canvas.style.transition = "none";
    };

    const onMove = (e) => {
      if (!this._dragging) return;
      e.preventDefault();
      const pt = e.touches ? e.touches[0] : e;
      const dx = pt.clientX - this._dragStartX;
      const dy = pt.clientY - this._dragStartY;
      this.panX = this._dragStartPanX + dx;
      this.panY = this._dragStartPanY + dy;
      if (this.canvas) this.canvas.style.transform = `translate(${this.panX}px, ${this.panY}px)`;
    };

    const onUp = () => {
      if (!this._dragging) return;
      this._dragging = false;
      el.style.cursor = "";
      // Redraw edges after drag ends
      this._renderEdges();
    };

    el.addEventListener("mousedown",  onDown);
    el.addEventListener("touchstart", onDown, { passive: true });
    window.addEventListener("mousemove",  onMove);
    window.addEventListener("touchmove",  onMove, { passive: false });
    window.addEventListener("mouseup",   onUp);
    window.addEventListener("touchend",  onUp);

    // Cursor hint
    el.style.cursor = "grab";
  },

  reset() {
    this.nodes.clear();
    this.edges = [];
    this.activeNodeId = null;
    this.rootId = null;
    this.focusId = null;
    this._cachedPositions = new Map();
    if (this.nodesContainer) this.nodesContainer.innerHTML = "";
    if (this.svgEdges) this.svgEdges.innerHTML = "";
    this._applyPan(0, 0, false);
  },

  addRootNode(id, topic, lesson) {
    this.rootId = id;
    this.focusId = id;
    this.activeNodeId = id;
    this.nodes.set(id, { id, topic, status: "active", lesson: lesson || null });
    this._scheduleRender();
  },

  addNode(node) {
    if (this.nodes.has(node.id)) return;
    this.nodes.set(node.id, { ...node, lesson: node.lesson || null });
    this._scheduleRender();
  },

  addEdge(edge) {
    if (this.edges.some((e) => e.id === edge.id)) return;
    this.edges.push(edge);
    this._scheduleRender();
  },

  setActive(id) {
    this.activeNodeId = id;
    this._scheduleRender(false);
  },

  markCompleted(id) {
    const node = this.nodes.get(id);
    if (!node) return null;
    node.status = "completed";
    const nextId = this._nextFocusAfterComplete(id);
    if (nextId) {
      this.focusId = nextId;
      this.activeNodeId = nextId;
    }
    this._scheduleRender();
    return nextId;
  },

  addPrerequisite(prereqNode, targetId) {
    if (!this.nodes.has(prereqNode.id)) {
      this.nodes.set(prereqNode.id, { ...prereqNode, lesson: prereqNode.lesson || null });
    }
    const edgeId = `e-${prereqNode.id}-${targetId}`;
    if (!this.edges.some((e) => e.id === edgeId)) {
      this.edges.push({ id: edgeId, source: prereqNode.id, target: targetId, type: "prerequisite" });
    }
    this.focusId = prereqNode.id;
    this.activeNodeId = prereqNode.id;
    this._scheduleRender();
  },

  setLesson(id, lesson) {
    const node = this.nodes.get(id);
    if (node) node.lesson = lesson;
  },

  getActiveNode()  { return this.nodes.get(this.activeNodeId) || null; },
  getNodeCount()   { return this.nodes.size; },
  getEdgeCount()   { return this.edges.length; },

  // ── Internal ──────────────────────────────────────────────────────

  _nextFocusAfterComplete(completedId) {
    const connected = this.edges
      .filter((e) => e.source === completedId || e.target === completedId)
      .map((e) => (e.source === completedId ? e.target : e.source))
      .filter((id) => { const n = this.nodes.get(id); return n && n.status !== "completed"; });
    if (connected.length > 0) return connected[0];
    for (const [id, node] of this.nodes) {
      if (node.status !== "completed") return id;
    }
    return null;
  },

  _computePositions() {
    const focusId = this.focusId || this.rootId;
    const RING_RADIUS = 190;
    const ringBuckets = new Map();
    const visited = new Set();
    const queue = [{ id: focusId, ring: 0 }];

    while (queue.length > 0) {
      const { id, ring } = queue.shift();
      if (visited.has(id)) continue;
      visited.add(id);
      if (!ringBuckets.has(ring)) ringBuckets.set(ring, []);
      ringBuckets.get(ring).push(id);
      this.edges
        .filter((e) => e.source === id || e.target === id)
        .map((e) => (e.source === id ? e.target : e.source))
        .filter((nid) => !visited.has(nid))
        .forEach((nid) => queue.push({ id: nid, ring: ring + 1 }));
    }

    // Orphan nodes (no edges yet) → ring 1
    for (const id of this.nodes.keys()) {
      if (!visited.has(id)) {
        if (!ringBuckets.has(1)) ringBuckets.set(1, []);
        ringBuckets.get(1).push(id);
      }
    }

    const positions = new Map();
    ringBuckets.forEach((ids, ring) => {
      if (ring === 0) { positions.set(ids[0], { x: 0, y: 0 }); return; }
      const count = ids.length;
      const radius = RING_RADIUS * ring;
      const baseAngle = ring % 2 === 0 ? 0 : -Math.PI / 2;
      ids.forEach((id, i) => {
        const angle = baseAngle + (2 * Math.PI * i) / count;
        positions.set(id, {
          x: Math.round(radius * Math.cos(angle)),
          y: Math.round(radius * Math.sin(angle)),
        });
      });
    });
    return positions;
  },

  _scheduleRender(recalc = true) {
    clearTimeout(this._renderTimer);
    this._renderTimer = setTimeout(() => this.render(recalc), 16);
  },

  render(recalcPositions = true) {
    if (!this.container) return;

    // Logical center of the canvas (independent of pan)
    const cx = this.container.clientWidth / 2;
    const cy = this.container.clientHeight / 2;

    const positions = recalcPositions ? this._computePositions() : this._cachedPositions;
    if (recalcPositions) this._cachedPositions = positions;

    // When focus shifts, pan so the new focus node appears at screen center
    if (recalcPositions) {
      const focusPos = positions.get(this.focusId) || { x: 0, y: 0 };
      // Pan to negate the focus offset so it lands at screen center
      this._applyPan(-focusPos.x, -focusPos.y, true);
    }

    // ── Nodes ──
    if (this.nodesContainer) {
      const existingEls = new Map();
      this.nodesContainer.querySelectorAll(".graph-node").forEach((el) => {
        existingEls.set(el.dataset.id, el);
      });

      for (const [id, node] of this.nodes) {
        const pos = positions.get(id) || { x: 0, y: 0 };
        const isActive = id === this.activeNodeId;
        const isFocus  = id === this.focusId;

        let el = existingEls.get(id);
        const isNew = !el;

        if (isNew) {
          el = document.createElement("div");
          el.dataset.id = id;
          const focusPos = positions.get(this.focusId) || { x: 0, y: 0 };
          el.style.left = `${cx + focusPos.x}px`;
          el.style.top  = `${cy + focusPos.y}px`;
          el.style.opacity = "0";
          el.style.transform = "translate(-50%, -50%) scale(0.6)";
          this.nodesContainer.appendChild(el);
          existingEls.set(id, el);
          requestAnimationFrame(() => {
            el.style.opacity = "";
            el.style.transform = "";
          });
        }

        const label = node.topic.length > 18 ? node.topic.slice(0, 16) + "…" : node.topic;
        el.className = ["graph-node", node.status, isActive ? "active" : "", isFocus ? "focus-center" : ""].filter(Boolean).join(" ");
        el.innerHTML = `<div class="graph-node-shell"><div class="graph-node-inner"><span class="node-label">${label}</span></div></div>`;
        el.style.left = `${cx + pos.x}px`;
        el.style.top  = `${cy + pos.y}px`;

        el.onclick = () => {
          this.setActive(id);
          if (this.onNodeClick) this.onNodeClick(node);
        };
      }

      existingEls.forEach((el, id) => { if (!this.nodes.has(id)) el.remove(); });
    }

    // Edges draw after position transitions settle
    clearTimeout(this._edgeTimer);
    this._edgeTimer = setTimeout(() => this._renderEdges(cx, cy, positions), 340);
  },

  _renderEdges(cx, cy, positions) {
    if (!this.svgEdges) return;

    // Use cached positions if not passed in
    const pos = positions || this._cachedPositions;
    if (!cx) cx = this.container.clientWidth / 2;
    if (!cy) cy = this.container.clientHeight / 2;

    this.svgEdges.innerHTML = this.edges.map((edge) => {
      const fp = pos.get(edge.source);
      const tp = pos.get(edge.target);
      if (!fp || !tp) return "";
      const cls = edge.type === "prerequisite" ? "edge-prereq" : "edge-branch";
      return `<line x1="${cx + fp.x}" y1="${cy + fp.y}" x2="${cx + tp.x}" y2="${cy + tp.y}" class="graph-edge ${cls}" />`;
    }).join("");
  },
};
