import { CanvasSvg } from "./canvas-svg.js";
import { renderPalette } from "./palette.js";
import { showContextMenu } from "./contextmenu.js";
import { topLevelKind, inferredEdgeLabel, nextId, validateGraph, debounce, computeDefaultLayout } from "./graph-utils.js";
import { attachKeyboardShortcuts } from "./keyboard-shortcuts.js";
import { AUTOSAVE_DEBOUNCE_MS, DUPLICATE_OFFSET, BASE_ZOOM } from "./constants.js";
import { modalAlert, modalPrompt } from "./modal.js";

export async function openEditor(graphName, labelSet, { onExit, onRename }) {
  let graph = await fetch(`/api/graphs/${graphName}`).then((response) => response.json());
  const rawLayout = await fetch(`/api/graphs/${graphName}/layout`).then((response) => response.json());
  const positions = rawLayout.positions ?? {};
  if (!Object.keys(positions).length && graph.vertices.length > 0) {
    Object.assign(positions, computeDefaultLayout(graph.vertices, graph.edges));
  }
  const edgeStyles = rawLayout.edge_styles ?? {};
  const sizes = rawLayout.sizes ?? {};
  const edgeEndpoints = rawLayout.edge_endpoints ?? {};
  const edgeElbows = rawLayout.edge_elbows ?? {};

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
    for (const id of Object.keys(edgeEndpoints)) {
      if (!validEdgeIds.has(id)) delete edgeEndpoints[id];
    }
    for (const id of Object.keys(edgeElbows)) {
      if (!validEdgeIds.has(id)) delete edgeElbows[id];
    }
    fetch(`/api/graphs/${graphName}/layout`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        positions,
        edge_styles: edgeStyles,
        sizes,
        edge_endpoints: edgeEndpoints,
        edge_elbows: edgeElbows,
      }),
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

  function snapshotState() {
    return {
      graph: JSON.parse(JSON.stringify(graph)),
      positions: JSON.parse(JSON.stringify(positions)),
      sizes: JSON.parse(JSON.stringify(sizes)),
      edgeStyles: JSON.parse(JSON.stringify(edgeStyles)),
      edgeEndpoints: JSON.parse(JSON.stringify(edgeEndpoints)),
      edgeElbows: JSON.parse(JSON.stringify(edgeElbows)),
    };
  }

  function restoreState(state) {
    graph = JSON.parse(JSON.stringify(state.graph));
    for (const key of Object.keys(positions)) delete positions[key];
    Object.assign(positions, JSON.parse(JSON.stringify(state.positions)));
    for (const key of Object.keys(sizes)) delete sizes[key];
    Object.assign(sizes, JSON.parse(JSON.stringify(state.sizes)));
    for (const key of Object.keys(edgeStyles)) delete edgeStyles[key];
    Object.assign(edgeStyles, JSON.parse(JSON.stringify(state.edgeStyles)));
    for (const key of Object.keys(edgeEndpoints)) delete edgeEndpoints[key];
    Object.assign(edgeEndpoints, JSON.parse(JSON.stringify(state.edgeEndpoints ?? {})));
    for (const key of Object.keys(edgeElbows)) delete edgeElbows[key];
    Object.assign(edgeElbows, JSON.parse(JSON.stringify(state.edgeElbows ?? {})));

    rerender();
    refreshViolations();
    debouncedSaveGraph();
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

  let activeSelectedItem = null;
  let lastStateBeforeDrag = null;
  let resizeStartState = null;

  const canvas = new CanvasSvg(document.getElementById("canvas-svg"), {
    onSelectionChange: (selection) => {
      if (activeMode === "edge") return;
      if (selection.nodes.length === 1 && selection.edges.length === 0) {
        activeSelectedItem = { type: "node", id: selection.nodes[0] };
        renderSelectedItemIsland();
      } else if (selection.edges.length === 1 && selection.nodes.length === 0) {
        activeSelectedItem = { type: "edge", id: selection.edges[0] };
        renderSelectedItemIsland();
      } else {
        hideItemIsland();
      }
    },
    onNodeDragStart: () => {
      lastStateBeforeDrag = snapshotState();
    },
    onNodeDragEnd: (moved) => {
      if (moved && lastStateBeforeDrag) {
        undoStack.push(lastStateBeforeDrag);
        redoStack.length = 0;
        updateUndoRedoButtons();
        debouncedSaveLayout();
      }
      lastStateBeforeDrag = null;
    },
    onNodeResizeStart: () => {
      resizeStartState = snapshotState();
    },
    onNodeResizeEnd: (vertexId, width, height, x, y) => {
      const prev = resizeStartState?.sizes[vertexId];
      const prevPos = resizeStartState?.positions[vertexId];
      const changed =
        !prev ||
        prev[0] !== width ||
        prev[1] !== height ||
        !prevPos ||
        prevPos[0] !== x ||
        prevPos[1] !== y;
      sizes[vertexId] = [width, height];
      positions[vertexId] = [x, y];
      if (changed && resizeStartState) {
        undoStack.push(resizeStartState);
        redoStack.length = 0;
        updateUndoRedoButtons();
      }
      resizeStartState = null;
      debouncedSaveLayout();
      if (activeSelectedItem && activeSelectedItem.id === vertexId) {
        renderSelectedItemIsland();
      }
    },
    onEdgeElbowStart: () => {
      lastStateBeforeDrag = snapshotState();
    },
    onEdgeElbowEnd: (edgeId, val) => {
      if (lastStateBeforeDrag) {
        undoStack.push(lastStateBeforeDrag);
        redoStack.length = 0;
        updateUndoRedoButtons();
        edgeElbows[edgeId] = val;
        debouncedSaveLayout();
        if (activeSelectedItem && activeSelectedItem.id === edgeId) {
          renderSelectedItemIsland();
        }
      }
      lastStateBeforeDrag = null;
    },
    onEdgeEndpointChange: async (edgeId, end, targetNodeId, relPos) => {
      const edge = graph.edges.find((e) => e.id === edgeId);
      if (!edge) return;
      const isSameNode = (end === "src" && edge.src === targetNodeId) || (end === "tgt" && edge.tgt === targetNodeId);

      if (isSameNode) {
        undoStack.push(snapshotState());
        redoStack.length = 0;
        updateUndoRedoButtons();
        edgeEndpoints[edgeId] ??= {};
        edgeEndpoints[edgeId][end] = relPos;
        canvas.setData({
          vertices: graph.vertices,
          edges: graph.edges,
          positions,
          sizes,
          edgeStyles,
          edgeEndpoints,
          edgeElbows,
          labelSet,
        });
        debouncedSaveLayout();
        if (activeSelectedItem && activeSelectedItem.id === edgeId) {
          renderSelectedItemIsland();
        }
      } else {
        const updated = end === "src" ? { ...edge, src: targetNodeId } : { ...edge, tgt: targetNodeId };
        const srcVertex = graph.vertices.find((v) => v.id === updated.src);
        const tgtVertex = graph.vertices.find((v) => v.id === updated.tgt);
        if (!srcVertex || !tgtVertex) return;
        const newLabel = inferredEdgeLabel(labelSet, srcVertex.label, tgtVertex.label);
        if (!newLabel) {
          await modalAlert("No edge rule matches that reconnection", "Invalid connection");
          canvas.render();
          return;
        }
        undoStack.push(snapshotState());
        redoStack.length = 0;
        updateUndoRedoButtons();
        edgeEndpoints[edgeId] ??= {};
        edgeEndpoints[edgeId][end] = relPos;
        updated.label = newLabel;
        graph = {
          vertices: graph.vertices,
          edges: graph.edges.map((e) => (e.id === edgeId ? updated : e)),
        };
        rerender();
        debouncedSaveGraph();
        debouncedSaveLayout();
        canvas.select(edgeId, "edge");
      }
    },
    onEdgeConnect: async (sourceId, targetId, srcRel, tgtRel) => {
      const ok = await tryAddEdge(sourceId, targetId, selectedEdgeStyle, selectedEdgeType, getSelectedEdgeTime(), srcRel, tgtRel);
      if (ok) {
        closeAddPanels();
      }
    },
    onContextMenuNode: (nodeId, clientX, clientY) => {
      showContextMenu(clientX, clientY, [
        { label: "Delete", onClick: () => tryDeleteVertex(nodeId) },
      ]);
    },
    onContextMenuEdge: (edgeId, clientX, clientY) => {
      showContextMenu(clientX, clientY, [
        { label: "Delete", onClick: () => tryDeleteEdge(edgeId) },
        { label: "Straight", onClick: () => setEdgeStyle(edgeId, "straight") },
        { label: "Elbow", onClick: () => setEdgeStyle(edgeId, "taxi") },
        { label: "Curved", onClick: () => setEdgeStyle(edgeId, "bezier") },
      ]);
    },
    onZoomChange: () => updateZoomText(),
  });

  function rerender() {
    hideItemIsland();
    if (!Object.keys(positions).length && graph.vertices.length > 0) {
      Object.assign(positions, computeDefaultLayout(graph.vertices, graph.edges));
    }
    canvas.setData({
      vertices: graph.vertices,
      edges: graph.edges,
      positions,
      sizes,
      edgeStyles,
      edgeEndpoints,
      edgeElbows,
      labelSet,
    });
  }

  async function tryAddVertex(label) {
    const id = nextId(new Set(graph.vertices.map((vertex) => vertex.id)), label);
    positions[id] = canvas.getViewCenter();
    await applyGraph({ vertices: [...graph.vertices, { id, label }], edges: graph.edges });
    debouncedSaveLayout();
  }

  async function tryAddEdge(
    sourceId,
    targetId,
    style = selectedEdgeStyle,
    type = selectedEdgeType,
    time = getSelectedEdgeTime(),
    srcRel = null,
    tgtRel = null
  ) {
    const existingIds = new Set(graph.edges.map((edge) => edge.id));
    const id = nextId(existingIds, "e");
    const sourceVertex = graph.vertices.find((vertex) => vertex.id === sourceId);
    const targetVertex = graph.vertices.find((vertex) => vertex.id === targetId);
    if (!sourceVertex || !targetVertex) return false;
    const label = type || inferredEdgeLabel(labelSet, sourceVertex.label, targetVertex.label);
    if (!label) {
      await modalAlert(`no edge rule matches ${sourceVertex.label} -> ${targetVertex.label}`, "Invalid connection");
      return false;
    }
    edgeStyles[id] = style;
    if (srcRel || tgtRel) {
      edgeEndpoints[id] = {
        ...(srcRel ? { src: srcRel } : {}),
        ...(tgtRel ? { tgt: tgtRel } : {}),
      };
    }
    const edge = { id, src: sourceId, tgt: targetId, label, time: time ?? [[0, null]] };
    const ok = await applyGraph({ vertices: graph.vertices, edges: [...graph.edges, edge] });
    if (ok) {
      canvas.select(id, "edge");
    }
    debouncedSaveLayout();
    return ok;
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
    delete edgeEndpoints[edgeId];
    delete edgeElbows[edgeId];
    await applyGraph({ vertices: graph.vertices, edges: graph.edges.filter((edge) => edge.id !== edgeId) });
    debouncedSaveLayout();
  }

  async function tryDeleteSelected() {
    const selected = canvas.getSelected();
    const selectedNodeIds = new Set(selected.nodes);
    const selectedEdgeIds = new Set(selected.edges);
    if (selectedNodeIds.size === 0 && selectedEdgeIds.size === 0) return;

    for (const nodeId of selectedNodeIds) {
      delete positions[nodeId];
      delete sizes[nodeId];
    }
    for (const edgeId of selectedEdgeIds) {
      delete edgeStyles[edgeId];
      delete edgeEndpoints[edgeId];
      delete edgeElbows[edgeId];
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
      canvas.select(id, "node");
    }
  }

  async function tryDuplicateEdge(edgeId) {
    const original = graph.edges.find((edge) => edge.id === edgeId);
    if (!original) return;
    const id = nextId(new Set(graph.edges.map((edge) => edge.id)), "e");
    if (edgeStyles[edgeId]) edgeStyles[id] = edgeStyles[edgeId];
    if (edgeEndpoints[edgeId]) edgeEndpoints[id] = JSON.parse(JSON.stringify(edgeEndpoints[edgeId]));
    if (edgeElbows[edgeId]) edgeElbows[id] = edgeElbows[edgeId];
    const ok = await applyGraph({ vertices: graph.vertices, edges: [...graph.edges, { ...original, id }] });
    if (ok) {
      debouncedSaveLayout();
      canvas.select(id, "edge");
    }
  }

  async function tryDuplicateSelected() {
    const selected = canvas.getSelected();
    if (selected.nodes.length === 1 && selected.edges.length === 0) {
      await tryDuplicateVertex(selected.nodes[0]);
    } else if (selected.edges.length === 1 && selected.nodes.length === 0) {
      await tryDuplicateEdge(selected.edges[0]);
    }
  }

  async function tryRenameVertex(oldId, newId) {
    if (!newId || newId === oldId) return;
    if (graph.vertices.some((vertex) => vertex.id === newId)) {
      await modalAlert(`A vertex named "${newId}" already exists`, "Duplicate vertex");
      return;
    }
    if (positions[oldId]) {
      positions[newId] = positions[oldId];
      delete positions[oldId];
    }
    if (sizes[oldId]) {
      sizes[newId] = sizes[oldId];
      delete sizes[oldId];
    }
    await applyGraph({
      vertices: graph.vertices.map((vertex) => (vertex.id === oldId ? { ...vertex, id: newId } : vertex)),
      edges: graph.edges.map((edge) => ({
        ...edge,
        src: edge.src === oldId ? newId : edge.src,
        tgt: edge.tgt === oldId ? newId : edge.tgt,
      })),
    });
    debouncedSaveLayout();
    canvas.select(newId, "node");
  }

  async function tryChangeVertexLabel(vertexId, newLabel) {
    await applyGraph({
      vertices: graph.vertices.map((vertex) => (vertex.id === vertexId ? { ...vertex, label: newLabel } : vertex)),
      edges: graph.edges,
    });
    canvas.select(vertexId, "node");
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
    canvas.setActiveEdgeStyle(style);
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
    toolAddVertex.classList.remove("active");
    toolAddEdge.classList.remove("active");
    if (activeMode === "edge") {
      setMode(previousMode || "pan");
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
    zoomResetBtn.textContent = `${Math.round((canvas.getZoom() / BASE_ZOOM) * 100)}%`;
  }
  zoomOutBtn.onclick = () => canvas.zoomOut();
  zoomInBtn.onclick = () => canvas.zoomIn();
  zoomResetBtn.onclick = () => canvas.resetZoom();
  updateZoomText();

  function setEdgeStyle(edgeId, style) {
    if (edgeStyles[edgeId] === style) return;
    undoStack.push(snapshotState());
    redoStack.length = 0;
    updateUndoRedoButtons();
    edgeStyles[edgeId] = style;
    canvas.setData({
      vertices: graph.vertices,
      edges: graph.edges,
      positions,
      sizes,
      edgeStyles,
      edgeEndpoints,
      edgeElbows,
      labelSet,
    });
    debouncedSaveLayout();
    if (activeSelectedItem && activeSelectedItem.id === edgeId) {
      renderSelectedItemIsland();
    }
  }

  function hideItemIsland() {
    activeSelectedItem = null;
    itemIsland.hidden = true;
    itemIslandBody.replaceChildren();
  }

  itemIslandCloseBtn.onclick = () => {
    hideItemIsland();
    canvas.clearSelection();
  };

  itemIslandDuplicateBtn.onclick = () => {
    if (!activeSelectedItem) return;
    if (activeSelectedItem.type === "node") {
      tryDuplicateVertex(activeSelectedItem.id);
    } else if (activeSelectedItem.type === "edge") {
      tryDuplicateEdge(activeSelectedItem.id);
    }
  };

  itemIslandDeleteBtn.onclick = () => {
    if (!activeSelectedItem) return;
    if (activeSelectedItem.type === "node") {
      tryDeleteVertex(activeSelectedItem.id);
    } else if (activeSelectedItem.type === "edge") {
      tryDeleteEdge(activeSelectedItem.id);
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

  function renderNodeFields(vertex) {
    const nameInput = document.createElement("input");
    nameInput.value = vertex.id;
    nameInput.onchange = () => tryRenameVertex(vertex.id, nameInput.value.trim());

    const labelSelect = document.createElement("select");
    for (const label of ALL_VERTEX_LABELS) {
      const option = document.createElement("option");
      option.value = label;
      option.textContent = label;
      option.selected = label === vertex.label;
      labelSelect.append(option);
    }
    labelSelect.onchange = () => tryChangeVertexLabel(vertex.id, labelSelect.value);

    return [labeledField("Name", nameInput), labeledField("Label", labelSelect)];
  }

  function renderEdgeFields(edge) {
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

    const fields = [styleTitle, styleGroup];

    // Elbow position if taxi style
    if (currentStyle === "taxi") {
      const elbowTitle = document.createElement("div");
      elbowTitle.className = "island-section-title";
      elbowTitle.textContent = "Elbow Offset";

      const elbowInput = document.createElement("input");
      elbowInput.type = "number";
      elbowInput.value = edgeElbows[edge.id] ?? "";
      elbowInput.placeholder = "auto";
      elbowInput.onchange = () => {
        undoStack.push(snapshotState());
        redoStack.length = 0;
        updateUndoRedoButtons();
        const val = elbowInput.value.trim();
        if (val === "") {
          delete edgeElbows[edge.id];
        } else {
          edgeElbows[edge.id] = Number(val);
        }
        canvas.setData({
          vertices: graph.vertices,
          edges: graph.edges,
          positions,
          sizes,
          edgeStyles,
          edgeEndpoints,
          edgeElbows,
          labelSet,
        });
        debouncedSaveLayout();
      };

      const resetElbowBtn = document.createElement("button");
      resetElbowBtn.className = "island-action-btn";
      resetElbowBtn.type = "button";
      resetElbowBtn.textContent = "Reset elbow to center";
      resetElbowBtn.onclick = () => {
        undoStack.push(snapshotState());
        redoStack.length = 0;
        updateUndoRedoButtons();
        delete edgeElbows[edge.id];
        canvas.setData({
          vertices: graph.vertices,
          edges: graph.edges,
          positions,
          sizes,
          edgeStyles,
          edgeEndpoints,
          edgeElbows,
          labelSet,
        });
        debouncedSaveLayout();
        renderSelectedItemIsland();
      };

      fields.push(elbowTitle, labeledField("Pos", elbowInput), resetElbowBtn);
    }

    // Endpoints metadata
    const endpointsTitle = document.createElement("div");
    endpointsTitle.className = "island-section-title";
    endpointsTitle.textContent = "Endpoints";

    const customEp = edgeEndpoints[edge.id];
    const srcRow = document.createElement("div");
    srcRow.className = "island-meta-row";
    srcRow.innerHTML = `<span>From: <strong>${edge.src}</strong></span><span>${customEp?.src ? "custom" : "auto"}</span>`;

    const tgtRow = document.createElement("div");
    tgtRow.className = "island-meta-row";
    tgtRow.innerHTML = `<span>To: <strong>${edge.tgt}</strong></span><span>${customEp?.tgt ? "custom" : "auto"}</span>`;

    const resetEpBtn = document.createElement("button");
    resetEpBtn.className = "island-action-btn";
    resetEpBtn.type = "button";
    resetEpBtn.textContent = "Reset endpoints to auto";
    resetEpBtn.onclick = () => {
      undoStack.push(snapshotState());
      redoStack.length = 0;
      updateUndoRedoButtons();
      delete edgeEndpoints[edge.id];
      canvas.setData({
        vertices: graph.vertices,
        edges: graph.edges,
        positions,
        sizes,
        edgeStyles,
        edgeEndpoints,
        edgeElbows,
        labelSet,
      });
      debouncedSaveLayout();
      renderSelectedItemIsland();
    };

    fields.push(endpointsTitle, srcRow, tgtRow, resetEpBtn);

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
      canvas.select(edge.id, "edge");
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
      canvas.select(edge.id, "edge");
    };
    typeGroup.append(haBtn, gaBtn);
    fields.push(typeTitle, typeGroup);

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
        canvas.select(edge.id, "edge");
      }
      startInput.onchange = commit;
      endInput.onchange = commit;
    });
    fields.push(timeTitle, timeList);

    return fields;
  }

  function renderSelectedItemIsland() {
    if (!activeSelectedItem) {
      hideItemIsland();
      return;
    }

    paletteIsland.hidden = true;
    edgeIsland.hidden = true;
    toolAddVertex.classList.remove("active");
    toolAddEdge.classList.remove("active");

    if (activeSelectedItem.type === "node") {
      const vertex = graph.vertices.find((v) => v.id === activeSelectedItem.id);
      if (!vertex) {
        hideItemIsland();
        return;
      }
      itemIslandTitle.textContent = "Vertex";
      itemIslandBody.replaceChildren(...renderNodeFields(vertex));
      itemIsland.hidden = false;
    } else if (activeSelectedItem.type === "edge") {
      const edge = graph.edges.find((e) => e.id === activeSelectedItem.id);
      if (!edge) {
        hideItemIsland();
        return;
      }
      itemIslandTitle.textContent = "Edge";
      itemIslandBody.replaceChildren(...renderEdgeFields(edge));
      itemIsland.hidden = false;
    }
  }

  const toolSelectBtn = document.getElementById("tool-select");
  const toolPanBtn = document.getElementById("tool-pan");
  let activeMode = "pan";
  let previousMode = "pan";
  let spacePressed = false;

  function applyMode() {
    canvas.setMode(activeMode);
    canvas.setSpacePressed(spacePressed);
  }

  function setMode(mode) {
    if (activeMode !== "edge" && mode === "edge") {
      previousMode = activeMode;
    }
    activeMode = mode;
    toolSelectBtn.classList.toggle("active", mode === "select");
    toolPanBtn.classList.toggle("active", mode === "pan");
    toolAddEdge.classList.toggle("active", mode === "edge");
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
    onSelectAll: () => canvas.selectAll(),
    onUndo: () => undoButton.click(),
    onRedo: () => redoButton.click(),
    onDuplicate: tryDuplicateSelected,
    onDelete: tryDeleteSelected,
    onEscape: () => {
      hideItemIsland();
      canvas.clearSelection();
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
    canvas.destroy();
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

  rerender();
  canvas.resetZoom();
  await refreshViolations();
}
