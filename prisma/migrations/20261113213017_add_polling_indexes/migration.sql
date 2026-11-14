-- CreateIndex
CREATE INDEX "jobs_state_next_attempt_at_id_idx" ON "jobs"("state", "next_attempt_at", "id");

-- CreateIndex
CREATE INDEX "jobs_state_lease_expires_at_id_idx" ON "jobs"("state", "lease_expires_at", "id");
