import { App, ButtonComponent, Modal, Notice, Setting, TFile } from "obsidian";
import TaskNotesPlugin from "../main";
import { EVENT_DATA_CHANGED, type FocusBlockInfo, type TaskInfo } from "../types";
import { RecurrenceContextMenu } from "../components/RecurrenceContextMenu";
import { getRecurrenceDisplayText, updateDTSTARTInRecurrenceRule } from "../core/recurrence";
import { FocusBlockService } from "../services/FocusBlockService";
import { formatDateForStorage } from "../utils/dateUtils";
import { getFocusBlockTaskCreationPrefill } from "./focusBlockCore";
import { TranslationKey } from "../i18n";

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
	private translate: (key: TranslationKey, variables?: Record<string, any>) => string;

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
		this.translate = plugin.i18n.translate.bind(plugin.i18n);
	}

	private setupTimeInput(input: HTMLInputElement): void {
		input.type = "hidden";
		input.addClass("timeblock-time-input");
	}

	private createTimeField(
		container: HTMLElement,
		label: string,
		value: string,
		onChange: () => void
	): HTMLInputElement {
		const normalizedValue = /^\d{2}:\d{2}$/.test(value) ? value : "09:00";
		const [initialHour, initialMinute] = normalizedValue.split(":");

		const field = container.createDiv({ cls: "timeblock-time-field" });
		field.createEl("label", { text: label, cls: "timeblock-time-label" });

		const input = field.createEl("input");
		this.setupTimeInput(input);
		input.value = normalizedValue;

		const picker = field.createDiv({ cls: "timeblock-time-picker" });
		const hourSelect = picker.createEl("select", {
			cls: "timeblock-time-segment timeblock-time-segment--hour",
		});
		hourSelect.setAttribute("aria-label", `${label} hours`);

		for (let hour = 0; hour < 24; hour++) {
			const optionValue = String(hour).padStart(2, "0");
			hourSelect.createEl("option", { value: optionValue, text: optionValue });
		}

		picker.createSpan({ cls: "timeblock-time-divider", text: ":" });

		const minuteSelect = picker.createEl("select", {
			cls: "timeblock-time-segment timeblock-time-segment--minute",
		});
		minuteSelect.setAttribute("aria-label", `${label} minutes`);

		for (let minute = 0; minute < 60; minute++) {
			const optionValue = String(minute).padStart(2, "0");
			minuteSelect.createEl("option", { value: optionValue, text: optionValue });
		}

		hourSelect.value = initialHour;
		minuteSelect.value = initialMinute;

		const syncValue = () => {
			input.value = `${hourSelect.value}:${minuteSelect.value}`;
			onChange();
		};

		hourSelect.addEventListener("change", syncValue);
		minuteSelect.addEventListener("change", syncValue);

		return input;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("timeblock-info-modal");

		new Setting(contentEl)
			.setName(this.translate("modals.focusBlockInfo.heading"))
			.setHeading();

		const dateDisplay = contentEl.createDiv({ cls: "timeblock-date-display" });
		dateDisplay.createEl("strong", { text: this.translate("modals.focusBlockInfo.dateTimeLabel") });
		dateDisplay.createSpan({
			text: this.translate("modals.focusBlockInfo.dateTimeValue", {
				date: this.eventDate.toLocaleDateString(),
				startTime: this.focusBlock.startTime,
				endTime: this.focusBlock.endTime,
			}),
		});

		new Setting(contentEl)
			.setName(this.translate("modals.focusBlockInfo.titleLabel"))
			.addText((text) => {
				this.titleInput = text.inputEl;
				text.setValue(this.focusBlock.title || "").onChange(() => this.validateForm());
			});

		new Setting(contentEl)
			.setName(this.translate("modals.focusBlockInfo.scheduledDateLabel"))
			.setDesc(this.translate("modals.focusBlockInfo.scheduledDateDesc"))
			.addText((text) => {
				this.scheduledDateInput = text.inputEl;
				this.scheduledDateInput.type = "date";
				text.setValue(this.getScheduledDatePart());
			});

		const timeContainer = contentEl.createDiv({ cls: "timeblock-time-container" });

		this.startTimeInput = this.createTimeField(
			timeContainer,
			this.translate("modals.focusBlockInfo.startTimeLabel"),
			this.focusBlock.startTime || "09:00",
			() => this.validateForm()
		);

		timeContainer.createDiv({ cls: "timeblock-time-separator", text: "→" });

		this.endTimeInput = this.createTimeField(
			timeContainer,
			this.translate("modals.focusBlockInfo.endTimeLabel"),
			this.focusBlock.endTime || "10:00",
			() => this.validateForm()
		);

		contentEl.createDiv({
			cls: "focus-block-time-note",
			text: this.translate("modals.focusBlockInfo.timeNote"),
		});

		new Setting(contentEl)
			.setName(this.translate("modals.focusBlockInfo.recurrenceLabel"))
			.setDesc(this.translate("modals.focusBlockInfo.recurrenceDesc"))
			.addButton((button) => {
				this.recurrenceButton = button;
				this.updateRecurrenceButton();
				button.onClick((event) => this.showRecurrenceMenu(event));
			})
			.addExtraButton((button) => {
				button
					.setIcon("x")
					.setTooltip(this.translate("components.recurrenceContextMenu.clearRecurrence"))
					.onClick(() => {
						this.recurrence = "";
						this.recurrenceAnchor = "scheduled";
						this.updateRecurrenceButton();
					});
			});

		new Setting(contentEl)
			.setName(this.translate("modals.focusBlockInfo.filterTagLabel"))
			.addText((text) => {
				this.filterTagInput = text.inputEl;
				text.setValue(this.focusBlock.filterTag || "");
			});

		new Setting(contentEl)
			.setName(this.translate("modals.focusBlockInfo.topTasksLabel"))
			.addText((text) => {
				this.topTasksCountInput = text.inputEl;
				this.topTasksCountInput.type = "number";
				this.topTasksCountInput.min = "1";
				text.setValue(String(this.focusBlock.topTasksCount || 1));
			});

		new Setting(contentEl)
			.setName(this.translate("modals.focusBlockInfo.descriptionLabel"))
			.addTextArea((text) => {
				this.descriptionInput = text.inputEl;
				this.descriptionInput.rows = 3;
				text.setValue(this.focusBlock.description || "");
			});

		new Setting(contentEl)
			.setName(this.translate("modals.focusBlockInfo.colorLabel"))
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
			text: this.translate("modals.focusBlockInfo.sections.tasks"),
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
			text: this.translate("modals.focusBlockInfo.buttons.delete"),
			cls: "mod-warning",
		});
		deleteButton.addEventListener("click", () => {
			void this.handleDelete();
		});

		const rightButtons = buttonContainer.createDiv();
		rightButtons.style.display = "flex";
		rightButtons.style.gap = "8px";

		const createTaskButton = rightButtons.createEl("button", {
			text: this.translate("modals.focusBlockInfo.buttons.createTask"),
		});
		createTaskButton.addEventListener("click", () => {
			void this.openCreateTaskModal(taskPreviewContainer);
		});

		const cancelButton = rightButtons.createEl("button", {
			text: this.translate("common.cancel"),
		});
		cancelButton.addEventListener("click", () => this.close());

		const saveButton = rightButtons.createEl("button", {
			text: this.translate("common.save"),
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
		const label = this.recurrence
			? getRecurrenceDisplayText(this.recurrence) || this.translate("focusBlocks.common.recurring")
			: this.translate("focusBlocks.common.setRecurrence");
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
		const loading = container.createEl("div", {
			text: this.translate("focusBlocks.preview.loadingTasks"),
		});
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
				const emptyState = container.createEl("div", {
					text: this.translate("focusBlocks.preview.noTasks"),
				});
				emptyState.style.fontSize = "var(--tn-font-size-sm)";
				emptyState.style.color = "var(--tn-text-muted)";
				return;
			}

			if (result.primaryTasks.length > 0) {
				const heading = container.createEl("div", {
					text: this.translate("focusBlocks.preview.tasksHeader"),
				});
				heading.style.fontSize = "var(--tn-font-size-sm)";
				heading.style.fontWeight = "600";
				heading.style.marginBottom = "4px";
				result.primaryTasks.forEach((task) => this.renderTaskPreviewRow(container, task, false));
			}

			if (result.overdueTasks.length > 0) {
				const overdueHeading = container.createEl("div", {
					text: this.translate("focusBlocks.preview.overdueHeader"),
				});
				overdueHeading.style.fontSize = "var(--tn-font-size-sm)";
				overdueHeading.style.fontWeight = "600";
				overdueHeading.style.marginTop = "6px";
				overdueHeading.style.marginBottom = "4px";
				overdueHeading.style.color = "var(--text-error)";
				const visibleOverdue = result.overdueTasks.slice(0, 3);
				visibleOverdue.forEach((task) => this.renderTaskPreviewRow(container, task, true));
				if (result.overdueTasks.length > visibleOverdue.length) {
					const moreOverdue = container.createEl("div", {
						text: this.translate("focusBlocks.preview.moreOverdueTasks", {
							count: result.overdueTasks.length - visibleOverdue.length,
						}),
					});
					moreOverdue.style.fontSize = "var(--tn-font-size-sm)";
					moreOverdue.style.color = "var(--text-error)";
					moreOverdue.style.marginTop = "2px";
				}
			}
		} catch (error) {
			console.error("Failed to load Focus Block tasks:", error);
			container.empty();
			const errorState = container.createEl("div", {
				text: this.translate("focusBlocks.preview.unableToLoadTasks"),
			});
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

		const label = row.createEl("span", {
			text: task.title || this.translate("focusBlocks.common.untitledTask"),
		});
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
			new Notice(this.translate("modals.focusBlockInfo.notices.taskFileMissing"));
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
			new Notice(this.translate("modals.focusBlockInfo.notices.updateSuccess"));
			this.close();
		} catch (error) {
			console.error("Failed to save Focus Block:", error);
			new Notice(this.translate("modals.focusBlockInfo.notices.updateFailure"));
		}
	}

	private async handleDelete(): Promise<void> {
		const confirmed = window.confirm(
			this.translate("modals.focusBlockInfo.deleteConfirmation", {
				title: this.focusBlock.title,
			})
		);
		if (!confirmed) {
			return;
		}

		try {
			const service = new FocusBlockService(this.plugin);
			await service.deleteFocusBlock(this.focusBlock);
			this.onChange?.();
			this.plugin.emitter.trigger(EVENT_DATA_CHANGED);
			new Notice(this.translate("modals.focusBlockInfo.notices.deleteSuccess"));
			this.close();
		} catch (error) {
			console.error("Failed to delete Focus Block:", error);
			new Notice(this.translate("modals.focusBlockInfo.notices.deleteFailure"));
		}
	}
}
