import { App, ButtonComponent, Modal, Notice, Setting, TFile } from "obsidian";
import TaskNotesPlugin from "../main";
import { EVENT_DATA_CHANGED, type FocusBlockInfo, type TaskInfo } from "../types";
import { RecurrenceContextMenu } from "../components/RecurrenceContextMenu";
import { getRecurrenceDisplayText, updateDTSTARTInRecurrenceRule } from "../core/recurrence";
import { FocusBlockService } from "../services/FocusBlockService";
import { formatDateForStorage } from "../utils/dateUtils";
import { getFocusBlockTaskCreationPrefill } from "./focusBlockCore";

export class FocusBlockInfoModal extends Modal {
	private titleInput!: HTMLInputElement;
	private scheduledDateInput!: HTMLInputElement;
	private startTimeInput!: HTMLInputElement;
	private endTimeInput!: HTMLInputElement;
	private filterTagInput!: HTMLInputElement;
	private topTasksCountInput!: HTMLInputElement;
	private descriptionInput!: HTMLTextAreaElement;
	private colorInput!: HTMLInputElement;
	private recurrenceButton?: ButtonComponent;
	private recurrence = "";
	private recurrenceAnchor: "scheduled" | "completion" = "scheduled";
	private readonly taskOverrides = new Map<string, TaskInfo>();

	constructor(
		app: App,
		private plugin: TaskNotesPlugin,
		private focusBlock: FocusBlockInfo,
		private eventDate: Date,
		private onChange?: () => void
	) {
		super(app);
		this.recurrence = focusBlock.recurrence || "";
		this.recurrenceAnchor = focusBlock.recurrence_anchor || "scheduled";
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("timeblock-info-modal");

		new Setting(contentEl).setName("Edit Focus Block").setHeading();

		const dateDisplay = contentEl.createDiv({ cls: "timeblock-date-display" });
		dateDisplay.createEl("strong", { text: "Date/time: " });
		dateDisplay.createSpan({
			text: `${this.eventDate.toLocaleDateString()} from ${this.focusBlock.startTime} to ${this.focusBlock.endTime}`,
		});

		new Setting(contentEl)
			.setName("Title")
			.addText((text) => {
				this.titleInput = text.inputEl;
				text.setValue(this.focusBlock.title || "").onChange(() => this.validateForm());
			});

		new Setting(contentEl)
			.setName("Scheduled date")
			.setDesc("Date this Focus Block is anchored to")
			.addText((text) => {
				this.scheduledDateInput = text.inputEl;
				this.scheduledDateInput.type = "date";
				text.setValue(this.getScheduledDatePart());
			});

		const timeContainer = contentEl.createDiv({ cls: "timeblock-time-container" });

		new Setting(timeContainer)
			.setName("Start time")
			.addText((text) => {
				this.startTimeInput = text.inputEl;
				this.startTimeInput.type = "time";
				this.startTimeInput.step = "60";
				this.startTimeInput.addClass("timeblock-time-input");
				text.setValue(this.focusBlock.startTime || "09:00").onChange(() => this.validateForm());
			});

		new Setting(timeContainer)
			.setName("End time")
			.addText((text) => {
				this.endTimeInput = text.inputEl;
				this.endTimeInput.type = "time";
				this.endTimeInput.step = "60";
				this.endTimeInput.addClass("timeblock-time-input");
				text.setValue(this.focusBlock.endTime || "10:00").onChange(() => this.validateForm());
			});

		contentEl.createDiv({
			cls: "focus-block-time-note",
			text: "Tip: any minute is allowed, and the end time can go past midnight.",
		});

		new Setting(contentEl)
			.setName("Recurrence")
			.setDesc("Reuse the same recurrence UI and logic as TaskNotes tasks")
			.addButton((button) => {
				this.recurrenceButton = button;
				this.updateRecurrenceButton();
				button.onClick((event) => this.showRecurrenceMenu(event));
			})
			.addExtraButton((button) => {
				button.setIcon("x").setTooltip("Clear recurrence").onClick(() => {
					this.recurrence = "";
					this.recurrenceAnchor = "scheduled";
					this.updateRecurrenceButton();
				});
			});

		new Setting(contentEl)
			.setName("Filter tag")
			.addText((text) => {
				this.filterTagInput = text.inputEl;
				text.setValue(this.focusBlock.filterTag || "");
			});

		new Setting(contentEl)
			.setName("Top tasks")
			.addText((text) => {
				this.topTasksCountInput = text.inputEl;
				this.topTasksCountInput.type = "number";
				this.topTasksCountInput.min = "1";
				text.setValue(String(this.focusBlock.topTasksCount || 1));
			});

		new Setting(contentEl)
			.setName("Description")
			.addTextArea((text) => {
				this.descriptionInput = text.inputEl;
				this.descriptionInput.rows = 3;
				text.setValue(this.focusBlock.description || "");
			});

		new Setting(contentEl)
			.setName("Color")
			.addText((text) => {
				this.colorInput = text.inputEl;
				this.colorInput.type = "color";
				text.setValue(
					this.focusBlock.color || this.plugin.settings.calendarViewSettings.defaultFocusBlockColor
				);
			});

		const taskPreviewSection = contentEl.createDiv({ cls: "focus-block-info-modal__tasks" });
		taskPreviewSection.style.marginTop = "12px";
		taskPreviewSection.createEl("div", {
			text: "Tasks",
			cls: "setting-item-name",
		});
		const taskPreviewContainer = taskPreviewSection.createDiv({
			cls: "focus-block-info-modal__tasks-list",
		});
		taskPreviewContainer.style.marginTop = "6px";
		void this.renderTaskPreview(taskPreviewContainer);

		const buttonContainer = contentEl.createDiv({ cls: "timeblock-modal-buttons" });
		buttonContainer.style.display = "flex";
		buttonContainer.style.justifyContent = "space-between";

		const deleteButton = buttonContainer.createEl("button", {
			text: "Delete",
			cls: "mod-warning",
		});
		deleteButton.addEventListener("click", () => {
			void this.handleDelete();
		});

		const rightButtons = buttonContainer.createDiv();
		rightButtons.style.display = "flex";
		rightButtons.style.gap = "8px";

		const createTaskButton = rightButtons.createEl("button", { text: "Create task" });
		createTaskButton.addEventListener("click", () => {
			void this.openCreateTaskModal(taskPreviewContainer);
		});

		const cancelButton = rightButtons.createEl("button", { text: "Cancel" });
		cancelButton.addEventListener("click", () => this.close());

		const saveButton = rightButtons.createEl("button", {
			text: "Save",
			cls: "mod-cta focus-block-save-button",
		});
		saveButton.addEventListener("click", () => {
			void this.handleSave();
		});

		this.validateForm();
	}

