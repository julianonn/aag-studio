// Graph editor canvas, toolbar, and state management.

import { renderPalette } from "./palette.js";
import { showContextMenu } from "./contextmenu.js";
import { attachSelectionHandles } from "./selection-handles.js";
import { topLevelKind, inferredEdgeLabel, nextId, validateGraph, debounce, computeDefaultLayout } from "./graph-utils.js";
import { icon } from "./icons.js";
import { AUTOSAVE_DEBOUNCE_MS, DUPLICATE_OFFSET, GATE_NODE_SIZE } from "./constants.js";

const rootStyle = getComputedStyle(document.documentElement);
const KIND_COLOR = {
  resource: rootStyle.getPropertyValue("--kind-resource").trim(),
  agent: rootStyle.getPropertyValue("--kind-agent").trim(),
  A: rootStyle.getPropertyValue("--kind-A").trim(),
};
const KIND_DEFAULT_COLOR = rootStyle.getPropertyValue("--kind-default").trim();
const SELECTED_COLOR = rootStyle.getPropertyValue("--color-selected").trim();

export async function openEditor(graphName, labelSet, { onExit, onRename }) {
  let graph = await fetch(`/api/graphs/${graphName}`).then((response) => response.json());
  const rawLayout = await fetch(`/api/graphs/${graphName}/layout`).then((response) => response.json());
  const positions = rawLayout.positions ?? {};
  if (!Object.keys(positions).length && graph.vertices.length > 0) {
    Object.assign(positions, computeDefaultLayout(graph.vertices, graph.edges));
  }
  const edgeStyles = rawLayout.edge_styles ?? {};
  const sizes = rawLayout.sizes ?? {};

  const issuesCountEl = document.getElementById("issues-count");
  const violationsList = document.getElementById("violations-list");

  const floatingToolbarEl = document.createElement("div");
  floatingToolbarEl.className = "floating-toolbar";
  floatingToolbarEl.hidden = true;
  // Stop mousedown bubbling so Cytoscape does not treat toolbar interaction as a background tap
  floatingToolbarEl.addEventListener("mousedown", (evt) => evt.stopPropagation());
  document.getElementById("graph").append(floatingToolbarEl);

  const undoButton = document.createElement("button");
  undoButton.title = "Undo";
  undoButton.append(icon("undo"));
  const redoButton = document.createElement("button");
  redoButton.title = "Redo";
  redoButton.append(icon("redo"));
  const undoRedoEl = document.createElement("div");
  undoRedoEl.id = "undo-redo";
  undoRedoEl.append(undoButton, redoButton);
  document.getElementById("graph").append(undoRedoEl);

  function saveGraph() {
    fetch(`/api/graphs/${graphName}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(graph),
    });
  }
  const debouncedSaveGraph = debounce(saveGraph, AUTOSAVE_DEBOUNCE_MS);

  function saveLayout() {
    fetch(`/api/graphs/${graphName}/layout`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ positions, edge_styles: edgeStyles, sizes }),
    });
  }
  const debouncedSaveLayout = debounce(saveLayout, AUTOSAVE_DEBOUNCE_MS);

  async function refreshViolations() {
    const violations = await validateGraph(graph);
    issuesCountEl.textContent = violations.length || "";
    violationsList.replaceChildren(
      ...violations.map((violation) => {
        const li = document.createElement("li");
        li.textContent = violation;
        return li;
      })
    );
  }

  function elementsFromGraph() {
    return [
      ...graph.vertices.map((vertex) => ({
        data: {
          id: vertex.id,
          label: vertex.label,
          kind: topLevelKind(vertex.label, labelSet.vertex_labels),
          ...(sizes[vertex.id] ? { width: sizes[vertex.id][0], height: sizes[vertex.id][1] } : {}),
        },
        position: positions[vertex.id] ? { x: positions[vertex.id][0], y: positions[vertex.id][1] } : undefined,
      })),
      ...graph.edges.map((edge) => ({
        data: {
          id: edge.id,
          source: edge.src,
          target: edge.tgt,
          label: edge.label,
          time: edge.time,
          curveStyle: edgeStyles[edge.id] ?? "bezier",
        },
      })),
    ];
  }

  const cy = cytoscape({
    container: document.getElementById("graph"),
    elements: elementsFromGraph(),
    layout: Object.keys(positions).length ? { name: "preset" } : { name: "breadthfirst" },
    style: [
      { selector: "core", style: { "active-bg-opacity": 0 } },
      {
        selector: "node",
        style: {
          label: "data(label)",
          "background-color": (node) => KIND_COLOR[node.data("kind")] ?? KIND_DEFAULT_COLOR,
          color: "#fff",
          "text-valign": "center",
          "text-halign": "center",
          "text-wrap": "wrap",
          "text-max-width": "80px",
          shape: "round-rectangle",
          width: "label",
          height: "label",
          padding: "10px",
          "font-size": 11,
          "overlay-opacity": 0,
        },
      },
      { selector: "node[kind = 'A']", style: { shape: "diamond", label: "A", width: GATE_NODE_SIZE, height: GATE_NODE_SIZE, padding: 0 } },
      { selector: "node[width]", style: { width: "data(width)", height: "data(height)" } },
      { selector: "node:selected", style: { "border-width": 3, "border-color": SELECTED_COLOR } },
      {
        selector: "edge",
        style: {
          label: "data(label)",
          "curve-style": "data(curveStyle)",
          "target-arrow-shape": "triangle",
          "font-size": 8,
          "overlay-opacity": 0,
        },
      },
      { selector: "edge:selected", style: { "line-color": SELECTED_COLOR, "target-arrow-color": SELECTED_COLOR, width: 3 } },
    ],
  });

  function rerender() {
    hideFloatingToolbar();
    cy.elements().remove();
    cy.add(elementsFromGraph());
    if (!Object.keys(positions).length && graph.vertices.length > 0) {
      Object.assign(positions, computeDefaultLayout(graph.vertices, graph.edges));
      cy.layout({ name: "preset" }).run();
    }
  }

  const undoStack = [];
  const redoStack = [];

  function updateUndoRedoButtons() {
    undoButton.disabled = undoStack.length === 0;
    redoButton.disabled = redoStack.length === 0;
  }

  async function applyGraph(candidate, { recordHistory = true } = {}) {
    const violations = await validateGraph(candidate);
    if (violations.length) {
      alert(violations.join("\n"));
      return false;
    }
    if (recordHistory) {
      undoStack.push(graph);
      redoStack.length = 0;
      updateUndoRedoButtons();
    }
    graph = candidate;
    rerender();
    refreshViolations();
    debouncedSaveGraph();
    return true;
  }

  undoButton.onclick = async () => {
    if (undoStack.length === 0) return;
    redoStack.push(graph);
    await applyGraph(undoStack.pop(), { recordHistory: false });
    updateUndoRedoButtons();
  };
  redoButton.onclick = async () => {
    if (redoStack.length === 0) return;
    undoStack.push(graph);
    await applyGraph(redoStack.pop(), { recordHistory: false });
    updateUndoRedoButtons();
  };
  updateUndoRedoButtons();

  async function tryAddVertex(label) {
    const id = nextId(new Set(graph.vertices.map((vertex) => vertex.id)), label);
    await applyGraph({ vertices: [...graph.vertices, { id, label }], edges: graph.edges });
  }

  async function tryAddEdge(sourceId, targetId) {
    const existingIds = new Set(graph.edges.map((edge) => edge.id));
    const id = nextId(existingIds, "e");
    const sourceLabel = graph.vertices.find((vertex) => vertex.id === sourceId).label;
    const targetLabel = graph.vertices.find((vertex) => vertex.id === targetId).label;
    const label = inferredEdgeLabel(labelSet, sourceLabel, targetLabel);
    if (!label) {
      alert(`no edge rule matches ${sourceLabel} -> ${targetLabel}`);
      return;
    }
    const edge = { id, src: sourceId, tgt: targetId, label, time: [[0, null]] };
    await applyGraph({ vertices: graph.vertices, edges: [...graph.edges, edge] });
  }

  async function tryDeleteVertex(vertexId) {
    await applyGraph({
      vertices: graph.vertices.filter((vertex) => vertex.id !== vertexId),
      edges: graph.edges.filter((edge) => edge.src !== vertexId && edge.tgt !== vertexId),
    });
  }

  async function tryDeleteEdge(edgeId) {
    await applyGraph({ vertices: graph.vertices, edges: graph.edges.filter((edge) => edge.id !== edgeId) });
  }

  async function tryDuplicateVertex(vertexId) {
    const original = graph.vertices.find((vertex) => vertex.id === vertexId);
    const id = nextId(new Set(graph.vertices.map((vertex) => vertex.id)), original.label);
    if (positions[vertexId]) positions[id] = [positions[vertexId][0] + DUPLICATE_OFFSET, positions[vertexId][1] + DUPLICATE_OFFSET];
    await applyGraph({ vertices: [...graph.vertices, { ...original, id }], edges: graph.edges });
  }

  async function tryDuplicateEdge(edgeId) {
    const original = graph.edges.find((edge) => edge.id === edgeId);
    const id = nextId(new Set(graph.edges.map((edge) => edge.id)), "e");
    await applyGraph({ vertices: graph.vertices, edges: [...graph.edges, { ...original, id }] });
  }

  async function tryRenameVertex(oldId, newId) {
    if (!newId || newId === oldId) return;
    if (graph.vertices.some((vertex) => vertex.id === newId)) {
      alert(`a vertex named "${newId}" already exists`);
      return;
    }
    await applyGraph({
      vertices: graph.vertices.map((vertex) => (vertex.id === oldId ? { ...vertex, id: newId } : vertex)),
      edges: graph.edges.map((edge) => ({
        ...edge,
        src: edge.src === oldId ? newId : edge.src,
        tgt: edge.tgt === oldId ? newId : edge.tgt,
      })),
    });
  }

  async function tryChangeVertexLabel(vertexId, newLabel) {
    await applyGraph({
      vertices: graph.vertices.map((vertex) => (vertex.id === vertexId ? { ...vertex, label: newLabel } : vertex)),
      edges: graph.edges,
    });
  }

  async function tryReconnectEdge(edgeId, movingEnd, droppedNodeId) {
    const edge = graph.edges.find((edge) => edge.id === edgeId);
    const updated = movingEnd === "src" ? { ...edge, src: droppedNodeId } : { ...edge, tgt: droppedNodeId };
    const newLabel = inferredEdgeLabel(
      labelSet,
      graph.vertices.find((vertex) => vertex.id === updated.src).label,
      graph.vertices.find((vertex) => vertex.id === updated.tgt).label
    );
    if (!newLabel) {
      alert("no edge rule matches that reconnection");
      return;
    }
    updated.label = newLabel;
    await applyGraph({
      vertices: graph.vertices,
      edges: graph.edges.map((edge) => (edge.id === edgeId ? updated : edge)),
    });
  }

  renderPalette(document.getElementById("panel-add"), labelSet.vertex_labels, tryAddVertex);

  const editorEl = document.getElementById("editor");
  const sidePanelEl = document.getElementById("side-panel");
  const panels = {
    add: document.getElementById("panel-add"),
    issues: document.getElementById("panel-issues"),
    info: document.getElementById("panel-info"),
  };
  const icons = {
    add: document.getElementById("icon-add"),
    issues: document.getElementById("icon-issues"),
    info: document.getElementById("icon-info"),
  };
  const panelTitleEl = document.getElementById("panel-title");
  const PANEL_TITLES = { add: "Add vertex", issues: "Issues", info: "Graph info" };
  let openPanel = null;

  function closePanel() {
    if (!openPanel) return;
    icons[openPanel].classList.remove("active");
    openPanel = null;
    sidePanelEl.hidden = true;
    editorEl.classList.remove("panel-open");
  }

  function togglePanel(name) {
    if (openPanel === name) {
      closePanel();
      return;
    }
    if (openPanel) icons[openPanel].classList.remove("active");
    openPanel = name;
    for (const [key, el] of Object.entries(panels)) el.hidden = key !== name;
    panelTitleEl.textContent = PANEL_TITLES[name];
    sidePanelEl.hidden = false;
    editorEl.classList.add("panel-open");
    icons[name].classList.add("active");
  }

  icons.add.onclick = () => togglePanel("add");
  icons.issues.onclick = () => togglePanel("issues");
  icons.info.onclick = () => togglePanel("info");

  const panelCollapseButton = document.getElementById("panel-collapse");
  panelCollapseButton.replaceChildren(icon("chevron-left"));
  panelCollapseButton.onclick = closePanel;

  document.getElementById("graph").addEventListener("contextmenu", (evt) => evt.preventDefault());

  const eh = cy.edgehandles({
    canConnect: (source, target) => !!inferredEdgeLabel(labelSet, source.data("label"), target.data("label")),
    edgeParams: () => ({}),
    hoverDelay: 0,
  });

  attachSelectionHandles(cy, eh, document.getElementById("graph"), {
    onConnect: tryAddEdge,
    onReconnect: tryReconnectEdge,
    onResize: (vertexId, width, height, x, y) => {
      sizes[vertexId] = [width, height];
      positions[vertexId] = [x, y];
      debouncedSaveLayout();
    },
  });

  cy.on("cxttap", "node", (evt) => {
    const node = evt.target;
    showContextMenu(evt.originalEvent.clientX, evt.originalEvent.clientY, [
      { label: "Delete", onClick: () => tryDeleteVertex(node.id()) },
    ]);
  });

  cy.on("cxttap", "edge", (evt) => {
    const edge = evt.target;
    showContextMenu(evt.originalEvent.clientX, evt.originalEvent.clientY, [
      { label: "Delete", onClick: () => tryDeleteEdge(edge.id()) },
      { label: "Straight", onClick: () => setEdgeStyle(edge.id(), "straight") },
      { label: "Elbow", onClick: () => setEdgeStyle(edge.id(), "taxi") },
      { label: "Curved", onClick: () => setEdgeStyle(edge.id(), "bezier") },
    ]);
  });

  function setEdgeStyle(edgeId, style) {
    edgeStyles[edgeId] = style;
    cy.getElementById(edgeId).data("curveStyle", style);
    debouncedSaveLayout();
  }

  let activeToolbarTarget = null;

  function positionFloatingToolbar(element) {
    const box = element.renderedBoundingBox();
    floatingToolbarEl.style.left = `${(box.x1 + box.x2) / 2}px`;
    floatingToolbarEl.style.top = `${box.y1}px`;
  }

  function hideFloatingToolbar() {
    activeToolbarTarget = null;
    floatingToolbarEl.hidden = true;
  }

  const ALL_VERTEX_LABELS = Object.keys(labelSet.vertex_labels).sort();

  function labeledField(labelText, inputEl) {
    const row = document.createElement("div");
    row.className = "field-row";
    const label = document.createElement("label");
    label.textContent = labelText;
    row.append(label, inputEl);
    return row;
  }

  function renderNodeMetadata(element) {
    const nameInput = document.createElement("input");
    nameInput.value = element.id();
    nameInput.onchange = () => tryRenameVertex(element.id(), nameInput.value.trim());

    const labelSelect = document.createElement("select");
    for (const label of ALL_VERTEX_LABELS) {
      const option = document.createElement("option");
      option.value = label;
      option.textContent = label;
      option.selected = label === element.data("label");
      labelSelect.append(option);
    }
    labelSelect.onchange = () => tryChangeVertexLabel(element.id(), labelSelect.value);

    return [labeledField("Name", nameInput), labeledField("Label", labelSelect)];
  }

  function renderEdgeMetadata(element) {
    const edge = graph.edges.find((graphEdge) => graphEdge.id === element.id());
    const heading = document.createElement("div");
    heading.textContent = `${edge.label === "ha" ? "has access to" : "gives access to"} (${edge.label})`;

    const list = document.createElement("ul");
    edge.time.forEach((interval, intervalIndex) => {
      const li = document.createElement("li");
      const startInput = document.createElement("input");
      startInput.value = interval[0] ?? "";
      startInput.placeholder = "0";
      const endInput = document.createElement("input");
      endInput.value = interval[1] ?? "";
      endInput.placeholder = "open-ended";
      li.append(labeledField("From", startInput), labeledField("Until", endInput));
      list.append(li);

      async function commit() {
        const newInterval = [startInput.value === "" ? null : Number(startInput.value), endInput.value === "" ? null : Number(endInput.value)];
        const newEdges = graph.edges.map((graphEdge) =>
          graphEdge.id !== edge.id ? graphEdge : { ...graphEdge, time: edge.time.map((iv, idx) => (idx === intervalIndex ? newInterval : iv)) }
        );
        await applyGraph({ vertices: graph.vertices, edges: newEdges });
      }
      startInput.onchange = commit;
      endInput.onchange = commit;
    });

    return [heading, list];
  }

  function renderFloatingToolbar(element) {
    activeToolbarTarget = element;
    floatingToolbarEl.hidden = false;
    positionFloatingToolbar(element);
    floatingToolbarEl.replaceChildren();

    const isNode = element.isNode();

    const toolbarRow = document.createElement("div");
    toolbarRow.className = "toolbar-row";

    const duplicateButton = document.createElement("button");
    duplicateButton.title = "Duplicate";
    duplicateButton.append(icon("duplicate"));
    duplicateButton.onclick = () => (isNode ? tryDuplicateVertex(element.id()) : tryDuplicateEdge(element.id()));

    const deleteButton = document.createElement("button");
    deleteButton.title = "Delete";
    deleteButton.append(icon("delete"));
    deleteButton.onclick = () => (isNode ? tryDeleteVertex(element.id()) : tryDeleteEdge(element.id()));

    const metadataEl = document.createElement("div");
    metadataEl.hidden = true;
    metadataEl.append(...(isNode ? renderNodeMetadata(element) : renderEdgeMetadata(element)));

    const moreButton = document.createElement("button");
    moreButton.title = "More";
    moreButton.append(icon("dots-vertical"));
    moreButton.onclick = () => {
      const items = [{ label: "Edit metadata", onClick: () => (metadataEl.hidden = !metadataEl.hidden) }];
      if (!isNode) {
        items.push(
          { label: "Straight edge", onClick: () => setEdgeStyle(element.id(), "straight") },
          { label: "Elbow edge", onClick: () => setEdgeStyle(element.id(), "taxi") },
          { label: "Curved edge", onClick: () => setEdgeStyle(element.id(), "bezier") }
        );
      }
      const rect = moreButton.getBoundingClientRect();
      showContextMenu(rect.left, rect.bottom, items);
    };

    toolbarRow.append(duplicateButton, deleteButton, moreButton);
    floatingToolbarEl.append(toolbarRow, metadataEl);
  }

  cy.on("tap", "node, edge", (evt) => renderFloatingToolbar(evt.target));
  cy.on("tap", (evt) => {
    if (evt.target === cy) hideFloatingToolbar();
  });
  cy.on("pan zoom position", () => {
    if (activeToolbarTarget) positionFloatingToolbar(activeToolbarTarget);
  });

  cy.on("dragfree", "node", () => {
    cy.nodes().forEach((node) => (positions[node.id()] = [node.position("x"), node.position("y")]));
    debouncedSaveLayout();
  });

  window.addEventListener("beforeunload", () => {
    debouncedSaveGraph.flush();
    debouncedSaveLayout.flush();
  });

  document.getElementById("back-to-library").onclick = () => {
    cy.destroy();
    onExit();
  };

  const graphNameEl = document.getElementById("graph-name");
  graphNameEl.textContent = graphName;

  const graphMetaEl = document.getElementById("graph-meta");
  const graphs = await fetch("/api/graphs").then((response) => response.json());
  const thisGraph = graphs.find((graphEntry) => graphEntry.name === graphName);
  if (thisGraph) {
    graphMetaEl.textContent = `created ${new Date(thisGraph.created * 1000).toLocaleString()}`;
  }

  document.getElementById("rename-graph").onclick = async () => {
    const newName = prompt("new name", graphName);
    if (!newName || newName === graphName) return;
    const response = await fetch(`/api/graphs/${graphName}/rename`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ new_name: newName }),
    });
    if (!response.ok) {
      alert((await response.json()).detail);
      return;
    }
    graphName = newName;
    graphNameEl.textContent = graphName;
    onRename(graphName);
  };

  await refreshViolations();
}
