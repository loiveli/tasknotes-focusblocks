import { setIcon } from "obsidian";
import TaskNotesPlugin from "../main";
import { EVENT_DATA_CHANGED, type FocusBlockInfo, type TaskInfo } from "../types";
import { FocusBlockService } from "../services/FocusBlockService";
import { shouldShowFocusBlockTasksInCalendar } from "./focusBlockCore";
import { FocusBlockInfoModal } from "./FocusBlockInfoModal";

export interface FocusBlockCardOptions {
	eventDate?: Date;
}

export function createFocusBlockCard(
	focusBlock: FocusBlockInfo,
	plugin: TaskNotesPlugin,
	options: FocusBlockCardOptions = {}
): HTMLElement {
	const card = document.createElement("div");
	card.className = "task-card task-card--timeblock task-card--focusblock";
	(card as any).dataset.key = `focusblock-${focusBlock.id}`;

	const mainRow = card.createEl("div", { cls: "task-card__main-row" });
	const leftIconWrap = mainRow.createEl("span", { cls: "timeblock-card__icon" });
	const leftIcon = leftIconWrap.createDiv();
	setIcon(leftIcon, "target");
	leftIconWrap.style.display = "inline-flex";
	leftIconWrap.style.width = "16px";
	leftIconWrap.style.height = "16px";
	leftIconWrap.style.marginRight = "8px";
	leftIconWrap.style.alignItems = "center";
	leftIconWrap.style.justifyContent = "center";
	leftIconWrap.style.flexShrink = "0";
	leftIcon.style.width = "100%";
	leftIcon.style.height = "100%";
	leftIcon.style.color = focusBlock.color || "var(--color-accent)";

	const content = mainRow.createEl("div", { cls: "task-card__content" });
	content.createEl("div", {
		cls: "task-card__title",
		text: focusBlock.title || plugin.i18n.translate("focusBlocks.common.defaultTitle"),
	});

	const metadata = content.createEl("div", { cls: "task-card__metadata" });
	metadata.textContent = `${focusBlock.startTime} - ${focusBlock.endTime}`;
	if (focusBlock.filterTag) {
		metadata.appendText(` • #${focusBlock.filterTag}`);
	}

	if (focusBlock.description) {
		const description = content.createEl("div", {
			cls: "task-card__description",
			text: focusBlock.description,
		});
		description.style.fontSize = "var(--tn-font-size-sm)";
		description.style.color = "var(--tn-text-muted)";
		description.style.marginTop = "4px";
	}

	const shouldShowTasks = shouldShowFocusBlockTasksInCalendar(
		plugin,
		focusBlock,
		options.eventDate || null
	);
	const tasksContainer = shouldShowTasks
		? content.createEl("div", { cls: "focus-block-card__tasks" })
		: null;
	if (tasksContainer) {
		tasksContainer.style.marginTop = "6px";
		tasksContainer.createEl("div", {
			text: plugin.i18n.translate("focusBlocks.preview.loadingTasks"),
		});
	}

	const service = new FocusBlockService(plugin);
	const taskOverrides = new Map<string, TaskInfo>();

	const renderTaskSection = async () => {
		if (!tasksContainer) {
			return;
		}
		tasksContainer.empty();

		try {
			const result = await service.getSelectionResultForFocusBlock(
				focusBlock,
				options.eventDate || new Date(),
				taskOverrides
			);

			if (result.allTasks.length === 0) {
				const emptyState = tasksContainer.createEl("div", {
					text: plugin.i18n.translate("focusBlocks.preview.noTasks"),
					cls: "focus-block-card__empty",
				});
				emptyState.style.fontSize = "var(--tn-font-size-sm)";
				emptyState.style.color = "var(--tn-text-muted)";
				return;
			}

			if (result.primaryTasks.length > 0) {
				const heading = tasksContainer.createEl("div", {
					text: plugin.i18n.translate("focusBlocks.preview.tasksHeader"),
				});
				heading.style.fontSize = "var(--tn-font-size-sm)";
				heading.style.fontWeight = "600";
				heading.style.marginBottom = "4px";
				result.primaryTasks.forEach((task) => renderTaskRow(tasksContainer, task, false));
			}

			if (result.overdueTasks.length > 0) {
				const overdueHeading = tasksContainer.createEl("div", {
					text: plugin.i18n.translate("focusBlocks.preview.overdueHeader"),
				});
				overdueHeading.style.fontSize = "var(--tn-font-size-sm)";
				overdueHeading.style.fontWeight = "600";
				overdueHeading.style.marginTop = "6px";
				overdueHeading.style.marginBottom = "4px";
				overdueHeading.style.color = "var(--text-error)";
				const visibleOverdue = result.overdueTasks.slice(0, 3);
				visibleOverdue.forEach((task) => renderTaskRow(tasksContainer, task, true));
				if (result.overdueTasks.length > visibleOverdue.length) {
					const moreOverdue = tasksContainer.createEl("div", {
						text: plugin.i18n.translate("focusBlocks.preview.moreOverdueTasks", {
							count: result.overdueTasks.length - visibleOverdue.length,
						}),
					});
					moreOverdue.style.fontSize = "var(--tn-font-size-sm)";
					moreOverdue.style.color = "var(--text-error)";
					moreOverdue.style.marginTop = "2px";
				}
			}
		} catch (error) {
			console.error("Failed to render Focus Block tasks:", error);
			const errorState = tasksContainer.createEl("div", {
				text: plugin.i18n.translate("focusBlocks.preview.unableToLoadTasks"),
				cls: "focus-block-card__empty",
			});
			errorState.style.fontSize = "var(--tn-font-size-sm)";
			errorState.style.color = "var(--text-error)";
		}
	};

	const renderTaskRow = (container: HTMLElement, task: TaskInfo, isOverdue: boolean) => {
		const row = container.createDiv({ cls: "focus-block-card__task-row" });
		row.style.display = "flex";
		row.style.alignItems = "center";
		row.style.gap = "6px";
		row.style.marginTop = "2px";

		const checkbox = row.createEl("input", { type: "checkbox" });
		checkbox.addEventListener("click", (event) => {
			event.stopPropagation();
		});
		checkbox.addEventListener("change", async (event) => {
			event.stopPropagation();
			checkbox.disabled = true;
			try {
				const updatedTask = await service.toggleTaskFromFocusBlock(task, options.eventDate || new Date());
				taskOverrides.set(updatedTask.path, updatedTask);
				await renderTaskSection();
				plugin.emitter.trigger(EVENT_DATA_CHANGED);
			} catch (error) {
				console.error("Failed to update task from Focus Block:", error);
				checkbox.disabled = false;
			}
		});

		const label = row.createEl("span", {
			text: task.title || plugin.i18n.translate("focusBlocks.common.untitledTask"),
		});
		label.style.fontSize = "var(--tn-font-size-md)";
		label.style.lineHeight = "1.35";
		if (isOverdue) {
			label.style.color = "var(--text-error)";
		}
	};

	void renderTaskSection();

	card.addEventListener("click", () => {
		new FocusBlockInfoModal(plugin.app, plugin, focusBlock, options.eventDate || new Date(), () => {
			void renderTaskSection();
		}).open();
	});

	if (focusBlock.color) {
		card.style.setProperty("--current-status-color", focusBlock.color);
	}

	return card;
}
