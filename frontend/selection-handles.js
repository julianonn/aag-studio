import { MIN_NODE_SIZE } from "./constants.js";

function screenToModel(cy, containerEl, clientX, clientY) {
  const rect = containerEl.getBoundingClientRect();
  const zoom = cy.zoom();
  const pan = cy.pan();
  return { x: (clientX - rect.left - pan.x) / zoom, y: (clientY - rect.top - pan.y) / zoom };
}

function createConnectionHandle(container) {
  const el = document.createElement("div");
  el.className = "edge-handle";
  el.hidden = true;
  container.append(el);
  return el;
}

function makeResizeHandle(container, corner) {
  const el = document.createElement("div");
  el.className = `resize-handle ${corner}`;
  el.hidden = true;
  container.append(el);
  return el;
}

export function attachSelectionHandles(cy, eh, containerEl, { onConnect, onReconnect, onResizeStart, onResize }) {
  let hoveredNode = null;
  let dragging = false;

  cy.on("mouseover", "node", (evt) => {
    if (dragging) hoveredNode = evt.target;
  });
  cy.on("mouseout", "node", () => {
    if (dragging) hoveredNode = null;
  });

  function driveEdgeGesture(sourceNode, onComplete) {
    dragging = true;
    eh.start(sourceNode);

    function onMouseMove(evt) {
      eh.update(screenToModel(cy, containerEl, evt.clientX, evt.clientY));
    }

    function onMouseUp() {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      eh.stop();
      dragging = false;
      const target = hoveredNode && !hoveredNode.same(sourceNode) ? hoveredNode : null;
      hoveredNode = null;
      onComplete(target ? target.id() : null);
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }

  // edgehandles drags source -> target; to move the source end, anchor on target and swap endpoints on reconnect
  const sourceHandle = createConnectionHandle(containerEl);
  const targetHandle = createConnectionHandle(containerEl);
  let selectedEdge = null;

  function positionReconnectHandles(edge) {
    const srcEndpoint = edge.renderedSourceEndpoint();
    const tgtEndpoint = edge.renderedTargetEndpoint();
    sourceHandle.style.left = `${srcEndpoint.x}px`;
    sourceHandle.style.top = `${srcEndpoint.y}px`;
    targetHandle.style.left = `${tgtEndpoint.x}px`;
    targetHandle.style.top = `${tgtEndpoint.y}px`;
  }

  function updateReconnectHandles() {
    const selectedEdges = cy.edges(":selected");
    if (selectedEdges.length === 1) {
      selectedEdge = selectedEdges[0];
      positionReconnectHandles(selectedEdge);
      sourceHandle.hidden = false;
      targetHandle.hidden = false;
    } else {
      selectedEdge = null;
      sourceHandle.hidden = true;
      targetHandle.hidden = true;
    }
  }

  cy.on("select unselect", "edge", updateReconnectHandles);
  cy.on("pan zoom position", () => {
    if (selectedEdge) positionReconnectHandles(selectedEdge);
  });
  window.addEventListener("resize", () => {
    if (selectedEdge) positionReconnectHandles(selectedEdge);
  });

  sourceHandle.addEventListener("mousedown", (evt) => {
    evt.preventDefault();
    evt.stopPropagation();
    if (!selectedEdge) return;
    const edgeId = selectedEdge.id();
    sourceHandle.hidden = true;
    targetHandle.hidden = true;
    driveEdgeGesture(cy.getElementById(selectedEdge.data("target")), (targetId) => {
      if (targetId) onReconnect(edgeId, "src", targetId);
    });
  });
  targetHandle.addEventListener("mousedown", (evt) => {
    evt.preventDefault();
    evt.stopPropagation();
    if (!selectedEdge) return;
    const edgeId = selectedEdge.id();
    sourceHandle.hidden = true;
    targetHandle.hidden = true;
    driveEdgeGesture(cy.getElementById(selectedEdge.data("source")), (targetId) => {
      if (targetId) onReconnect(edgeId, "tgt", targetId);
    });
  });

  const resizeHandles = { tl: makeResizeHandle(containerEl, "tl"), tr: makeResizeHandle(containerEl, "tr"), bl: makeResizeHandle(containerEl, "bl"), br: makeResizeHandle(containerEl, "br") };
  let selectedNode = null;

  function positionResizeHandles(node) {
    const box = node.renderedBoundingBox();
    resizeHandles.tl.style.left = `${box.x1}px`;
    resizeHandles.tl.style.top = `${box.y1}px`;
    resizeHandles.tr.style.left = `${box.x2}px`;
    resizeHandles.tr.style.top = `${box.y1}px`;
    resizeHandles.bl.style.left = `${box.x1}px`;
    resizeHandles.bl.style.top = `${box.y2}px`;
    resizeHandles.br.style.left = `${box.x2}px`;
    resizeHandles.br.style.top = `${box.y2}px`;
  }

  function showResizeHandles() {
    for (const el of Object.values(resizeHandles)) el.hidden = false;
  }
  function hideResizeHandles() {
    for (const el of Object.values(resizeHandles)) el.hidden = true;
  }

  function updateResizeHandles() {
    const selectedNodes = cy.nodes(":selected");
    if (selectedNodes.length === 1) {
      selectedNode = selectedNodes[0];
      positionResizeHandles(selectedNode);
      showResizeHandles();
    } else {
      selectedNode = null;
      hideResizeHandles();
    }
  }

  cy.on("select unselect", "node", updateResizeHandles);
  cy.on("pan zoom position data", () => {
    if (selectedNode) positionResizeHandles(selectedNode);
  });
  window.addEventListener("resize", () => {
    if (selectedNode) positionResizeHandles(selectedNode);
  });

  const OPPOSITE_CORNER = { tl: "br", tr: "bl", bl: "tr", br: "tl" };
  for (const [corner, handle] of Object.entries(resizeHandles)) {
    handle.addEventListener("mousedown", (mousedownEvt) => {
      mousedownEvt.preventDefault();
      mousedownEvt.stopPropagation();
      if (!selectedNode) return;
      onResizeStart?.();
      const node = selectedNode;
      const box = node.boundingBox();
      const opposite = OPPOSITE_CORNER[corner];
      const fixedX = opposite.includes("l") ? box.x1 : box.x2;
      const fixedY = opposite[0] === "t" ? box.y1 : box.y2;

      function onMouseMove(moveEvt) {
        const modelPos = screenToModel(cy, containerEl, moveEvt.clientX, moveEvt.clientY);
        const width = Math.max(MIN_NODE_SIZE, Math.abs(modelPos.x - fixedX));
        const height = Math.max(MIN_NODE_SIZE, Math.abs(modelPos.y - fixedY));
        const centerX = (modelPos.x + fixedX) / 2;
        const centerY = (modelPos.y + fixedY) / 2;
        node.data({ width, height });
        node.position({ x: centerX, y: centerY });
        positionResizeHandles(node);
      }

      function onMouseUp() {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        onResize(node.id(), node.data("width"), node.data("height"), node.position("x"), node.position("y"));
      }

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    });
  }
}
