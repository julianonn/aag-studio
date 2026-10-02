export function getLocalDateString(d = new Date()) {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

export function parseDateTime(str) {
	const trimmed = String(str || "").trim();
	if (!trimmed) {
		return { date: "", time: null };
	}
	const parts = trimmed.split(/[ T]/);
	let date = parts[0] || "";
	const match = date.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
	if (match) {
		date = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
	} else {
		date = "";
	}
	let time = null;
	if (parts[1]) {
		const timeMatch = parts[1].match(/^(\d{1,2}):(\d{1,2})/);
		if (timeMatch) {
			time = `${timeMatch[1].padStart(2, "0")}:${timeMatch[2].padStart(2, "0")}`;
		}
	}
	return { date, time };
}

let activeCalendar = null;

export function closeActiveCalendar() {
	if (activeCalendar) {
		activeCalendar.destroy();
		activeCalendar = null;
	}
}

export function openCalendarPopup({ anchorEl, initialValue, onChange }) {
	closeActiveCalendar();

	const parsed = parseDateTime(initialValue);
	let selectedDate = parsed.date;
	let hasTime = Boolean(parsed.time);
	let timeVal = parsed.time || "";

	let viewYear = selectedDate ? parseInt(selectedDate.slice(0, 4), 10) : new Date().getFullYear();
	let viewMonth = selectedDate ? parseInt(selectedDate.slice(5, 7), 10) - 1 : new Date().getMonth();
	if (Number.isNaN(viewYear) || Number.isNaN(viewMonth)) {
		const now = new Date();
		viewYear = now.getFullYear();
		viewMonth = now.getMonth();
	}

	const popup = document.createElement("div");
	popup.className = "island-calendar-popup";

	const rect = anchorEl.getBoundingClientRect();
	const popupWidth = 240;
	let left = rect.left - popupWidth + rect.width;
	if (left < 8) left = rect.left;
	if (left + popupWidth > window.innerWidth - 8) {
		left = window.innerWidth - popupWidth - 8;
	}
	popup.style.left = `${Math.max(8, left)}px`;

	const popupHeight = 280;
	if (rect.bottom + popupHeight > window.innerHeight - 8 && rect.top > popupHeight + 8) {
		popup.style.top = `${rect.top - popupHeight - 4}px`;
	} else {
		popup.style.top = `${rect.bottom + 4}px`;
	}

	const MONTH_NAMES = [
		"January", "February", "March", "April", "May", "June",
		"July", "August", "September", "October", "November", "December",
	];
	const DAY_NAMES = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
	const todayStr = getLocalDateString();

	function commit() {
		if (!selectedDate) return;
		const val = hasTime ? `${selectedDate} ${timeVal || "00:00"}` : selectedDate;
		onChange(val);
	}

	const header = document.createElement("div");
	header.className = "calendar-header";

	const prevBtn = document.createElement("button");
	prevBtn.type = "button";
	prevBtn.className = "calendar-nav-btn";
	prevBtn.innerHTML = '<i class="mdi mdi-chevron-left"></i>';
	prevBtn.onclick = (e) => {
		e.stopPropagation();
		viewMonth--;
		if (viewMonth < 0) {
			viewMonth = 11;
			viewYear--;
		}
		renderMonth();
	};

	const monthLabel = document.createElement("span");
	monthLabel.className = "calendar-month-label";

	const nextBtn = document.createElement("button");
	nextBtn.type = "button";
	nextBtn.className = "calendar-nav-btn";
	nextBtn.innerHTML = '<i class="mdi mdi-chevron-right"></i>';
	nextBtn.onclick = (e) => {
		e.stopPropagation();
		viewMonth++;
		if (viewMonth > 11) {
			viewMonth = 0;
			viewYear++;
		}
		renderMonth();
	};

	header.append(prevBtn, monthLabel, nextBtn);

	const grid = document.createElement("div");
	grid.className = "calendar-grid";

	const sep = document.createElement("div");
	sep.className = "calendar-separator";

	const timeSection = document.createElement("div");
	timeSection.className = "calendar-footer";

	popup.append(header, grid, sep, timeSection);
	document.body.appendChild(popup);

	function renderMonth() {
		monthLabel.textContent = `${MONTH_NAMES[viewMonth]} ${viewYear}`;
		grid.replaceChildren();

		for (const d of DAY_NAMES) {
			const cell = document.createElement("div");
			cell.className = "calendar-day-header";
			cell.textContent = d;
			grid.append(cell);
		}

		const firstDayIndex = new Date(viewYear, viewMonth, 1).getDay();
		const totalDays = new Date(viewYear, viewMonth + 1, 0).getDate();
		const prevMonthDays = new Date(viewYear, viewMonth, 0).getDate();

		for (let i = firstDayIndex - 1; i >= 0; i--) {
			const dayNum = prevMonthDays - i;
			const prevDate = new Date(viewYear, viewMonth, 0);
			const pYear = prevDate.getFullYear();
			const pMonth = prevDate.getMonth();
			const ds = `${pYear}-${String(pMonth + 1).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = "calendar-day-cell other-month";
			btn.textContent = String(dayNum);
			btn.onclick = (e) => {
				e.stopPropagation();
				viewYear = pYear;
				viewMonth = pMonth;
				selectedDate = ds;
				commit();
				renderMonth();
			};
			grid.append(btn);
		}

		for (let day = 1; day <= totalDays; day++) {
			const ds = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = "calendar-day-cell";
			if (ds === selectedDate) btn.classList.add("selected");
			if (ds === todayStr) btn.classList.add("today");
			btn.textContent = String(day);
			btn.onclick = (e) => {
				e.stopPropagation();
				selectedDate = ds;
				commit();
				renderMonth();
			};
			grid.append(btn);
		}

		const currentCount = firstDayIndex + totalDays;
		const remaining = (7 - (currentCount % 7)) % 7;
		for (let day = 1; day <= remaining; day++) {
			const nextDate = new Date(viewYear, viewMonth + 1, 1);
			const nYear = nextDate.getFullYear();
			const nMonth = nextDate.getMonth();
			const ds = `${nYear}-${String(nMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = "calendar-day-cell other-month";
			btn.textContent = String(day);
			btn.onclick = (e) => {
				e.stopPropagation();
				viewYear = nYear;
				viewMonth = nMonth;
				selectedDate = ds;
				commit();
				renderMonth();
			};
			grid.append(btn);
		}
	}

	function renderTimeSection() {
		timeSection.replaceChildren();
		if (!hasTime) {
			const addTimeBtn = document.createElement("button");
			addTimeBtn.type = "button";
			addTimeBtn.className = "calendar-add-time-btn";
			addTimeBtn.innerHTML = '<i class="mdi mdi-clock-outline"></i> Add time';
			addTimeBtn.onclick = (e) => {
				e.stopPropagation();
				hasTime = true;
				timeVal = "00:00";
				commit();
				renderTimeSection();
			};
			timeSection.append(addTimeBtn);
		} else {
			const row = document.createElement("div");
			row.className = "calendar-time-row";

			const icon = document.createElement("i");
			icon.className = "mdi mdi-clock-outline calendar-time-icon";

			const timeInput = document.createElement("input");
			timeInput.type = "time";
			timeInput.className = "calendar-time-input";
			timeInput.value = timeVal || "00:00";
			timeInput.onchange = () => {
				timeVal = timeInput.value || "00:00";
				commit();
			};
			timeInput.oninput = () => {
				timeVal = timeInput.value || "00:00";
				commit();
			};

			const removeBtn = document.createElement("button");
			removeBtn.type = "button";
			removeBtn.className = "calendar-remove-time-btn";
			removeBtn.title = "Remove time (default midnight)";
			removeBtn.innerHTML = '<i class="mdi mdi-close"></i>';
			removeBtn.onclick = (e) => {
				e.stopPropagation();
				hasTime = false;
				timeVal = null;
				commit();
				renderTimeSection();
			};

			row.append(icon, timeInput, removeBtn);
			timeSection.append(row);
		}
	}

	renderMonth();
	renderTimeSection();

	const onDocClick = (e) => {
		if (!popup.contains(e.target) && !anchorEl.contains(e.target)) {
			closeActiveCalendar();
		}
	};
	const onKeyDown = (e) => {
		if (e.key === "Escape") {
			closeActiveCalendar();
		}
	};

	setTimeout(() => {
		document.addEventListener("pointerdown", onDocClick, true);
		document.addEventListener("keydown", onKeyDown, true);
	}, 0);

	activeCalendar = {
		anchorEl,
		destroy() {
			document.removeEventListener("pointerdown", onDocClick, true);
			document.removeEventListener("keydown", onKeyDown, true);
			popup.remove();
		},
	};
}
