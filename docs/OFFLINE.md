# Offline-first mobile

The mobile app caches search lists and tasks in SQLite. GPS and task-status commands are written to a local queue when network requests fail. A background timer attempts to flush the queue every 20 seconds while the app is running.

For production, add platform background execution, conflict resolution, durable sync cursors and explicit server acknowledgements before relying on unattended background tracking.
