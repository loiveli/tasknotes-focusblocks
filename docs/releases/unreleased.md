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

## Fixed

- (#1767) Fixed the Timeblock creation UI so the start and end time controls are aligned and easier to use.
  - Replaces the uneven layout with a cleaner segmented hour/minute picker that supports minute-level scheduling more clearly.
  - Improves spacing and small-screen behavior in the modal without changing the underlying timeblock workflow.
  - Thanks to @loiveli for reporting and contributing the fix.
