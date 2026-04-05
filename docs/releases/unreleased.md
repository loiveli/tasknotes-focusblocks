# TaskNotes - Unreleased

<!--

**Added** for new features.
**Changed** for changes in existing functionality.
**Deprecated** for soon-to-be removed features.
**Removed** for now removed features.
**Fixed** for any bug fixes.
**Security** in case of vulnerabilities.

Always acknowledge contributors and those who report issues.

Example:

```
## Fixed

- (#768) Fixed calendar view appearing empty in week and day views due to invalid time configuration values
  - Added time validation in settings UI with proper error messages and debouncing
  - Prevents "Cannot read properties of null (reading 'years')" error from FullCalendar
  - Thanks to @userhandle for reporting and help debugging
```

-->

## Added

- (#1768) Added **Focus Blocks** to calendar views so you can reserve one-off or recurring time for a tagged set of tasks.
  - Focus Blocks include dedicated create/edit modals, calendar cards, recurrence support, and drag/resize behavior in the calendar.
  - Each block can filter tasks by tag and surface the top **N** active tasks for that session, while still showing overdue work.
  - Primary task previews prioritize higher-priority tasks, respect Manual Order (`tasknotes_manual_order`) within the same priority group, and keep blocked tasks out of the main ranked list while still surfacing overdue blocked tasks in the overdue section.
  - Creating a task from a Focus Block prefills the matching tag and refreshes the block preview after the task is saved.
  - Thanks to @loiveli for the feature request and contribution.

## Fixed

- (#1767) Fixed the Timeblock creation UI so the start and end time controls are aligned and easier to use.
  - Replaces the uneven layout with a cleaner segmented hour/minute picker that supports minute-level scheduling more clearly.
  - Improves spacing and small-screen behavior in the modal without changing the underlying timeblock workflow.
  - Thanks to @loiveli for reporting and contributing the fix.
