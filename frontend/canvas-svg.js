import { MIN_NODE_SIZE, GATE_NODE_SIZE, BASE_ZOOM } from "./constants.js";
import { topLevelKind } from "./graph-utils.js";

const rootStyle = getComputedStyle(document.documentElement);
const KIND_COLOR = {
  resource: rootStyle.getPropertyValue("--kind-resource").trim() || "#4c8bf5",
  agent: rootStyle.getPropertyValue("--kind-agent").trim() || "#f5a623",
  A: rootStyle.getPropertyValue("--kind-A").trim() || "#7b7b7b",
};
const KIND_DEFAULT_COLOR = rootStyle.getPropertyValue("--kind-default").trim() || "#999";
const SELECTED_COLOR = rootStyle.getPropertyValue("--color-selected").trim() || "#2f6fed";

const textMeasureCanvas = document.createElement("canvas");
const textMeasureCtx = textMeasureCanvas.getContext("2d");
textMeasureCtx.font = "500 11px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

export function getNodeDimensions(vertex, sizes, kind) {
  if (sizes[vertex.id]) {
    return { width: sizes[vertex.id][0], height: sizes[vertex.id][1] };
  }
  if (kind === "A") {
    return { width: GATE_NODE_SIZE, height: GATE_NODE_SIZE };
  }
  const textWidth = textMeasureCtx.measureText(vertex.label).width;
  const width = Math.max(64, Math.round(textWidth + 24));
  const height = 34;
  return { width, height };
}

export function getNodePorts(cx, cy, width, height) {
  return {
    top: { x: cx, y: cy - height / 2, side: "top", relX: 0, relY: -1 },
    right: { x: cx + width / 2, y: cy, side: "right", relX: 1, relY: 0 },
    bottom: { x: cx, y: cy + height / 2, side: "bottom", relX: 0, relY: 1 },
    left: { x: cx - width / 2, y: cy, side: "left", relX: -1, relY: 0 },
  };
}

export function projectToPerimeter(nodeBox, px, py, snapDistance = 16) {
  const hw = nodeBox.width / 2;
  const hh = nodeBox.height / 2;
  const dx = px - nodeBox.cx;
  const dy = py - nodeBox.cy;

  if (nodeBox.kind === "A") {
    const denom = Math.abs(dx) / hw + Math.abs(dy) / hh;
    const scale = denom === 0 ? 0 : 1 / denom;
    const ix = nodeBox.cx + dx * scale;
    const iy = nodeBox.cy + dy * scale;
    const relX = (ix - nodeBox.cx) / hw;
    const relY = (iy - nodeBox.cy) / hh;

    const corners = [
      { side: "top", relX: 0, relY: -1, x: nodeBox.cx, y: nodeBox.cy - hh },
      { side: "right", relX: 1, relY: 0, x: nodeBox.cx + hw, y: nodeBox.cy },
      { side: "bottom", relX: 0, relY: 1, x: nodeBox.cx, y: nodeBox.cy + hh },
      { side: "left", relX: -1, relY: 0, x: nodeBox.cx - hw, y: nodeBox.cy },
    ];
    for (const c of corners) {
      if (Math.hypot(px - c.x, py - c.y) <= snapDistance) {
        return { x: c.x, y: c.y, relX: c.relX, relY: c.relY, side: c.side, snapped: true };
      }
    }
    const side = Math.abs(relX) > Math.abs(relY) ? (relX > 0 ? "right" : "left") : (relY > 0 ? "bottom" : "top");
    return { x: ix, y: iy, relX, relY, side, snapped: false };
  } else {
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    const scale = absDx === 0 && absDy === 0 ? 0 : Math.min(absDx === 0 ? Infinity : hw / absDx, absDy === 0 ? Infinity : hh / absDy);
    const ix = nodeBox.cx + dx * scale;
    const iy = nodeBox.cy + dy * scale;
    const relX = (ix - nodeBox.cx) / hw;
    const relY = (iy - nodeBox.cy) / hh;

    const anchors = [
      { side: "top", relX: 0, relY: -1, x: nodeBox.cx, y: nodeBox.cy - hh },
      { side: "right", relX: 1, relY: 0, x: nodeBox.cx + hw, y: nodeBox.cy },
      { side: "bottom", relX: 0, relY: 1, x: nodeBox.cx, y: nodeBox.cy + hh },
      { side: "left", relX: -1, relY: 0, x: nodeBox.cx - hw, y: nodeBox.cy },
    ];
    for (const a of anchors) {
      if (Math.hypot(px - a.x, py - a.y) <= snapDistance) {
        return { x: a.x, y: a.y, relX: a.relX, relY: a.relY, side: a.side, snapped: true };
      }
    }
    const side = Math.abs(relX) > Math.abs(relY) ? (relX > 0 ? "right" : "left") : (relY > 0 ? "bottom" : "top");
    return { x: ix, y: iy, relX, relY, side, snapped: false };
  }
}

export function resolveEndpoint(nodeBox, relPos) {
  if (relPos && Array.isArray(relPos) && relPos.length === 2) {
    const hw = nodeBox.width / 2;
    const hh = nodeBox.height / 2;
    const [relX, relY] = relPos;
    const x = nodeBox.cx + relX * hw;
    const y = nodeBox.cy + relY * hh;
    const side = Math.abs(relX) > Math.abs(relY) ? (relX > 0 ? "right" : "left") : (relY > 0 ? "bottom" : "top");
    return { x, y, side, relX, relY };
  }
  return null;
}

export function getBestPortPair(srcBox, tgtBox) {
  const srcPorts = getNodePorts(srcBox.cx, srcBox.cy, srcBox.width, srcBox.height);
  const tgtPorts = getNodePorts(tgtBox.cx, tgtBox.cy, tgtBox.width, tgtBox.height);
  let bestDist = Infinity;
  let bestSrcPort = srcPorts.bottom;
  let bestTgtPort = tgtPorts.top;

  for (const s of Object.values(srcPorts)) {
    for (const t of Object.values(tgtPorts)) {
      const dist = Math.hypot(s.x - t.x, s.y - t.y);
      if (dist < bestDist) {
        bestDist = dist;
        bestSrcPort = s;
        bestTgtPort = t;
      }
    }
  }
  return { srcPort: bestSrcPort, tgtPort: bestTgtPort };
}

