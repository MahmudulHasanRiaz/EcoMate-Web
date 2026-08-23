-- HR Phase 0 groundwork: add EMPLOYEE to UserRole enum.
-- Pure-staff login role; UserProfile.role sync rules in employees service
-- never downgrade manager/cashier/admin (HR architecture decision #4).
ALTER TYPE "UserRole" ADD VALUE 'employee';