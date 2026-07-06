-- AlterTable: make Address.userId optional
ALTER TABLE "Address" ALTER COLUMN "userId" DROP NOT NULL;
