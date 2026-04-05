import { Notice } from "obsidian";
import { addDays, format } from "date-fns";
import type TaskNotesPlugin from "../main";
import type { FocusBlockInfo, TaskInfo } from "../types";
import { FocusBlockService } from "../services/FocusBlockService";
import { FocusBlockCreationModal } from "./FocusBlockCreationModal";
import { FocusBlockInfoModal } from "./FocusBlockInfoModal";
import { updateDTSTARTInRecurrenceRule } from "../core/recurrence";

function getFocusBlockColor(plugin: TaskNotesPlugin, focusBlock: FocusBlockInfo): string {
	return focusBlock.color || plugin.settings.calendarViewSettings.defaultFocusBlockColor;
}

export function getFocusBlockDateTimeRange(
	focusBlock: Pick<FocusBlockInfo, "startTime" | "endTime">,
	eventDate: Date | string
): { start: Date; end: Date } {
	const dateStr = typeof eventDate === "string" ? eventDate : format(eventDate, "yyyy-MM-dd");
	const start = new Date(`${dateStr}T${focusBlock.startTime}:00`);
	let end = new Date(`${dateStr}T${focusBlock.endTime}:00`);

	if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end <= start) {
		end = addDays(end, 1);
	}

	return { start, end };
}

export function getFocusBlockScheduleDateForUpdate(
	focusBlock: Pick<FocusBlockInfo, "recurrence" | "scheduled" | "dateCreated">,
	fallbackDate: string,
	preserveOriginalDate = false
): string {
	if (!focusBlock.recurrence || !preserveOriginalDate) {
		return fallbackDate;
	}

	const sourceDate = focusBlock.scheduled || focusBlock.dateCreated;
	if (!sourceDate) {
		return fallbackDate;
	}

	const match = String(sourceDate).match(/^(\d{4}-\d{2}-\d{2})/);
	return match?.[1] || fallbackDate;
}

function getWeekdayCode(date: Date): string {
	const weekdayCodes = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
	return weekdayCodes[date.getDay()] || "MO";
}

function getWeekdaySetPosition(date: Date): number {
	const dayOfMonth = date.getDate();
	const lastDayOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
	return dayOfMonth + 7 > lastDayOfMonth ? -1 : Math.ceil(dayOfMonth / 7);
}

