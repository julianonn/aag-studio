// Floating overlays synced to the selected/hovered element's on-screen
// position: 4 connect arrows on hover, 2 reconnect handles on a selected
// edge, 4 resize handles on a selected node. Same technique for all three
// (position a div via node.renderedPosition()/renderedBoundingBox(), keep
// it in sync on pan/zoom/position) so they behave and look consistent.

const MIN_NODE_SIZE = 24;

function screenToModel(cy, containerEl, clientX, clientY) {
  const rect = containerEl.getBoundingClientRect();
  const zoom = cy.zoom();
  const pan = cy.pan();
  return { x: (clientX - rect.left - pan.x) / zoom, y: (clientY - rect.top - pan.y) / zoom };
}

function makeDot(container) {
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

export function attachSelectionHandles(cy, eh, containerEl, { onConnect, onReconnect, onResize }) {
  // Cytoscape's own node hover tracking (mouseover/mouseout) already does
  // accurate hit-testing, so the drag driver below reuses it as its drop
  // target signal instead of re-implementing hit-testing by hand.
  let hoveredNode = null;
  let dragging = false;

  // cytoscape-edgehandles normally drives itself off Cytoscape's internal
  // tapdrag/tapend gesture events, which only fire for a drag that started
  // on the canvas — a drag starting on our overlay handles never reaches
  // that. We call eh.start()/update() by hand purely for the ghost-line
  // visual; whether a valid drop happened is decided ourselves from the
  // same hover tracking the connect arrows already use (eh's own
  // preview/stop-driven completion turned out to be unreliable when driven
  // this way, so onComplete below is the actual source of truth).
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
      onComplete(target ? target.id() : null);
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }

  // 4-directional connect arrows on node hover.
  const connectHandles = { top: makeDot(containerEl), right: makeDot(containerEl), bottom: makeDot(containerEl), left: makeDot(containerEl) };

  function positionConnectHandles(node) {
    const box = node.renderedBoundingBox();
    connectHandles.top.style.left = `${(box.x1 + box.x2) / 2}px`;
    connectHandles.top.style.top = `${box.y1}px`;
    connectHandles.right.style.left = `${box.x2}px`;
    connectHandles.right.style.top = `${(box.y1 + box.y2) / 2}px`;
    connectHandles.bottom.style.left = `${(box.x1 + box.x2) / 2}px`;
    connectHandles.bottom.style.top = `${box.y2}px`;
    connectHandles.left.style.left = `${box.x1}px`;
    connectHandles.left.style.top = `${(box.y1 + box.y2) / 2}px`;
  }

  function showConnectHandles() {
    for (const el of Object.values(connectHandles)) el.hidden = false;
  }
  function hideConnectHandles() {
    for (const el of Object.values(connectHandles)) el.hidden = true;
  }

  cy.on("mouseover", "node", (evt) => {
    hoveredNode = evt.target;
    if (dragging) return;
    positionConnectHandles(hoveredNode);
    showConnectHandles();
  });
  cy.on("mouseout", "node", () => {
    hoveredNode = null;
    if (!dragging) hideConnectHandles();
  });
  cy.on("pan zoom position", () => {
    if (hoveredNode && !dragging) positionConnectHandles(hoveredNode);
  });
  for (const el of Object.values(connectHandles)) {
    el.addEventListener("mousedown", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      hideConnectHandles();
      if (!hoveredNode) return;
      const sourceId = hoveredNode.id();
      driveEdgeGesture(hoveredNode, (targetId) => {
        if (targetId) onConnect(sourceId, targetId);
      });
    });
  }

  // Reconnect handles at a selected edge's two endpoints. edgehandles can
  // only start a drag from a fixed source toward a dropped target, so to
  // move the *source* end (target fixed) we anchor on the target instead
  // and swap direction in onReconnect.
  const sourceHandle = makeDot(containerEl);
  const targetHandle = makeDot(containerEl);
  let selectedEdge = null;

  function positionReconnectHandles(edge) {
    const srcPos = cy.getElementById(edge.data("source")).renderedPosition();
    const tgtPos = cy.getElementById(edge.data("target")).renderedPosition();
    sourceHandle.style.left = `${srcPos.x}px`;
    sourceHandle.style.top = `${srcPos.y}px`;
    targetHandle.style.left = `${tgtPos.x}px`;
    targetHandle.style.top = `${tgtPos.y}px`;
  }

  cy.on("select", "edge", (evt) => {
    selectedEdge = evt.target;
    positionReconnectHandles(selectedEdge);
    sourceHandle.hidden = false;
    targetHandle.hidden = false;
  });
  cy.on("unselect", "edge", () => {
    selectedEdge = null;
    sourceHandle.hidden = true;
    targetHandle.hidden = true;
  });
  cy.on("pan zoom position", () => {
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

  // Resize handles at a selected node's 4 corners. Dragging one keeps the
  // diagonally opposite corner fixed, matching the usual resize-box convention.
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

  cy.on("select", "node", (evt) => {
    selectedNode = evt.target;
    positionResizeHandles(selectedNode);
    showResizeHandles();
  });
  cy.on("unselect", "node", () => {
    selectedNode = null;
    hideResizeHandles();
  });
  cy.on("pan zoom position", () => {
    if (selectedNode) positionResizeHandles(selectedNode);
  });

  const OPPOSITE_CORNER = { tl: "br", tr: "bl", bl: "tr", br: "tl" };
  for (const [corner, handle] of Object.entries(resizeHandles)) {
    handle.addEventListener("mousedown", (mousedownEvt) => {
      mousedownEvt.preventDefault();
      mousedownEvt.stopPropagation();
      if (!selectedNode) return;
      const node = selectedNode;
      const box = node.boundingBox(); // model-space, unaffected by pan/zoom
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
