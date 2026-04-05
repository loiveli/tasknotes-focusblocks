import type { TaskInfo } from "../../../src/types";
import { selectTasksForFocusBlock } from "../../../src/services/FocusBlockService";
import {
	getFocusBlockDateTimeRange,
	getFocusBlockTaskCreationPrefill,
	shouldShowFocusBlockTasksInCalendar,
	updateFocusBlockRecurrenceForMove,
} from "../../../src/focus-blocks/focusBlockCore";

function makeTask(overrides: Partial<TaskInfo>): TaskInfo {
	return {
		title: "Task",
		status: "open",
		priority: "normal",
		path: `/tmp/${Math.random().toString(36).slice(2)}.md`,
		archived: false,
		...overrides,
	};
}

describe("FocusBlockService", () => {
	const targetDate = new Date("2026-04-03T12:00:00Z");

	it("selects the top N matching tasks and appends matching overdue tasks", () => {
		const tasks: TaskInfo[] = [
			makeTask({ title: "High priority work", priority: "high", tags: ["work"] }),
			makeTask({ title: "Normal work", priority: "normal", tags: ["work"] }),
			makeTask({ title: "Late work", priority: "low", tags: ["work"], due: "2026-04-01" }),
			makeTask({ title: "Late home", priority: "high", tags: ["home"], due: "2026-04-01" }),
			makeTask({ title: "Done work", priority: "high", tags: ["work"], status: "done" }),
		];

		const result = selectTasksForFocusBlock(
			tasks,
			{ title: "Morning Focus", filterTag: "work", topTasksCount: 1 },
			{ targetDate }
		);

		expect(result.primaryTasks.map((task) => task.title)).toEqual(["High priority work"]);
		expect(result.overdueTasks.map((task) => task.title)).toEqual(["Late work"]);
		expect(result.allTasks.map((task) => task.title)).toEqual(["High priority work", "Late work"]);
	});

	it("does not duplicate an overdue task that is already part of the top N", () => {
		const tasks: TaskInfo[] = [
			makeTask({ title: "Urgent work", priority: "high", tags: ["work"], due: "2026-04-01" }),
			makeTask({ title: "Second work", priority: "normal", tags: ["work"] }),
		];

		const result = selectTasksForFocusBlock(
			tasks,
			{ title: "Morning Focus", filterTag: "work", topTasksCount: 1 },
			{ targetDate }
		);

		expect(result.primaryTasks.map((task) => task.title)).toEqual(["Urgent work"]);
		expect(result.overdueTasks).toHaveLength(0);
		expect(result.allTasks.map((task) => task.title)).toEqual(["Urgent work"]);
	});

	it("keeps blocked tasks out of the primary set but still shows them when overdue", () => {
		const tasks: TaskInfo[] = [
			makeTask({
				title: "Blocked overdue work",
				priority: "high",
				tags: ["work"],
				due: "2026-04-01",
				isBlocked: true,
			}),
			makeTask({ title: "Ready work", priority: "normal", tags: ["work"] }),
		];

		const result = selectTasksForFocusBlock(
			tasks,
			{ title: "Morning Focus", filterTag: "work", topTasksCount: 1 },
			{ targetDate }
		);

		expect(result.primaryTasks.map((task) => task.title)).toEqual(["Ready work"]);
		expect(result.overdueTasks.map((task) => task.title)).toEqual(["Blocked overdue work"]);
		expect(result.allTasks.map((task) => task.title)).toEqual(["Ready work", "Blocked overdue work"]);
	});

	it("keeps priority ahead of sortOrder across different priority groups", () => {
		const tasks: TaskInfo[] = [
			makeTask({ title: "Low ranked first", priority: "low", tags: ["work"], sortOrder: "0|000001:" }),
			makeTask({ title: "High priority task", priority: "high", tags: ["work"] }),
			makeTask({ title: "Normal ranked", priority: "normal", tags: ["work"], sortOrder: "0|000002:" }),
		];

		const result = selectTasksForFocusBlock(
			tasks,
			{ title: "Morning Focus", filterTag: "work", topTasksCount: 2 },
			{ targetDate }
		);

		expect(result.primaryTasks.map((task) => task.title)).toEqual([
			"High priority task",
			"Normal ranked",
		]);
	});

	it("uses sortOrder as a tiebreaker within the same priority group", () => {
		const tasks: TaskInfo[] = [
			makeTask({ title: "Normal later", priority: "normal", tags: ["work"], sortOrder: "0|000003:" }),
			makeTask({ title: "Normal earlier", priority: "normal", tags: ["work"], sortOrder: "0|000001:" }),
		];

		const result = selectTasksForFocusBlock(
			tasks,
			{ title: "Morning Focus", filterTag: "work", topTasksCount: 2 },
			{ targetDate }
		);

		expect(result.primaryTasks.map((task) => task.title)).toEqual(["Normal earlier", "Normal later"]);
	});

	it("prefills task tags from the Focus Block filter tag for the create-task flow", () => {
		expect(getFocusBlockTaskCreationPrefill({ filterTag: "work" })).toEqual({
			tags: ["work"],
		});
		expect(getFocusBlockTaskCreationPrefill({ filterTag: undefined })).toEqual({});
	});

	it("updates weekly recurrence weekday when a Focus Block is moved to another day", () => {
		const updated = updateFocusBlockRecurrenceForMove(
			"DTSTART:20260403T090000Z;FREQ=WEEKLY;INTERVAL=1;BYDAY=FR",
			"2026-04-07T09:00",
			new Date("2026-04-07T09:00:00"),
			true
		);

		expect(updated).toContain("DTSTART:20260407T090000Z");
		expect(updated).toContain("BYDAY=TU");
	});

	it("hides recurring tasks that are already completed for the Focus Block date", () => {
		const tasks: TaskInfo[] = [
			makeTask({
				title: "Weekly review",
				tags: ["work"],
				recurrence: "DTSTART:20260403T090000Z;FREQ=WEEKLY;INTERVAL=1;BYDAY=FR",
				complete_instances: ["2026-04-03"],
			}),
		];

		const result = selectTasksForFocusBlock(
			tasks,
			{ title: "Work Focus", filterTag: "work", topTasksCount: 1 },
			{ targetDate }
		);

		expect(result.allTasks).toHaveLength(0);
	});

	it("keeps the original weekly recurrence day when only the time changes", () => {
		const updated = updateFocusBlockRecurrenceForMove(
			"DTSTART:20260403T090000Z;FREQ=WEEKLY;INTERVAL=1;BYDAY=FR",
			"2026-04-03T11:30",
			new Date("2026-04-03T11:30:00"),
			false
		);

		expect(updated).toContain("DTSTART:20260403T113000Z");
		expect(updated).toContain("BYDAY=FR");
	});

	it("can limit calendar task previews to only the currently active Focus Block", () => {
		jest.useFakeTimers();
		try {
			jest.setSystemTime(new Date("2026-04-03T10:30:00"));
			const plugin = {
				settings: {
					calendarViewSettings: {
						showTasksOnAllFocusBlocks: false,
					},
				},
			} as any;

			expect(
				shouldShowFocusBlockTasksInCalendar(
					plugin,
					{ startTime: "10:00", endTime: "11:00" },
					new Date("2026-04-03T10:00:00")
				)
			).toBe(true);

			expect(
				shouldShowFocusBlockTasksInCalendar(
					plugin,
					{ startTime: "12:00", endTime: "13:00" },
					new Date("2026-04-03T12:00:00")
				)
			).toBe(false);
		} finally {
			jest.useRealTimers();
		}
	});

	it("treats the end boundary as exclusive and supports overnight Focus Blocks", () => {
		jest.useFakeTimers();
		try {
			const plugin = {
				settings: {
					calendarViewSettings: {
						showTasksOnAllFocusBlocks: false,
					},
				},
			} as any;

			jest.setSystemTime(new Date("2026-04-03T21:00:00"));
			expect(
				shouldShowFocusBlockTasksInCalendar(
					plugin,
					{ startTime: "15:00", endTime: "21:00" },
					new Date("2026-04-03T15:00:00")
				)
			).toBe(false);
			expect(
				shouldShowFocusBlockTasksInCalendar(
					plugin,
					{ startTime: "21:00", endTime: "21:30" },
					new Date("2026-04-03T21:00:00")
				)
			).toBe(true);
			expect(
				shouldShowFocusBlockTasksInCalendar(
					plugin,
					{ startTime: "21:00", endTime: "00:30" },
					new Date("2026-04-03T21:00:00")
				)
			).toBe(true);

			jest.setSystemTime(new Date("2026-04-04T00:15:00"));
			expect(
				shouldShowFocusBlockTasksInCalendar(
					plugin,
					{ startTime: "21:00", endTime: "00:30" },
					new Date("2026-04-03T21:00:00")
				)
			).toBe(true);
		} finally {
			jest.useRealTimers();
		}
	});

	it("extends overnight Focus Block date ranges into the next day", () => {
		const range = getFocusBlockDateTimeRange(
			{ startTime: "21:00", endTime: "00:30" },
			new Date("2026-04-03T21:00:00")
		);

		expect(range.start.getFullYear()).toBe(2026);
		expect(range.start.getMonth()).toBe(3);
		expect(range.start.getDate()).toBe(3);
		expect(range.start.getHours()).toBe(21);
		expect(range.end.getFullYear()).toBe(2026);
		expect(range.end.getMonth()).toBe(3);
		expect(range.end.getDate()).toBe(4);
		expect(range.end.getHours()).toBe(0);
		expect(range.end.getMinutes()).toBe(30);
		expect(range.end.getTime()).toBeGreaterThan(range.start.getTime());
	});
});
