import { parseYaml, stringifyYaml, TFile } from "obsidian";
import type TaskNotesPlugin from "../main";
import type { FocusBlockFrontmatter, FocusBlockInfo, TaskInfo } from "../types";
import { getEffectiveTaskStatus, generateRecurringInstances } from "../core/recurrence";
import { formatDateForStorage, getCurrentTimestamp, parseDateToLocal } from "../utils/dateUtils";
import { ensureFolderExists, sanitizeTags } from "../utils/helpers";
import { addDTSTARTToRecurrenceRule } from "../core/recurrence";

export const DEFAULT_FOCUS_BLOCKS_FOLDER = "TaskNotes/FocusBlocks";

export interface FocusBlockSelectionOptions {
	targetDate?: Date;
	getPriorityWeight?: (priority?: string) => number;
	isCompletedStatus?: (status: string) => boolean;
}

export interface FocusBlockSelectionResult {
	primaryTasks: TaskInfo[];
	overdueTasks: TaskInfo[];
	allTasks: TaskInfo[];
}

export interface FocusBlockCreateData {
	title: string;
	date: string;
	startTime: string;
	endTime: string;
	recurrence?: string;
	recurrence_anchor?: "scheduled" | "completion";
	filterTag?: string;
	topTasksCount?: number;
	includeOverdue?: boolean;
	color?: string;
	description?: string;
}

type FocusBlockFrontmatterInput = Partial<FocusBlockFrontmatter>;

