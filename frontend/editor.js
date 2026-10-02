import { CanvasSvg } from "./canvas-svg.js";
import {
	AUTOSAVE_DEBOUNCE_MS,
	BASE_ZOOM,
	DUPLICATE_OFFSET,
} from "./constants.js";
import { showContextMenu } from "./contextmenu.js";
import { initEditorIssues } from "./editor_issues.js";
import { initEditorLeftIsland } from "./editor_left_island.js";
import {
	computeDefaultLayout,
	debounce,
	inferredEdgeLabel,
	nextId,
	validateGraph,
} from "./graph-utils.js";
import { attachKeyboardShortcuts } from "./keyboard-shortcuts.js";
import { modalAlert, promptRenameGraph } from "./modal.js";

export async function openEditor(graphName, labelSet, { onExit, onRename }) {
	let graphRes;
	let layoutRes;
	try {
		[graphRes, layoutRes] = await Promise.all([
			fetch(`/api/graphs/${graphName}`),
			fetch(`/api/graphs/${graphName}/layout`),
		]);
	} catch (err) {
		await modalAlert(
			`Failed to connect to server: ${err.message}`,
			"Connection Error",
		);
		onExit();
		return;
	}

	if (!graphRes.ok) {
		const errorData = await graphRes
			.json()
			.catch(() => ({ detail: graphRes.statusText }));
		await modalAlert(
			errorData.detail || `Failed to load graph "${graphName}"`,
			"Broken Graph File",
		);
		onExit();
		return;
	}

	if (!layoutRes.ok) {
		const errorData = await layoutRes
			.json()
			.catch(() => ({ detail: layoutRes.statusText }));
		await modalAlert(
			errorData.detail || `Failed to load layout for "${graphName}"`,
			"Broken Layout File",
		);
		onExit();
		return;
	}

	let graph;
	let rawLayout;
	try {
		graph = await graphRes.json();
		rawLayout = await layoutRes.json();
		if (
			!graph ||
			!Array.isArray(graph.vertices) ||
			!Array.isArray(graph.edges)
		) {
			throw new Error(
				`Graph file "${graphName}.json" is missing vertices or edges.`,
			);
		}
	} catch (err) {
		await modalAlert(err.message, "Broken Graph File");
		onExit();
		return;
	}

	const positions = rawLayout.positions ?? {};
	if (!Object.keys(positions).length && graph.vertices.length > 0) {
		Object.assign(positions, computeDefaultLayout(graph.vertices, graph.edges));
	}
	const edgeStyles = rawLayout.edge_styles ?? {};
	const sizes = rawLayout.sizes ?? {};
	const edgeEndpoints = rawLayout.edge_endpoints ?? {};
	const edgeElbows = rawLayout.edge_elbows ?? {};

	const issuesController = initEditorIssues({
		onToggleMenu: () => {
			hamburgerMenu.hidden = true;
		},
	});

	const leftIslandController = initEditorLeftIsland({
		labelSet,
		onClose: () => {
			canvas.clearSelection();
			activeSelectedItem = null;
			toolAddVertex.classList.remove("active");
			toolAddEdge.classList.remove("active");
			if (activeMode === "edge") {
				setMode(previousMode || "pan");
			}
		},
		onRenameVertex: tryRenameVertex,
		onChangeVertexLabel: tryChangeVertexLabel,
		onDuplicateVertex: tryDuplicateVertex,
		onDeleteVertex: tryDeleteVertex,
		onRenameEdge: tryRenameEdge,
		onChangeEdgeLabel: async (edgeId, newLabel) => {
			await applyGraph({
				vertices: graph.vertices,
				edges: graph.edges.map((e) =>
					e.id === edgeId ? { ...e, label: newLabel } : e,
				),
			});
			canvas.select(edgeId, "edge");
		},
		onUpdateEdgeTime: async (edgeId, arg1, arg2) => {
			let newRules;
			if (Array.isArray(arg1)) {
				newRules = arg1;
			} else {
				const edge = graph.edges.find((e) => e.id === edgeId);
				const intervals = edge?.time?.length ? edge.time : [];
				newRules = intervals.map((iv, idx) => (idx === arg1 ? arg2 : iv));
			}
			const newEdges = graph.edges.map((graphEdge) =>
				graphEdge.id !== edgeId
					? graphEdge
					: {
							...graphEdge,
							time: newRules,
						},
			);
			await applyGraph({ vertices: graph.vertices, edges: newEdges });
			canvas.select(edgeId, "edge");
		},
		onSetEdgeStyle: (edgeId, styleId) => setEdgeStyle(edgeId, styleId),
		onSetEdgeElbow: (edgeId, offset) => {
			undoStack.push(snapshotState());
			redoStack.length = 0;
			updateUndoRedoButtons();
			if (offset === null) {
				delete edgeElbows[edgeId];
			} else {
				edgeElbows[edgeId] = offset;
			}
			canvas.setData({
				vertices: graph.vertices,
				edges: graph.edges,
				positions,
				sizes,
				edgeStyles,
				edgeEndpoints,
				edgeElbows,
				labelSet,
			});
			debouncedSaveLayout();
		},
		onDuplicateEdge: tryDuplicateEdge,
		onDeleteEdge: tryDeleteEdge,
	});

	const undoButton = document.getElementById("btn-undo");
	const redoButton = document.getElementById("btn-redo");

	function saveGraph() {
		fetch(`/api/graphs/${graphName}`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(graph),
		});
	}
	const debouncedSaveGraph = debounce(saveGraph, AUTOSAVE_DEBOUNCE_MS);

	function saveLayout() {
		const validVertexIds = new Set(graph.vertices.map((vertex) => vertex.id));
		const validEdgeIds = new Set(graph.edges.map((edge) => edge.id));
		for (const id of Object.keys(positions)) {
			if (!validVertexIds.has(id)) delete positions[id];
		}
		for (const id of Object.keys(sizes)) {
			if (!validVertexIds.has(id)) delete sizes[id];
		}
		for (const id of Object.keys(edgeStyles)) {
			if (!validEdgeIds.has(id)) delete edgeStyles[id];
		}
		for (const id of Object.keys(edgeEndpoints)) {
			if (!validEdgeIds.has(id)) delete edgeEndpoints[id];
		}
		for (const id of Object.keys(edgeElbows)) {
			if (!validEdgeIds.has(id)) delete edgeElbows[id];
		}
		fetch(`/api/graphs/${graphName}/layout`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				positions,
				edge_styles: edgeStyles,
				sizes,
				edge_endpoints: edgeEndpoints,
				edge_elbows: edgeElbows,
			}),
		});
	}
	const debouncedSaveLayout = debounce(saveLayout, AUTOSAVE_DEBOUNCE_MS);

	async function refreshViolations() {
		return issuesController.refreshViolations(graph);
	}

	function snapshotState() {
		return {
			graph: JSON.parse(JSON.stringify(graph)),
			positions: JSON.parse(JSON.stringify(positions)),
			sizes: JSON.parse(JSON.stringify(sizes)),
			edgeStyles: JSON.parse(JSON.stringify(edgeStyles)),
			edgeEndpoints: JSON.parse(JSON.stringify(edgeEndpoints)),
			edgeElbows: JSON.parse(JSON.stringify(edgeElbows)),
		};
	}

	function restoreState(state) {
		graph = JSON.parse(JSON.stringify(state.graph));
		for (const key of Object.keys(positions)) delete positions[key];
		Object.assign(positions, JSON.parse(JSON.stringify(state.positions)));
		for (const key of Object.keys(sizes)) delete sizes[key];
		Object.assign(sizes, JSON.parse(JSON.stringify(state.sizes)));
		for (const key of Object.keys(edgeStyles)) delete edgeStyles[key];
		Object.assign(edgeStyles, JSON.parse(JSON.stringify(state.edgeStyles)));
		for (const key of Object.keys(edgeEndpoints)) delete edgeEndpoints[key];
		Object.assign(
			edgeEndpoints,
			JSON.parse(JSON.stringify(state.edgeEndpoints ?? {})),
		);
		for (const key of Object.keys(edgeElbows)) delete edgeElbows[key];
		Object.assign(
			edgeElbows,
			JSON.parse(JSON.stringify(state.edgeElbows ?? {})),
		);

		rerender();
		refreshViolations();
		debouncedSaveGraph();
		debouncedSaveLayout();
		if (activeSelectedItem) {
			renderSelectedItemIsland();
		}
	}

	const undoStack = [];
	const redoStack = [];

	function updateUndoRedoButtons() {
		undoButton.disabled = undoStack.length === 0;
		redoButton.disabled = redoStack.length === 0;
	}

	async function applyGraph(candidate, { recordHistory = true } = {}) {
		const violations = await validateGraph(candidate);
		if (violations.length) {
			await modalAlert(violations.join("\n"), "Validation error");
			return false;
		}
		if (recordHistory) {
			undoStack.push(snapshotState());
			redoStack.length = 0;
			updateUndoRedoButtons();
		}
		graph = candidate;
		rerender();
		refreshViolations();
		debouncedSaveGraph();
		return true;
	}

	undoButton.onclick = async () => {
		if (undoStack.length === 0) return;
		redoStack.push(snapshotState());
		restoreState(undoStack.pop());
		updateUndoRedoButtons();
	};
	redoButton.onclick = async () => {
		if (redoStack.length === 0) return;
		undoStack.push(snapshotState());
		restoreState(redoStack.pop());
		updateUndoRedoButtons();
	};
	updateUndoRedoButtons();

	let activeSelectedItem = null;
	const currentIslandMode = null;
	let lastStateBeforeDrag = null;
	let resizeStartState = null;

	const canvas = new CanvasSvg(document.getElementById("canvas-svg"), {
		onSelectionChange: (selection) => {
			if (selection.edges.length === 1 && selection.nodes.length === 0) {
				if (activeMode === "edge") {
					setMode(previousMode || "pan");
				}
				activeSelectedItem = { type: "edge", id: selection.edges[0] };
				renderSelectedItemIsland();
				return;
			}
			if (activeMode === "edge") return;
			if (selection.nodes.length === 1 && selection.edges.length === 0) {
				activeSelectedItem = { type: "node", id: selection.nodes[0] };
				renderSelectedItemIsland();
			} else {
				if (currentIslandMode === "node" || currentIslandMode === "edge") {
					closeLeftIsland();
				}
			}
		},
		onNodeDragStart: () => {
			lastStateBeforeDrag = snapshotState();
		},
		onNodeDragEnd: (moved) => {
			if (moved && lastStateBeforeDrag) {
				undoStack.push(lastStateBeforeDrag);
				redoStack.length = 0;
				updateUndoRedoButtons();
				debouncedSaveLayout();
			}
			lastStateBeforeDrag = null;
		},
		onNodeResizeStart: () => {
			resizeStartState = snapshotState();
		},
		onNodeResizeEnd: (vertexId, width, height, x, y) => {
			const prev = resizeStartState?.sizes[vertexId];
			const prevPos = resizeStartState?.positions[vertexId];
			const changed =
				!prev ||
				prev[0] !== width ||
				prev[1] !== height ||
				!prevPos ||
				prevPos[0] !== x ||
				prevPos[1] !== y;
			sizes[vertexId] = [width, height];
			positions[vertexId] = [x, y];
			if (changed && resizeStartState) {
				undoStack.push(resizeStartState);
				redoStack.length = 0;
				updateUndoRedoButtons();
			}
			resizeStartState = null;
			debouncedSaveLayout();
			if (activeSelectedItem && activeSelectedItem.id === vertexId) {
				renderSelectedItemIsland();
			}
		},
		onEdgeElbowStart: () => {
			lastStateBeforeDrag = snapshotState();
		},
		onEdgeElbowEnd: (edgeId, val) => {
			if (lastStateBeforeDrag) {
				undoStack.push(lastStateBeforeDrag);
				redoStack.length = 0;
				updateUndoRedoButtons();
				edgeElbows[edgeId] = val;
				debouncedSaveLayout();
				if (activeSelectedItem && activeSelectedItem.id === edgeId) {
					renderSelectedItemIsland();
				}
			}
			lastStateBeforeDrag = null;
		},
		onEdgeEndpointChange: async (edgeId, end, targetNodeId, relPos) => {
			const edge = graph.edges.find((e) => e.id === edgeId);
			if (!edge) return;
			const isSameNode =
				(end === "src" && edge.src === targetNodeId) ||
				(end === "tgt" && edge.tgt === targetNodeId);

			if (isSameNode) {
				undoStack.push(snapshotState());
				redoStack.length = 0;
				updateUndoRedoButtons();
				edgeEndpoints[edgeId] ??= {};
				edgeEndpoints[edgeId][end] = relPos;
				canvas.setData({
					vertices: graph.vertices,
					edges: graph.edges,
					positions,
					sizes,
					edgeStyles,
					edgeEndpoints,
					edgeElbows,
					labelSet,
				});
				debouncedSaveLayout();
				if (activeSelectedItem && activeSelectedItem.id === edgeId) {
					renderSelectedItemIsland();
				}
			} else {
				const updated =
					end === "src"
						? { ...edge, src: targetNodeId }
						: { ...edge, tgt: targetNodeId };
				const srcVertex = graph.vertices.find((v) => v.id === updated.src);
				const tgtVertex = graph.vertices.find((v) => v.id === updated.tgt);
				if (!srcVertex || !tgtVertex) return;
				const newLabel = inferredEdgeLabel(
					labelSet,
					srcVertex.label,
					tgtVertex.label,
				);
				if (!newLabel) {
					await modalAlert(
						"No edge rule matches that reconnection",
						"Invalid connection",
					);
					canvas.render();
					return;
				}
				undoStack.push(snapshotState());
				redoStack.length = 0;
				updateUndoRedoButtons();
				edgeEndpoints[edgeId] ??= {};
				edgeEndpoints[edgeId][end] = relPos;
				updated.label = newLabel;
				graph = {
					vertices: graph.vertices,
					edges: graph.edges.map((e) => (e.id === edgeId ? updated : e)),
				};
				rerender();
				debouncedSaveGraph();
				debouncedSaveLayout();
				canvas.select(edgeId, "edge");
			}
		},
		onEdgeConnect: async (sourceId, targetId, srcRel, tgtRel) => {
			const customId = addEdgeNameVal.trim() || null;
			const ok = await tryAddEdge(
				sourceId,
				targetId,
				selectedEdgeStyle,
				selectedEdgeType,
				getSelectedEdgeTime(),
				srcRel,
				tgtRel,
				customId,
			);
			if (ok) {
				closeLeftIsland();
			}
		},
		onContextMenuNode: (nodeId, clientX, clientY) => {
			showContextMenu(clientX, clientY, [
				{ label: "Delete", onClick: () => tryDeleteVertex(nodeId) },
			]);
		},
		onContextMenuEdge: (edgeId, clientX, clientY) => {
			showContextMenu(clientX, clientY, [
				{ label: "Delete", onClick: () => tryDeleteEdge(edgeId) },
				{ label: "Straight", onClick: () => setEdgeStyle(edgeId, "straight") },
				{ label: "Elbow", onClick: () => setEdgeStyle(edgeId, "taxi") },
				{ label: "Curved", onClick: () => setEdgeStyle(edgeId, "bezier") },
			]);
		},
		onZoomChange: () => updateZoomText(),
	});

	function rerender() {
		if (activeSelectedItem) {
			const exists =
				activeSelectedItem.type === "node"
					? graph.vertices.some((v) => v.id === activeSelectedItem.id)
					: graph.edges.some((e) => e.id === activeSelectedItem.id);
			if (!exists) {
				closeLeftIsland();
			}
		}
		if (!Object.keys(positions).length && graph.vertices.length > 0) {
			Object.assign(
				positions,
				computeDefaultLayout(graph.vertices, graph.edges),
			);
		}
		canvas.setData({
			vertices: graph.vertices,
			edges: graph.edges,
			positions,
			sizes,
			edgeStyles,
			edgeEndpoints,
			edgeElbows,
			labelSet,
		});
	}

	async function tryAddVertex(label, customId = null) {
		const existingIds = new Set(graph.vertices.map((vertex) => vertex.id));
		if (customId && existingIds.has(customId)) {
			await modalAlert(
				`A vertex named "${customId}" already exists`,
				"Duplicate vertex",
			);
			return;
		}
		const id = customId || nextId(existingIds, label);
		positions[id] = canvas.getViewCenter();
		await applyGraph({
			vertices: [...graph.vertices, { id, label }],
			edges: graph.edges,
		});
		debouncedSaveLayout();
	}

	async function tryAddEdge(
		sourceId,
		targetId,
		style = selectedEdgeStyle,
		type = selectedEdgeType,
		time = getSelectedEdgeTime(),
		srcRel = null,
		tgtRel = null,
		customId = null,
	) {
		const existingIds = new Set(graph.edges.map((edge) => edge.id));
		if (customId && existingIds.has(customId)) {
			await modalAlert(
				`An edge named "${customId}" already exists`,
				"Duplicate edge",
			);
			return false;
		}
		const id = customId || nextId(existingIds, "e");
		const sourceVertex = graph.vertices.find(
			(vertex) => vertex.id === sourceId,
		);
		const targetVertex = graph.vertices.find(
			(vertex) => vertex.id === targetId,
		);
		if (!sourceVertex || !targetVertex) return false;
		const label =
			type ||
			inferredEdgeLabel(labelSet, sourceVertex.label, targetVertex.label);
		if (!label) {
			await modalAlert(
				`no edge rule matches ${sourceVertex.label} -> ${targetVertex.label}`,
				"Invalid connection",
			);
			return false;
		}
		edgeStyles[id] = style;
		if (srcRel || tgtRel) {
			edgeEndpoints[id] = {
				...(srcRel ? { src: srcRel } : {}),
				...(tgtRel ? { tgt: tgtRel } : {}),
			};
		}
		const edge = {
			id,
			src: sourceId,
			tgt: targetId,
			label,
			time: time ?? [],
		};
		const ok = await applyGraph({
			vertices: graph.vertices,
			edges: [...graph.edges, edge],
		});
		if (ok) {
			canvas.select(id, "edge");
		}
		debouncedSaveLayout();
		return ok;
	}

	async function tryDeleteVertex(vertexId) {
		delete positions[vertexId];
		delete sizes[vertexId];
		await applyGraph({
			vertices: graph.vertices.filter((vertex) => vertex.id !== vertexId),
			edges: graph.edges.filter(
				(edge) => edge.src !== vertexId && edge.tgt !== vertexId,
			),
		});
		debouncedSaveLayout();
	}

	async function tryDeleteEdge(edgeId) {
		delete edgeStyles[edgeId];
		delete edgeEndpoints[edgeId];
		delete edgeElbows[edgeId];
		await applyGraph({
			vertices: graph.vertices,
			edges: graph.edges.filter((edge) => edge.id !== edgeId),
		});
		debouncedSaveLayout();
	}

	async function tryDeleteSelected() {
		const selected = canvas.getSelected();
		const selectedNodeIds = new Set(selected.nodes);
		const selectedEdgeIds = new Set(selected.edges);
		if (selectedNodeIds.size === 0 && selectedEdgeIds.size === 0) return;

		for (const nodeId of selectedNodeIds) {
			delete positions[nodeId];
			delete sizes[nodeId];
		}
		for (const edgeId of selectedEdgeIds) {
			delete edgeStyles[edgeId];
			delete edgeEndpoints[edgeId];
			delete edgeElbows[edgeId];
		}

		await applyGraph({
			vertices: graph.vertices.filter(
				(vertex) => !selectedNodeIds.has(vertex.id),
			),
			edges: graph.edges.filter(
				(edge) =>
					!selectedEdgeIds.has(edge.id) &&
					!selectedNodeIds.has(edge.src) &&
					!selectedNodeIds.has(edge.tgt),
			),
		});
		debouncedSaveLayout();
	}

	async function tryDuplicateVertex(vertexId) {
		const original = graph.vertices.find((vertex) => vertex.id === vertexId);
		if (!original) return;
		const id = nextId(
			new Set(graph.vertices.map((vertex) => vertex.id)),
			original.label,
		);
		if (positions[vertexId])
			positions[id] = [
				positions[vertexId][0] + DUPLICATE_OFFSET,
				positions[vertexId][1] + DUPLICATE_OFFSET,
			];
		if (sizes[vertexId]) sizes[id] = [...sizes[vertexId]];
		const ok = await applyGraph({
			vertices: [...graph.vertices, { ...original, id }],
			edges: graph.edges,
		});
		if (ok) {
			debouncedSaveLayout();
			canvas.select(id, "node");
		}
	}

	async function tryDuplicateEdge(edgeId) {
		const original = graph.edges.find((edge) => edge.id === edgeId);
		if (!original) return;
		const id = nextId(new Set(graph.edges.map((edge) => edge.id)), "e");
		if (edgeStyles[edgeId]) edgeStyles[id] = edgeStyles[edgeId];
		if (edgeEndpoints[edgeId])
			edgeEndpoints[id] = JSON.parse(JSON.stringify(edgeEndpoints[edgeId]));
		if (edgeElbows[edgeId]) edgeElbows[id] = edgeElbows[edgeId];
		const ok = await applyGraph({
			vertices: graph.vertices,
			edges: [...graph.edges, { ...original, id }],
		});
		if (ok) {
			debouncedSaveLayout();
			canvas.select(id, "edge");
		}
	}

	async function tryDuplicateSelected() {
		const selected = canvas.getSelected();
		if (selected.nodes.length === 1 && selected.edges.length === 0) {
			await tryDuplicateVertex(selected.nodes[0]);
		} else if (selected.edges.length === 1 && selected.nodes.length === 0) {
			await tryDuplicateEdge(selected.edges[0]);
		}
	}

	async function tryRenameVertex(oldId, newId) {
		if (!newId || newId === oldId) return;
		if (graph.vertices.some((vertex) => vertex.id === newId)) {
			await modalAlert(
				`A vertex named "${newId}" already exists`,
				"Duplicate vertex",
			);
			return;
		}
		if (positions[oldId]) {
			positions[newId] = positions[oldId];
			delete positions[oldId];
		}
		if (sizes[oldId]) {
			sizes[newId] = sizes[oldId];
			delete sizes[oldId];
		}
		await applyGraph({
			vertices: graph.vertices.map((vertex) =>
				vertex.id === oldId ? { ...vertex, id: newId } : vertex,
			),
			edges: graph.edges.map((edge) => ({
				...edge,
				src: edge.src === oldId ? newId : edge.src,
				tgt: edge.tgt === oldId ? newId : edge.tgt,
			})),
		});
		debouncedSaveLayout();
		canvas.select(newId, "node");
	}

	async function tryChangeVertexLabel(vertexId, newLabel) {
		await applyGraph({
			vertices: graph.vertices.map((vertex) =>
				vertex.id === vertexId ? { ...vertex, label: newLabel } : vertex,
			),
			edges: graph.edges,
		});
		canvas.select(vertexId, "node");
	}

	async function tryRenameEdge(oldId, newId) {
		if (!newId || newId === oldId) return;
		if (graph.edges.some((edge) => edge.id === newId)) {
			await modalAlert(
				`An edge named "${newId}" already exists`,
				"Duplicate edge",
			);
			return;
		}
		if (edgeStyles[oldId]) {
			edgeStyles[newId] = edgeStyles[oldId];
			delete edgeStyles[oldId];
		}
		if (edgeEndpoints[oldId]) {
			edgeEndpoints[newId] = edgeEndpoints[oldId];
			delete edgeEndpoints[oldId];
		}
		if (edgeElbows[oldId]) {
			edgeElbows[newId] = edgeElbows[oldId];
			delete edgeElbows[oldId];
		}
		await applyGraph({
			vertices: graph.vertices,
			edges: graph.edges.map((edge) =>
				edge.id === oldId ? { ...edge, id: newId } : edge,
			),
		});
		debouncedSaveLayout();
		canvas.select(newId, "edge");
	}

	const toolAddVertex = document.getElementById("tool-add-vertex");
	const toolAddEdge = document.getElementById("tool-add-edge");

	let addEdgeNameVal = "";
	let selectedEdgeStyle = "bezier";
	let selectedEdgeType = "ha";
	let edgeTimeFromVal = "inf";
	let edgeTimeUntilVal = "inf";

	function parseTimeBound(val) {
		const trimmed = (val ?? "").trim();
		if (
			!trimmed ||
			trimmed === "inf" ||
			trimmed === "+inf" ||
			trimmed === "-inf" ||
			trimmed === "null"
		) {
			return trimmed === "inf" || trimmed === "+inf" || trimmed === "-inf"
				? trimmed
				: null;
		}
		const num = Number(trimmed);
		return Number.isNaN(num) ? trimmed : num;
	}

	function getSelectedEdgeTime() {
		return [];
	}

	function closeLeftIsland() {
		activeSelectedItem = null;
		leftIslandController.close();
		toolAddVertex.classList.remove("active");
		toolAddEdge.classList.remove("active");
		if (activeMode === "edge") {
			setMode(previousMode || "pan");
		}
	}

	function openAddVertexIsland() {
		canvas.clearSelection();
		activeSelectedItem = null;
		if (activeMode === "edge") {
			setMode(previousMode || "pan");
		}
		toolAddVertex.classList.add("active");
		toolAddEdge.classList.remove("active");

		const defaultId = nextId(new Set(graph.vertices.map((v) => v.id)), "v");
		leftIslandController.showAddVertex({
			defaultId,
			onAddVertex: (label, customName) => {
				tryAddVertex(label, customName);
				return nextId(new Set(graph.vertices.map((v) => v.id)), "v");
			},
		});
	}

	function openAddEdgeIsland() {
		canvas.clearSelection();
		activeSelectedItem = null;
		toolAddVertex.classList.remove("active");
		setMode("edge");
		addEdgeNameVal = nextId(new Set(graph.edges.map((edge) => edge.id)), "e");
		leftIslandController.showAddEdge({
			defaultId: addEdgeNameVal,
			selectedType: selectedEdgeType,
			selectedStyle: selectedEdgeStyle,
			edgeTimeFrom: edgeTimeFromVal,
			edgeTimeUntil: edgeTimeUntilVal,
			onTypeChange: (t) => (selectedEdgeType = t),
			onStyleChange: (s) => {
				selectedEdgeStyle = s;
				canvas.setActiveEdgeStyle(s);
			},
			onTimeChange: (fromVal, untilVal) => {
				edgeTimeFromVal = fromVal;
				edgeTimeUntilVal = untilVal;
			},
			onNameChange: (val) => (addEdgeNameVal = val),
		});
	}

	toolAddVertex.onclick = () => {
		if (
			leftIslandController.getMode() === "palette" &&
			leftIslandController.isOpen()
		) {
			closeLeftIsland();
		} else {
			openAddVertexIsland();
		}
	};

	toolAddEdge.onclick = () => {
		if (activeMode === "edge") {
			closeLeftIsland();
		} else {
			openAddEdgeIsland();
		}
	};

	const zoomOutBtn = document.getElementById("btn-zoom-out");
	const zoomResetBtn = document.getElementById("btn-zoom-reset");
	const zoomInBtn = document.getElementById("btn-zoom-in");

	function updateZoomText() {
		zoomResetBtn.textContent = `${Math.round((canvas.getZoom() / BASE_ZOOM) * 100)}%`;
	}
	zoomOutBtn.onclick = () => canvas.zoomOut();
	zoomInBtn.onclick = () => canvas.zoomIn();
	zoomResetBtn.onclick = () => canvas.resetZoom();
	updateZoomText();

	function setEdgeStyle(edgeId, style) {
		if (edgeStyles[edgeId] === style) return;
		undoStack.push(snapshotState());
		redoStack.length = 0;
		updateUndoRedoButtons();
		edgeStyles[edgeId] = style;
		canvas.setData({
			vertices: graph.vertices,
			edges: graph.edges,
			positions,
			sizes,
			edgeStyles,
			edgeEndpoints,
			edgeElbows,
			labelSet,
		});
		debouncedSaveLayout();
		if (activeSelectedItem && activeSelectedItem.id === edgeId) {
			renderSelectedItemIsland();
		}
	}

	function renderSelectedItemIsland() {
		if (!activeSelectedItem) {
			closeLeftIsland();
			return;
		}

		toolAddVertex.classList.remove("active");
		toolAddEdge.classList.remove("active");

		if (activeSelectedItem.type === "node") {
			const vertex = graph.vertices.find((v) => v.id === activeSelectedItem.id);
			if (!vertex) {
				closeLeftIsland();
				return;
			}
			leftIslandController.showVertex(vertex);
		} else if (activeSelectedItem.type === "edge") {
			const edge = graph.edges.find((e) => e.id === activeSelectedItem.id);
			if (!edge) {
				closeLeftIsland();
				return;
			}
			leftIslandController.showEdge(edge, edgeStyles, edgeElbows);
		}
	}

	const toolSelectBtn = document.getElementById("tool-select");
	const toolPanBtn = document.getElementById("tool-pan");
	let activeMode = "pan";
	let previousMode = "pan";
	let spacePressed = false;

	function applyMode() {
		canvas.setMode(activeMode);
		canvas.setSpacePressed(spacePressed);
	}

	function setMode(mode) {
		if (activeMode !== "edge" && mode === "edge") {
			previousMode = activeMode;
		}
		activeMode = mode;
		toolSelectBtn.classList.toggle("active", mode === "select");
		toolPanBtn.classList.toggle("active", mode === "pan");
		toolAddEdge.classList.toggle("active", mode === "edge");
		applyMode();
	}

	toolSelectBtn.onclick = () => {
		closeLeftIsland();
		setMode("select");
	};
	toolPanBtn.onclick = () => {
		closeLeftIsland();
		setMode("pan");
	};
	setMode("pan");

	const detachKeyboardShortcuts = attachKeyboardShortcuts({
		onSelectAll: () => canvas.selectAll(),
		onUndo: () => undoButton.click(),
		onRedo: () => redoButton.click(),
		onDuplicate: tryDuplicateSelected,
		onDelete: tryDeleteSelected,
		onEscape: () => {
			closeLeftIsland();
			canvas.clearSelection();
			hamburgerMenu.hidden = true;
			issuesController.closeIssues();
		},
		onSelectMode: () => setMode("select"),
		onPanMode: () => setMode("pan"),
		onSpaceDown: () => {
			spacePressed = true;
			applyMode();
		},
		onSpaceUp: () => {
			spacePressed = false;
			applyMode();
		},
	});

	window.addEventListener("beforeunload", () => {
		debouncedSaveGraph.flush();
		debouncedSaveLayout.flush();
	});

	const graphNameEl = document.getElementById("graph-name");
	graphNameEl.textContent = graphName;

	const hamburgerBtn = document.getElementById("btn-hamburger");
	const hamburgerMenu = document.getElementById("hamburger-menu");
	const menuHomeBtn = document.getElementById("menu-home");
	const menuRenameBtn = document.getElementById("menu-rename");
	const menuMetaEl = document.getElementById("menu-meta");

	hamburgerBtn.onclick = (evt) => {
		evt.stopPropagation();
		hamburgerMenu.hidden = !hamburgerMenu.hidden;
	};
	document.addEventListener("click", () => {
		hamburgerMenu.hidden = true;
	});
	hamburgerMenu.addEventListener("click", (evt) => evt.stopPropagation());

	menuHomeBtn.onclick = () => {
		hamburgerMenu.hidden = true;
		detachKeyboardShortcuts();
		canvas.destroy();
		onExit();
	};

	menuRenameBtn.onclick = async () => {
		hamburgerMenu.hidden = true;
		const newName = await promptRenameGraph(graphName);
		if (!newName) return;
		const response = await fetch(`/api/graphs/${graphName}/rename`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ new_name: newName }),
		});
		if (!response.ok) {
			await modalAlert((await response.json()).detail, "Rename failed");
			return;
		}
		graphName = newName;
		graphNameEl.textContent = graphName;
		onRename(graphName);
	};

	const graphs = await fetch("/api/graphs").then((response) => response.json());
	const thisGraph = graphs.find((graphEntry) => graphEntry.name === graphName);
	if (thisGraph) {
		menuMetaEl.textContent = `Created ${new Date(thisGraph.created * 1000).toLocaleString()}`;
	}

	rerender();
	canvas.resetZoom();
	await refreshViolations();
}
