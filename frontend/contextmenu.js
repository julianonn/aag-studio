// A minimal right-click/two-finger-tap menu. Both gestures fire the same
// browser contextmenu event, and Cytoscape's own cxttap mirrors it, so one
// implementation covers both.

let openMenuEl = null;

function closeMenu() {
  openMenuEl?.remove();
  openMenuEl = null;
}

document.addEventListener("click", closeMenu);

export function showContextMenu(x, y, items) {
  closeMenu();
  const menu = document.createElement("div");
  menu.className = "context-menu";
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  for (const item of items) {
    const button = document.createElement("button");
    button.textContent = item.label;
    button.onclick = () => {
      closeMenu();
      item.onClick();
    };
    menu.append(button);
  }
  document.body.append(menu);
  openMenuEl = menu;
}
