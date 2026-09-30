import { renderPalette } from "./palette.js";

export function parseTimeBound(val) {
  if (val === null || val === undefined) return null;
  const trimmed = String(val).trim();
  if (trimmed === "" || trimmed.toLowerCase() === "inf") {
    return null;
  }
  const num = Number(trimmed);
  return Number.isNaN(num) ? trimmed : num;
}

export function initEditorLeftIsland({
  labelSet,
  onClose,
  onRenameVertex,
  onChangeVertexLabel,
  onDuplicateVertex,
  onDeleteVertex,
  onRenameEdge,
  onChangeEdgeLabel,
  onUpdateEdgeTime,
  onSetEdgeStyle,
  onSetEdgeElbow,
  onDuplicateEdge,
  onDeleteEdge,
}) {
  const leftIsland = document.getElementById("left-island");
  const leftIslandTitle = document.getElementById("left-island-title");
  const leftIslandBody = document.getElementById("left-island-body");
  const leftIslandCloseBtn = document.getElementById("left-island-close");

  let currentMode = null; // "node" | "edge" | "palette" | "add-edge" | null

  if (leftIslandCloseBtn) {
    leftIslandCloseBtn.onclick = () => {
      close();
      onClose?.();
    };
  }

  function close() {
    currentMode = null;
    if (leftIsland) leftIsland.hidden = true;
    if (leftIslandBody) leftIslandBody.replaceChildren();
  }

  function labeledField(labelText, inputEl) {
    const row = document.createElement("div");
    row.className = "field-row";
    const label = document.createElement("label");
    label.className = "island-field-label";
    label.textContent = labelText;
    row.append(label, inputEl);
    return row;
  }

  function createSectionTitle(text) {
    const title = document.createElement("div");
    title.className = "island-field-label";
    title.textContent = text;
    return title;
  }

  function createItemActionsRow(onDuplicate, onDelete) {
    const row = document.createElement("div");
    row.className = "island-actions-row";

    const dupBtn = document.createElement("button");
    dupBtn.className = "island-action-btn";
    dupBtn.type = "button";
    dupBtn.innerHTML = '<i class="mdi mdi-content-copy"></i> Duplicate';
    dupBtn.onclick = onDuplicate;

    const delBtn = document.createElement("button");
    delBtn.className = "island-action-btn danger";
    delBtn.type = "button";
    delBtn.innerHTML = '<i class="mdi mdi-delete-outline"></i> Delete';
    delBtn.onclick = onDelete;

    row.append(dupBtn, delBtn);
    return row;
  }

  function showVertex(vertex) {
    currentMode = "node";
    if (leftIslandTitle) leftIslandTitle.textContent = "Vertex";

    const idInput = document.createElement("input");
    idInput.value = vertex.id;
    idInput.onchange = () => onRenameVertex(vertex.id, idInput.value.trim());
    const idRow = labeledField("ID", idInput);

    const labelTitle = createSectionTitle("Label");

    const paletteTree = document.createElement("div");
    paletteTree.id = "palette-tree";
    renderPalette(
      paletteTree,
      labelSet.vertex_labels,
      (newLabel) => onChangeVertexLabel(vertex.id, newLabel),
      vertex.label
    );

    const separator = document.createElement("div");
    separator.className = "island-separator";

    const actionsRow = createItemActionsRow(
      () => onDuplicateVertex(vertex.id),
      () => onDeleteVertex(vertex.id)
    );

    if (leftIslandBody) {
      leftIslandBody.replaceChildren(idRow, labelTitle, paletteTree, separator, actionsRow);
    }
    if (leftIsland) leftIsland.hidden = false;
  }

  function showEdge(edge, edgeStyles, edgeElbows) {
    currentMode = "edge";
    if (leftIslandTitle) leftIslandTitle.textContent = "Edge";

    const idInput = document.createElement("input");
    idInput.value = edge.id;
    idInput.onchange = () => onRenameEdge(edge.id, idInput.value.trim());
    const idRow = labeledField("ID", idInput);

    const endpointsTitle = createSectionTitle("Endpoints");
    const endpointsVal = document.createElement("div");
    endpointsVal.className = "island-endpoints-row";
    endpointsVal.innerHTML = `<span class="island-endpoint-node">${edge.src}</span><i class="mdi mdi-arrow-right island-endpoint-arrow"></i><span class="island-endpoint-node">${edge.tgt}</span>`;

    const typeTitle = createSectionTitle("Label");
    const typeGroup = document.createElement("div");
    typeGroup.className = "island-btn-group";
    const types = ["HA", "GA"];
    for (const t of types) {
      const btn = document.createElement("button");
      btn.className = `island-group-btn ${edge.label === t.toLowerCase() ? "active" : ""}`;
      btn.type = "button";
      btn.textContent = t;
      btn.onclick = () => {
        if (edge.label === t.toLowerCase()) return;
        onChangeEdgeLabel(edge.id, t.toLowerCase());
      };
      typeGroup.append(btn);
    }

    const timeTitle = createSectionTitle("Time");
    const intervals = edge.time?.length ? edge.time : [[0, null]];
    const timeRows = intervals.map((interval, intervalIndex) => {
      const row = document.createElement("div");
      row.className = "island-time-row";
      const fromInput = document.createElement("input");
      fromInput.className = "island-time-input";
      fromInput.type = "text";
      fromInput.value = interval[0] ?? "";
      fromInput.placeholder = "0";

      const toSpan = document.createElement("span");
      toSpan.textContent = "to";

      const untilInput = document.createElement("input");
      untilInput.className = "island-time-input";
      untilInput.type = "text";
      untilInput.value = interval[1] ?? "";
      untilInput.placeholder = "inf";

      function commit() {
        const newInterval = [
          fromInput.value === "" ? null : parseTimeBound(fromInput.value),
          untilInput.value === "" ? null : parseTimeBound(untilInput.value),
        ];
        onUpdateEdgeTime(edge.id, intervalIndex, newInterval);
      }
      fromInput.onchange = commit;
      untilInput.onchange = commit;

      row.append(fromInput, toSpan, untilInput);
      return row;
    });

    const currentStyle = edgeStyles[edge.id] ?? "bezier";
    const styleTitle = createSectionTitle("Style");
    const styleGroup = document.createElement("div");
    styleGroup.className = "island-btn-group";
    const styles = [
      { id: "bezier", title: "Curved", icon: "mdi-vector-curve" },
      { id: "taxi", title: "Elbow", icon: "mdi-vector-polyline" },
      { id: "straight", title: "Straight", icon: "mdi-vector-line" },
    ];
    for (const s of styles) {
      const btn = document.createElement("button");
      btn.className = `island-group-btn ${currentStyle === s.id ? "active" : ""}`;
      btn.type = "button";
      btn.title = s.title;
      btn.innerHTML = `<i class="mdi ${s.icon}"></i>`;
      btn.onclick = () => onSetEdgeStyle(edge.id, s.id);
      styleGroup.append(btn);
    }

    const bottomItems = [];
    if (currentStyle === "taxi") {
      const elbowTitle = createSectionTitle("Elbow Offset");
      const elbowInput = document.createElement("input");
      elbowInput.type = "number";
      elbowInput.value = edgeElbows[edge.id] ?? "";
      elbowInput.placeholder = "auto";
      elbowInput.onchange = () => {
        const val = elbowInput.value.trim();
        onSetEdgeElbow(edge.id, val === "" ? null : Number(val));
      };
      bottomItems.push(elbowTitle, labeledField("Pos", elbowInput));
    }

    const separator = document.createElement("div");
    separator.className = "island-separator";
    const actionsRow = createItemActionsRow(
      () => onDuplicateEdge(edge.id),
      () => onDeleteEdge(edge.id)
    );
    bottomItems.push(separator, actionsRow);

    if (leftIslandBody) {
      leftIslandBody.replaceChildren(
        idRow,
        endpointsTitle,
        endpointsVal,
        typeTitle,
        typeGroup,
        timeTitle,
        ...timeRows,
        styleTitle,
        styleGroup,
        ...bottomItems
      );
    }
    if (leftIsland) leftIsland.hidden = false;
  }

  function showAddVertex({ defaultId, onAddVertex }) {
    currentMode = "palette";
    if (leftIslandTitle) leftIslandTitle.textContent = "Vertex";

    let currentNameVal = defaultId;
    const nameInput = document.createElement("input");
    nameInput.value = currentNameVal;
    nameInput.placeholder = "v_0";
    nameInput.onchange = () => {
      currentNameVal = nameInput.value.trim();
    };
    const idRow = labeledField("ID", nameInput);
    const labelTitle = createSectionTitle("Label");

    const container = document.createElement("div");
    container.id = "palette-tree";
    renderPalette(container, labelSet.vertex_labels, (label) => {
      const addedName = currentNameVal.trim() || null;
      const nextSuggestedId = onAddVertex(label, addedName);
      if (nextSuggestedId) {
        currentNameVal = nextSuggestedId;
        nameInput.value = nextSuggestedId;
      }
    });

    if (leftIslandBody) {
      leftIslandBody.replaceChildren(idRow, labelTitle, container);
    }
    if (leftIsland) leftIsland.hidden = false;
  }

  function showAddEdge({ defaultId, selectedType, selectedStyle, edgeTimeFrom, edgeTimeUntil, onTypeChange, onStyleChange, onTimeChange, onNameChange }) {
    currentMode = "add-edge";
    if (leftIslandTitle) leftIslandTitle.textContent = "Edge";

    const nameInput = document.createElement("input");
    nameInput.value = defaultId;
    nameInput.placeholder = "e_0";
    nameInput.onchange = () => onNameChange(nameInput.value.trim());
    const idRow = labeledField("ID", nameInput);

    const typeTitle = createSectionTitle("Label");
    const typeGroup = document.createElement("div");
    typeGroup.className = "island-btn-group";
    const types = ["HA", "GA"];
    for (const t of types) {
      const btn = document.createElement("button");
      btn.className = `island-group-btn ${selectedType === t.toLowerCase() ? "active" : ""}`;
      btn.type = "button";
      btn.textContent = t;
      btn.onclick = () => {
        for (const child of typeGroup.children) child.classList.remove("active");
        btn.classList.add("active");
        onTypeChange(t.toLowerCase());
      };
      typeGroup.append(btn);
    }

    const timeTitle = createSectionTitle("Time");
    const timeRow = document.createElement("div");
    timeRow.className = "island-time-row";
    const fromInput = document.createElement("input");
    fromInput.className = "island-time-input";
    fromInput.type = "text";
    fromInput.value = edgeTimeFrom;
    fromInput.onchange = () => onTimeChange(fromInput.value, untilInput.value);

    const toSpan = document.createElement("span");
    toSpan.textContent = "to";

    const untilInput = document.createElement("input");
    untilInput.className = "island-time-input";
    untilInput.type = "text";
    untilInput.value = edgeTimeUntil;
    untilInput.onchange = () => onTimeChange(fromInput.value, untilInput.value);

    timeRow.append(fromInput, toSpan, untilInput);

    const styleTitle = createSectionTitle("Style");
    const styleGroup = document.createElement("div");
    styleGroup.className = "island-btn-group";
    const styles = [
      { id: "bezier", title: "Curved", icon: "mdi-vector-curve" },
      { id: "taxi", title: "Elbow", icon: "mdi-vector-polyline" },
      { id: "straight", title: "Straight", icon: "mdi-vector-line" },
    ];
    for (const s of styles) {
      const btn = document.createElement("button");
      btn.className = `island-group-btn ${selectedStyle === s.id ? "active" : ""}`;
      btn.type = "button";
      btn.title = s.title;
      btn.innerHTML = `<i class="mdi ${s.icon}"></i>`;
      btn.onclick = () => {
        for (const child of styleGroup.children) child.classList.remove("active");
        btn.classList.add("active");
        onStyleChange(s.id);
      };
      styleGroup.append(btn);
    }

    if (leftIslandBody) {
      leftIslandBody.replaceChildren(idRow, typeTitle, typeGroup, timeTitle, timeRow, styleTitle, styleGroup);
    }
    if (leftIsland) leftIsland.hidden = false;
  }

  return {
    showVertex,
    showEdge,
    showAddVertex,
    showAddEdge,
    close,
    getMode: () => currentMode,
    isOpen: () => leftIsland && !leftIsland.hidden,
  };
}
