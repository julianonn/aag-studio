// Library screen (list/open/new/delete graphs) and the graph editor
// (palette, typed edge tool, properties panel, validation panel).

import { renderPalette } from "./palette.js";

const KIND_COLOR = { resource: "#4c8bf5", agent: "#f5a623", A: "#7b7b7b" };

function topLevelKind(label, vertexParents) {
  const parents = vertexParents[label] ?? [];
  return parents.length === 0 ? label : topLevelKind(parents[0], vertexParents);
}

function isA(vertexParents, label, ancestor) {
  return label === ancestor || (vertexParents[label] ?? []).some((p) => isA(vertexParents, p, ancestor));
}

// Client-side mirror of the backend's edge-rule matching, for instant
// feedback while dragging an edge. The backend call in tryAddEdge is what
// actually decides whether the edge is kept.
function inferredEdgeLabel(labelSet, sourceLabel, targetLabel) {
  for (const rule of labelSet.edge_rules) {
    if (isA(labelSet.vertex_labels, sourceLabel, rule.source) && isA(labelSet.vertex_labels, targetLabel, rule.target)) {
      return rule.label;
    }
  }
  return null;
}

function nextId(existingIds, label) {
  let n = 1;
  while (existingIds.has(`${label}_${n}`)) n++;
  return `${label}_${n}`;
}

async function validateGraph(graph) {
  const response = await fetch("/api/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(graph),
  });
  return response.json();
}

function debounce(fn, delayMs) {
  let timer = null;
  let lastArgs = null;
  const debounced = (...args) => {
    lastArgs = args;
    clearTimeout(timer);
    timer = setTimeout(() => fn(...lastArgs), delayMs);
  };
  debounced.flush = () => {
    if (lastArgs === null) return;
    clearTimeout(timer);
    fn(...lastArgs);
  };
  return debounced;
}

const libraryEl = document.getElementById("library");
const editorEl = document.getElementById("editor");
const graphListEl = document.getElementById("graph-list");

let labelSet = null;
let currentCy = null;

async function showLibrary() {
  if (currentCy) {
    currentCy.destroy();
    currentCy = null;
  }
  editorEl.hidden = true;
  libraryEl.hidden = false;

  const graphNames = await fetch("/api/graphs").then((r) => r.json());
  graphListEl.replaceChildren(
    ...graphNames.map((name) => {
      const li = document.createElement("li");
      const openButton = document.createElement("button");
      openButton.textContent = name;
      openButton.onclick = () => openEditor(name);
      const deleteButton = document.createElement("button");
      deleteButton.textContent = "delete";
      deleteButton.onclick = async () => {
        if (!confirm(`delete graph "${name}"?`)) return;
        await fetch(`/api/graphs/${name}`, { method: "DELETE" });
        showLibrary();
      };
      li.append(openButton, deleteButton);
      return li;
    })
  );
}

async function openEditor(graphName) {
  libraryEl.hidden = true;
  editorEl.hidden = false;

  let graph = await fetch(`/api/graphs/${graphName}`).then((r) => r.json());
  const layout = await fetch(`/api/graphs/${graphName}/layout`).then((r) => r.json());

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

  function saveLayout(positions) {
    fetch(`/api/graphs/${graphName}/layout`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(positions),
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
        position: layout[v.id] ? { x: layout[v.id][0], y: layout[v.id][1] } : undefined,
      })),
      ...graph.edges.map((e) => ({
        data: { id: e.id, source: e.src, target: e.tgt, label: e.label, time: e.time },
      })),
    ];
  }

  const cy = cytoscape({
    container: document.getElementById("graph"),
    elements: elementsFromGraph(),
    layout: Object.keys(layout).length ? { name: "preset" } : { name: "breadthfirst" },
    style: [
      {
        selector: "node",
        style: {
          label: "data(label)",
          "background-color": (n) => KIND_COLOR[n.data("kind")] ?? "#999",
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
          "curve-style": "bezier",
          "target-arrow-shape": "triangle",
          "font-size": 8,
        },
      },
    ],
  });
  currentCy = cy;

  function rerender() {
    cy.elements().remove();
    cy.add(elementsFromGraph());
    if (!Object.keys(layout).length) cy.layout({ name: "breadthfirst" }).run();
  }

  async function tryAddVertex(label) {
    const id = nextId(new Set(graph.vertices.map((v) => v.id)), label);
    const candidate = { vertices: [...graph.vertices, { id, label }], edges: graph.edges };
    const violations = await validateGraph(candidate);
    if (violations.length) {
      alert(violations.join("\n"));
      return;
    }
    graph = candidate;
    rerender();
    refreshViolations();
    debouncedSaveGraph();
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
    const candidate = { vertices: graph.vertices, edges: [...graph.edges, edge] };
    const violations = await validateGraph(candidate);
    if (violations.length) {
      alert(violations.join("\n"));
      return;
    }
    graph = candidate;
    rerender();
    refreshViolations();
    debouncedSaveGraph();
  }

  renderPalette(document.getElementById("palette"), labelSet.vertex_labels, tryAddVertex);

  const eh = cy.edgehandles({
    canConnect: (source, target) => !!inferredEdgeLabel(labelSet, source.data("label"), target.data("label")),
    edgeParams: () => ({}),
    complete: (sourceNode, targetNode, addedEles) => {
      addedEles.remove();
      tryAddEdge(sourceNode.id(), targetNode.id());
    },
  });

  // The library has no hover-only handle mode: drawing an edge requires the
  // whole node body to act as the handle, which conflicts with dragging a
  // node to move it. So dragging and connecting are separate, explicit modes.
  const connectToggle = document.getElementById("connect-toggle");
  connectToggle.onclick = () => {
    const nowActive = !connectToggle.classList.contains("active");
    connectToggle.classList.toggle("active", nowActive);
    if (nowActive) eh.enableDrawMode();
    else eh.disableDrawMode();
  };
  connectToggle.classList.remove("active");
  eh.disableDrawMode();

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
        const candidate = { vertices: graph.vertices, edges: newEdges };
        const violations = await validateGraph(candidate);
        if (violations.length) {
          alert(violations.join("\n"));
          return;
        }
        graph = candidate;
        refreshViolations();
        debouncedSaveGraph();
      }
      start.onchange = commit;
      end.onchange = commit;
    });
    propertiesEl.append(list);
  }

  cy.on("tap", "node, edge", (evt) => renderProperties(evt.target));

  cy.on("dragfree", "node", () => {
    const positions = {};
    cy.nodes().forEach((n) => (positions[n.id()] = [n.position("x"), n.position("y")]));
    debouncedSaveLayout(positions);
  });

  window.addEventListener("beforeunload", () => {
    debouncedSaveGraph.flush();
    debouncedSaveLayout.flush();
  });

  document.getElementById("back-to-library").onclick = showLibrary;

  await refreshViolations();
}

async function main() {
  labelSet = await fetch("/api/labels").then((r) => r.json());

  document.getElementById("new-graph-btn").onclick = async () => {
    const name = document.getElementById("new-graph-name").value.trim();
    if (!name) return;
    await fetch(`/api/graphs/${name}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vertices: [], edges: [] }),
    });
    openEditor(name);
  };

  await showLibrary();
}

main();
