// Library screen: list, open, create, rename and delete graphs, plus URL
// routing (/ = library, /graphs/<name> = that graph, back/forward work).
// Editing itself lives in editor.js.

import { openEditor } from "./editor.js";
import { icon } from "./icons.js";

const libraryEl = document.getElementById("library");
const editorEl = document.getElementById("editor");
const graphListEl = document.getElementById("graph-list");

let labelSet = null;

function formatTimestamp(unixSeconds) {
  return new Date(unixSeconds * 1000).toLocaleString();
}

async function showLibrary() {
  editorEl.hidden = true;
  libraryEl.hidden = false;

  const graphs = await fetch("/api/graphs").then((r) => r.json());
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
        const newName = prompt("new name", name);
        if (!newName || newName === name) return;
        const response = await fetch(`/api/graphs/${name}/rename`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ new_name: newName }),
        });
        if (!response.ok) {
          alert((await response.json()).detail);
          return;
        }
        showLibrary();
      };

      const deleteButton = document.createElement("button");
      deleteButton.textContent = "delete";
      deleteButton.onclick = async () => {
        if (!confirm(`delete graph "${name}"?`)) return;
        await fetch(`/api/graphs/${name}`, { method: "DELETE" });
        showLibrary();
      };

      li.append(openButton, meta, renameButton, deleteButton);
      return li;
    })
  );
}

async function openGraph(name) {
  libraryEl.hidden = true;
  editorEl.hidden = false;
  await openEditor(name, labelSet, {
    onExit: () => {
      history.pushState({}, "", "/");
      showLibrary();
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
  return match ? openGraph(decodeURIComponent(match[1])) : showLibrary();
}

window.addEventListener("popstate", routeFromLocation);

async function main() {
  labelSet = await fetch("/api/labels").then((r) => r.json());

  document.getElementById("back-to-library").prepend(icon("home"));
  document.getElementById("icon-add").prepend(icon("plus"));
  document.getElementById("icon-issues").prepend(icon("alert"));
  document.getElementById("icon-info").prepend(icon("info"));

  document.getElementById("new-graph-btn").onclick = async () => {
    const name = document.getElementById("new-graph-name").value.trim();
    if (!name) return;
    await fetch(`/api/graphs/${name}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vertices: [], edges: [] }),
    });
    navigateToGraph(name);
  };

  await routeFromLocation();
}

main();
