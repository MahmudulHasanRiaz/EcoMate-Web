-- Idempotent seed of default leave types (configurable; admin may add/edit/disable).
-- ON CONFLICT (code) DO NOTHING keeps this safe to re-run.
INSERT INTO "LeaveType" ("id", "name", "code", "daysPerYear", "isPaid", "isActive", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid(), 'Casual Leave', 'casual', 10, true, true, now(), now()),
  (gen_random_uuid(), 'Sick Leave', 'sick', 14, true, true, now(), now()),
  (gen_random_uuid(), 'Annual Leave', 'annual', 20, true, true, now(), now())
ON CONFLICT ("code") DO NOTHING;
