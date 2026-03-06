-- AlterTable
ALTER TABLE "Group" ADD COLUMN     "liveMode" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "writeFirst" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "writeFirstInterval" INTEGER NOT NULL DEFAULT 60;

-- CreateTable
CREATE TABLE "ContactContext" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "telegramContactId" BIGINT NOT NULL,
    "displayName" TEXT NOT NULL DEFAULT '',
    "info" TEXT NOT NULL DEFAULT '',
    "memory" TEXT NOT NULL DEFAULT '',
    "messages" JSONB NOT NULL DEFAULT '[]',
    "historyLoaded" BOOLEAN NOT NULL DEFAULT false,
    "lastWriteFirst" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactContext_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContactContext_userId_telegramContactId_key" ON "ContactContext"("userId", "telegramContactId");

-- AddForeignKey
ALTER TABLE "ContactContext" ADD CONSTRAINT "ContactContext_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