	private updateRecurrenceButton(): void {
		if (!this.recurrenceButton) {
			return;
		}
		const label = this.recurrence ? getRecurrenceDisplayText(this.recurrence) || "Recurring" : "Set recurrence";
		this.recurrenceButton.setButtonText(label);
	}

	private showRecurrenceMenu(event: MouseEvent): void {
		const menu = new RecurrenceContextMenu({
			currentValue: this.recurrence,
			currentAnchor: this.recurrenceAnchor,
			scheduledDate:
				this.focusBlock.scheduled || `${formatDateForStorage(this.eventDate)}T${this.startTimeInput?.value || this.focusBlock.startTime}`,
			onSelect: (value, anchor) => {
				this.recurrence = value || "";
				this.recurrenceAnchor = anchor || "scheduled";
				this.updateRecurrenceButton();
			},
			app: this.app,
			plugin: this.plugin,
		});
		menu.show(event);
	}

	private async renderTaskPreview(container: HTMLElement): Promise<void> {
		container.empty();
		const loading = container.createEl("div", { text: "Loading tasks..." });
		loading.style.fontSize = "var(--tn-font-size-sm)";
		loading.style.color = "var(--tn-text-muted)";

		try {
			const service = new FocusBlockService(this.plugin);
			const result = await service.getSelectionResultForFocusBlock(
				this.focusBlock,
				this.eventDate,
				this.taskOverrides
			);
			container.empty();

			if (result.allTasks.length === 0) {
				const emptyState = container.createEl("div", { text: "No tasks" });
				emptyState.style.fontSize = "var(--tn-font-size-sm)";
				emptyState.style.color = "var(--tn-text-muted)";
				return;
			}

			if (result.primaryTasks.length > 0) {
				const heading = container.createEl("div", {
					text: "Tasks:",
				});
				heading.style.fontSize = "var(--tn-font-size-sm)";
				heading.style.fontWeight = "600";
				heading.style.marginBottom = "4px";
				result.primaryTasks.forEach((task) => this.renderTaskPreviewRow(container, task, false));
			}

			if (result.overdueTasks.length > 0) {
				const overdueHeading = container.createEl("div", { text: "Overdue:" });
				overdueHeading.style.fontSize = "var(--tn-font-size-sm)";
				overdueHeading.style.fontWeight = "600";
				overdueHeading.style.marginTop = "6px";
				overdueHeading.style.marginBottom = "4px";
				overdueHeading.style.color = "var(--text-error)";
				const visibleOverdue = result.overdueTasks.slice(0, 3);
				visibleOverdue.forEach((task) => this.renderTaskPreviewRow(container, task, true));
				if (result.overdueTasks.length > visibleOverdue.length) {
					const moreOverdue = container.createEl("div", {
						text: `+${result.overdueTasks.length - visibleOverdue.length} overdue tasks`,
					});
					moreOverdue.style.fontSize = "var(--tn-font-size-sm)";
					moreOverdue.style.color = "var(--text-error)";
					moreOverdue.style.marginTop = "2px";
				}
			}
		} catch (error) {
			console.error("Failed to load Focus Block tasks:", error);
			container.empty();
			const errorState = container.createEl("div", { text: "Unable to load tasks" });
			errorState.style.fontSize = "var(--tn-font-size-sm)";
			errorState.style.color = "var(--text-error)";
		}
	}

