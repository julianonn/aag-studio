// Home screen: graph list, creation, deletion, and URL routing.

import { openEditor } from "./editor.js";
import { modalAlert, modalConfirm, modalPrompt } from "./modal.js";

const homeEl = document.getElementById("home");
const editorEl = document.getElementById("editor");
const graphListEl = document.getElementById("graph-list");

let labelSet = null;

function formatTimestamp(unixSeconds) {
  return new Date(unixSeconds * 1000).toLocaleString();
}

async function showHome() {
  editorEl.hidden = true;
  homeEl.hidden = false;

  const graphs = await fetch("/api/graphs").then((response) => response.json());
  graphListEl.replaceChildren(
    ...graphs.map(({ name, created, modified }) => {
      const li = document.createElement("li");
      const openButton = document.createElement("button");
      openButton.textContent = name;
      openButton.onclick = () => navigateToGraph(name);

      const meta = document.createElement("span");
      meta.textContent = `created ${formatTimestamp(created)} · last modified* ${formatTimestamp(modified)}`;
      meta.title = "*file timestamp — may reflect a git checkout, not the actual last edit";

      const renameButton = document.createElement("button");
      renameButton.textContent = "rename";
      renameButton.onclick = async () => {
        const newName = await modalPrompt("New name for this graph:", name, "Rename graph");
        if (!newName || newName === name) return;
        const response = await fetch(`/api/graphs/${name}/rename`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ new_name: newName }),
        });
        if (!response.ok) {
          await modalAlert((await response.json()).detail, "Rename failed");
          return;
        }
        showHome();
      };

      const deleteButton = document.createElement("button");
      deleteButton.textContent = "delete";
      deleteButton.onclick = async () => {
        const confirmed = await modalConfirm(`Delete graph "${name}"? This cannot be undone.`, "Delete graph");
        if (!confirmed) return;
        await fetch(`/api/graphs/${name}`, { method: "DELETE" });
        showHome();
      };

      li.append(openButton, meta, renameButton, deleteButton);
      return li;
    })
  );
}

async function openGraph(name) {
  homeEl.hidden = true;
  editorEl.hidden = false;
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
  labelSet = await fetch("/api/labels").then((response) => response.json());

  document.getElementById("new-graph-btn").onclick = async () => {
    const name = document.getElementById("new-graph-name").value.trim();
    if (!name) return;
    const response = await fetch(`/api/graphs/${name}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vertices: [], edges: [] }),
    });
    if (!response.ok) {
      await modalAlert((await response.json()).detail, "Creation failed");
      return;
    }
    navigateToGraph(name);
  };

  await routeFromLocation();
}

main();
