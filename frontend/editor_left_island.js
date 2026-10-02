import { renderPalette } from "./palette.js";
import { closeActiveCalendar, openCalendarPopup } from "./calendar_popup.js";

export function parseTimeBound(val) {
	if (val === null || val === undefined) return null;
	const trimmed = String(val).trim();
	if (trimmed === "" || trimmed.toLowerCase() === "inf") {
		return null;
	}
	const num = Number(trimmed);
	return Number.isNaN(num) ? trimmed : num;
}

export function normalizeTimeRules(time) {
	if (!Array.isArray(time) || time.length === 0) {
		return [];
	}
	return time
		.map((item) => {
			if (Array.isArray(item)) {
				if (item[0] !== null && item[0] !== undefined && item[0] !== 0) {
					return { mode: "relative", op: "at least", value: item[0], unit: "min" };
				}
				if (item[1] !== null && item[1] !== undefined && item[1] !== "inf") {
					return { mode: "relative", op: "at most", value: item[1], unit: "min" };
				}
				return null;
			}
			return {
				mode: item.mode || "",
				op: item.op || "",
				value: item.value ?? "",
				unit: item.unit ?? "",
			};
		})
		.filter(Boolean);
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
		closeActiveCalendar();
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
		title.className = "island-field-label island-section-title";
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
			vertex.label,
		);

		const separator = document.createElement("div");
		separator.className = "island-separator";

		const actionsRow = createItemActionsRow(
			() => onDuplicateVertex(vertex.id),
			() => onDeleteVertex(vertex.id),
		);

		if (leftIslandBody) {
			leftIslandBody.replaceChildren(
				idRow,
				labelTitle,
				paletteTree,
				separator,
				actionsRow,
			);
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

		const rules = normalizeTimeRules(edge.time);

		function updateRules(newRules) {
			closeActiveCalendar();
			onUpdateEdgeTime(edge.id, newRules);
			showEdge({ ...edge, time: newRules }, edgeStyles, edgeElbows);
		}

		const timeHeader = document.createElement("div");
		timeHeader.className = "island-section-header";
		const timeTitle = createSectionTitle("Time Rules");
		const addBtn = document.createElement("button");
		addBtn.type = "button";
		addBtn.className = "island-time-icon-btn";
		addBtn.innerHTML = '<i class="mdi mdi-plus-circle-outline"></i>';
		addBtn.title = "Add rule";
		addBtn.onclick = () => {
			closeActiveCalendar();
			const updated = [...rules, { mode: "", op: "", value: "", unit: "" }];
			updateRules(updated);
		};
		timeHeader.append(timeTitle, addBtn);

		const timeElements = [];
		for (let index = 0; index < rules.length; index++) {
			const rule = rules[index];
			const row = document.createElement("div");
			row.className = "island-time-row";

			const controls = document.createElement("div");
			controls.className = "island-time-controls";

			const modeSelect = document.createElement("select");
			modeSelect.className = "island-time-select";
			const optBlank = document.createElement("option");
			optBlank.value = "";
			optBlank.textContent = "—";
			const optRel = document.createElement("option");
			optRel.value = "relative";
			optRel.textContent = "Relative";
			const optAbs = document.createElement("option");
			optAbs.value = "absolute";
			optAbs.textContent = "Absolute";
			modeSelect.append(optBlank, optRel, optAbs);
			modeSelect.value = rule.mode || "";
			modeSelect.onchange = () => {
				closeActiveCalendar();
				const updated = [...rules];
				const isRel = modeSelect.value === "relative";
				const isAbs = modeSelect.value === "absolute";
				if (isRel) {
					updated[index] = {
						mode: "relative",
						op: "at most",
						value: "",
						unit: "min",
					};
				} else if (isAbs) {
					updated[index] = {
						mode: "absolute",
						op: "before",
						value: "",
						unit: undefined,
					};
				} else {
					updated[index] = {
						mode: "",
						op: "",
						value: "",
						unit: "",
					};
				}
				updateRules(updated);
			};

			controls.append(modeSelect);

			if (rule.mode === "relative") {
				const sep = document.createElement("span");
				sep.className = "island-endpoint-node island-time-dash";
				sep.textContent = "—";

				const opSelect = document.createElement("select");
				opSelect.className = "island-time-select";
				const op1 = document.createElement("option");
				op1.value = "at most";
				op1.textContent = "at most";
				const op2 = document.createElement("option");
				op2.value = "at least";
				op2.textContent = "at least";
				opSelect.append(op1, op2);
				opSelect.value = rule.op === "at least" ? "at least" : "at most";
				opSelect.onchange = () => {
					closeActiveCalendar();
					const updated = [...rules];
					updated[index] = { ...rule, op: opSelect.value };
					updateRules(updated);
				};

				const valInput = document.createElement("input");
				valInput.type = "text";
				valInput.className = "island-time-input island-time-num-input";
				valInput.placeholder = "0";
				valInput.value = rule.value ?? "";
				valInput.onchange = () => {
					const updated = [...rules];
					const trimmed = valInput.value.trim();
					const num = Number(trimmed);
					updated[index] = { ...rule, value: (trimmed !== "" && !Number.isNaN(num)) ? num : trimmed };
					updateRules(updated);
				};

				const unitSelect = document.createElement("select");
				unitSelect.className = "island-time-select";
				for (const u of ["sec", "min", "hour", "day"]) {
					const opt = document.createElement("option");
					opt.value = u;
					opt.textContent = u;
					unitSelect.append(opt);
				}
				unitSelect.value = rule.unit || "min";
				unitSelect.onchange = () => {
					closeActiveCalendar();
					const updated = [...rules];
					updated[index] = { ...rule, unit: unitSelect.value };
					updateRules(updated);
				};

				const suffix = document.createElement("span");
				suffix.className = "island-endpoint-node";
				suffix.textContent = "after source";

				controls.append(sep, opSelect, valInput, unitSelect, suffix);
			} else if (rule.mode === "absolute") {
				const sep = document.createElement("span");
				sep.className = "island-endpoint-node island-time-dash";
				sep.textContent = "—";

				const opSelect = document.createElement("select");
				opSelect.className = "island-time-select";
				const op1 = document.createElement("option");
				op1.value = "before";
				op1.textContent = "before";
				const op2 = document.createElement("option");
				op2.value = "after";
				op2.textContent = "after";
				opSelect.append(op1, op2);
				opSelect.value = rule.op === "after" ? "after" : "before";
				opSelect.onchange = () => {
					closeActiveCalendar();
					const updated = [...rules];
					updated[index] = { ...rule, op: opSelect.value };
					updateRules(updated);
				};

				const dateInput = document.createElement("input");
				dateInput.type = "text";
				dateInput.className = "island-time-input island-time-date-input";
				dateInput.placeholder = "YYYY-MM-DD";
				dateInput.value = rule.value ?? "";
				dateInput.onchange = () => {
					const updated = [...rules];
					updated[index] = { ...rule, value: dateInput.value.trim() };
					updateRules(updated);
				};
				dateInput.onkeydown = (e) => {
					if (e.key === "Enter") {
						dateInput.blur();
					}
				};

				const calBtn = document.createElement("button");
				calBtn.type = "button";
				calBtn.className = "island-time-icon-btn";
				calBtn.innerHTML = '<i class="mdi mdi-calendar"></i>';
				calBtn.title = "Open calendar";
				calBtn.onclick = (e) => {
					e.stopPropagation();
					openCalendarPopup({
						anchorEl: calBtn,
						initialValue: dateInput.value.trim() || rule.value || "",
						onChange: (newVal) => {
							dateInput.value = newVal;
							const updated = [...rules];
							updated[index] = { ...rule, value: newVal };
							onUpdateEdgeTime(edge.id, updated);
						},
					});
				};

				controls.append(sep, opSelect, dateInput, calBtn);
			}

			const delBtn = document.createElement("button");
			delBtn.type = "button";
			delBtn.className = "island-time-icon-btn";
			delBtn.innerHTML = '<i class="mdi mdi-minus-circle-outline"></i>';
			delBtn.title = "Remove rule";
			delBtn.onclick = () => {
				closeActiveCalendar();
				const updated = rules.filter((_, i) => i !== index);
				updateRules(updated);
			};

			row.append(controls, delBtn);
			timeElements.push(row);
		}

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
			() => onDeleteEdge(edge.id),
		);
		bottomItems.push(separator, actionsRow);

		if (leftIslandBody) {
			leftIslandBody.replaceChildren(
				idRow,
				endpointsTitle,
				endpointsVal,
				typeTitle,
				typeGroup,
				timeHeader,
				...timeElements,
				styleTitle,
				styleGroup,
				...bottomItems,
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

	function showAddEdge({
		defaultId,
		selectedType,
		selectedStyle,
		edgeTimeFrom,
		edgeTimeUntil,
		onTypeChange,
		onStyleChange,
		onTimeChange,
		onNameChange,
	}) {
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
				for (const child of typeGroup.children)
					child.classList.remove("active");
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
				for (const child of styleGroup.children)
					child.classList.remove("active");
				btn.classList.add("active");
				onStyleChange(s.id);
			};
			styleGroup.append(btn);
		}

		if (leftIslandBody) {
			leftIslandBody.replaceChildren(
				idRow,
				typeTitle,
				typeGroup,
				timeTitle,
				timeRow,
				styleTitle,
				styleGroup,
			);
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
