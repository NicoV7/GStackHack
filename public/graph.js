/**
 * GraphState — manages the interactive knowledge graph (SVG-based).
 * Nodes are positioned radially from the root topic. Edges are drawn as lines.
 * Clicking a node triggers a callback to display its lesson.
 */
const GraphState = {
  nodes: new Map(),
  edges: [],
  activeNodeId: null,
  rootId: null,
  container: null,
  svgEdges: null,
  nodesContainer: null,
  onNodeClick: null,

  init(containerEl, svgEdgesEl, nodesContainerEl, onNodeClick) {
    this.container = containerEl;
    this.svgEdges = svgEdgesEl;
    this.nodesContainer = nodesContainerEl;
    this.onNodeClick = onNodeClick;
  },

  reset() {
    this.nodes.clear();
    this.edges = [];
    this.activeNodeId = null;
    this.rootId = null;
    this.render();
  },

  addRootNode(id, topic, lesson) {
    this.rootId = id;
    this.activeNodeId = id;
    this.nodes.set(id, {
      id,
      topic,
      status: "active",
      lesson: lesson || null,
      position: { x: 0, y: 0 },
    });
    this.render();
  },

  addNode(node) {
    if (this.nodes.has(node.id)) return;

    // Position relative to root if not specified or at origin
    const pos = node.position && (node.position.x !== 0 || node.position.y !== 0)
      ? node.position
      : this._autoPosition(this.nodes.size);

    this.nodes.set(node.id, {
      ...node,
      position: pos,
      lesson: node.lesson || null,
    });
    this.render();
  },

  addEdge(edge) {
    if (this.edges.some((e) => e.id === edge.id)) return;
    this.edges.push(edge);
    this.render();
  },

  setActive(id) {
    this.activeNodeId = id;
    this.render();
  },

  markCompleted(id) {
    const node = this.nodes.get(id);
    if (node) {
      node.status = "completed";
      this.render();
    }
  },

  setLesson(id, lesson) {
    const node = this.nodes.get(id);
    if (node) {
      node.lesson = lesson;
    }
  },

  getActiveNode() {
    return this.nodes.get(this.activeNodeId) || null;
  },

  getNodeCount() {
    return this.nodes.size;
  },

  getEdgeCount() {
    return this.edges.length;
  },

  _autoPosition(index) {
    if (index === 0) return { x: 0, y: 0 };
    const ring = Math.ceil(index / 6);
    const posInRing = (index - 1) % 6;
    const total = Math.min(6, this.nodes.size);
    const angle = (2 * Math.PI * posInRing) / total - Math.PI / 2;
    const radius = 160 * ring;
    return {
      x: Math.round(radius * Math.cos(angle)),
      y: Math.round(radius * Math.sin(angle)),
    };
  },

  render() {
    if (!this.container) return;

    const cx = this.container.clientWidth / 2;
    const cy = this.container.clientHeight / 2;

    // Render edges as SVG lines
    if (this.svgEdges) {
      this.svgEdges.innerHTML = this.edges
        .map((edge) => {
          const from = this.nodes.get(edge.source);
          const to = this.nodes.get(edge.target);
          if (!from || !to) return "";
          const x1 = cx + from.position.x;
          const y1 = cy + from.position.y;
          const x2 = cx + to.position.x;
          const y2 = cy + to.position.y;
          const cls = edge.type === "prerequisite" ? "edge-prereq" : "edge-branch";
          return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="graph-edge ${cls}" />`;
        })
        .join("");
    }

    // Render nodes as positioned divs
    if (this.nodesContainer) {
      this.nodesContainer.innerHTML = "";
      for (const [id, node] of this.nodes) {
        const el = document.createElement("div");
        const isActive = id === this.activeNodeId;
        el.className = `graph-node ${node.status}${isActive ? " active" : ""}`;
        el.style.left = `${cx + node.position.x}px`;
        el.style.top = `${cy + node.position.y}px`;
        el.dataset.id = id;

        const label =
          node.topic.length > 18
            ? node.topic.slice(0, 16) + "..."
            : node.topic;
        el.innerHTML = `<span class="node-label">${label}</span>`;

        el.addEventListener("click", () => {
          this.setActive(id);
          if (this.onNodeClick) this.onNodeClick(node);
        });

        this.nodesContainer.appendChild(el);
      }
    }
  },
};
