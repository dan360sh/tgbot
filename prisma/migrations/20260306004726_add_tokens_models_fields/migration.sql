-- AlterTable
ALTER TABLE "ContactGroup" ADD COLUMN     "displayName" TEXT;

-- AlterTable
ALTER TABLE "Group" ADD COLUMN     "aiModel" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "isDefault" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "tokens" INTEGER NOT NULL DEFAULT 3000,
ALTER COLUMN "openrouterModel" SET DEFAULT 'openai/gpt-4o-mini';
