-- Add packing_assistant role to UserRole enum
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'packing_assistant';
