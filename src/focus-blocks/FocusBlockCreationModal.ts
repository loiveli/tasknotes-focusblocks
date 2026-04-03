import { App, ButtonComponent, Modal, Notice, Setting } from "obsidian";
import TaskNotesPlugin from "../main";
import { RecurrenceContextMenu } from "../components/RecurrenceContextMenu";
import { getRecurrenceDisplayText } from "../core/recurrence";
import { FocusBlockService } from "../services/FocusBlockService";

export interface FocusBlockCreationOptions {
	date: string;
	startTime?: string;
	endTime?: string;
	onCreated?: () => void;
}

export class FocusBlockCreationModal extends Modal {
	private titleInput!: HTMLInputElement;
	private startTimeInput!: HTMLInputElement;
	private endTimeInput!: HTMLInputElement;
	private filterTagInput!: HTMLInputElement;
	private topTasksCountInput!: HTMLInputElement;
	private descriptionInput!: HTMLTextAreaElement;
	private colorInput!: HTMLInputElement;
	private recurrenceButton?: ButtonComponent;
	private recurrence = "";
	private recurrenceAnchor: "scheduled" | "completion" = "scheduled";

	constructor(
		app: App,
		private plugin: TaskNotesPlugin,
		private options: FocusBlockCreationOptions
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("timeblock-creation-modal");

		new Setting(contentEl).setName("Create Focus Block").setHeading();

		const dateDisplay = contentEl.createDiv({ cls: "timeblock-date-display" });
		dateDisplay.createEl("strong", { text: "Date: " });
		dateDisplay.createSpan({ text: this.options.date });

		new Setting(contentEl)
			.setName("Title")
			.setDesc("Name for this Focus Block")
			.addText((text) => {
				this.titleInput = text.inputEl;
				text.setPlaceholder("Morning Focus").onChange(() => this.validateForm());
				window.setTimeout(() => this.titleInput.focus(), 50);
			});

		const timeContainer = contentEl.createDiv({ cls: "timeblock-time-container" });

		new Setting(timeContainer)
			.setName("Start time")
			.addText((text) => {
				this.startTimeInput = text.inputEl;
				this.startTimeInput.type = "time";
				this.startTimeInput.step = "60";
				this.startTimeInput.addClass("timeblock-time-input");
				text.setValue(this.options.startTime || "09:00").onChange(() => this.validateForm());
			});

		new Setting(timeContainer)
			.setName("End time")
			.addText((text) => {
				this.endTimeInput = text.inputEl;
				this.endTimeInput.type = "time";
				this.endTimeInput.step = "60";
				this.endTimeInput.addClass("timeblock-time-input");
				text.setValue(this.options.endTime || "10:00").onChange(() => this.validateForm());
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
			.setDesc("Optional tag to limit which tasks appear in this Focus Block")
			.addText((text) => {
				this.filterTagInput = text.inputEl;
				text.setPlaceholder("work");
			});

		new Setting(contentEl)
			.setName("Top tasks")
			.setDesc("How many priority tasks to surface before showing overdue tasks")
			.addText((text) => {
				this.topTasksCountInput = text.inputEl;
				this.topTasksCountInput.type = "number";
				this.topTasksCountInput.min = "1";
				text.setValue("1");
			});

		new Setting(contentEl)
			.setName("Description")
			.setDesc("Optional notes for this Focus Block")
			.addTextArea((text) => {
				this.descriptionInput = text.inputEl;
				this.descriptionInput.rows = 3;
			});

		new Setting(contentEl)
			.setName("Color")
			.setDesc("Calendar color for this Focus Block")
			.addText((text) => {
				this.colorInput = text.inputEl;
				this.colorInput.type = "color";
				text.setValue(this.plugin.settings.calendarViewSettings.defaultFocusBlockColor);
			});

		const buttonContainer = contentEl.createDiv({ cls: "timeblock-modal-buttons" });
		const cancelButton = buttonContainer.createEl("button", { text: "Cancel" });
		cancelButton.addEventListener("click", () => this.close());

		const createButton = buttonContainer.createEl("button", {
			text: "Create Focus Block",
			cls: "mod-cta focus-block-create-button",
		});
		createButton.addEventListener("click", () => {
			void this.handleSubmit();
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
			scheduledDate: `${this.options.date}T${this.startTimeInput?.value || this.options.startTime || "09:00"}`,
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

	private validateForm(): void {
		const createButton = this.contentEl.querySelector(".focus-block-create-button") as HTMLButtonElement | null;
		if (!createButton) {
			return;
		}

		const title = this.titleInput?.value.trim();
		const startTime = this.startTimeInput?.value;
		const endTime = this.endTimeInput?.value;
		let isValid = !!(title && startTime && endTime);

		if (isValid && startTime && endTime) {
			isValid = endTime !== startTime;
		}

		createButton.disabled = !isValid;
		createButton.style.opacity = isValid ? "1" : "0.5";
	}

	private async handleSubmit(): Promise<void> {
		const title = this.titleInput.value.trim();
		const startTime = this.startTimeInput.value;
		const endTime = this.endTimeInput.value;

		if (!title || !startTime || !endTime || endTime === startTime) {
			new Notice("Please provide a valid title and time range");
			return;
		}

		try {
			const service = new FocusBlockService(this.plugin);
			await service.createFocusBlock({
				title,
				date: this.options.date,
				startTime,
				endTime,
				recurrence: this.recurrence || undefined,
				recurrence_anchor: this.recurrenceAnchor,
				filterTag: this.filterTagInput.value.trim() || undefined,
				topTasksCount: Number(this.topTasksCountInput.value || "1"),
				includeOverdue: true,
				color: this.colorInput.value,
				description: this.descriptionInput.value.trim() || undefined,
			});
			new Notice("Focus Block created");
			this.close();
			this.options.onCreated?.();
		} catch (error) {
			console.error("Failed to create Focus Block:", error);
			new Notice("Failed to create Focus Block");
		}
	}
}
