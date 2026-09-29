// A toolbar-button click bubbles to document (unlike right-click's
// synthetic cxttap), so the close-on-outside-click listener is deferred
// past the current click or it closes the menu it just opened.

let openMenuEl = null;
let outsideClickListener = null;

function closeMenu() {
  openMenuEl?.remove();
  openMenuEl = null;
  if (outsideClickListener) {
    document.removeEventListener("click", outsideClickListener);
    outsideClickListener = null;
  }
}

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
  setTimeout(() => {
    outsideClickListener = closeMenu;
    document.addEventListener("click", outsideClickListener);
  }, 0);
}
