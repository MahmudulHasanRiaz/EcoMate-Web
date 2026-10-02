-- A task may have at most ONE running timer per employee.
--
-- startTimer/resumeTimer previously guarded this with a findFirst-then-create,
-- which is a check-then-act race: two simultaneous requests (double-click,
-- retry, two tabs) both read "no active entry" and both insert, so the same
-- task accumulated two ACTIVE sessions and double-counted the time.
-- resumeTimer had no guard at all, so a double resume deterministically
-- created two ACTIVE entries.
--
-- A partial unique index makes the invariant a database guarantee rather than
-- application convention, and it only applies to 'active' rows, so finished
-- and paused history are unaffected.
CREATE UNIQUE INDEX "TaskTimeEntry_one_active_per_task_employee_idx"
  ON "TaskTimeEntry" ("taskId", "employeeId")
  WHERE "status" = 'active';

-- getProductivityReport groups by employeeId filtered on startedAt within a
-- range. Only the single-column indexes existed, so Postgres had to scan
-- every entry for an employee and filter. This composite serves both halves
-- of the predicate.
CREATE INDEX "TaskTimeEntry_employeeId_startedAt_status_idx"
  ON "TaskTimeEntry" ("employeeId", "startedAt", "status");

-- OrderStaffEvent has no standalone createdAt index. The staff-performance
-- queries filter on createdAt ranges (and an OR across employeeId/userId), so
-- without this the planner has no index it can use for the range half.
CREATE INDEX "OrderStaffEvent_createdAt_idx"
  ON "OrderStaffEvent" ("createdAt");
