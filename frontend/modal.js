// In-app modal dialog replacing browser alert(), confirm(), and prompt().

let activeResolver = null;

const backdropEl = document.getElementById("modal-backdrop");
const titleEl = document.getElementById("modal-title");
const messageEl = document.getElementById("modal-message");
const inputEl = document.getElementById("modal-input");
const cancelBtn = document.getElementById("modal-cancel-btn");
const confirmBtn = document.getElementById("modal-confirm-btn");

function closeModal(result) {
  if (backdropEl) backdropEl.hidden = true;
  const resolve = activeResolver;
  activeResolver = null;
  resolve?.(result);
}

export function modalAlert(message, title = "Alert") {
  return new Promise((resolve) => {
    activeResolver = resolve;
    titleEl.textContent = title;
    messageEl.textContent = message;
    inputEl.hidden = true;
    cancelBtn.hidden = true;
    confirmBtn.textContent = "OK";
    backdropEl.hidden = false;
    confirmBtn.focus();
  });
}

export function modalConfirm(message, title = "Confirm") {
  return new Promise((resolve) => {
    activeResolver = resolve;
    titleEl.textContent = title;
    messageEl.textContent = message;
    inputEl.hidden = true;
    cancelBtn.hidden = false;
    cancelBtn.textContent = "Cancel";
    confirmBtn.textContent = "OK";
    backdropEl.hidden = false;
    confirmBtn.focus();
  });
}

export function modalPrompt(message, defaultValue = "", title = "Prompt") {
  return new Promise((resolve) => {
    activeResolver = resolve;
    titleEl.textContent = title;
    messageEl.textContent = message;
    inputEl.hidden = false;
    inputEl.value = defaultValue;
    cancelBtn.hidden = false;
    cancelBtn.textContent = "Cancel";
    confirmBtn.textContent = "OK";
    backdropEl.hidden = false;
    inputEl.focus();
    inputEl.select();
  });
}

cancelBtn?.addEventListener("click", () => closeModal(inputEl.hidden ? false : null));
confirmBtn?.addEventListener("click", () => closeModal(inputEl.hidden ? true : inputEl.value));
backdropEl?.addEventListener("click", (evt) => {
  if (evt.target === backdropEl) closeModal(inputEl.hidden ? false : null);
});

window.addEventListener("keydown", (evt) => {
  if (!backdropEl || backdropEl.hidden) return;
  if (evt.key === "Escape") {
    evt.preventDefault();
    closeModal(inputEl.hidden ? false : null);
  } else if (evt.key === "Enter" && (!inputEl.hidden || document.activeElement === confirmBtn)) {
    evt.preventDefault();
    closeModal(inputEl.hidden ? true : inputEl.value);
  }
});
