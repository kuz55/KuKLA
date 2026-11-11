// Only legacy event types are exposed by the legacy member-readable endpoints.
// New workflow audit events may contain sensitive reasons or identifiers and
// require an independently authorized audit API before they can be returned.
// This is not a complete privacy policy for the legacy events themselves.
export const legacyVisibleEventTypes = [
  'SEARCH_CREATED', 'SEARCH_UPDATED', 'MEMBER_ADDED', 'MEMBER_REMOVED',
  'TASK_CREATED', 'TASK_UPDATED', 'COORDINATOR_NOTE',
];
