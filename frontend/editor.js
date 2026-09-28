// The graph editor: canvas render, palette, typed edge tool, context menu,
// properties panel and the validation panel. Selection/hover overlays
// (connect arrows, reconnect handles, resize handles) live in selection-handles.js.

import { renderPalette } from "./palette.js";
import { showContextMenu } from "./contextmenu.js";
import { attachSelectionHandles } from "./selection-handles.js";
import { topLevelKind, inferredEdgeLabel, nextId, validateGraph, debounce } from "./graph-utils.js";

const rootStyle = getComputedStyle(document.documentElement);
const KIND_COLOR = {
  resource: rootStyle.getPropertyValue("--kind-resource").trim(),
  agent: rootStyle.getPropertyValue("--kind-agent").trim(),
  A: rootStyle.getPropertyValue("--kind-A").trim(),
};
const KIND_DEFAULT_COLOR = rootStyle.getPropertyValue("--kind-default").trim();
const SELECTED_COLOR = rootStyle.getPropertyValue("--color-selected").trim();

export async function openEditor(graphName, labelSet, { onExit, onRename }) {
  let graph = await fetch(`/api/graphs/${graphName}`).then((r) => r.json());
  const rawLayout = await fetch(`/api/graphs/${graphName}/layout`).then((r) => r.json());
  const positions = rawLayout.positions ?? {};
  const edgeStyles = rawLayout.edge_styles ?? {};
  const sizes = rawLayout.sizes ?? {};

  const issuesCountEl = document.getElementById("issues-count");
  const violationsList = document.getElementById("violations-list");

  const propertiesEl = document.createElement("div");
  propertiesEl.className = "floating-toolbar";
  propertiesEl.hidden = true;
  document.getElementById("graph").append(propertiesEl);

  function saveGraph() {
    fetch(`/api/graphs/${graphName}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(graph),
    });
  }
  const debouncedSaveGraph = debounce(saveGraph, 1000);

  function saveLayout() {
    fetch(`/api/graphs/${graphName}/layout`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ positions, edge_styles: edgeStyles, sizes }),
    });
  }
  const debouncedSaveLayout = debounce(saveLayout, 1000);

  async function refreshViolations() {
    const violations = await validateGraph(graph);
    issuesCountEl.textContent = violations.length || "";
    violationsList.replaceChildren(
      ...violations.map((v) => {
        const li = document.createElement("li");
        li.textContent = v;
        return li;
      })
    );
  }

  function elementsFromGraph() {
    return [
      ...graph.vertices.map((v) => ({
        data: {
          id: v.id,
          label: v.label,
          kind: topLevelKind(v.label, labelSet.vertex_labels),
          ...(sizes[v.id] ? { width: sizes[v.id][0], height: sizes[v.id][1] } : {}),
        },
        position: positions[v.id] ? { x: positions[v.id][0], y: positions[v.id][1] } : undefined,
      })),
      ...graph.edges.map((e) => ({
        data: {
          id: e.id,
          source: e.src,
          target: e.tgt,
          label: e.label,
          time: e.time,
          curveStyle: edgeStyles[e.id] ?? "bezier",
        },
      })),
    ];
  }

  const cy = cytoscape({
    container: document.getElementById("graph"),
    elements: elementsFromGraph(),
    layout: Object.keys(positions).length ? { name: "preset" } : { name: "breadthfirst" },
    style: [
      {
        selector: "node",
        style: {
          label: "data(label)",
          "background-color": (n) => KIND_COLOR[n.data("kind")] ?? KIND_DEFAULT_COLOR,
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
      { selector: "node[kind = 'A']", style: { shape: "diamond", label: "A", width: 30, height: 30, padding: 0 } },
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
    hideProperties();
    cy.elements().remove();
    cy.add(elementsFromGraph());
    if (!Object.keys(positions).length) cy.layout({ name: "breadthfirst" }).run();
  }

  async function applyGraph(candidate) {
    const violations = await validateGraph(candidate);
    if (violations.length) {
      alert(violations.join("\n"));
      return false;
    }
    graph = candidate;
    rerender();
    refreshViolations();
    debouncedSaveGraph();
    return true;
  }

  async function tryAddVertex(label) {
    const id = nextId(new Set(graph.vertices.map((v) => v.id)), label);
    await applyGraph({ vertices: [...graph.vertices, { id, label }], edges: graph.edges });
  }

  async function tryAddEdge(sourceId, targetId) {
    const existingIds = new Set(graph.edges.map((e) => e.id));
    const id = nextId(existingIds, "e");
    const sourceLabel = graph.vertices.find((v) => v.id === sourceId).label;
    const targetLabel = graph.vertices.find((v) => v.id === targetId).label;
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
      vertices: graph.vertices.filter((v) => v.id !== vertexId),
      edges: graph.edges.filter((e) => e.src !== vertexId && e.tgt !== vertexId),
    });
  }

  async function tryDeleteEdge(edgeId) {
    await applyGraph({ vertices: graph.vertices, edges: graph.edges.filter((e) => e.id !== edgeId) });
  }

  async function tryReconnectEdge(edgeId, movingEnd, droppedNodeId) {
    const edge = graph.edges.find((e) => e.id === edgeId);
    const updated = movingEnd === "src" ? { ...edge, src: droppedNodeId } : { ...edge, tgt: droppedNodeId };
    const newLabel = inferredEdgeLabel(
      labelSet,
      graph.vertices.find((v) => v.id === updated.src).label,
      graph.vertices.find((v) => v.id === updated.tgt).label
    );
    if (!newLabel) {
      alert("no edge rule matches that reconnection");
      return;
    }
    updated.label = newLabel;
    await applyGraph({
      vertices: graph.vertices,
      edges: graph.edges.map((e) => (e.id === edgeId ? updated : e)),
    });
  }

  renderPalette(document.getElementById("panel-add"), labelSet.vertex_labels, tryAddVertex);

  // Left sidebar: a thin icon strip always visible; clicking an icon opens
  // its panel next to the strip, clicking it again (or another icon)
  // collapses back to just the strip — only one panel open at a time.
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
  let openPanel = null;

  function togglePanel(name) {
    if (openPanel === name) {
      openPanel = null;
      sidePanelEl.hidden = true;
      editorEl.classList.remove("panel-open");
      icons[name].classList.remove("active");
      return;
    }
    if (openPanel) icons[openPanel].classList.remove("active");
    openPanel = name;
    for (const [key, el] of Object.entries(panels)) el.hidden = key !== name;
    sidePanelEl.hidden = false;
    editorEl.classList.add("panel-open");
    icons[name].classList.add("active");
  }

  icons.add.onclick = () => togglePanel("add");
  icons.issues.onclick = () => togglePanel("issues");
  icons.info.onclick = () => togglePanel("info");

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

  let propertiesTarget = null;

  function positionPropertiesToolbar(element) {
    const box = element.renderedBoundingBox();
    propertiesEl.style.left = `${(box.x1 + box.x2) / 2}px`;
    propertiesEl.style.top = `${box.y1}px`;
  }

  function hideProperties() {
    propertiesTarget = null;
    propertiesEl.hidden = true;
  }

  function renderProperties(element) {
    propertiesTarget = element;
    propertiesEl.hidden = false;
    positionPropertiesToolbar(element);

    if (element.isNode()) {
      propertiesEl.textContent = `${element.id()} : ${element.data("label")}`;
      return;
    }
    const edge = graph.edges.find((e) => e.id === element.id());
    propertiesEl.replaceChildren();
    const heading = document.createElement("div");
    heading.textContent = `${edge.id} : ${edge.label}`;
    propertiesEl.append(heading);

    const list = document.createElement("ul");
    edge.time.forEach((interval, index) => {
      const li = document.createElement("li");
      const start = document.createElement("input");
      start.value = interval[0] ?? "";
      const end = document.createElement("input");
      end.value = interval[1] ?? "";
      end.placeholder = "open";
      li.append(start, " – ", end);
      list.append(li);

      async function commit() {
        const newInterval = [start.value === "" ? null : Number(start.value), end.value === "" ? null : Number(end.value)];
        const newEdges = graph.edges.map((e) =>
          e.id !== edge.id ? e : { ...e, time: edge.time.map((iv, i) => (i === index ? newInterval : iv)) }
        );
        await applyGraph({ vertices: graph.vertices, edges: newEdges });
      }
      start.onchange = commit;
      end.onchange = commit;
    });
    propertiesEl.append(list);
  }

  cy.on("tap", "node, edge", (evt) => renderProperties(evt.target));
  cy.on("tap", (evt) => {
    if (evt.target === cy) hideProperties();
  });
  cy.on("pan zoom position", () => {
    if (propertiesTarget) positionPropertiesToolbar(propertiesTarget);
  });

  cy.on("dragfree", "node", () => {
    cy.nodes().forEach((n) => (positions[n.id()] = [n.position("x"), n.position("y")]));
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
  const graphs = await fetch("/api/graphs").then((r) => r.json());
  const thisGraph = graphs.find((g) => g.name === graphName);
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