export function computePathAndMidpoint(p1, p2, style = "bezier", elbowPos = null) {
  if (style === "straight") {
    const d = `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`;
    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2;
    return { d, midX, midY };
  }

  if (style === "taxi") {
    const isHorizontal = p1.side === "left" || p1.side === "right";
    if (isHorizontal) {
      const bendX = elbowPos !== null && elbowPos !== undefined ? elbowPos : (p1.x + p2.x) / 2;
      const d = `M ${p1.x} ${p1.y} L ${bendX} ${p1.y} L ${bendX} ${p2.y} L ${p2.x} ${p2.y}`;
      return {
        d,
        midX: bendX,
        midY: (p1.y + p2.y) / 2,
        elbowX: bendX,
        elbowY: (p1.y + p2.y) / 2,
        isHorizontalBend: true,
      };
    } else {
      const bendY = elbowPos !== null && elbowPos !== undefined ? elbowPos : (p1.y + p2.y) / 2;
      const d = `M ${p1.x} ${p1.y} L ${p1.x} ${bendY} L ${p2.x} ${bendY} L ${p2.x} ${p2.y}`;
      return {
        d,
        midX: (p1.x + p2.x) / 2,
        midY: bendY,
        elbowX: (p1.x + p2.x) / 2,
        elbowY: bendY,
        isHorizontalBend: false,
      };
    }
  }

  const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const offset = Math.min(80, Math.max(30, dist * 0.4));
  const normals = {
    top: { x: 0, y: -1 },
    bottom: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
  };
  const n1 = normals[p1.side] || { x: 0, y: 1 };
  const n2 = normals[p2.side] || { x: 0, y: -1 };
  const cp1x = p1.x + n1.x * offset;
  const cp1y = p1.y + n1.y * offset;
  const cp2x = p2.x + n2.x * offset;
  const cp2y = p2.y + n2.y * offset;
  const d = `M ${p1.x} ${p1.y} C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${p2.x} ${p2.y}`;
  const midX = 0.125 * p1.x + 0.375 * cp1x + 0.375 * cp2x + 0.125 * p2.x;
  const midY = 0.125 * p1.y + 0.375 * cp1y + 0.375 * cp2y + 0.125 * p2.y;
  return { d, midX, midY };
}

export function computeFreePreviewPath(p1, p2, style = "bezier") {
  if (style === "straight") {
    return `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`;
  }
  if (style === "taxi") {
    const isHorizontal = p1.side === "left" || p1.side === "right";
    if (isHorizontal) {
      const midX = (p1.x + p2.x) / 2;
      return `M ${p1.x} ${p1.y} L ${midX} ${p1.y} L ${midX} ${p2.y} L ${p2.x} ${p2.y}`;
    } else {
      const midY = (p1.y + p2.y) / 2;
      return `M ${p1.x} ${p1.y} L ${p1.x} ${midY} L ${p2.x} ${midY} L ${p2.x} ${p2.y}`;
    }
  }
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const cx = (p1.x + p2.x) / 2 - dy * 0.15;
  const cy = (p1.y + p2.y) / 2 + dx * 0.15;
  return `M ${p1.x} ${p1.y} Q ${cx} ${cy} ${p2.x} ${p2.y}`;
}

export class CanvasSvg {
  constructor(svgEl, callbacks = {}) {
    this.svg = svgEl;
    this.viewport = svgEl.querySelector("#viewport");
    this.edgesLayer = svgEl.querySelector("#layer-edges");
    this.nodesLayer = svgEl.querySelector("#layer-nodes");
    this.overlayLayer = svgEl.querySelector("#layer-overlay");
    this.gridPattern = svgEl.querySelector("#canvas-grid");

    this.callbacks = callbacks;

    this.pan = { x: 0, y: 0 };
    this.zoom = BASE_ZOOM;

    this.vertices = [];
    this.edges = [];
    this.positions = {};
    this.sizes = {};
    this.edgeStyles = {};
    this.edgeEndpoints = {};
    this.edgeElbows = {};
    this.labelSet = null;

    this.selectedNodeIds = new Set();
    this.selectedEdgeIds = new Set();

    this.mode = "pan";
    this.spacePressed = false;
    this.activeEdgeStyle = "bezier";

    this.isPanning = false;
    this.panStart = { x: 0, y: 0 };

    this.isDraggingNodes = false;
    this.nodeDragStart = { x: 0, y: 0 };
    this.initialNodePositions = {};
    this.nodesMoved = false;

    this.isBoxSelecting = false;
    this.boxStart = { x: 0, y: 0 };
    this.selectionBoxEl = null;

    this.isResizing = false;
    this.resizeNodeId = null;
    this.resizeCorner = null;
    this.resizeFixed = { x: 0, y: 0 };

    this.isReconnecting = false;
    this.reconnectEdgeId = null;
    this.reconnectEnd = null;
    this.reconnectFixedPort = null;
    this.pendingReconnect = null;

    this.isDraggingElbow = false;
    this.elbowEdgeId = null;
    this.elbowIsHorizontal = false;
    this.elbowStartVal = 0;

    this.isDrawingEdge = false;
    this.edgeSourceNodeId = null;
    this.edgeSourcePort = null;
    this.edgeSourceRel = null;
    this.edgeTargetNodeId = null;
    this.edgeTargetPort = null;
    this.edgeTargetRel = null;
    this.hoveredNodeId = null;

    this.boundPointerDown = this.handlePointerDown.bind(this);
    this.boundPointerMove = this.handlePointerMove.bind(this);
    this.boundPointerUp = this.handlePointerUp.bind(this);
    this.boundWheel = this.handleWheel.bind(this);
    this.boundContextMenu = this.handleContextMenu.bind(this);

    this.initEvents();
    this.updateTransform();
  }

  initEvents() {
    this.svg.addEventListener("pointerdown", this.boundPointerDown);
    window.addEventListener("pointermove", this.boundPointerMove);
    window.addEventListener("pointerup", this.boundPointerUp);
    this.svg.addEventListener("wheel", this.boundWheel, { passive: false });
    this.svg.addEventListener("contextmenu", this.boundContextMenu);
  }

