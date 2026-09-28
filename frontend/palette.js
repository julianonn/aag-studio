// Renders the vertex-label palette as nested <details> trees, one per poset root.

function childrenOf(vertexLabels) {
  const children = {};
  for (const label of Object.keys(vertexLabels)) {
    for (const parent of vertexLabels[label]) {
      (children[parent] ??= []).push(label);
    }
  }
  return children;
}

function renderNode(label, children, onSelect) {
  const kids = children[label] ?? [];
  if (kids.length === 0) {
    const button = document.createElement("button");
    button.textContent = label;
    button.onclick = () => onSelect(label);
    return button;
  }
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = label;
  details.append(summary);
  for (const kid of kids.sort()) details.append(renderNode(kid, children, onSelect));
  return details;
}

export function renderPalette(container, vertexLabels, onSelect) {
  const children = childrenOf(vertexLabels);
  const roots = Object.keys(vertexLabels).filter((label) => vertexLabels[label].length === 0);
  container.replaceChildren(...roots.sort().map((root) => renderNode(root, children, onSelect)));
}
