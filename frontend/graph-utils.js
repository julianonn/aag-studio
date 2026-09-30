// Shared helpers between the home screen and the editor.

export function topLevelKind(label, vertexParents) {
  const parents = vertexParents[label] ?? [];
  return parents.length === 0 ? label : topLevelKind(parents[0], vertexParents);
}

const RESOURCE_SUBTYPES = ["credential", "device", "account", "phone_number"];

export function resourceSubtype(label, vertexParents) {
  if (RESOURCE_SUBTYPES.includes(label)) return label;
  const parents = vertexParents[label] ?? [];
  if (parents.length === 0) return null;
  return resourceSubtype(parents[0], vertexParents);
}

function isA(vertexParents, label, ancestor) {
  return label === ancestor || (vertexParents[label] ?? []).some((parent) => isA(vertexParents, parent, ancestor));
}

// Client-side edge rule preview for instant drag feedback
export function inferredEdgeLabel(labelSet, sourceLabel, targetLabel) {
  for (const rule of labelSet.edge_rules) {
    if (isA(labelSet.vertex_labels, sourceLabel, rule.source) && isA(labelSet.vertex_labels, targetLabel, rule.target)) {
      return rule.label;
    }
  }
  return null;
}

export function nextId(existingIds, label) {
  let counter = 1;
  while (existingIds.has(`${label}_${counter}`)) counter++;
  return `${label}_${counter}`;
}

export async function validateGraph(graph) {
  const response = await fetch("/api/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(graph),
  });
  return response.json();
}

export function debounce(fn, delayMs) {
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

export function computeDefaultLayout(vertices, edges) {
  if (vertices.length === 0) return {};

  const outgoing = {};
  const inDegree = {};
  for (const vertex of vertices) {
    outgoing[vertex.id] = [];
    inDegree[vertex.id] = 0;
  }
  for (const edge of edges) {
    if (outgoing[edge.src] && inDegree[edge.tgt] !== undefined) {
      outgoing[edge.src].push(edge.tgt);
      inDegree[edge.tgt]++;
    }
  }

  const rank = {};
  for (const vertex of vertices) rank[vertex.id] = 0;

  const queue = vertices.filter((vertex) => inDegree[vertex.id] === 0).map((vertex) => vertex.id);
  const visitedCount = {};

  while (queue.length > 0) {
    const currentId = queue.shift();
    visitedCount[currentId] = (visitedCount[currentId] || 0) + 1;
    if (visitedCount[currentId] > vertices.length) continue;

    for (const targetId of outgoing[currentId]) {
      const nextRank = rank[currentId] + 1;
      if (nextRank > rank[targetId]) {
        rank[targetId] = nextRank;
        queue.push(targetId);
      }
    }
  }

  const maxRank = Math.max(...Object.values(rank), 0);
  const layers = {};
  for (const vertex of vertices) {
    const layerIndex = rank[vertex.id];
    (layers[layerIndex] ??= []).push(vertex.id);
  }

  const HORIZONTAL_SPACING = 150;
  const VERTICAL_SPACING = 120;
  const positions = {};

  for (const [layerIndex, vertexIds] of Object.entries(layers)) {
    const y = (maxRank - Number(layerIndex)) * VERTICAL_SPACING;
    const count = vertexIds.length;
    vertexIds.forEach((id, index) => {
      const x = (index - (count - 1) / 2) * HORIZONTAL_SPACING;
      positions[id] = [x, y];
    });
  }

  return positions;
}