  destroy() {
    this.svg.removeEventListener("pointerdown", this.boundPointerDown);
    window.removeEventListener("pointermove", this.boundPointerMove);
    window.removeEventListener("pointerup", this.boundPointerUp);
    this.svg.removeEventListener("wheel", this.boundWheel);
    this.svg.removeEventListener("contextmenu", this.boundContextMenu);
  }

  screenToCanvas(clientX, clientY) {
    const rect = this.svg.getBoundingClientRect();
    return {
      x: (clientX - rect.left - this.pan.x) / this.zoom,
      y: (clientY - rect.top - this.pan.y) / this.zoom,
    };
  }

  canvasToScreen(canvasX, canvasY) {
    const rect = this.svg.getBoundingClientRect();
    return {
      x: canvasX * this.zoom + this.pan.x + rect.left,
      y: canvasY * this.zoom + this.pan.y + rect.top,
    };
  }

  updateTransform() {
    this.viewport.setAttribute("transform", `translate(${this.pan.x}, ${this.pan.y}) scale(${this.zoom})`);
    if (this.gridPattern) {
      this.gridPattern.setAttribute("patternTransform", `translate(${this.pan.x}, ${this.pan.y}) scale(${this.zoom})`);
    }
  }

  zoomAround(clientX, clientY, factor) {
    const rect = this.svg.getBoundingClientRect();
    const mouseX = clientX - rect.left;
    const mouseY = clientY - rect.top;
    const oldZoom = this.zoom;
    const newZoom = Math.min(4.0, Math.max(0.1, oldZoom * factor));
    this.pan.x = mouseX - (mouseX - this.pan.x) * (newZoom / oldZoom);
    this.pan.y = mouseY - (mouseY - this.pan.y) * (newZoom / oldZoom);
    this.zoom = newZoom;
    this.updateTransform();
    this.callbacks.onZoomChange?.(this.zoom);
  }

  zoomIn() {
    const rect = this.svg.getBoundingClientRect();
    this.zoomAround(rect.left + rect.width / 2, rect.top + rect.height / 2, 1.25);
  }

  zoomOut() {
    const rect = this.svg.getBoundingClientRect();
    this.zoomAround(rect.left + rect.width / 2, rect.top + rect.height / 2, 0.8);
  }