	private renderTaskPreviewRow(container: HTMLElement, task: TaskInfo, isOverdue: boolean): void {
		const row = container.createDiv();
		row.style.display = "flex";
		row.style.alignItems = "center";
		row.style.gap = "8px";
		row.style.fontSize = "var(--tn-font-size-md)";
		row.style.lineHeight = "1.35";
		row.style.marginTop = "2px";
		row.style.cursor = "pointer";
		row.title = task.path;

		const checkbox = row.createEl("input", { type: "checkbox" });
		checkbox.style.margin = "0";
		checkbox.addEventListener("click", (event) => {
			event.stopPropagation();
		});
		checkbox.addEventListener("change", async (event) => {
			event.stopPropagation();
			checkbox.disabled = true;
			try {
				const service = new FocusBlockService(this.plugin);
				const updatedTask = await service.toggleTaskFromFocusBlock(task, this.eventDate);
				this.taskOverrides.set(updatedTask.path, updatedTask);
				this.requestImmediateRefresh();
				await this.renderTaskPreview(container);
			} catch (error) {
				console.error("Failed to update task from Focus Block modal:", error);
				checkbox.disabled = false;
			}
		});

		const label = row.createEl("span", { text: task.title || "Untitled task" });
		label.style.flex = "1";
		if (isOverdue) {
			label.style.color = "var(--text-error)";
		}

		row.addEventListener("click", (event) => {
			if ((event.target as HTMLElement).tagName.toLowerCase() === "input") {
				return;
			}
			void this.openTaskFromPreview(task);
		});
	}

	private async openTaskFromPreview(task: TaskInfo): Promise<void> {
		const file = this.plugin.app.vault.getAbstractFileByPath(task.path);
		if (!(file instanceof TFile)) {
			new Notice("Could not find task file");
			return;
		}

		await this.plugin.openTaskEditModal(
			task,
			(updatedTask) => {
				this.taskOverrides.set(updatedTask.path, updatedTask);
				this.requestImmediateRefresh();
				const taskPreviewContainer = this.contentEl.querySelector(
					".focus-block-info-modal__tasks-list"
				) as HTMLElement | null;
				if (taskPreviewContainer) {
					void this.renderTaskPreview(taskPreviewContainer);
				}
			},
			() => this.close()
		);
	}

	private async openCreateTaskModal(taskPreviewContainer: HTMLElement): Promise<void> {
		const { TaskCreationModal } = await import("../modals/TaskCreationModal");
		new TaskCreationModal(this.app, this.plugin, {
			prePopulatedValues: getFocusBlockTaskCreationPrefill(this.focusBlock),
			onTaskCreated: (task) => {
				this.taskOverrides.set(task.path, task);
				this.requestImmediateRefresh();
				void this.renderTaskPreview(taskPreviewContainer);
			},
		}).open();
	}

