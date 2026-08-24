-- CreateIndex: performance index for RawAttendanceEvent status filter
CREATE INDEX "RawAttendanceEvent_status_idx" ON "RawAttendanceEvent"("status");
