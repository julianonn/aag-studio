// Shared helpers between the library screen and the editor.

export function topLevelKind(label, vertexParents) {
  const parents = vertexParents[label] ?? [];
  return parents.length === 0 ? label : topLevelKind(parents[0], vertexParents);
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
