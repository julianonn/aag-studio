// The graph editor: canvas render, palette, typed edge tool, reconnect,
// context menu, properties panel and the validation panel.

import { renderPalette } from "./palette.js";
import { showContextMenu } from "./contextmenu.js";
import { topLevelKind, inferredEdgeLabel, nextId, validateGraph, debounce } from "./graph-utils.js";

const rootStyle = getComputedStyle(document.documentElement);
const KIND_COLOR = {
  resource: rootStyle.getPropertyValue("--kind-resource").trim(),
  agent: rootStyle.getPropertyValue("--kind-agent").trim(),
  A: rootStyle.getPropertyValue("--kind-A").trim(),
};
const KIND_DEFAULT_COLOR = rootStyle.getPropertyValue("--kind-default").trim();

export async function openEditor(graphName, labelSet, { onExit, onRename }) {
  let graph = await fetch(`/api/graphs/${graphName}`).then((r) => r.json());
  const rawLayout = await fetch(`/api/graphs/${graphName}/layout`).then((r) => r.json());
  const positions = rawLayout.positions ?? {};
  const edgeStyles = rawLayout.edge_styles ?? {};

  const violationsEl = document.getElementById("violations");
  const propertiesEl = document.getElementById("properties");

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
      body: JSON.stringify({ positions, edge_styles: edgeStyles }),
    });
  }
  const debouncedSaveLayout = debounce(saveLayout, 1000);

  async function refreshViolations() {
    const violations = await validateGraph(graph);
    violationsEl.replaceChildren(
      ...(violations.length ? violations : ["no violations"]).map((v) => {
        const li = document.createElement("li");
        li.textContent = v;
        return li;
      })
    );
  }

  function elementsFromGraph() {
    return [
      ...graph.vertices.map((v) => ({
        data: { id: v.id, label: v.label, kind: topLevelKind(v.label, labelSet.vertex_labels) },
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
        },
      },
      { selector: "node[kind = 'A']", style: { shape: "diamond", label: "A", width: 30, height: 30, padding: 0 } },
      {
        selector: "edge",
        style: {
          label: "data(label)",
          "curve-style": "data(curveStyle)",
          "target-arrow-shape": "triangle",
          "font-size": 8,
        },
      },
    ],
  });

  function rerender() {
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

  renderPalette(document.getElementById("palette"), labelSet.vertex_labels, tryAddVertex);

  document.getElementById("graph").addEventListener("contextmenu", (evt) => evt.preventDefault());

  const eh = cy.edgehandles({
    canConnect: (source, target) => !!inferredEdgeLabel(labelSet, source.data("label"), target.data("label")),
    edgeParams: () => ({}),
    complete: (sourceNode, targetNode, addedEles) => {
      addedEles.remove();
      if (reconnecting) {
        const { edgeId, movingEnd } = reconnecting;
        reconnecting = null;
        tryReconnectEdge(edgeId, movingEnd, targetNode.id());
      } else {
        tryAddEdge(sourceNode.id(), targetNode.id());
      }
    },
  });

  // The library has no built-in hover handle, so we draw our own small dot
  // at the node's edge on hover. Dragging the node body always moves it;
  // dragging from the dot starts an edge (Figma/Canva/Miro-style), no mode toggle.
  const handleEl = document.createElement("div");
  handleEl.className = "edge-handle";
  handleEl.hidden = true;
  document.getElementById("graph").append(handleEl);

  let hoveredNode = null;

  function positionHandle(node) {
    const pos = node.renderedPosition();
    handleEl.style.left = `${pos.x + node.renderedOuterWidth() / 2}px`;
    handleEl.style.top = `${pos.y}px`;
  }

  cy.on("mouseover", "node", (evt) => {
    hoveredNode = evt.target;
    positionHandle(hoveredNode);
    handleEl.hidden = false;
  });
  cy.on("mouseout", "node", () => {
    hoveredNode = null;
    handleEl.hidden = true;
  });
  cy.on("pan zoom position", () => {
    if (hoveredNode) positionHandle(hoveredNode);
  });

  handleEl.addEventListener("mousedown", (evt) => {
    evt.preventDefault();
    handleEl.hidden = true;
    if (hoveredNode) eh.start(hoveredNode);
  });

  // Selecting an edge shows a drag handle at each end; dragging one to a
  // different node reconnects that end. edgehandles can only start a drag
  // from a fixed anchor toward a dropped target, so to move the *source*
  // end (target fixed) we anchor on the target and swap direction on completion.
  let reconnecting = null; // { edgeId, movingEnd: "src" | "tgt" }
  const sourceHandleEl = document.createElement("div");
  sourceHandleEl.className = "edge-handle";
  sourceHandleEl.hidden = true;
  const targetHandleEl = document.createElement("div");
  targetHandleEl.className = "edge-handle";
  targetHandleEl.hidden = true;
  document.getElementById("graph").append(sourceHandleEl, targetHandleEl);

  let selectedEdge = null;

  function positionReconnectHandles(edge) {
    const srcPos = cy.getElementById(edge.data("source")).renderedPosition();
    const tgtPos = cy.getElementById(edge.data("target")).renderedPosition();
    sourceHandleEl.style.left = `${srcPos.x}px`;
    sourceHandleEl.style.top = `${srcPos.y}px`;
    targetHandleEl.style.left = `${tgtPos.x}px`;
    targetHandleEl.style.top = `${tgtPos.y}px`;
  }

  cy.on("select", "edge", (evt) => {
    selectedEdge = evt.target;
    positionReconnectHandles(selectedEdge);
    sourceHandleEl.hidden = false;
    targetHandleEl.hidden = false;
  });
  cy.on("unselect", "edge", () => {
    selectedEdge = null;
    sourceHandleEl.hidden = true;
    targetHandleEl.hidden = true;
  });
  cy.on("pan zoom position", () => {
    if (selectedEdge) positionReconnectHandles(selectedEdge);
  });

  sourceHandleEl.addEventListener("mousedown", (evt) => {
    evt.preventDefault();
    if (!selectedEdge) return;
    reconnecting = { edgeId: selectedEdge.id(), movingEnd: "src" };
    sourceHandleEl.hidden = true;
    targetHandleEl.hidden = true;
    eh.start(cy.getElementById(selectedEdge.data("target")));
  });
  targetHandleEl.addEventListener("mousedown", (evt) => {
    evt.preventDefault();
    if (!selectedEdge) return;
    reconnecting = { edgeId: selectedEdge.id(), movingEnd: "tgt" };
    sourceHandleEl.hidden = true;
    targetHandleEl.hidden = true;
    eh.start(cy.getElementById(selectedEdge.data("source")));
  });

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

  function renderProperties(element) {
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
