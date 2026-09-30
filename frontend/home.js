import {
	confirmDeleteGraph,
	modalAlert,
	promptNewGraph,
	promptRenameGraph,
} from "./modal.js";

function formatTimestamp(unixSeconds) {
	if (!unixSeconds || Number.isNaN(unixSeconds)) return "";
	return new Date(unixSeconds * 1000).toLocaleString();
}

export async function showHome({ onOpenGraph }) {
	const homeEl = document.getElementById("home");
	const editorEl = document.getElementById("editor");
	const graphListEl = document.getElementById("graph-list");

	if (editorEl) editorEl.hidden = true;
	if (homeEl) homeEl.hidden = false;
	if (!graphListEl) return;

	try {
		const res = await fetch("/api/graphs");
		if (!res.ok) {
			console.error("Failed to fetch graphs:", res.status, res.statusText);
			return;
		}
		const graphs = await res.json();
		if (!Array.isArray(graphs)) {
			console.error("Expected array of graphs, got:", graphs);
			return;
		}

		if (graphs.length === 0) {
			const li = document.createElement("li");
			li.className = "home-empty";
			li.textContent = "None";
			graphListEl.replaceChildren(li);
			return;
		}

		graphListEl.replaceChildren(
			...graphs.map(({ name, modified, created }) => {
				const li = document.createElement("li");

				const info = document.createElement("div");
				info.className = "home-graph-info";

				const nameBtn = document.createElement("button");
				nameBtn.className = "home-graph-name";
				nameBtn.textContent = name;
				nameBtn.onclick = () => onOpenGraph(name);

				const meta = document.createElement("span");
				meta.className = "home-graph-meta";
				const timeVal = modified ?? created;
				meta.textContent = timeVal
					? `modified ${formatTimestamp(timeVal)}`
					: "";

				info.append(nameBtn, meta);

				const actions = document.createElement("div");
				actions.className = "home-actions";

				const openBtn = document.createElement("button");
				openBtn.className = "home-btn";
				openBtn.textContent = "Open";
				openBtn.onclick = () => onOpenGraph(name);

				const renameBtn = document.createElement("button");
				renameBtn.className = "home-btn";
				renameBtn.textContent = "Rename";
				renameBtn.onclick = async () => {
					const newName = await promptRenameGraph(name);
					if (!newName) return;
					const response = await fetch(
						`/api/graphs/${encodeURIComponent(name)}/rename`,
						{
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({ new_name: newName }),
						},
					);
					if (!response.ok) {
						const err = await response
							.json()
							.catch(() => ({ detail: response.statusText }));
						await modalAlert(err.detail || "Rename failed", "Rename failed");
						return;
					}
					showHome({ onOpenGraph });
				};

				const deleteBtn = document.createElement("button");
				deleteBtn.className = "home-btn";
				deleteBtn.textContent = "Delete";
				deleteBtn.onclick = async () => {
					const confirmed = await confirmDeleteGraph(name);
					if (!confirmed) return;
					const response = await fetch(
						`/api/graphs/${encodeURIComponent(name)}`,
						{ method: "DELETE" },
					);
					if (!response.ok) {
						const err = await response
							.json()
							.catch(() => ({ detail: response.statusText }));
						await modalAlert(err.detail || "Delete failed", "Delete failed");
						return;
					}
					showHome({ onOpenGraph });
				};

				actions.append(openBtn, renameBtn, deleteBtn);
				li.append(info, actions);
				return li;
			}),
		);
	} catch (err) {
		console.error("Error in showHome:", err);
	}
}

export function initHome({ onOpenGraph }) {
	const newGraphBtn = document.getElementById("new-graph-btn");
	if (!newGraphBtn) return;

	newGraphBtn.onclick = async () => {
		const trimmed = await promptNewGraph();
		if (!trimmed) return;

		const checkRes = await fetch(`/api/graphs/${encodeURIComponent(trimmed)}`);
		if (checkRes.ok) {
			await modalAlert(`Graph "${trimmed}" already exists.`, "Error");
			return;
		}

		const response = await fetch(`/api/graphs/${encodeURIComponent(trimmed)}`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ vertices: [], edges: [] }),
		});
		if (!response.ok) {
			const err = await response
				.json()
				.catch(() => ({ detail: response.statusText }));
			await modalAlert(err.detail || "Creation failed", "Error");
			return;
		}
		onOpenGraph(trimmed);
	};
}