	private requestImmediateRefresh(): void {
		this.onChange?.();
		this.plugin.emitter.trigger(EVENT_DATA_CHANGED);
	}

	private getScheduledDatePart(): string {
		const match = this.focusBlock.scheduled?.match(/^(\d{4}-\d{2}-\d{2})/);
		return match?.[1] || formatDateForStorage(this.eventDate);
	}

	private getWeekdayCode(date: Date): string {
		const weekdayCodes = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
		return weekdayCodes[date.getDay()] || "MO";
	}

	private getWeekdaySetPosition(date: Date): number {
		const dayOfMonth = date.getDate();
		const lastDayOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
		return dayOfMonth + 7 > lastDayOfMonth ? -1 : Math.ceil(dayOfMonth / 7);
	}

	private updateRecurrenceForScheduledChange(
		recurrence: string | undefined,
		scheduled: string,
		dateChanged: boolean
	): string | undefined {
		if (!recurrence) {
			return recurrence;
		}

		let updated = updateDTSTARTInRecurrenceRule(recurrence, scheduled) || recurrence;
		if (!dateChanged) {
			return updated;
		}

		const scheduledDate = new Date(`${scheduled}:00`);
		const weekdayCode = this.getWeekdayCode(scheduledDate);
		const dayOfMonth = scheduledDate.getDate();
		const month = scheduledDate.getMonth() + 1;

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
				updated = updated.replace(/BYSETPOS=[^;]+/, `BYSETPOS=${this.getWeekdaySetPosition(scheduledDate)}`);
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

	private validateForm(): void {
		const saveButton = this.contentEl.querySelector(".focus-block-save-button") as HTMLButtonElement | null;
		if (!saveButton) {
			return;
		}

		const title = this.titleInput?.value.trim();
		const startTime = this.startTimeInput?.value;
		const endTime = this.endTimeInput?.value;
		const isValid = !!(title && startTime && endTime && endTime !== startTime);
		saveButton.disabled = !isValid;
		saveButton.style.opacity = isValid ? "1" : "0.5";
	}

	private async handleSave(): Promise<void> {
		try {
			const previousScheduledDatePart = this.getScheduledDatePart();
			const scheduledDatePart = this.scheduledDateInput?.value || previousScheduledDatePart;
			const scheduled = `${scheduledDatePart}T${this.startTimeInput.value}`;
			const recurrence = this.updateRecurrenceForScheduledChange(
				this.recurrence || undefined,
				scheduled,
				scheduledDatePart !== previousScheduledDatePart
			);

			const service = new FocusBlockService(this.plugin);
			this.focusBlock = await service.updateFocusBlock(this.focusBlock, {
				title: this.titleInput.value.trim(),
				startTime: this.startTimeInput.value,
				endTime: this.endTimeInput.value,
				scheduled,
				recurrence,
				recurrence_anchor: this.recurrenceAnchor,
				filterTag: this.filterTagInput.value.trim() || undefined,
				topTasksCount: Number(this.topTasksCountInput.value || "1"),
				description: this.descriptionInput.value.trim() || undefined,
				color: this.colorInput.value,
			});
			this.onChange?.();
			this.plugin.emitter.trigger(EVENT_DATA_CHANGED);
			new Notice("Focus Block updated");
			this.close();
		} catch (error) {
			console.error("Failed to save Focus Block:", error);
			new Notice("Failed to save Focus Block");
		}
	}

	private async handleDelete(): Promise<void> {
		const confirmed = window.confirm(`Delete Focus Block "${this.focusBlock.title}"?`);
		if (!confirmed) {
			return;
		}

		try {
			const service = new FocusBlockService(this.plugin);
			await service.deleteFocusBlock(this.focusBlock);
			this.onChange?.();
			this.plugin.emitter.trigger(EVENT_DATA_CHANGED);
			new Notice("Focus Block deleted");
			this.close();
		} catch (error) {
			console.error("Failed to delete Focus Block:", error);
			new Notice("Failed to delete Focus Block");
		}
	}
}
