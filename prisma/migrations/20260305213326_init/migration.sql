-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "telegramId" BIGINT NOT NULL,
    "username" TEXT,
    "firstName" TEXT,
    "sessionString" TEXT,
    "token" TEXT,
    "openrouterApiKey" TEXT,
    "openrouterModel" TEXT NOT NULL DEFAULT 'openai/gpt-5.2',
    "defaultSystemPrompt" TEXT NOT NULL DEFAULT 'Ты — я. Отвечай кратко и по-человечески.',
    "responseMode" TEXT NOT NULL DEFAULT 'all',
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "newcomersEnabled" BOOLEAN NOT NULL DEFAULT false,
    "defaultGroupId" INTEGER,
    "newcomersGroupId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Group" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "systemPrompt" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactGroup" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "telegramContactId" BIGINT NOT NULL,
    "groupId" INTEGER NOT NULL,

    CONSTRAINT "ContactGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlacklistEntry" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "telegramContactId" BIGINT NOT NULL,

    CONSTRAINT "BlacklistEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnownUser" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "telegramContactId" BIGINT NOT NULL,

    CONSTRAINT "KnownUser_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_telegramId_key" ON "User"("telegramId");

-- CreateIndex
CREATE UNIQUE INDEX "User_token_key" ON "User"("token");

-- CreateIndex
CREATE UNIQUE INDEX "Group_userId_name_key" ON "Group"("userId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ContactGroup_userId_telegramContactId_key" ON "ContactGroup"("userId", "telegramContactId");

-- CreateIndex
CREATE UNIQUE INDEX "BlacklistEntry_userId_telegramContactId_key" ON "BlacklistEntry"("userId", "telegramContactId");

-- CreateIndex
CREATE UNIQUE INDEX "KnownUser_userId_telegramContactId_key" ON "KnownUser"("userId", "telegramContactId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_defaultGroupId_fkey" FOREIGN KEY ("defaultGroupId") REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_newcomersGroupId_fkey" FOREIGN KEY ("newcomersGroupId") REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Group" ADD CONSTRAINT "Group_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactGroup" ADD CONSTRAINT "ContactGroup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactGroup" ADD CONSTRAINT "ContactGroup_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlacklistEntry" ADD CONSTRAINT "BlacklistEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnownUser" ADD CONSTRAINT "KnownUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
