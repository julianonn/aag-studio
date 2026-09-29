// Canvas keyboard shortcuts (undo/redo, delete, select-all, escape, modes, space-pan)

export function attachKeyboardShortcuts({
  cy,
  onUndo,
  onRedo,
  onDuplicate,
  onDelete,
  onEscape,
  onSelectMode,
  onPanMode,
  onSpaceDown,
  onSpaceUp,
}) {
  function handleKeyDown(evt) {
    const targetTag = evt.target.tagName;
    if (targetTag === "INPUT" || targetTag === "TEXTAREA" || targetTag === "SELECT") {
      return;
    }

    const isMac = navigator.platform.toUpperCase().includes("MAC");
    const modifier = isMac ? evt.metaKey : evt.ctrlKey;

    if (modifier && evt.key.toLowerCase() === "z") {
      evt.preventDefault();
      if (evt.shiftKey) {
        onRedo();
      } else {
        onUndo();
      }
      return;
    }

    if (modifier && evt.key.toLowerCase() === "y") {
      evt.preventDefault();
      onRedo();
      return;
    }

    if (modifier && evt.key.toLowerCase() === "a") {
      evt.preventDefault();
      cy.elements().select();
      return;
    }

    if (modifier && evt.key.toLowerCase() === "d") {
      evt.preventDefault();
      onDuplicate?.();
      return;
    }

    if (evt.key === "Backspace" || evt.key === "Delete") {
      evt.preventDefault();
      onDelete();
      return;
    }

    if (evt.key === "Escape") {
      evt.preventDefault();
      onEscape();
      return;
    }

    if (!modifier && (evt.key === "v" || evt.key === "V")) {
      evt.preventDefault();
      onSelectMode?.();
      return;
    }

    if (!modifier && (evt.key === "h" || evt.key === "H")) {
      evt.preventDefault();
      onPanMode?.();
      return;
    }

    if (!modifier && evt.code === "Space" && !evt.repeat) {
      evt.preventDefault();
      onSpaceDown?.();
      return;
    }
  }

  function handleKeyUp(evt) {
    if (evt.code === "Space") {
      onSpaceUp?.();
    }
  }

  window.addEventListener("keydown", handleKeyDown);
  window.addEventListener("keyup", handleKeyUp);
  return () => {
    window.removeEventListener("keydown", handleKeyDown);
    window.removeEventListener("keyup", handleKeyUp);
  };
}