function normalizeTag(tag?: string): string {
	if (!tag || typeof tag !== "string") {
		return "";
	}
	return tag.trim().replace(/^#/, "").toLowerCase();
}

function extractDatePart(value?: string): string {
	if (!value || typeof value !== "string") {
		return "";
	}
	return value.includes("T") ? value.split("T")[0] : value;
}

function parseFrontmatterFromContent(content: string): FocusBlockFrontmatterInput | null {
	if (!content.startsWith("---")) {
		return null;
	}

	const endOfFrontmatter = content.indexOf("---", 3);
	if (endOfFrontmatter === -1) {
		return null;
	}

	try {
		return (parseYaml(content.substring(3, endOfFrontmatter)) || {}) as FocusBlockFrontmatterInput;
	} catch (error) {
		console.error("Failed to parse Focus Block frontmatter:", error);
		return null;
	}
}

function buildFocusBlockInfoFromFrontmatter(
	file: TFile,
	frontmatter: FocusBlockFrontmatterInput
): FocusBlockInfo | null {
	const isFocusBlock = frontmatter.focusBlock === true || frontmatter.type === "focus-block";
	if (!isFocusBlock) {
		return null;
	}

	const startTime = String(frontmatter.startTime || "").trim();
	const endTime = String(frontmatter.endTime || "").trim();
	if (!startTime || !endTime) {
		return null;
	}

	return {
		id: String(frontmatter.id || file.path),
		title: String(frontmatter.title || file.basename || "Focus Block"),
		path: file.path,
		focusBlock: true,
		type: "focus-block",
		startTime,
		endTime,
		scheduled: typeof frontmatter.scheduled === "string" ? frontmatter.scheduled : undefined,
		recurrence: typeof frontmatter.recurrence === "string" ? frontmatter.recurrence : undefined,
		recurrence_anchor:
			frontmatter.recurrence_anchor === "completion" ? "completion" : "scheduled",
		filterTag:
			typeof frontmatter.filterTag === "string" ? normalizeTag(frontmatter.filterTag) : undefined,
		topTasksCount: Number(frontmatter.topTasksCount || 1),
		includeOverdue: frontmatter.includeOverdue !== false,
		color: typeof frontmatter.color === "string" ? frontmatter.color : undefined,
		description:
			typeof frontmatter.description === "string" ? frontmatter.description : undefined,
		dateCreated:
			typeof frontmatter.dateCreated === "string" ? frontmatter.dateCreated : undefined,
		dateModified:
			typeof frontmatter.dateModified === "string" ? frontmatter.dateModified : undefined,
	};
}

function defaultPriorityWeight(priority?: string): number {
	switch ((priority || "").toLowerCase()) {
		case "high":
			return 3;
		case "normal":
			return 2;
		case "low":
			return 1;
		default:
			return 0;
	}
}

function isTaskCompleted(
	task: TaskInfo,
	targetDate: Date,
	isCompletedStatus: (status: string) => boolean
): boolean {
	if (!task.recurrence) {
		return isCompletedStatus(task.status || "open");
	}

	const effectiveStatus = getEffectiveTaskStatus(task, targetDate, "done");
	return isCompletedStatus(effectiveStatus);
}

function isTaskVisibleOnDate(
	task: TaskInfo,
	targetDate: Date,
	isCompletedStatus: (status: string) => boolean
): boolean {
	if (task.archived) {
		return false;
	}

	if (isTaskCompleted(task, targetDate, isCompletedStatus)) {
		return false;
	}

	return true;
}

function matchesFocusFilter(task: TaskInfo, filterTag?: string): boolean {
	const normalizedFilter = normalizeTag(filterTag);
	if (!normalizedFilter) {
		return true;
	}

	const taskTags = Array.isArray(task.tags) ? task.tags.map((tag) => normalizeTag(tag)) : [];
	return taskTags.includes(normalizedFilter);
}

function isOverdueTask(task: TaskInfo, targetDate: Date): boolean {
	const dueDate = extractDatePart(task.due);
	if (!dueDate) {
		return false;
	}
	return dueDate < formatDateForStorage(targetDate);
}

function compareTasks(
	a: TaskInfo,
	b: TaskInfo,
	getPriorityWeight: (priority?: string) => number
): number {
	const priorityDiff = getPriorityWeight(b.priority) - getPriorityWeight(a.priority);
	if (priorityDiff !== 0) {
		return priorityDiff;
	}

	if (a.sortOrder && b.sortOrder && a.sortOrder !== b.sortOrder) {
		return a.sortOrder.localeCompare(b.sortOrder);
	}
	if (a.sortOrder && !b.sortOrder) {
		return -1;
	}
	if (!a.sortOrder && b.sortOrder) {
		return 1;
	}

	const dateA = extractDatePart(a.due) || extractDatePart(a.scheduled) || "9999-12-31";
	const dateB = extractDatePart(b.due) || extractDatePart(b.scheduled) || "9999-12-31";
	if (dateA !== dateB) {
		return dateA.localeCompare(dateB);
	}

	return (a.title || "").localeCompare(b.title || "");
}

export function selectTasksForFocusBlock(
	tasks: TaskInfo[],
	focusBlock: Pick<FocusBlockInfo, "filterTag" | "topTasksCount" | "includeOverdue" | "title">,
	options: FocusBlockSelectionOptions = {}
): FocusBlockSelectionResult {
	const targetDate = options.targetDate || new Date();
	const getPriorityWeight = options.getPriorityWeight || defaultPriorityWeight;
	const isCompletedStatus = options.isCompletedStatus || ((status: string) => status === "done");
	const topTasksCount = Math.max(1, Number(focusBlock.topTasksCount || 1));
	const includeOverdue = focusBlock.includeOverdue !== false;

	const matchingTasks = tasks
		.filter((task) => matchesFocusFilter(task, focusBlock.filterTag))
		.filter((task) => isTaskVisibleOnDate(task, targetDate, isCompletedStatus));

	const rankedTasks = [...matchingTasks].sort((a, b) => compareTasks(a, b, getPriorityWeight));
	const primaryTasks = rankedTasks
		.filter((task) => !task.isBlocked)
		.slice(0, topTasksCount);
	const primaryPaths = new Set(primaryTasks.map((task) => task.path));

	const overdueTasks = includeOverdue
		? rankedTasks.filter((task) => isOverdueTask(task, targetDate) && !primaryPaths.has(task.path))
		: [];

	return {
		primaryTasks,
		overdueTasks,
		allTasks: [...primaryTasks, ...overdueTasks],
	};
}

function sanitizeFilename(input: string): string {
	const base = input
		.trim()
		.replace(/[<>:"/\\|?*]/g, "")
		.replace(/\s+/g, " ")
		.replace(/^\.+|\.+$/g, "")
		.trim();
	return base || "Focus Block";
}

export class FocusBlockService {
	constructor(private plugin: TaskNotesPlugin) {}

	getFolderPath(): string {
		return DEFAULT_FOCUS_BLOCKS_FOLDER;
	}

	async getAllFocusBlocks(): Promise<FocusBlockInfo[]> {
		const prefix = `${this.getFolderPath()}/`;
		const files = this.plugin.app.vault
			.getMarkdownFiles()
			.filter((file) => file.path === `${this.getFolderPath()}.md` || file.path.startsWith(prefix));

		const blocks: FocusBlockInfo[] = [];
		for (const file of files) {
			const block = await this.getFocusBlockFromFile(file);
			if (block) {
				blocks.push(block);
			}
		}

		return blocks;
	}

	async getFocusBlockFromFile(file: TFile): Promise<FocusBlockInfo | null> {
		let frontmatter = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter as
			| FocusBlockFrontmatterInput
			| undefined;

		if (!frontmatter) {
			const content = await this.plugin.app.vault.cachedRead(file);
			frontmatter = parseFrontmatterFromContent(content) || undefined;
		}

		if (!frontmatter) {
			return null;
		}

		return buildFocusBlockInfoFromFrontmatter(file, frontmatter);
	}

	async createFocusBlock(input: FocusBlockCreateData): Promise<FocusBlockInfo> {
		await ensureFolderExists(this.plugin.app.vault, this.getFolderPath());

		const timestamp = getCurrentTimestamp();
		const id = `focus-${Date.now()}`;
		const scheduled = `${input.date}T${input.startTime}`;
		let recurrence = input.recurrence?.trim() || undefined;
		if (recurrence && !recurrence.includes("DTSTART:")) {
			recurrence =
				addDTSTARTToRecurrenceRule({
					recurrence,
					scheduled,
					dateCreated: timestamp,
				}) || recurrence;
		}

		const frontmatter: FocusBlockFrontmatter = {
			id,
			title: input.title.trim(),
			focusBlock: true,
			type: "focus-block",
			startTime: input.startTime,
			endTime: input.endTime,
			scheduled,
			recurrence,
			recurrence_anchor: input.recurrence_anchor || "scheduled",
			filterTag: normalizeTag(sanitizeTags(input.filterTag || "")) || undefined,
			topTasksCount: Math.max(1, Number(input.topTasksCount || 1)),
			includeOverdue: input.includeOverdue !== false,
			color:
				input.color || this.plugin.settings.calendarViewSettings.defaultFocusBlockColor,
			description: input.description?.trim() || undefined,
			dateCreated: timestamp,
			dateModified: timestamp,
		};

		const baseName = sanitizeFilename(input.title);
		let path = `${this.getFolderPath()}/${baseName}.md`;
		let counter = 2;
		while (this.plugin.app.vault.getAbstractFileByPath(path)) {
			path = `${this.getFolderPath()}/${baseName} ${counter}.md`;
			counter += 1;
		}

		const content = `---\n${stringifyYaml(frontmatter)}---\n`;
		const file = await this.plugin.app.vault.create(path, content);
		const created = buildFocusBlockInfoFromFrontmatter(file, frontmatter);
		if (!created) {
			throw new Error("Failed to create Focus Block note");
		}
		return created;
	}

	async updateFocusBlock(
		focusBlock: FocusBlockInfo,
		updates: Partial<FocusBlockInfo>
	): Promise<FocusBlockInfo> {
		const file = this.plugin.app.vault.getAbstractFileByPath(focusBlock.path);
		if (!(file instanceof TFile)) {
			throw new Error(`Cannot find Focus Block file: ${focusBlock.path}`);
		}

		await this.plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
			const nextDateModified = getCurrentTimestamp();
			frontmatter.title = (updates.title ?? focusBlock.title).trim();
			frontmatter.focusBlock = true;
			frontmatter.type = "focus-block";
			frontmatter.startTime = updates.startTime ?? focusBlock.startTime;
			frontmatter.endTime = updates.endTime ?? focusBlock.endTime;
			frontmatter.scheduled = updates.scheduled ?? focusBlock.scheduled;
			frontmatter.recurrence = updates.recurrence ?? focusBlock.recurrence;
			frontmatter.recurrence_anchor =
				updates.recurrence_anchor ?? focusBlock.recurrence_anchor ?? "scheduled";
			frontmatter.topTasksCount = Math.max(
				1,
				Number(updates.topTasksCount ?? focusBlock.topTasksCount ?? 1)
			);
			frontmatter.includeOverdue = updates.includeOverdue ?? focusBlock.includeOverdue ?? true;
			frontmatter.color =
				updates.color ??
				focusBlock.color ??
				this.plugin.settings.calendarViewSettings.defaultFocusBlockColor;
			frontmatter.dateModified = nextDateModified;

			const nextFilterTag = updates.filterTag ?? focusBlock.filterTag;
			if (nextFilterTag) {
				frontmatter.filterTag = normalizeTag(nextFilterTag);
			} else {
				delete frontmatter.filterTag;
			}

			const nextDescription = updates.description ?? focusBlock.description;
			if (nextDescription && nextDescription.trim()) {
				frontmatter.description = nextDescription.trim();
			} else {
				delete frontmatter.description;
			}
		});

		const updated = await this.getFocusBlockFromFile(file);
		if (!updated) {
			throw new Error("Failed to reload Focus Block after update");
		}
		return updated;
	}

	async deleteFocusBlock(focusBlock: FocusBlockInfo): Promise<void> {
		const file = this.plugin.app.vault.getAbstractFileByPath(focusBlock.path);
		if (!(file instanceof TFile)) {
			return;
		}
		await this.plugin.app.vault.trash(file, false);
	}

	async getSelectionResultForFocusBlock(
		focusBlock: FocusBlockInfo,
		targetDate?: Date,
		taskOverrides?: Map<string, TaskInfo>
	): Promise<FocusBlockSelectionResult> {
		const tasks = await this.plugin.cacheManager.getAllTasks();
		let mergedTasks = tasks;

		if (taskOverrides && taskOverrides.size > 0) {
			const seenPaths = new Set<string>();
			mergedTasks = tasks.map((task) => {
				const override = taskOverrides.get(task.path);
				seenPaths.add(task.path);
				return override || task;
			});

			for (const [path, task] of taskOverrides.entries()) {
				if (!seenPaths.has(path)) {
					mergedTasks.push(task);
				}
			}
		}

		const tasksWithBlockedState = mergedTasks.map((task) => ({
			...task,
			isBlocked: Boolean(task.isBlocked || this.plugin.dependencyCache?.isTaskBlocked(task.path)),
		}));

		return selectTasksForFocusBlock(tasksWithBlockedState, focusBlock, {
			targetDate,
			getPriorityWeight: (priority) =>
				priority ? this.plugin.priorityManager.getPriorityWeight(priority) : 0,
			isCompletedStatus: (status) => this.plugin.statusManager.isCompletedStatus(status),
		});
	}

	async toggleTaskFromFocusBlock(task: TaskInfo, targetDate?: Date): Promise<TaskInfo> {
		if (task.recurrence) {
			return this.plugin.taskService.toggleRecurringTaskComplete(task, targetDate);
		}
		return this.plugin.taskService.toggleStatus(task);
	}

	getOccurrenceDatesForFocusBlock(
		focusBlock: Pick<FocusBlockInfo, "title" | "recurrence" | "scheduled" | "dateCreated">,
		visibleStart: Date,
		visibleEnd: Date
	): Date[] {
		if (focusBlock.recurrence) {
			return generateRecurringInstances(focusBlock, visibleStart, visibleEnd);
		}

		const anchor = focusBlock.scheduled || focusBlock.dateCreated;
		if (!anchor) {
			return [];
		}

		const date = parseDateToLocal(anchor);
		if (Number.isNaN(date.getTime())) {
			return [];
		}

		if (date < visibleStart || date > visibleEnd) {
			return [];
		}

		return [date];
	}
}
