import { validateGraph } from "./graph-utils.js";

export function initEditorIssues({ onToggleMenu }) {
	const issuesDialogEl = document.getElementById("issues-dialog");
	const violationsList = document.getElementById("violations-list");
	const issuesCountEl = document.getElementById("issues-count");
	const issuesCloseBtnEl = document.getElementById("issues-close");
	const menuIssuesBtn = document.getElementById("menu-issues");

	if (menuIssuesBtn) {
		menuIssuesBtn.onclick = () => {
			onToggleMenu?.();
			if (issuesDialogEl) {
				issuesDialogEl.hidden = !issuesDialogEl.hidden;
			}
		};
	}

	if (issuesCloseBtnEl) {
		issuesCloseBtnEl.onclick = () => {
			if (issuesDialogEl) {
				issuesDialogEl.hidden = true;
			}
		};
	}

	async function refreshViolations(graph) {
		const violations = await validateGraph(graph);
		if (issuesCountEl) {
			issuesCountEl.textContent = violations.length || "";
		}
		if (violationsList) {
			violationsList.replaceChildren(
				...violations.map((violation) => {
					const li = document.createElement("li");
					li.textContent = violation;
					return li;
				}),
			);
		}
		return violations;
	}

	function closeIssues() {
		if (issuesDialogEl) {
			issuesDialogEl.hidden = true;
		}
	}

	return {
		refreshViolations,
		closeIssues,
	};
}
