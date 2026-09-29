import { renderPalette } from "./palette.js";
import { showContextMenu } from "./contextmenu.js";
import { attachSelectionHandles } from "./selection-handles.js";
import { topLevelKind, inferredEdgeLabel, nextId, validateGraph, debounce, computeDefaultLayout } from "./graph-utils.js";
import { attachKeyboardShortcuts } from "./keyboard-shortcuts.js";
import { AUTOSAVE_DEBOUNCE_MS, DUPLICATE_OFFSET, GATE_NODE_SIZE, BASE_ZOOM } from "./constants.js";
import { modalAlert, modalPrompt } from "./modal.js";

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

  const itemIsland = document.getElementById("item-island");
  const itemIslandTitle = document.getElementById("item-island-title");
  const itemIslandBody = document.getElementById("item-island-body");
  const itemIslandCloseBtn = document.getElementById("item-island-close");
  const itemIslandDuplicateBtn = document.getElementById("item-island-duplicate");
  const itemIslandDeleteBtn = document.getElementById("item-island-delete");

  const undoButton = document.getElementById("btn-undo");
  const redoButton = document.getElementById("btn-redo");

  function saveGraph() {
    fetch(`/api/graphs/${graphName}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(graph),
    });
  }
  const debouncedSaveGraph = debounce(saveGraph, AUTOSAVE_DEBOUNCE_MS);

  function saveLayout() {
    const validVertexIds = new Set(graph.vertices.map((vertex) => vertex.id));
    const validEdgeIds = new Set(graph.edges.map((edge) => edge.id));
    for (const id of Object.keys(positions)) {
      if (!validVertexIds.has(id)) delete positions[id];
    }
    for (const id of Object.keys(sizes)) {
      if (!validVertexIds.has(id)) delete sizes[id];
    }
    for (const id of Object.keys(edgeStyles)) {
      if (!validEdgeIds.has(id)) delete edgeStyles[id];
    }
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
    minZoom: 0.1,
    maxZoom: 4.0,
    zoom: BASE_ZOOM,
    pan: { x: 0, y: 0 },
    layout: {
      name: "preset",
      fit: false,
    },
    style: [
      {
        selector: "core",
        style: {
          "active-bg-opacity": 0,
          "selection-box-color": "#2f6fed",
          "selection-box-opacity": 0.12,
          "selection-box-border-color": "#2f6fed",
          "selection-box-border-width": 1.5,
        },
      },
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
      { selector: "node.edge-hover", style: { "border-width": 3, "border-color": SELECTED_COLOR } },
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

  cy.resize();
  cy.zoom(BASE_ZOOM);
  cy.center();

  function rerender() {
    hideItemIsland();
    if (!Object.keys(positions).length && graph.vertices.length > 0) {
      Object.assign(positions, computeDefaultLayout(graph.vertices, graph.edges));
    }
    cy.elements().remove();
    cy.add(elementsFromGraph());
  }

  function snapshotState() {
    return {
      graph: JSON.parse(JSON.stringify(graph)),
      positions: JSON.parse(JSON.stringify(positions)),
      sizes: JSON.parse(JSON.stringify(sizes)),
      edgeStyles: JSON.parse(JSON.stringify(edgeStyles)),
    };
  }

  function restoreState(state) {
    const graphChanged = JSON.stringify(graph) !== JSON.stringify(state.graph);
    graph = state.graph;
    for (const key of Object.keys(positions)) delete positions[key];
    Object.assign(positions, state.positions);
    for (const key of Object.keys(sizes)) delete sizes[key];
    Object.assign(sizes, state.sizes);
    for (const key of Object.keys(edgeStyles)) delete edgeStyles[key];
    Object.assign(edgeStyles, state.edgeStyles);

    if (graphChanged) {
      rerender();
      refreshViolations();
      debouncedSaveGraph();
    } else {
      cy.batch(() => {
        cy.nodes().forEach((node) => {
          const id = node.id();
          if (positions[id]) {
            node.position({ x: positions[id][0], y: positions[id][1] });
          }
          if (sizes[id]) {
            node.data({ width: sizes[id][0], height: sizes[id][1] });
          } else {
            node.removeData("width");
            node.removeData("height");
          }
        });
        cy.edges().forEach((edge) => {
          const id = edge.id();
          edge.data("curveStyle", edgeStyles[id] ?? "bezier");
        });
      });
    }
    debouncedSaveLayout();
    if (activeSelectedItem) {
      renderSelectedItemIsland();
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
      await modalAlert(violations.join("\n"), "Validation error");
      return false;
    }
    if (recordHistory) {
      undoStack.push(snapshotState());
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
    redoStack.push(snapshotState());
    restoreState(undoStack.pop());
    updateUndoRedoButtons();
  };
  redoButton.onclick = async () => {
    if (redoStack.length === 0) return;
    undoStack.push(snapshotState());
    restoreState(redoStack.pop());
    updateUndoRedoButtons();
  };
  updateUndoRedoButtons();

  async function tryAddVertex(label) {
    const id = nextId(new Set(graph.vertices.map((vertex) => vertex.id)), label);
    const extent = cy.extent();
    positions[id] = [Math.round((extent.x1 + extent.x2) / 2), Math.round((extent.y1 + extent.y2) / 2)];
    await applyGraph({ vertices: [...graph.vertices, { id, label }], edges: graph.edges });
    debouncedSaveLayout();
  }

  async function tryAddEdge(sourceId, targetId, style = selectedEdgeStyle, type = selectedEdgeType, time = getSelectedEdgeTime()) {
    const existingIds = new Set(graph.edges.map((edge) => edge.id));
    const id = nextId(existingIds, "e");
    const sourceVertex = graph.vertices.find((vertex) => vertex.id === sourceId);
    const targetVertex = graph.vertices.find((vertex) => vertex.id === targetId);
    if (!sourceVertex || !targetVertex) return;
    const label = type || inferredEdgeLabel(labelSet, sourceVertex.label, targetVertex.label);
    if (!label) {
      await modalAlert(`no edge rule matches ${sourceVertex.label} -> ${targetVertex.label}`, "Invalid connection");
      return;
    }
    edgeStyles[id] = style;
    const edge = { id, src: sourceId, tgt: targetId, label, time: time ?? [[0, null]] };
    const ok = await applyGraph({ vertices: graph.vertices, edges: [...graph.edges, edge] });
    if (ok) {
      cy.getElementById(id).select();
    }
    debouncedSaveLayout();
  }

  async function tryDeleteVertex(vertexId) {
    delete positions[vertexId];
    delete sizes[vertexId];
    await applyGraph({
      vertices: graph.vertices.filter((vertex) => vertex.id !== vertexId),
      edges: graph.edges.filter((edge) => edge.src !== vertexId && edge.tgt !== vertexId),
    });
    debouncedSaveLayout();
  }

  async function tryDeleteEdge(edgeId) {
    delete edgeStyles[edgeId];
    await applyGraph({ vertices: graph.vertices, edges: graph.edges.filter((edge) => edge.id !== edgeId) });
    debouncedSaveLayout();
  }

  async function tryDeleteSelected() {
    const selectedElements = cy.$(":selected");
    if (selectedElements.length === 0) return;

    const selectedNodeIds = new Set(selectedElements.nodes().map((node) => node.id()));
    const selectedEdgeIds = new Set(selectedElements.edges().map((edge) => edge.id()));

    for (const nodeId of selectedNodeIds) {
      delete positions[nodeId];
      delete sizes[nodeId];
    }
    for (const edgeId of selectedEdgeIds) {
      delete edgeStyles[edgeId];
    }

    await applyGraph({
      vertices: graph.vertices.filter((vertex) => !selectedNodeIds.has(vertex.id)),
      edges: graph.edges.filter(
        (edge) =>
          !selectedEdgeIds.has(edge.id) &&
          !selectedNodeIds.has(edge.src) &&
          !selectedNodeIds.has(edge.tgt)
      ),
    });
    debouncedSaveLayout();
  }

  async function tryDuplicateVertex(vertexId) {
    const original = graph.vertices.find((vertex) => vertex.id === vertexId);
    if (!original) return;
    const id = nextId(new Set(graph.vertices.map((vertex) => vertex.id)), original.label);
    if (positions[vertexId]) positions[id] = [positions[vertexId][0] + DUPLICATE_OFFSET, positions[vertexId][1] + DUPLICATE_OFFSET];
    if (sizes[vertexId]) sizes[id] = [...sizes[vertexId]];
    const ok = await applyGraph({ vertices: [...graph.vertices, { ...original, id }], edges: graph.edges });
    if (ok) {
      debouncedSaveLayout();
      cy.getElementById(id).select();
    }
  }

  async function tryDuplicateEdge(edgeId) {
    const original = graph.edges.find((edge) => edge.id === edgeId);
    if (!original) return;
    const id = nextId(new Set(graph.edges.map((edge) => edge.id)), "e");
    if (edgeStyles[edgeId]) edgeStyles[id] = edgeStyles[edgeId];
    const ok = await applyGraph({ vertices: graph.vertices, edges: [...graph.edges, { ...original, id }] });
    if (ok) {
      debouncedSaveLayout();
      cy.getElementById(id).select();
    }
  }

  async function tryDuplicateSelected() {
    const selected = cy.$(":selected");
    if (selected.length === 0) return;
    const el = selected[0];
    if (el.isNode()) {
      await tryDuplicateVertex(el.id());
    } else if (el.isEdge()) {
      await tryDuplicateEdge(el.id());
    }
  }

  async function tryRenameVertex(oldId, newId) {
    if (!newId || newId === oldId) return;
    if (graph.vertices.some((vertex) => vertex.id === newId)) {
      await modalAlert(`A vertex named "${newId}" already exists`, "Duplicate vertex");
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
      await modalAlert("No edge rule matches that reconnection", "Invalid connection");
      return;
    }
    updated.label = newLabel;
    await applyGraph({
      vertices: graph.vertices,
      edges: graph.edges.map((edge) => (edge.id === edgeId ? updated : edge)),
    });
    debouncedSaveLayout();
  }

  const paletteIsland = document.getElementById("palette-island");
  const paletteCloseBtn = document.getElementById("palette-close");
  const edgeIsland = document.getElementById("edge-island");
  const edgeCloseBtn = document.getElementById("edge-close");
  const styleBezierBtn = document.getElementById("style-bezier");
  const styleTaxiBtn = document.getElementById("style-taxi");
  const styleStraightBtn = document.getElementById("style-straight");
  const typeHaBtn = document.getElementById("type-ha");
  const typeGaBtn = document.getElementById("type-ga");
  const edgeTimeFromInput = document.getElementById("edge-time-from");
  const edgeTimeUntilInput = document.getElementById("edge-time-until");
  const toolAddVertex = document.getElementById("tool-add-vertex");
  const toolAddEdge = document.getElementById("tool-add-edge");

  let selectedEdgeStyle = "bezier";
  let selectedEdgeType = "ha";

  function setEdgeCurveStyle(style) {
    selectedEdgeStyle = style;
    styleBezierBtn.classList.toggle("active", style === "bezier");
    styleTaxiBtn.classList.toggle("active", style === "taxi");
    styleStraightBtn.classList.toggle("active", style === "straight");
  }
  styleBezierBtn.onclick = () => setEdgeCurveStyle("bezier");
  styleTaxiBtn.onclick = () => setEdgeCurveStyle("taxi");
  styleStraightBtn.onclick = () => setEdgeCurveStyle("straight");

  function setEdgeType(type) {
    selectedEdgeType = type;
    typeHaBtn.classList.toggle("active", type === "ha");
    typeGaBtn.classList.toggle("active", type === "ga");
  }
  typeHaBtn.onclick = () => setEdgeType("ha");
  typeGaBtn.onclick = () => setEdgeType("ga");

  function parseTimeBound(val) {
    const trimmed = (val ?? "").trim();
    if (!trimmed || trimmed === "inf" || trimmed === "+inf" || trimmed === "-inf" || trimmed === "null") {
      return trimmed === "inf" || trimmed === "+inf" || trimmed === "-inf" ? trimmed : null;
    }
    const num = Number(trimmed);
    return Number.isNaN(num) ? trimmed : num;
  }

  function getSelectedEdgeTime() {
    return [[parseTimeBound(edgeTimeFromInput.value), parseTimeBound(edgeTimeUntilInput.value)]];
  }

  function closeAddPanels() {
    paletteIsland.hidden = true;
    edgeIsland.hidden = true;
    itemIsland.hidden = true;
    toolAddVertex.classList.remove("active");
    toolAddEdge.classList.remove("active");
    clearEdgeHighlights();
    hidePreviewLine();
    if (activeMode === "edge") {
      setMode("select");
    }
  }

  renderPalette(document.getElementById("palette-tree"), labelSet.vertex_labels, tryAddVertex);

  toolAddVertex.onclick = () => {
    const shouldOpen = paletteIsland.hidden;
    closeAddPanels();
    if (shouldOpen) {
      paletteIsland.hidden = false;
      toolAddVertex.classList.add("active");
    }
  };
  paletteCloseBtn.onclick = closeAddPanels;

  toolAddEdge.onclick = () => {
    if (activeMode === "edge") {
      closeAddPanels();
    } else {
      closeAddPanels();
      edgeIsland.hidden = false;
      setMode("edge");
    }
  };
  edgeCloseBtn.onclick = closeAddPanels;

  const issuesDialog = document.getElementById("issues-dialog");
  const issuesCloseBtn = document.getElementById("issues-close");
  issuesCloseBtn.onclick = () => (issuesDialog.hidden = true);

  const zoomOutBtn = document.getElementById("btn-zoom-out");
  const zoomResetBtn = document.getElementById("btn-zoom-reset");
  const zoomInBtn = document.getElementById("btn-zoom-in");

  function updateZoomText() {
    zoomResetBtn.textContent = `${Math.round((cy.zoom() / BASE_ZOOM) * 100)}%`;
  }
  zoomOutBtn.onclick = () => {
    cy.zoom({ level: cy.zoom() * 0.8, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
    updateZoomText();
  };
  zoomInBtn.onclick = () => {
    cy.zoom({ level: cy.zoom() * 1.25, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
    updateZoomText();
  };
  zoomResetBtn.onclick = () => {
    cy.zoom({ level: BASE_ZOOM, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
    cy.center();
    updateZoomText();
  };
  cy.on("zoom", updateZoomText);
  updateZoomText();

  document.getElementById("graph").addEventListener("contextmenu", (evt) => evt.preventDefault());

  const eh = cy.edgehandles({
    canConnect: (source, target) => !!inferredEdgeLabel(labelSet, source.data("label"), target.data("label")),
    edgeParams: () => ({}),
    hoverDelay: 0,
  });

  let resizeStartState = null;
  attachSelectionHandles(cy, eh, document.getElementById("graph"), {
    onConnect: tryAddEdge,
    onReconnect: tryReconnectEdge,
    onResizeStart: () => {
      resizeStartState = snapshotState();
    },
    onResize: (vertexId, width, height, x, y) => {
      const prev = resizeStartState?.sizes[vertexId];
      const prevPos = resizeStartState?.positions[vertexId];
      const changed = !prev || prev[0] !== width || prev[1] !== height ||
                      !prevPos || prevPos[0] !== x || prevPos[1] !== y;
      sizes[vertexId] = [width, height];
      positions[vertexId] = [x, y];
      if (changed && resizeStartState) {
        undoStack.push(resizeStartState);
        redoStack.length = 0;
        updateUndoRedoButtons();
      }
      resizeStartState = null;
      debouncedSaveLayout();
      if (activeSelectedItem && activeSelectedItem.id() === vertexId) {
        renderSelectedItemIsland();
      }
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
    if (edgeStyles[edgeId] === style) return;
    undoStack.push(snapshotState());
    redoStack.length = 0;
    updateUndoRedoButtons();
    edgeStyles[edgeId] = style;
    cy.getElementById(edgeId).data("curveStyle", style);
    debouncedSaveLayout();
    if (activeSelectedItem && activeSelectedItem.id() === edgeId) {
      renderSelectedItemIsland();
    }
  }

  let activeSelectedItem = null;

  function hideItemIsland() {
    activeSelectedItem = null;
    itemIsland.hidden = true;
    itemIslandBody.replaceChildren();
  }

  itemIslandCloseBtn.onclick = () => {
    hideItemIsland();
    cy.elements().unselect();
  };

  itemIslandDuplicateBtn.onclick = () => {
    if (!activeSelectedItem) return;
    if (activeSelectedItem.isNode()) {
      tryDuplicateVertex(activeSelectedItem.id());
    } else if (activeSelectedItem.isEdge()) {
      tryDuplicateEdge(activeSelectedItem.id());
    }
  };

  itemIslandDeleteBtn.onclick = () => {
    if (!activeSelectedItem) return;
    if (activeSelectedItem.isNode()) {
      tryDeleteVertex(activeSelectedItem.id());
    } else if (activeSelectedItem.isEdge()) {
      tryDeleteEdge(activeSelectedItem.id());
    }
  };

  const ALL_VERTEX_LABELS = Object.keys(labelSet.vertex_labels).sort();

  function labeledField(labelText, inputEl) {
    const row = document.createElement("div");
    row.className = "field-row";
    const label = document.createElement("label");
    label.textContent = labelText;
    row.append(label, inputEl);
    return row;
  }

  function renderNodeFields(element) {
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

  function renderEdgeFields(element) {
    const edge = graph.edges.find((graphEdge) => graphEdge.id === element.id());
    if (!edge) return [];

    const currentStyle = edgeStyles[edge.id] ?? "bezier";
    const styleTitle = document.createElement("div");
    styleTitle.className = "island-section-title";
    styleTitle.textContent = "Style";

    const styleGroup = document.createElement("div");
    styleGroup.className = "island-btn-group";

    const styles = [
      { id: "bezier", title: "Curved", icon: "mdi-vector-curve" },
      { id: "taxi", title: "Elbow", icon: "mdi-vector-polyline" },
      { id: "straight", title: "Straight", icon: "mdi-vector-line" },
    ];
    for (const s of styles) {
      const btn = document.createElement("button");
      btn.className = `island-group-btn ${currentStyle === s.id ? "active" : ""}`;
      btn.type = "button";
      btn.title = s.title;
      btn.innerHTML = `<i class="mdi ${s.icon}"></i>`;
      btn.onclick = () => setEdgeStyle(edge.id, s.id);
      styleGroup.append(btn);
    }

    const typeTitle = document.createElement("div");
    typeTitle.className = "island-section-title";
    typeTitle.textContent = "Type";

    const typeGroup = document.createElement("div");
    typeGroup.className = "island-btn-group";

    const haBtn = document.createElement("button");
    haBtn.className = `island-group-btn ${edge.label === "ha" ? "active" : ""}`;
    haBtn.type = "button";
    haBtn.textContent = "HA";
    haBtn.onclick = async () => {
      if (edge.label === "ha") return;
      await applyGraph({
        vertices: graph.vertices,
        edges: graph.edges.map((e) => (e.id === edge.id ? { ...e, label: "ha" } : e)),
      });
    };

    const gaBtn = document.createElement("button");
    gaBtn.className = `island-group-btn ${edge.label === "ga" ? "active" : ""}`;
    gaBtn.type = "button";
    gaBtn.textContent = "GA";
    gaBtn.onclick = async () => {
      if (edge.label === "ga") return;
      await applyGraph({
        vertices: graph.vertices,
        edges: graph.edges.map((e) => (e.id === edge.id ? { ...e, label: "ga" } : e)),
      });
    };
    typeGroup.append(haBtn, gaBtn);

    const timeTitle = document.createElement("div");
    timeTitle.className = "island-section-title";
    timeTitle.textContent = "Time";

    const timeList = document.createElement("ul");
    edge.time.forEach((interval, intervalIndex) => {
      const li = document.createElement("li");
      const startInput = document.createElement("input");
      startInput.value = interval[0] ?? "";
      startInput.placeholder = "0";
      const endInput = document.createElement("input");
      endInput.value = interval[1] ?? "";
      endInput.placeholder = "open-ended";
      li.append(labeledField("From", startInput), labeledField("Until", endInput));
      timeList.append(li);

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

    return [styleTitle, styleGroup, typeTitle, typeGroup, timeTitle, timeList];
  }

  function renderSelectedItemIsland() {
    const selected = cy.$(":selected");
    if (selected.length !== 1) {
      hideItemIsland();
      return;
    }
    const element = selected[0];
    activeSelectedItem = element;

    // Close any other open add panels so left side is clean
    paletteIsland.hidden = true;
    edgeIsland.hidden = true;
    toolAddVertex.classList.remove("active");
    toolAddEdge.classList.remove("active");

    const isNode = element.isNode();
    itemIslandTitle.textContent = isNode ? "Vertex" : "Edge";
    itemIslandBody.replaceChildren(...(isNode ? renderNodeFields(element) : renderEdgeFields(element)));
    itemIsland.hidden = false;
  }

  cy.on("select unselect", () => {
    if (activeMode === "edge") return;
    renderSelectedItemIsland();
  });

  let lastStateBeforeDrag = null;
  cy.on("grab", "node", () => {
    lastStateBeforeDrag = snapshotState();
  });

  cy.on("dragfree", "node", () => {
    let moved = false;
    if (lastStateBeforeDrag) {
      for (const node of cy.nodes()) {
        const id = node.id();
        const prev = lastStateBeforeDrag.positions[id];
        const curX = node.position("x");
        const curY = node.position("y");
        if (!prev || Math.abs(prev[0] - curX) > 1 || Math.abs(prev[1] - curY) > 1) {
          moved = true;
          break;
        }
      }
    }
    cy.nodes().forEach((node) => (positions[node.id()] = [node.position("x"), node.position("y")]));
    if (moved && lastStateBeforeDrag) {
      undoStack.push(lastStateBeforeDrag);
      redoStack.length = 0;
      updateUndoRedoButtons();
      debouncedSaveLayout();
    }
    lastStateBeforeDrag = null;
  });

  const graphEl = document.getElementById("graph");
  const toolSelectBtn = document.getElementById("tool-select");
  const toolPanBtn = document.getElementById("tool-pan");
  const previewPath = document.getElementById("edge-preview-path");
  let activeMode = "pan";
  let spacePressed = false;

  function getNodeAt(clientX, clientY) {
    const rect = graphEl.getBoundingClientRect();
    const rx = clientX - rect.left;
    const ry = clientY - rect.top;
    const nodes = cy.nodes();
    for (let i = nodes.length - 1; i >= 0; i--) {
      const box = nodes[i].renderedBoundingBox();
      if (rx >= box.x1 && rx <= box.x2 && ry >= box.y1 && ry <= box.y2) {
        return nodes[i];
      }
    }
    return null;
  }

  function drawPreviewLine(x1, y1, x2, y2, style) {
    let d = "";
    if (style === "straight") {
      d = `M ${x1} ${y1} L ${x2} ${y2}`;
    } else if (style === "taxi") {
      const midX = (x1 + x2) / 2;
      d = `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`;
    } else {
      const dx = x2 - x1;
      const dy = y2 - y1;
      const cx = (x1 + x2) / 2 - dy * 0.15;
      const cyPt = (y1 + y2) / 2 + dx * 0.15;
      d = `M ${x1} ${y1} Q ${cx} ${cyPt} ${x2} ${y2}`;
    }
    previewPath.setAttribute("d", d);
    previewPath.hidden = false;
  }

  function hidePreviewLine() {
    if (previewPath) {
      previewPath.hidden = true;
      previewPath.setAttribute("d", "");
    }
  }

  let edgeDragSource = null;
  let edgeDragTarget = null;
  let hoveredNode = null;
  let isDraggingEdge = false;

  function clearEdgeHighlights() {
    if (edgeDragSource) edgeDragSource.removeClass("edge-hover");
    if (edgeDragTarget) edgeDragTarget.removeClass("edge-hover");
    if (hoveredNode) hoveredNode.removeClass("edge-hover");
    edgeDragSource = null;
    edgeDragTarget = null;
    hoveredNode = null;
  }

  graphEl.addEventListener("pointerdown", (evt) => {
    if (activeMode !== "edge") return;
    if (evt.button !== 0) return;
    const node = getNodeAt(evt.clientX, evt.clientY);
    if (!node) return;

    evt.preventDefault();
    evt.stopPropagation();
    isDraggingEdge = true;
    edgeDragSource = node;
    node.addClass("edge-hover");
    cy.elements().unselect();
    hideFloatingToolbar();
  });

  window.addEventListener("pointermove", (evt) => {
    if (activeMode !== "edge") return;

    if (isDraggingEdge && edgeDragSource) {
      evt.preventDefault();
      const rect = graphEl.getBoundingClientRect();
      const curX = evt.clientX - rect.left;
      const curY = evt.clientY - rect.top;

      const srcBox = edgeDragSource.renderedBoundingBox();
      const x1 = (srcBox.x1 + srcBox.x2) / 2;
      const y1 = (srcBox.y1 + srcBox.y2) / 2;

      const hit = getNodeAt(evt.clientX, evt.clientY);
      if (hit && hit.id() !== edgeDragSource.id()) {
        if (edgeDragTarget && edgeDragTarget.id() !== hit.id()) {
          edgeDragTarget.removeClass("edge-hover");
        }
        hit.addClass("edge-hover");
        edgeDragTarget = hit;
        const tgtBox = hit.renderedBoundingBox();
        const x2 = (tgtBox.x1 + tgtBox.x2) / 2;
        const y2 = (tgtBox.y1 + tgtBox.y2) / 2;
        drawPreviewLine(x1, y1, x2, y2, selectedEdgeStyle);
      } else {
        if (edgeDragTarget) {
          edgeDragTarget.removeClass("edge-hover");
          edgeDragTarget = null;
        }
        drawPreviewLine(x1, y1, curX, curY, selectedEdgeStyle);
      }
    } else {
      const hit = getNodeAt(evt.clientX, evt.clientY);
      if (hit !== hoveredNode) {
        if (hoveredNode) hoveredNode.removeClass("edge-hover");
        if (hit) {
          cy.elements().unselect();
          hit.addClass("edge-hover");
        }
        hoveredNode = hit;
      }
    }
  });

  window.addEventListener("pointerup", (evt) => {
    if (!isDraggingEdge) return;
    isDraggingEdge = false;
    hidePreviewLine();

    const src = edgeDragSource;
    const tgt = edgeDragTarget;
    clearEdgeHighlights();

    if (src && tgt && src.id() !== tgt.id()) {
      tryAddEdge(src.id(), tgt.id(), selectedEdgeStyle, selectedEdgeType, getSelectedEdgeTime());
      closeAddPanels();
    }
  });

  function applyMode() {
    const isPan = spacePressed || activeMode === "pan";
    const isEdge = activeMode === "edge";
    cy.userPanningEnabled(isPan);
    cy.boxSelectionEnabled(!isPan && !isEdge);
    cy.autoungrabify(isEdge);
    graphEl.classList.toggle("mode-pan", isPan);
    graphEl.classList.toggle("mode-select", !isPan && !isEdge);
    graphEl.classList.toggle("mode-edge", isEdge && !spacePressed);
  }

  function setMode(mode) {
    activeMode = mode;
    toolSelectBtn.classList.toggle("active", mode === "select");
    toolPanBtn.classList.toggle("active", mode === "pan");
    toolAddEdge.classList.toggle("active", mode === "edge");
    if (mode !== "edge") {
      clearEdgeHighlights();
      hidePreviewLine();
    }
    applyMode();
  }

  toolSelectBtn.onclick = () => {
    closeAddPanels();
    setMode("select");
  };
  toolPanBtn.onclick = () => {
    closeAddPanels();
    setMode("pan");
  };
  setMode("pan");

  const detachKeyboardShortcuts = attachKeyboardShortcuts({
    cy,
    onUndo: () => undoButton.click(),
    onRedo: () => redoButton.click(),
    onDuplicate: tryDuplicateSelected,
    onDelete: tryDeleteSelected,
    onEscape: () => {
      hideItemIsland();
      cy.elements().unselect();
      hamburgerMenu.hidden = true;
      closeAddPanels();
      issuesDialog.hidden = true;
    },
    onSelectMode: () => setMode("select"),
    onPanMode: () => setMode("pan"),
    onSpaceDown: () => {
      spacePressed = true;
      applyMode();
    },
    onSpaceUp: () => {
      spacePressed = false;
      applyMode();
    },
  });

  window.addEventListener("beforeunload", () => {
    debouncedSaveGraph.flush();
    debouncedSaveLayout.flush();
  });

  const graphNameEl = document.getElementById("graph-name");
  graphNameEl.textContent = graphName;

  const hamburgerBtn = document.getElementById("btn-hamburger");
  const hamburgerMenu = document.getElementById("hamburger-menu");
  const menuHomeBtn = document.getElementById("menu-home");
  const menuRenameBtn = document.getElementById("menu-rename");
  const menuIssuesBtn = document.getElementById("menu-issues");
  const menuMetaEl = document.getElementById("menu-meta");

  hamburgerBtn.onclick = (evt) => {
    evt.stopPropagation();
    hamburgerMenu.hidden = !hamburgerMenu.hidden;
  };
  document.addEventListener("click", () => {
    hamburgerMenu.hidden = true;
  });
  hamburgerMenu.addEventListener("click", (evt) => evt.stopPropagation());

  menuHomeBtn.onclick = () => {
    hamburgerMenu.hidden = true;
    detachKeyboardShortcuts();
    cy.destroy();
    onExit();
  };

  menuRenameBtn.onclick = async () => {
    hamburgerMenu.hidden = true;
    const newName = await modalPrompt("New name for this graph:", graphName, "Rename graph");
    if (!newName || newName === graphName) return;
    const response = await fetch(`/api/graphs/${graphName}/rename`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ new_name: newName }),
    });
    if (!response.ok) {
      await modalAlert((await response.json()).detail, "Rename failed");
      return;
    }
    graphName = newName;
    graphNameEl.textContent = graphName;
    onRename(graphName);
  };

  menuIssuesBtn.onclick = () => {
    hamburgerMenu.hidden = true;
    issuesDialog.hidden = !issuesDialog.hidden;
  };

  const graphs = await fetch("/api/graphs").then((response) => response.json());
  const thisGraph = graphs.find((graphEntry) => graphEntry.name === graphName);
  if (thisGraph) {
    menuMetaEl.textContent = `Created ${new Date(thisGraph.created * 1000).toLocaleString()}`;
  }

  await refreshViolations();
}