export function getFocusBlockTaskCreationPrefill(
	focusBlock: Pick<FocusBlockInfo, "filterTag">
): Partial<TaskInfo> {
	const normalizedTag = String(focusBlock.filterTag || "")
		.trim()
		.replace(/^#/, "");

	if (!normalizedTag) {
		return {};
	}

	return {
		tags: [normalizedTag],
	};
}

export function updateFocusBlockRecurrenceForMove(
	recurrence: string | undefined,
	scheduled: string,
	newStart: Date,
	dateChanged: boolean
): string | undefined {
	if (!recurrence) {
		return recurrence;
	}

	let updated = updateDTSTARTInRecurrenceRule(recurrence, scheduled) || recurrence;
	if (!dateChanged) {
		return updated;
	}

	const weekdayCode = getWeekdayCode(newStart);
	const dayOfMonth = newStart.getDate();
	const month = newStart.getMonth() + 1;

	if (updated.includes("FREQ=WEEKLY")) {
		const byDayMatch = updated.match(/BYDAY=([^;]+)/);
		if (byDayMatch && /^[A-Z]{2}$/.test(byDayMatch[1])) {
			updated = updated.replace(/BYDAY=[^;]+/, `BYDAY=${weekdayCode}`);
		}
	}

	if (updated.includes("FREQ=MONTHLY")) {
		if (/BYMONTHDAY=[^;]+/.test(updated)) {
			updated = updated.replace(/BYMONTHDAY=[^;]+/, `BYMONTHDAY=${dayOfMonth}`);
		}
		const byDayMatch = updated.match(/BYDAY=([^;]+)/);
		if (byDayMatch && /BYSETPOS=/.test(updated) && /^[A-Z]{2}$/.test(byDayMatch[1])) {
			updated = updated.replace(/BYDAY=[^;]+/, `BYDAY=${weekdayCode}`);
			updated = updated.replace(/BYSETPOS=[^;]+/, `BYSETPOS=${getWeekdaySetPosition(newStart)}`);
		}
	}

	if (updated.includes("FREQ=YEARLY")) {
		if (/BYMONTH=[^;]+/.test(updated)) {
			updated = updated.replace(/BYMONTH=[^;]+/, `BYMONTH=${month}`);
		}
		if (/BYMONTHDAY=[^;]+/.test(updated)) {
			updated = updated.replace(/BYMONTHDAY=[^;]+/, `BYMONTHDAY=${dayOfMonth}`);
		}
	}

	return updated;
}

function isCssVariable(color: string): boolean {
	return color.startsWith("var(");
}

function hexToRgba(color: string, alpha: number): string {
	if (isCssVariable(color)) {
		return color;
	}
	const normalized = color.replace("#", "");
	if (!/^[0-9A-Fa-f]{6}$/.test(normalized)) {
		return `rgba(14, 165, 233, ${alpha})`;
	}
	const r = parseInt(normalized.substring(0, 2), 16);
	const g = parseInt(normalized.substring(2, 4), 16);
	const b = parseInt(normalized.substring(4, 6), 16);
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function shouldShowFocusBlockTasksInCalendar(
	plugin: TaskNotesPlugin,
	focusBlock: Pick<FocusBlockInfo, "startTime" | "endTime">,
	eventDate?: Date | null
): boolean {
	if (plugin.settings.calendarViewSettings.showTasksOnAllFocusBlocks !== false) {
		return true;
	}

	if (!eventDate) {
		return false;
	}

	const now = new Date();
	const { start, end } = getFocusBlockDateTimeRange(focusBlock, eventDate);
	if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
		return false;
	}

	return now >= start && now < end;
}

export async function generateFocusBlockEvents(
	plugin: TaskNotesPlugin,
	visibleStart: Date,
	visibleEnd: Date
): Promise<any[]> {
	if (!plugin.settings.calendarViewSettings.enableFocusBlocks) {
		return [];
	}

	const service = new FocusBlockService(plugin);
	const focusBlocks = await service.getAllFocusBlocks();
	const events: any[] = [];

	for (const focusBlock of focusBlocks) {
		const occurrences = service.getOccurrenceDatesForFocusBlock(focusBlock, visibleStart, visibleEnd);
		for (const occurrence of occurrences) {
			const dateStr = format(occurrence, "yyyy-MM-dd");
			const { start, end } = getFocusBlockDateTimeRange(focusBlock, occurrence);
			const color = getFocusBlockColor(plugin, focusBlock);
			const textColor = isCssVariable(color) ? "" : "var(--text-normal)";

			events.push({
				id: `focusblock-${focusBlock.id}-${dateStr}`,
				title: focusBlock.title,
				start,
				end,
				allDay: false,
				backgroundColor: isCssVariable(color) ? color : hexToRgba(color, 0.18),
				borderColor: color,
				textColor,
				editable: true,
				extendedProps: {
					focusBlock,
					eventType: "focusblock",
					originalDate: dateStr,
				},
			});
		}
	}

	return events;
}

export async function handleFocusBlockCreation(
	start: Date,
	end: Date,
	allDay: boolean,
	plugin: TaskNotesPlugin,
	onCreated?: () => void
): Promise<void> {
	if (allDay) {
		new Notice("Focus Blocks must have a specific time range. Please select time in day or week view.");
		return;
	}

	const modal = new FocusBlockCreationModal(plugin.app, plugin, {
		date: format(start, "yyyy-MM-dd"),
		startTime: format(start, "HH:mm"),
		endTime: format(end, "HH:mm"),
		onCreated,
	});
	modal.open();
}

export async function handleFocusBlockDrop(
	dropInfo: any,
	focusBlock: FocusBlockInfo,
	plugin: TaskNotesPlugin
): Promise<void> {
	try {
		const newStart = dropInfo.event.start;
		const newEnd = dropInfo.event.end;
		if (!newStart || !newEnd) {
			dropInfo.revert();
			return;
		}

		const newDate = format(newStart, "yyyy-MM-dd");
		const newStartTime = format(newStart, "HH:mm");
		const newEndTime = format(newEnd, "HH:mm");
		const originalDate =
			(dropInfo.oldEvent?.start ? format(dropInfo.oldEvent.start, "yyyy-MM-dd") : undefined) ||
			dropInfo.oldEvent?.extendedProps?.originalDate ||
			dropInfo.event.extendedProps?.originalDate;
		const dateChanged =
			Number(dropInfo.delta?.days || 0) !== 0 ||
			Number(dropInfo.delta?.months || 0) !== 0 ||
			(!!originalDate && originalDate !== newDate);
		const scheduledDate = getFocusBlockScheduleDateForUpdate(focusBlock, newDate, !dateChanged);
		const scheduled = `${scheduledDate}T${newStartTime}`;
		const recurrence = updateFocusBlockRecurrenceForMove(
			focusBlock.recurrence,
			scheduled,
			newStart,
			dateChanged
		);

		const service = new FocusBlockService(plugin);
		await service.updateFocusBlock(focusBlock, {
			scheduled,
			startTime: newStartTime,
			endTime: newEndTime,
			recurrence,
		});
		new Notice("Focus Block moved");
	} catch (error: any) {
		console.error("Error moving Focus Block:", error);
		new Notice(`Failed to move Focus Block: ${error.message || error}`);
		dropInfo.revert();
	}
}

export async function handleFocusBlockResize(
	resizeInfo: any,
	focusBlock: FocusBlockInfo,
	plugin: TaskNotesPlugin
): Promise<void> {
	try {
		const start = resizeInfo.event.start;
		const end = resizeInfo.event.end;
		if (!start || !end) {
			resizeInfo.revert();
			return;
		}

		const newDate = format(start, "yyyy-MM-dd");
		const newStartTime = format(start, "HH:mm");
		const newEndTime = format(end, "HH:mm");
		const scheduledDate = getFocusBlockScheduleDateForUpdate(focusBlock, newDate, true);
		const scheduled = `${scheduledDate}T${newStartTime}`;
		const recurrence = updateFocusBlockRecurrenceForMove(
			focusBlock.recurrence,
			scheduled,
			start,
			false
		);

		const service = new FocusBlockService(plugin);
		await service.updateFocusBlock(focusBlock, {
			scheduled,
			startTime: newStartTime,
			endTime: newEndTime,
			recurrence,
		});
		new Notice("Focus Block updated");
	} catch (error: any) {
		console.error("Error resizing Focus Block:", error);
		new Notice(`Failed to resize Focus Block: ${error.message || error}`);
		resizeInfo.revert();
	}
}

export function showFocusBlockInfoModal(
	focusBlock: FocusBlockInfo,
	eventDate: Date,
	plugin: TaskNotesPlugin,
	onChange?: () => void
): void {
	new FocusBlockInfoModal(plugin.app, plugin, focusBlock, eventDate, onChange).open();
}

export async function enhanceFocusBlockEventPreview(
	element: HTMLElement,
	focusBlock: FocusBlockInfo,
	plugin: TaskNotesPlugin,
	eventDate?: Date | null
): Promise<void> {
	const mainEl = (element.querySelector(".fc-event-main-frame") ||
		element.querySelector(".fc-event-main") ||
		element) as HTMLElement | null;
	if (!mainEl || mainEl.querySelector(".focus-block-event__tasks")) {
		return;
	}

	if (!shouldShowFocusBlockTasksInCalendar(plugin, focusBlock, eventDate)) {
		return;
	}

	mainEl.style.display = "flex";
	mainEl.style.flexDirection = "column";
	mainEl.style.justifyContent = "flex-start";
	mainEl.style.alignItems = "stretch";
	mainEl.style.rowGap = "4px";
	mainEl.style.overflow = "hidden";

	const titleContainer = mainEl.querySelector(".fc-event-title-container") as HTMLElement | null;
	if (titleContainer) {
		titleContainer.style.flex = "0 0 auto";
		titleContainer.style.marginBottom = "2px";
	}
	const timeEl = mainEl.querySelector(".fc-event-time") as HTMLElement | null;
	if (timeEl) {
		timeEl.style.flex = "0 0 auto";
		timeEl.style.marginBottom = "2px";
	}

	const preview = element.ownerDocument.createElement("div");
	preview.className = "focus-block-event__tasks";
	preview.style.fontSize = "var(--tn-font-size-sm)";
	preview.style.lineHeight = "1.35";
	preview.style.marginTop = "2px";
	preview.style.opacity = "0.98";
	preview.style.display = "flex";
	preview.style.flexDirection = "column";
	preview.style.gap = "2px";
	if (titleContainer && titleContainer.parentElement === mainEl) {
		mainEl.insertBefore(preview, titleContainer.nextSibling);
	} else {
		mainEl.appendChild(preview);
	}

	try {
		const service = new FocusBlockService(plugin);
		const result = await service.getSelectionResultForFocusBlock(focusBlock, eventDate || new Date());
		preview.innerHTML = "";

		const appendLine = (text: string, options: { overdue?: boolean; muted?: boolean; header?: boolean } = {}) => {
			const lineEl = element.ownerDocument.createElement("div");
			lineEl.textContent = text;
			lineEl.style.whiteSpace = "nowrap";
			lineEl.style.overflow = "hidden";
			lineEl.style.textOverflow = "ellipsis";
			lineEl.style.fontWeight = options.header ? "600" : options.overdue ? "500" : "400";
			if (options.overdue) {
				lineEl.style.color = "var(--text-error)";
			} else if (options.muted) {
				lineEl.style.color = "var(--text-muted)";
			}
			preview.appendChild(lineEl);
		};

		const topTaskLimit = Math.max(1, Number(focusBlock.topTasksCount || 1));
		if (result.primaryTasks.length > 0) {
			appendLine("Tasks:", { header: true });
			result.primaryTasks.slice(0, topTaskLimit).forEach((task) => {
				appendLine(`• ${task.title || "Untitled task"}`);
			});
		}

		if (result.overdueTasks.length > 0) {
			appendLine("Overdue:", { header: true, overdue: true });
			const visibleOverdue = result.overdueTasks.slice(0, 3);
			visibleOverdue.forEach((task) => {
				appendLine(`• ${task.title || "Untitled task"}`, { overdue: true });
			});
			if (result.overdueTasks.length > visibleOverdue.length) {
				appendLine(`+${result.overdueTasks.length - visibleOverdue.length} overdue tasks`, {
					overdue: true,
					muted: true,
				});
			}
		}

		if (result.allTasks.length === 0) {
			appendLine("No tasks", { muted: true });
		}
	} catch (error) {
		console.error("Failed to load Focus Block task preview:", error);
		preview.textContent = "Unable to load tasks";
	}
}

export function applyFocusBlockStyling(element: HTMLElement, focusBlock: FocusBlockInfo): void {
	element.setAttribute("data-focusblock-id", focusBlock.id || "");
	element.classList.add("fc-timeblock-event", "fc-focus-block-event");
	element.style.borderStyle = "solid";
	element.style.borderWidth = "2px";
}

export function generateFocusBlockTooltip(focusBlock: FocusBlockInfo): string {
	const tagPart = focusBlock.filterTag ? `\nTag: #${focusBlock.filterTag}` : "";
	return `${focusBlock.title}${focusBlock.description ? ` - ${focusBlock.description}` : ""}${tagPart}`;
}