  resetZoom() {
    const rect = this.svg.getBoundingClientRect();
    this.zoom = BASE_ZOOM;
    const nodeIds = Object.keys(this.positions);
    if (nodeIds.length > 0) {
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const id of nodeIds) {
        const [x, y] = this.positions[id];
        const v = this.vertices.find((vertex) => vertex.id === id);
        const kind = v && this.labelSet ? topLevelKind(v.label, this.labelSet.vertex_labels) : "resource";
        const dims = v ? getNodeDimensions(v, this.sizes, kind) : { width: 80, height: 34 };
        minX = Math.min(minX, x - dims.width / 2);
        maxX = Math.max(maxX, x + dims.width / 2);
        minY = Math.min(minY, y - dims.height / 2);
        maxY = Math.max(maxY, y + dims.height / 2);
      }
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      this.pan.x = rect.width / 2 - cx * this.zoom;
      this.pan.y = rect.height / 2 - cy * this.zoom;
    } else {
      this.pan.x = rect.width / 2;
      this.pan.y = rect.height / 2;
    }
    this.updateTransform();
    this.callbacks.onZoomChange?.(this.zoom);
  }

  getZoom() {
    return this.zoom;
  }

  getViewCenter() {
    const rect = this.svg.getBoundingClientRect();
    return [
      Math.round((rect.width / 2 - this.pan.x) / this.zoom),
      Math.round((rect.height / 2 - this.pan.y) / this.zoom),
    ];
  }

  setMode(mode) {
    this.mode = mode;
    this.clearEdgeHover();
    this.updateCursorClass();
    this.renderOverlay();
  }

  setSpacePressed(pressed) {
    this.spacePressed = pressed;
    this.updateCursorClass();
  }

  setActiveEdgeStyle(style) {
    this.activeEdgeStyle = style;
  }

  updateCursorClass() {
    const isPan = this.spacePressed || this.mode === "pan";
    const isEdge = this.mode === "edge" && !this.spacePressed;
    this.svg.classList.toggle("mode-pan", isPan);
    this.svg.classList.toggle("mode-select", !isPan && !isEdge);
    this.svg.classList.toggle("mode-edge", isEdge);
  }

  setData({ vertices, edges, positions, sizes, edgeStyles, edgeEndpoints = {}, edgeElbows = {}, labelSet }) {
    this.vertices = vertices;
    this.edges = edges;
    this.positions = positions;
    this.sizes = sizes;
    this.edgeStyles = edgeStyles;
    this.edgeEndpoints = edgeEndpoints;
    this.edgeElbows = edgeElbows;
    this.labelSet = labelSet;

    const validNodeIds = new Set(vertices.map((v) => v.id));
    const validEdgeIds = new Set(edges.map((e) => e.id));
    for (const id of Array.from(this.selectedNodeIds)) {
      if (!validNodeIds.has(id)) this.selectedNodeIds.delete(id);
    }
    for (const id of Array.from(this.selectedEdgeIds)) {
      if (!validEdgeIds.has(id)) this.selectedEdgeIds.delete(id);
    }

    this.render();
  }

  getNodeBox(nodeId) {
    const v = this.vertices.find((vertex) => vertex.id === nodeId);
    if (!v) return null;
    const pos = this.positions[nodeId] || [0, 0];
    const kind = this.labelSet ? topLevelKind(v.label, this.labelSet.vertex_labels) : "resource";
    const dims = getNodeDimensions(v, this.sizes, kind);
    return {
      id: nodeId,
      cx: pos[0],
      cy: pos[1],
      width: dims.width,
      height: dims.height,
      kind,
    };
  }

  findNodeAt(canvasX, canvasY, padding = 0) {
    for (let i = this.vertices.length - 1; i >= 0; i--) {
      const v = this.vertices[i];
      const box = this.getNodeBox(v.id);
      if (!box) continue;
      const x1 = box.cx - box.width / 2 - padding;
      const x2 = box.cx + box.width / 2 + padding;
      const y1 = box.cy - box.height / 2 - padding;
      const y2 = box.cy + box.height / 2 + padding;
      if (canvasX >= x1 && canvasX <= x2 && canvasY >= y1 && canvasY <= y2) {
        return box;
      }
    }
    return null;
  }

  getEdgeEndpoints(edge) {
    const srcBox = this.getNodeBox(edge.src);
    const tgtBox = this.getNodeBox(edge.tgt);
    if (!srcBox || !tgtBox) return null;

    const customEndpoints = this.edgeEndpoints[edge.id];
    let srcPort = customEndpoints ? resolveEndpoint(srcBox, customEndpoints.src) : null;
    let tgtPort = customEndpoints ? resolveEndpoint(tgtBox, customEndpoints.tgt) : null;

    if (!srcPort || !tgtPort) {
      const pair = getBestPortPair(srcBox, tgtBox);
      if (!srcPort) srcPort = pair.srcPort;
      if (!tgtPort) tgtPort = pair.tgtPort;
    }

    return { srcBox, tgtBox, srcPort, tgtPort };
  }

  render() {
    this.renderEdges();
    this.renderNodes();
    this.renderOverlay();
  }

  renderEdges() {
    this.edgesLayer.replaceChildren();

    for (const edge of this.edges) {
      const endpoints = this.getEdgeEndpoints(edge);
      if (!endpoints) continue;

      const { srcPort, tgtPort } = endpoints;
      const style = this.edgeStyles[edge.id] || "bezier";
      const elbowPos = this.edgeElbows[edge.id];
      const { d, midX, midY } = computePathAndMidpoint(srcPort, tgtPort, style, elbowPos);

      const isSelected = this.selectedEdgeIds.has(edge.id);

      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      g.setAttribute("class", "svg-edge");
      g.dataset.id = edge.id;

      const hitPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
      hitPath.setAttribute("d", d);
      hitPath.setAttribute("stroke", "transparent");
      hitPath.setAttribute("stroke-width", "14");
      hitPath.setAttribute("fill", "none");
      hitPath.setAttribute("class", "edge-hit-area");
      g.append(hitPath);

      const visiblePath = document.createElementNS("http://www.w3.org/2000/svg", "path");
      visiblePath.setAttribute("d", d);
      visiblePath.setAttribute("stroke", isSelected ? SELECTED_COLOR : "#777");
      visiblePath.setAttribute("stroke-width", isSelected ? "2.5" : "1.5");
      visiblePath.setAttribute("fill", "none");
      visiblePath.setAttribute("marker-end", isSelected ? "url(#edge-arrow-selected)" : "url(#edge-arrow)");
      g.append(visiblePath);

      if (edge.label) {
        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", midX);
        text.setAttribute("y", midY);
        text.setAttribute("class", "edge-label");
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("dominant-baseline", "central");
        text.textContent = edge.label;
        g.append(text);
      }

      this.edgesLayer.append(g);
    }
  }

  renderNodes() {
    this.nodesLayer.replaceChildren();

    for (const vertex of this.vertices) {
      const box = this.getNodeBox(vertex.id);
      if (!box) continue;

      const isSelected = this.selectedNodeIds.has(vertex.id);
      const isHovered = (this.mode === "edge" || this.isReconnecting) && (this.hoveredNodeId === vertex.id || this.edgeSourceNodeId === vertex.id || this.edgeTargetNodeId === vertex.id);

      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      g.setAttribute("class", "svg-node");
      g.dataset.id = vertex.id;
      g.setAttribute("transform", `translate(${box.cx}, ${box.cy})`);

      const color = KIND_COLOR[box.kind] || KIND_DEFAULT_COLOR;
      const strokeColor = isSelected || isHovered ? SELECTED_COLOR : "none";
      const strokeWidth = isSelected || isHovered ? "2.5" : "0";

      if (box.kind === "A") {
        const polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
        const hw = box.width / 2;
        const hh = box.height / 2;
        polygon.setAttribute("points", `0,${-hh} ${hw},0 0,${hh} ${-hw},0`);
        polygon.setAttribute("fill", color);
        polygon.setAttribute("stroke", strokeColor);
        polygon.setAttribute("stroke-width", strokeWidth);
        g.append(polygon);

        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", 0);
        text.setAttribute("y", 0);
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("dominant-baseline", "central");
        text.setAttribute("fill", "#fff");
        text.setAttribute("pointer-events", "none");

        const sub = vertex.label === "fallback" ? "f" : vertex.label === "primary" ? "p" : (vertex.label !== "A" ? vertex.label[0] : "");
        if (sub) {
          const tspanA = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
          tspanA.setAttribute("font-size", "11");
          tspanA.setAttribute("font-weight", "600");
          tspanA.textContent = "A";

          const tspanSub = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
          tspanSub.setAttribute("font-size", "8");
          tspanSub.setAttribute("font-weight", "600");
          tspanSub.setAttribute("dy", "3");
          tspanSub.textContent = sub;

          text.append(tspanA, tspanSub);
        } else {
          text.setAttribute("font-size", "11");
          text.setAttribute("font-weight", "600");
          text.textContent = "A";
        }
        g.append(text);
      } else {
        const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        rect.setAttribute("x", -box.width / 2);
        rect.setAttribute("y", -box.height / 2);
        rect.setAttribute("width", box.width);
        rect.setAttribute("height", box.height);
        rect.setAttribute("rx", "6");
        rect.setAttribute("ry", "6");
        rect.setAttribute("fill", color);
        rect.setAttribute("stroke", strokeColor);
        rect.setAttribute("stroke-width", strokeWidth);
        g.append(rect);

        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", 0);
        text.setAttribute("y", 0);
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("dominant-baseline", "central");
        text.setAttribute("fill", "#fff");
        text.setAttribute("font-size", "11");
        text.setAttribute("font-weight", "500");
        text.setAttribute("pointer-events", "none");
        text.textContent = vertex.label;
        g.append(text);
      }

      this.nodesLayer.append(g);
    }
  }

  renderOverlay() {
    this.overlayLayer.replaceChildren();

    if (this.mode === "edge") {
      this.renderEdgeToolOverlay();
      return;
    }

    if (this.isReconnecting) {
      this.renderReconnectOverlay();
      return;
    }

    if (this.selectedNodeIds.size === 1) {
      const nodeId = Array.from(this.selectedNodeIds)[0];
      this.renderResizeHandles(nodeId);
    } else if (this.selectedEdgeIds.size === 1) {
      const edgeId = Array.from(this.selectedEdgeIds)[0];
      this.renderReconnectHandles(edgeId);
    }
  }

  renderResizeHandles(nodeId) {
    const box = this.getNodeBox(nodeId);
    if (!box) return;

    const corners = [
      { name: "tl", x: box.cx - box.width / 2, y: box.cy - box.height / 2, cursor: "nwse-resize" },
      { name: "tr", x: box.cx + box.width / 2, y: box.cy - box.height / 2, cursor: "nesw-resize" },
      { name: "bl", x: box.cx - box.width / 2, y: box.cy + box.height / 2, cursor: "nesw-resize" },
      { name: "br", x: box.cx + box.width / 2, y: box.cy + box.height / 2, cursor: "nwse-resize" },
    ];

    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("id", "resize-handles-group");

    for (const c of corners) {
      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.setAttribute("x", c.x - 4);
      rect.setAttribute("y", c.y - 4);
      rect.setAttribute("width", 8);
      rect.setAttribute("height", 8);
      rect.setAttribute("class", `resize-handle ${c.name}`);
      rect.dataset.corner = c.name;
      rect.dataset.nodeId = nodeId;
      rect.style.cursor = c.cursor;
      g.append(rect);
    }

    this.overlayLayer.append(g);
  }

  renderReconnectHandles(edgeId) {
    const edge = this.edges.find((e) => e.id === edgeId);
    if (!edge) return;
    const endpoints = this.getEdgeEndpoints(edge);
    if (!endpoints) return;

    const { srcPort, tgtPort } = endpoints;
    const style = this.edgeStyles[edge.id] || "bezier";
    const elbowPos = this.edgeElbows[edge.id];
    const pathCalc = computePathAndMidpoint(srcPort, tgtPort, style, elbowPos);

    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("id", "reconnect-handles-group");

    const srcCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    srcCircle.setAttribute("cx", srcPort.x);
    srcCircle.setAttribute("cy", srcPort.y);
    srcCircle.setAttribute("r", 5);
    srcCircle.setAttribute("class", "reconnect-handle src");
    srcCircle.dataset.edgeId = edgeId;
    srcCircle.dataset.end = "src";
    g.append(srcCircle);

    const tgtCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    tgtCircle.setAttribute("cx", tgtPort.x);
    tgtCircle.setAttribute("cy", tgtPort.y);
    tgtCircle.setAttribute("r", 5);
    tgtCircle.setAttribute("class", "reconnect-handle tgt");
    tgtCircle.dataset.edgeId = edgeId;
    tgtCircle.dataset.end = "tgt";
    g.append(tgtCircle);

    if (style === "taxi" && pathCalc.elbowX !== undefined) {
      const elbowCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      elbowCircle.setAttribute("cx", pathCalc.elbowX);
      elbowCircle.setAttribute("cy", pathCalc.elbowY);
      elbowCircle.setAttribute("r", 5);
      elbowCircle.setAttribute("class", "elbow-handle");
      elbowCircle.dataset.edgeId = edgeId;
      elbowCircle.style.cursor = pathCalc.isHorizontalBend ? "ew-resize" : "ns-resize";
      g.append(elbowCircle);
    }

    this.overlayLayer.append(g);
  }

  renderReconnectOverlay() {
    if (!this.reconnectEdgeId || !this.reconnectFixedPort) return;
    const edge = this.edges.find((e) => e.id === this.reconnectEdgeId);
    if (!edge) return;
    const style = this.edgeStyles[edge.id] || "bezier";

    let movingPort = null;
    if (this.pendingReconnect) {
      movingPort = {
        x: this.pendingReconnect.x,
        y: this.pendingReconnect.y,
        side: this.pendingReconnect.side,
      };

      const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      dot.setAttribute("cx", movingPort.x);
      dot.setAttribute("cy", movingPort.y);
      dot.setAttribute("r", this.pendingReconnect.snapped ? 6.5 : 4.5);
      dot.setAttribute("class", `snap-dot ${this.pendingReconnect.snapped ? "active" : ""}`);
      this.overlayLayer.append(dot);
    } else if (this.currentPointerCanvas) {
      movingPort = {
        x: this.currentPointerCanvas.x,
        y: this.currentPointerCanvas.y,
        side: "top",
      };
    }

    if (movingPort) {
      const p1 = this.reconnectEnd === "src" ? movingPort : this.reconnectFixedPort;
      const p2 = this.reconnectEnd === "src" ? this.reconnectFixedPort : movingPort;

      const previewPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
      previewPath.setAttribute("id", "edge-preview-path");
      previewPath.setAttribute("stroke", SELECTED_COLOR);
      previewPath.setAttribute("stroke-width", "2.5");
      previewPath.setAttribute("fill", "none");
      previewPath.setAttribute("marker-end", "url(#edge-preview-arrow)");

      let d = "";
      if (this.pendingReconnect) {
        d = computePathAndMidpoint(p1, p2, style, this.edgeElbows[edge.id]).d;
      } else {
        d = computeFreePreviewPath(p1, p2, style);
      }
      previewPath.setAttribute("d", d);
      this.overlayLayer.append(previewPath);
    }
  }

  renderEdgeToolOverlay() {
    if (this.hoveredNodeId) {
      const box = this.getNodeBox(this.hoveredNodeId);
      if (box) {
        const ports = getNodePorts(box.cx, box.cy, box.width, box.height);
        const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
        g.setAttribute("class", "snap-ports-group");
        for (const [side, p] of Object.entries(ports)) {
          const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
          circle.setAttribute("cx", p.x);
          circle.setAttribute("cy", p.y);
          circle.setAttribute("r", 4.5);
          circle.setAttribute("class", "snap-dot");
          circle.dataset.nodeId = box.id;
          circle.dataset.side = side;
          g.append(circle);
        }
        this.overlayLayer.append(g);
      }
    }

    if (this.isDrawingEdge && this.edgeTargetPort) {
      const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      dot.setAttribute("cx", this.edgeTargetPort.x);
      dot.setAttribute("cy", this.edgeTargetPort.y);
      dot.setAttribute("r", this.edgeTargetPort.snapped ? 6.5 : 4.5);
      dot.setAttribute("class", `snap-dot ${this.edgeTargetPort.snapped ? "active" : ""}`);
      this.overlayLayer.append(dot);
    }

    if (this.isDrawingEdge && this.edgeSourcePort) {
      const previewPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
      previewPath.setAttribute("id", "edge-preview-path");
      previewPath.setAttribute("stroke", SELECTED_COLOR);
      previewPath.setAttribute("stroke-width", "2.5");
      previewPath.setAttribute("fill", "none");
      previewPath.setAttribute("marker-end", "url(#edge-preview-arrow)");

      let d = "";
      if (this.edgeTargetPort) {
        d = computePathAndMidpoint(this.edgeSourcePort, this.edgeTargetPort, this.activeEdgeStyle).d;
      } else if (this.currentPointerCanvas) {
        d = computeFreePreviewPath(this.edgeSourcePort, this.currentPointerCanvas, this.activeEdgeStyle);
      }
      previewPath.setAttribute("d", d);
      this.overlayLayer.append(previewPath);
    }
  }

  clearEdgeHover() {
    this.hoveredNodeId = null;
    this.edgeSourceNodeId = null;
    this.edgeSourcePort = null;
    this.edgeSourceRel = null;
    this.edgeTargetNodeId = null;
    this.edgeTargetPort = null;
    this.edgeTargetRel = null;
    this.isDrawingEdge = false;
    this.isReconnecting = false;
    this.pendingReconnect = null;
    this.isDraggingElbow = false;
  }

  select(id, type = "node", additive = false) {
    if (!additive) {
      this.selectedNodeIds.clear();
      this.selectedEdgeIds.clear();
    }
    if (type === "node") {
      this.selectedNodeIds.add(id);
    } else if (type === "edge") {
      this.selectedEdgeIds.add(id);
    }
    this.render();
    this.notifySelection();
  }

  selectAll() {
    this.selectedNodeIds = new Set(this.vertices.map((v) => v.id));
    this.selectedEdgeIds = new Set(this.edges.map((e) => e.id));
    this.render();
    this.notifySelection();
  }

  clearSelection() {
    if (this.selectedNodeIds.size === 0 && this.selectedEdgeIds.size === 0) return;
    this.selectedNodeIds.clear();
    this.selectedEdgeIds.clear();
    this.render();
    this.notifySelection();
  }

  getSelected() {
    return {
      nodes: Array.from(this.selectedNodeIds),
      edges: Array.from(this.selectedEdgeIds),
    };
  }

  notifySelection() {
    this.callbacks.onSelectionChange?.(this.getSelected());
  }

  handlePointerDown(evt) {
    if (evt.button !== 0 && evt.button !== 1) return;

    const isPan = evt.button === 1 || this.spacePressed || this.mode === "pan";
    const canvasPt = this.screenToCanvas(evt.clientX, evt.clientY);

    if (this.mode === "edge" && !this.spacePressed) {
      const clickedEdgeEl = evt.target.closest(".svg-edge");
      if (clickedEdgeEl) {
        evt.preventDefault();
        evt.stopPropagation();
        const edgeId = clickedEdgeEl.dataset.id;
        this.select(edgeId, "edge");
        return;
      }
      const node = this.findNodeAt(canvasPt.x, canvasPt.y, 20);
      if (!node) return;
      evt.preventDefault();
      evt.stopPropagation();
      this.isDrawingEdge = true;
      this.edgeSourceNodeId = node.id;
      const proj = projectToPerimeter(node, canvasPt.x, canvasPt.y, 16);
      this.edgeSourcePort = proj;
      this.edgeSourceRel = [Number(proj.relX.toFixed(3)), Number(proj.relY.toFixed(3))];
      this.edgeTargetNodeId = null;
      this.edgeTargetPort = null;
      this.edgeTargetRel = null;
      this.currentPointerCanvas = canvasPt;
      this.clearSelection();
      this.render();
      return;
    }

    const elbowHandle = evt.target.closest(".elbow-handle");
    if (elbowHandle && !this.spacePressed) {
      evt.preventDefault();
      evt.stopPropagation();
      const edgeId = elbowHandle.dataset.edgeId;
      const edge = this.edges.find((e) => e.id === edgeId);
      if (!edge) return;
      const endpoints = this.getEdgeEndpoints(edge);
      if (!endpoints) return;

      const pathCalc = computePathAndMidpoint(endpoints.srcPort, endpoints.tgtPort, "taxi", this.edgeElbows[edgeId]);
      this.isDraggingElbow = true;
      this.elbowEdgeId = edgeId;
      this.elbowIsHorizontal = pathCalc.isHorizontalBend;
      this.elbowStartVal = pathCalc.isHorizontalBend ? pathCalc.elbowX : pathCalc.elbowY;
      this.callbacks.onEdgeElbowStart?.();
      return;
    }

    const resizeHandle = evt.target.closest(".resize-handle");
    if (resizeHandle && !this.spacePressed) {
      evt.preventDefault();
      evt.stopPropagation();
      const corner = resizeHandle.dataset.corner;
      const nodeId = resizeHandle.dataset.nodeId;
      const box = this.getNodeBox(nodeId);
      if (!box) return;

      this.isResizing = true;
      this.resizeNodeId = nodeId;
      this.resizeCorner = corner;

      const OPPOSITE = { tl: "br", tr: "bl", bl: "tr", br: "tl" };
      const opp = OPPOSITE[corner];
      const fixedX = opp.includes("l") ? box.cx - box.width / 2 : box.cx + box.width / 2;
      const fixedY = opp[0] === "t" ? box.cy - box.height / 2 : box.cy + box.height / 2;
      this.resizeFixed = { x: fixedX, y: fixedY };

      this.callbacks.onNodeResizeStart?.();
      return;
    }

    const reconnectHandle = evt.target.closest(".reconnect-handle");
    if (reconnectHandle && !this.spacePressed) {
      evt.preventDefault();
      evt.stopPropagation();
      const edgeId = reconnectHandle.dataset.edgeId;
      const end = reconnectHandle.dataset.end;
      const edge = this.edges.find((e) => e.id === edgeId);
      if (!edge) return;
      const endpoints = this.getEdgeEndpoints(edge);
      if (!endpoints) return;

      this.isReconnecting = true;
      this.reconnectEdgeId = edgeId;
      this.reconnectEnd = end;
      this.reconnectFixedPort = end === "src" ? endpoints.tgtPort : endpoints.srcPort;
      this.pendingReconnect = null;
      this.render();
      return;
    }

    const clickedNodeEl = evt.target.closest(".svg-node");
    if (clickedNodeEl && !this.spacePressed && this.mode !== "edge") {
      const nodeId = clickedNodeEl.dataset.id;
      const isAdditive = evt.shiftKey || evt.metaKey;

      if (isAdditive) {
        if (this.selectedNodeIds.has(nodeId)) {
          this.selectedNodeIds.delete(nodeId);
        } else {
          this.selectedNodeIds.add(nodeId);
        }
        this.render();
        this.notifySelection();
      } else if (!this.selectedNodeIds.has(nodeId)) {
        this.select(nodeId, "node");
      }

      this.isDraggingNodes = false;
      this.nodesMoved = false;
      this.nodeDragStart = canvasPt;
      this.initialNodePositions = {};
      for (const id of this.selectedNodeIds) {
        const pos = this.positions[id] || [0, 0];
        this.initialNodePositions[id] = [...pos];
      }
      return;
    }

    const clickedEdgeEl = evt.target.closest(".svg-edge");
    if (clickedEdgeEl && !this.spacePressed && this.mode !== "edge") {
      const edgeId = clickedEdgeEl.dataset.id;
      const isAdditive = evt.shiftKey || evt.metaKey;
      if (isAdditive) {
        if (this.selectedEdgeIds.has(edgeId)) {
          this.selectedEdgeIds.delete(edgeId);
        } else {
          this.selectedEdgeIds.add(edgeId);
        }
        this.render();
        this.notifySelection();
      } else {
        this.select(edgeId, "edge");
      }
      return;
    }

    if (isPan) {
      this.isPanning = true;
      this.panStart = { x: evt.clientX - this.pan.x, y: evt.clientY - this.pan.y };
      this.svg.classList.add("panning");
      return;
    }

    if (this.mode === "select" && !isPan) {
      this.clearSelection();
      this.isBoxSelecting = true;
      this.boxStart = canvasPt;
      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.setAttribute("id", "selection-marquee");
      rect.setAttribute("x", canvasPt.x);
      rect.setAttribute("y", canvasPt.y);
      rect.setAttribute("width", 0);
      rect.setAttribute("height", 0);
      rect.setAttribute("fill", "rgba(47, 111, 237, 0.12)");
      rect.setAttribute("stroke", SELECTED_COLOR);
      rect.setAttribute("stroke-width", "1");
      rect.setAttribute("stroke-dasharray", "3 3");
      this.overlayLayer.append(rect);
      this.selectionBoxEl = rect;
    }
  }

  handlePointerMove(evt) {
    const canvasPt = this.screenToCanvas(evt.clientX, evt.clientY);
    this.currentPointerCanvas = canvasPt;

    if (this.isPanning) {
      this.pan.x = evt.clientX - this.panStart.x;
      this.pan.y = evt.clientY - this.panStart.y;
      this.updateTransform();
      return;
    }

    if (this.isDraggingElbow && this.elbowEdgeId) {
      const val = this.elbowIsHorizontal ? Math.round(canvasPt.x) : Math.round(canvasPt.y);
      this.edgeElbows[this.elbowEdgeId] = val;
      this.render();
      return;
    }

    if (this.isBoxSelecting && this.selectionBoxEl) {
      const x = Math.min(this.boxStart.x, canvasPt.x);
      const y = Math.min(this.boxStart.y, canvasPt.y);
      const width = Math.abs(this.boxStart.x - canvasPt.x);
      const height = Math.abs(this.boxStart.y - canvasPt.y);
      this.selectionBoxEl.setAttribute("x", x);
      this.selectionBoxEl.setAttribute("y", y);
      this.selectionBoxEl.setAttribute("width", width);
      this.selectionBoxEl.setAttribute("height", height);
      return;
    }

    if (this.isResizing && this.resizeNodeId) {
      const newWidth = Math.max(MIN_NODE_SIZE, Math.abs(canvasPt.x - this.resizeFixed.x));
      const newHeight = Math.max(MIN_NODE_SIZE, Math.abs(canvasPt.y - this.resizeFixed.y));
      const newCenterX = (canvasPt.x + this.resizeFixed.x) / 2;
      const newCenterY = (canvasPt.y + this.resizeFixed.y) / 2;

      this.sizes[this.resizeNodeId] = [Math.round(newWidth), Math.round(newHeight)];
      this.positions[this.resizeNodeId] = [Math.round(newCenterX), Math.round(newCenterY)];
      this.render();
      return;
    }

    if (this.isReconnecting) {
      const candidate = this.findNodeAt(canvasPt.x, canvasPt.y, 25);
      if (candidate) {
        const proj = projectToPerimeter(candidate, canvasPt.x, canvasPt.y, 16);
        this.hoveredNodeId = candidate.id;
        this.pendingReconnect = {
          nodeId: candidate.id,
          x: proj.x,
          y: proj.y,
          relX: Number(proj.relX.toFixed(3)),
          relY: Number(proj.relY.toFixed(3)),
          side: proj.side,
          snapped: proj.snapped,
        };
      } else {
        this.hoveredNodeId = null;
        this.pendingReconnect = null;
      }
      this.render();
      return;
    }

    if (this.mode === "edge") {
      if (this.isDrawingEdge && this.edgeSourceNodeId) {
        const candidate = this.findNodeAt(canvasPt.x, canvasPt.y, 25);
        if (candidate && candidate.id !== this.edgeSourceNodeId) {
          const proj = projectToPerimeter(candidate, canvasPt.x, canvasPt.y, 16);
          this.edgeTargetNodeId = candidate.id;
          this.edgeTargetPort = proj;
          this.edgeTargetRel = [Number(proj.relX.toFixed(3)), Number(proj.relY.toFixed(3))];
        } else {
          this.edgeTargetNodeId = null;
          this.edgeTargetPort = null;
          this.edgeTargetRel = null;
        }
        this.renderOverlay();
      } else {
        const candidate = this.findNodeAt(canvasPt.x, canvasPt.y, 16);
        const newHoveredId = candidate ? candidate.id : null;
        if (newHoveredId !== this.hoveredNodeId) {
          this.hoveredNodeId = newHoveredId;
          this.render();
        }
      }
      return;
    }

    if (this.initialNodePositions && Object.keys(this.initialNodePositions).length > 0) {
      const dx = canvasPt.x - this.nodeDragStart.x;
      const dy = canvasPt.y - this.nodeDragStart.y;
      if (!this.isDraggingNodes && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
        this.isDraggingNodes = true;
        this.callbacks.onNodeDragStart?.();
      }
      if (this.isDraggingNodes) {
        this.nodesMoved = true;
        for (const [id, [origX, origY]] of Object.entries(this.initialNodePositions)) {
          this.positions[id] = [Math.round(origX + dx), Math.round(origY + dy)];
        }
        this.render();
      }
    }
  }

  handlePointerUp(evt) {
    if (this.isPanning) {
      this.isPanning = false;
      this.svg.classList.remove("panning");
    }

    if (this.isDraggingElbow && this.elbowEdgeId) {
      const edgeId = this.elbowEdgeId;
      const finalVal = this.edgeElbows[edgeId];
      this.isDraggingElbow = false;
      this.elbowEdgeId = null;
      this.callbacks.onEdgeElbowEnd?.(edgeId, finalVal);
    }

    if (this.isBoxSelecting && this.selectionBoxEl) {
      const x1 = Math.min(this.boxStart.x, this.currentPointerCanvas.x);
      const x2 = Math.max(this.boxStart.x, this.currentPointerCanvas.x);
      const y1 = Math.min(this.boxStart.y, this.currentPointerCanvas.y);
      const y2 = Math.max(this.boxStart.y, this.currentPointerCanvas.y);
      this.selectionBoxEl.remove();
      this.selectionBoxEl = null;
      this.isBoxSelecting = false;

      if (Math.abs(x2 - x1) > 5 || Math.abs(y2 - y1) > 5) {
        for (const v of this.vertices) {
          const box = this.getNodeBox(v.id);
          if (!box) continue;
          const bx1 = box.cx - box.width / 2;
          const bx2 = box.cx + box.width / 2;
          const by1 = box.cy - box.height / 2;
          const by2 = box.cy + box.height / 2;
          if (bx1 < x2 && bx2 > x1 && by1 < y2 && by2 > y1) {
            this.selectedNodeIds.add(v.id);
          }
        }
        this.render();
        this.notifySelection();
      }
    }

    if (this.isResizing && this.resizeNodeId) {
      const id = this.resizeNodeId;
      const [w, h] = this.sizes[id];
      const [cx, cy] = this.positions[id];
      this.isResizing = false;
      this.resizeNodeId = null;
      this.callbacks.onNodeResizeEnd?.(id, w, h, cx, cy);
    }

    if (this.isReconnecting && this.reconnectEdgeId) {
      const edgeId = this.reconnectEdgeId;
      const end = this.reconnectEnd;
      const pending = this.pendingReconnect;
      this.isReconnecting = false;
      this.reconnectEdgeId = null;
      this.reconnectEnd = null;
      this.reconnectFixedPort = null;
      this.hoveredNodeId = null;
      this.pendingReconnect = null;

      if (pending) {
        this.callbacks.onEdgeEndpointChange?.(edgeId, end, pending.nodeId, [pending.relX, pending.relY]);
      } else {
        this.render();
      }
    }

    if (this.isDrawingEdge) {
      const srcId = this.edgeSourceNodeId;
      const tgtId = this.edgeTargetNodeId;
      const srcRel = this.edgeSourceRel;
      const tgtRel = this.edgeTargetRel;
      this.clearEdgeHover();
      this.render();

      if (srcId && tgtId && srcId !== tgtId) {
        this.callbacks.onEdgeConnect?.(srcId, tgtId, srcRel, tgtRel);
      }
    }

    if (this.isDraggingNodes) {
      this.isDraggingNodes = false;
      this.initialNodePositions = {};
      this.callbacks.onNodeDragEnd?.(this.nodesMoved);
      this.nodesMoved = false;
    } else {
      this.initialNodePositions = {};
    }
  }

  handleWheel(evt) {
    evt.preventDefault();
    if (evt.ctrlKey || evt.metaKey) {
      const factor = Math.exp(-evt.deltaY * 0.01);
      this.zoomAround(evt.clientX, evt.clientY, factor);
    } else {
      this.pan.x -= evt.deltaX;
      this.pan.y -= evt.deltaY;
      this.updateTransform();
    }
  }

  handleContextMenu(evt) {
    evt.preventDefault();
    const canvasPt = this.screenToCanvas(evt.clientX, evt.clientY);

    const clickedNode = this.findNodeAt(canvasPt.x, canvasPt.y);
    if (clickedNode) {
      this.select(clickedNode.id, "node");
      this.callbacks.onContextMenuNode?.(clickedNode.id, evt.clientX, evt.clientY);
      return;
    }

    const clickedEdgeEl = evt.target.closest(".svg-edge");
    if (clickedEdgeEl) {
      const edgeId = clickedEdgeEl.dataset.id;
      this.select(edgeId, "edge");
      this.callbacks.onContextMenuEdge?.(edgeId, evt.clientX, evt.clientY);
      return;
    }

    this.callbacks.onContextMenuCanvas?.(evt.clientX, evt.clientY);
  }
}
