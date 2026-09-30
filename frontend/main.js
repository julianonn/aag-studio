// Home screen: graph list, creation, deletion, and URL routing.

import { openEditor } from "./editor.js";
import { modalAlert, modalConfirm, modalPrompt } from "./modal.js";

let labelSet = null;

function formatTimestamp(unixSeconds) {
  if (!unixSeconds || isNaN(unixSeconds)) return "";
  return new Date(unixSeconds * 1000).toLocaleString();
}

async function showHome() {
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
        nameBtn.onclick = () => navigateToGraph(name);

        const meta = document.createElement("span");
        meta.className = "home-graph-meta";
        const timeVal = modified ?? created;
        meta.textContent = timeVal ? `modified ${formatTimestamp(timeVal)}` : "";

        info.append(nameBtn, meta);

        const actions = document.createElement("div");
        actions.className = "home-actions";

        const openBtn = document.createElement("button");
        openBtn.className = "home-btn";
        openBtn.textContent = "Open";
        openBtn.onclick = () => navigateToGraph(name);

        const renameBtn = document.createElement("button");
        renameBtn.className = "home-btn";
        renameBtn.textContent = "Rename";
        renameBtn.onclick = async () => {
          const newName = await modalPrompt("New name:", name, "Rename graph");
          if (!newName) return;
          const trimmed = newName.trim();
          if (!trimmed || trimmed === name) return;
          const response = await fetch(`/api/graphs/${encodeURIComponent(name)}/rename`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ new_name: trimmed }),
          });
          if (!response.ok) {
            const err = await response.json().catch(() => ({ detail: response.statusText }));
            await modalAlert(err.detail || "Rename failed", "Rename failed");
            return;
          }
          showHome();
        };

        const deleteBtn = document.createElement("button");
        deleteBtn.className = "home-btn";
        deleteBtn.textContent = "Delete";
        deleteBtn.onclick = async () => {
          const confirmed = await modalConfirm(`Are you sure you want to delete "${name}"?`, "Are you sure?");
          if (!confirmed) return;
          const response = await fetch(`/api/graphs/${encodeURIComponent(name)}`, { method: "DELETE" });
          if (!response.ok) {
            const err = await response.json().catch(() => ({ detail: response.statusText }));
            await modalAlert(err.detail || "Delete failed", "Delete failed");
            return;
          }
          showHome();
        };

        actions.append(openBtn, renameBtn, deleteBtn);
        li.append(info, actions);
        return li;
      })
    );
  } catch (err) {
    console.error("Error in showHome:", err);
  }
}

async function openGraph(name) {
  const homeEl = document.getElementById("home");
  const editorEl = document.getElementById("editor");
  if (homeEl) homeEl.hidden = true;
  if (editorEl) editorEl.hidden = false;

  if (!labelSet) {
    try {
      labelSet = await fetch("/api/labels").then((response) => response.json());
    } catch (err) {
      console.error("Failed to load labels:", err);
    }
  }

  await openEditor(name, labelSet, {
    onExit: () => {
      history.pushState({}, "", "/");
      showHome();
    },
    onRename: (newName) => history.replaceState({}, "", `/graphs/${newName}`),
  });
}

function navigateToGraph(name) {
  history.pushState({}, "", `/graphs/${name}`);
  openGraph(name);
}

function routeFromLocation() {
  const match = location.pathname.match(/^\/graphs\/(.+)$/);
  return match ? openGraph(decodeURIComponent(match[1])) : showHome();
}

window.addEventListener("popstate", routeFromLocation);

async function main() {
  const newGraphBtn = document.getElementById("new-graph-btn");
  if (newGraphBtn) {
    newGraphBtn.onclick = async () => {
      const name = await modalPrompt("Graph name (saves to graphs/*.json):", "", "New graph");
      if (!name) return;
      const trimmed = name.trim();
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
        const err = await response.json().catch(() => ({ detail: response.statusText }));
        await modalAlert(err.detail || "Creation failed", "Error");
        return;
      }
      navigateToGraph(trimmed);
    };
  }

  routeFromLocation();

  try {
    labelSet = await fetch("/api/labels").then((response) => response.json());
  } catch (err) {
    console.error("Failed to load labels in background:", err);
  }
}

main();
