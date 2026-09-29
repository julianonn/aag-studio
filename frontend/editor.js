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

  const floatingToolbarEl = document.createElement("div");
  floatingToolbarEl.className = "floating-toolbar";
  floatingToolbarEl.hidden = true;
  // Stop mousedown bubbling so Cytoscape does not treat toolbar interaction as a background tap
  floatingToolbarEl.addEventListener("mousedown", (evt) => evt.stopPropagation());
  document.getElementById("graph").append(floatingToolbarEl);

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
    hideFloatingToolbar();
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

  async function tryAddEdge(sourceId, targetId, style = selectedEdgeStyle) {
    const existingIds = new Set(graph.edges.map((edge) => edge.id));
    const id = nextId(existingIds, "e");
    const sourceVertex = graph.vertices.find((vertex) => vertex.id === sourceId);
    const targetVertex = graph.vertices.find((vertex) => vertex.id === targetId);
    if (!sourceVertex || !targetVertex) return;
    const label = inferredEdgeLabel(labelSet, sourceVertex.label, targetVertex.label);
    if (!label) {
      await modalAlert(`no edge rule matches ${sourceVertex.label} -> ${targetVertex.label}`, "Invalid connection");
      return;
    }
    edgeStyles[id] = style;
    const edge = { id, src: sourceId, tgt: targetId, label, time: [[0, null]] };
    await applyGraph({ vertices: graph.vertices, edges: [...graph.edges, edge] });
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
  }

  const paletteIsland = document.getElementById("palette-island");
  const paletteCloseBtn = document.getElementById("palette-close");
  const edgeIsland = document.getElementById("edge-island");
  const edgeCloseBtn = document.getElementById("edge-close");
  const edgeInstruction = document.getElementById("edge-instruction");
  const styleBezierBtn = document.getElementById("style-bezier");
  const styleTaxiBtn = document.getElementById("style-taxi");
  const styleStraightBtn = document.getElementById("style-straight");
  const toolAddVertex = document.getElementById("tool-add-vertex");
  const toolAddEdge = document.getElementById("tool-add-edge");

  let selectedEdgeStyle = "bezier";
  let edgeSourceNode = null;

  function setEdgeCurveStyle(style) {
    selectedEdgeStyle = style;
    styleBezierBtn.classList.toggle("active", style === "bezier");
    styleTaxiBtn.classList.toggle("active", style === "taxi");
    styleStraightBtn.classList.toggle("active", style === "straight");
  }
  styleBezierBtn.onclick = () => setEdgeCurveStyle("bezier");
  styleTaxiBtn.onclick = () => setEdgeCurveStyle("taxi");
  styleStraightBtn.onclick = () => setEdgeCurveStyle("straight");

  function closeAddPanels() {
    paletteIsland.hidden = true;
    edgeIsland.hidden = true;
    toolAddVertex.classList.remove("active");
    toolAddEdge.classList.remove("active");
    if (edgeSourceNode) {
      edgeSourceNode.unselect();
      edgeSourceNode = null;
    }
    edgeInstruction.textContent = "Click a source node, then click a target node to connect.";
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
    const shouldOpen = edgeIsland.hidden;
    closeAddPanels();
    if (shouldOpen) {
      edgeIsland.hidden = false;
      toolAddEdge.classList.add("active");
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

  attachSelectionHandles(cy, eh, document.getElementById("graph"), {
    onConnect: tryAddEdge,
    onReconnect: tryReconnectEdge,
    onResize: (vertexId, width, height, x, y) => {
      const oldSize = sizes[vertexId];
      const oldPos = positions[vertexId];
      const changed = !oldSize || oldSize[0] !== width || oldSize[1] !== height ||
                      !oldPos || oldPos[0] !== x || oldPos[1] !== y;
      if (changed) {
        undoStack.push(snapshotState());
        redoStack.length = 0;
        updateUndoRedoButtons();
      }
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
    if (edgeStyles[edgeId] === style) return;
    undoStack.push(snapshotState());
    redoStack.length = 0;
    updateUndoRedoButtons();
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
    duplicateButton.innerHTML = '<i class="mdi mdi-content-copy"></i>';
    duplicateButton.onclick = () => (isNode ? tryDuplicateVertex(element.id()) : tryDuplicateEdge(element.id()));

    const deleteButton = document.createElement("button");
    deleteButton.title = "Delete";
    deleteButton.innerHTML = '<i class="mdi mdi-delete-outline"></i>';
    deleteButton.onclick = () => (isNode ? tryDeleteVertex(element.id()) : tryDeleteEdge(element.id()));

    const metadataEl = document.createElement("div");
    metadataEl.hidden = true;
    metadataEl.append(...(isNode ? renderNodeMetadata(element) : renderEdgeMetadata(element)));

    const moreButton = document.createElement("button");
    moreButton.title = "More";
    moreButton.innerHTML = '<i class="mdi mdi-dots-vertical"></i>';
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

  cy.on("tap", "node, edge", (evt) => {
    if (!edgeIsland.hidden && evt.target.isNode()) {
      const clickedNode = evt.target;
      if (!edgeSourceNode) {
        edgeSourceNode = clickedNode;
        clickedNode.select();
        edgeInstruction.textContent = `Source: ${clickedNode.id()}. Now click target node.`;
      } else {
        const sourceId = edgeSourceNode.id();
        const targetId = clickedNode.id();
        edgeSourceNode.unselect();
        edgeSourceNode = null;
        edgeInstruction.textContent = "Click a source node, then click a target node to connect.";
        tryAddEdge(sourceId, targetId, selectedEdgeStyle);
      }
      return;
    }

    if (cy.$(":selected").length <= 1) {
      renderFloatingToolbar(evt.target);
    } else {
      hideFloatingToolbar();
    }
  });
  cy.on("tap", (evt) => {
    if (evt.target === cy) {
      hideFloatingToolbar();
      if (edgeSourceNode) {
        edgeSourceNode.unselect();
        edgeSourceNode = null;
        edgeInstruction.textContent = "Click a source node, then click a target node to connect.";
      }
    }
  });
  cy.on("pan zoom position", () => {
    if (activeToolbarTarget) positionFloatingToolbar(activeToolbarTarget);
  });
  window.addEventListener("resize", () => {
    if (activeToolbarTarget) positionFloatingToolbar(activeToolbarTarget);
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
  let activeMode = "pan";
  let spacePressed = false;

  function applyMode() {
    const isPan = spacePressed || activeMode === "pan";
    cy.userPanningEnabled(isPan);
    cy.boxSelectionEnabled(!isPan);
    graphEl.classList.toggle("mode-pan", isPan);
    graphEl.classList.toggle("mode-select", !isPan);
  }

  function setMode(mode) {
    activeMode = mode;
    toolSelectBtn.classList.toggle("active", mode === "select");
    toolPanBtn.classList.toggle("active", mode === "pan");
    applyMode();
  }

  toolSelectBtn.onclick = () => setMode("select");
  toolPanBtn.onclick = () => setMode("pan");
  setMode("pan");

  const detachKeyboardShortcuts = attachKeyboardShortcuts({
    cy,
    onUndo: () => undoButton.click(),
    onRedo: () => redoButton.click(),
    onDelete: tryDeleteSelected,
    onEscape: () => {
      hideFloatingToolbar();
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
