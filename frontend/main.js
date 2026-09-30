// Application router and entry point.
// Manages URL routing and delegates view rendering to home.js and editor.js.

import { openEditor } from "./editor.js";
import { initHome, showHome } from "./home.js";

let labelSet = null;

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
			showHome({ onOpenGraph: navigateToGraph });
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
	return match
		? openGraph(decodeURIComponent(match[1]))
		: showHome({ onOpenGraph: navigateToGraph });
}

window.addEventListener("popstate", routeFromLocation);

async function main() {
	initHome({ onOpenGraph: navigateToGraph });
	routeFromLocation();

	try {
		labelSet = await fetch("/api/labels").then((response) => response.json());
	} catch (err) {
		console.error("Failed to load labels in background:", err);
	}
}

main();
