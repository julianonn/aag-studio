// Renders the vertex-label palette into 3 distinct sections (Resource, Agent, A)
// with clear visual hierarchy separating expandable menus from selectable nodes.

export function childrenOf(vertexLabels) {
  const children = {};
  for (const label of Object.keys(vertexLabels)) {
    for (const parent of vertexLabels[label]) {
      (children[parent] ??= []).push(label);
    }
  }
  return children;
}

function createNodeButton(label, onSelect, isSelected, displayName = null) {
  const btn = document.createElement("button");
  btn.className = `palette-node-btn ${isSelected ? "active" : ""}`;
  btn.type = "button";
  btn.title = `Select ${label}`;

  const bullet = document.createElement("span");
  bullet.className = "palette-node-bullet";
  bullet.textContent = "•";

  const nameSpan = document.createElement("span");
  nameSpan.className = "palette-node-label";
  nameSpan.textContent = displayName || label;

  btn.append(bullet, nameSpan);
  btn.onclick = () => onSelect(label);
  return btn;
}

function renderCategoryOrNode(label, children, onSelect, selectedLabel) {
  const childLabels = children[label] ?? [];
  const isSelected = label === selectedLabel;

  if (childLabels.length === 0) {
    return { el: createNodeButton(label, onSelect, isSelected), containsSelected: isSelected };
  }

  const details = document.createElement("details");
  details.className = "palette-menu";

  const summary = document.createElement("summary");
  summary.className = "palette-menu-summary";

  const titleSpan = document.createElement("span");
  titleSpan.className = "palette-menu-title";
  titleSpan.textContent = label;

  summary.append(titleSpan);
  details.append(summary);

  const body = document.createElement("div");
  body.className = "palette-menu-body";

  let childSelected = isSelected;

  const selfBtn = createNodeButton(label, onSelect, isSelected, `${label} (general)`);
  body.append(selfBtn);

  for (const childLabel of childLabels.sort()) {
    const res = renderCategoryOrNode(childLabel, children, onSelect, selectedLabel);
    if (res.containsSelected) childSelected = true;
    body.append(res.el);
  }

  details.append(body);
  if (childSelected) {
    details.open = true;
  }

  return { el: details, containsSelected: childSelected };
}

export function renderPalette(container, vertexLabels, onSelect, selectedLabel = null) {
  const children = childrenOf(vertexLabels);
  const roots = Object.keys(vertexLabels).filter((l) => vertexLabels[l].length === 0).sort();

  const sections = [];

  for (const root of roots) {
    const section = document.createElement("div");
    section.className = "palette-section";

    const title = document.createElement("div");
    title.className = "island-section-title";
    title.textContent = root.toUpperCase();
    section.append(title);

    const childLabels = children[root] ?? [];
    if (childLabels.length === 0) {
      const btn = createNodeButton(root, onSelect, root === selectedLabel);
      section.append(btn);
    } else {
      for (const childLabel of childLabels.sort()) {
        const res = renderCategoryOrNode(childLabel, children, onSelect, selectedLabel);
        section.append(res.el);
      }
      const rootSelfBtn = createNodeButton(root, onSelect, root === selectedLabel, `${root} (general)`);
      section.append(rootSelfBtn);
    }

    sections.push(section);
  }

  container.replaceChildren(...sections);
}

export function populateUniformLabelSelect(selectEl, vertexLabels, selectedLabel) {
  selectEl.replaceChildren();
  const children = childrenOf(vertexLabels);
  const roots = Object.keys(vertexLabels).filter((l) => vertexLabels[l].length === 0).sort();

  function appendToGroup(group, label, depth = 0) {
    const opt = document.createElement("option");
    opt.value = label;
    const indent = "\u00A0\u00A0".repeat(depth);
    opt.textContent = `${indent}${label}`;
    opt.selected = label === selectedLabel;
    group.append(opt);

    const childLabels = (children[label] ?? []).sort();
    for (const child of childLabels) {
      appendToGroup(group, child, depth + 1);
    }
  }

  for (const root of roots) {
    const group = document.createElement("optgroup");
    group.label = root.toUpperCase();
    appendToGroup(group, root, 0);
    selectEl.append(group);
  }
}
