-- CreateEnum
CREATE TYPE "UserAvatarStatus" AS ENUM ('UPLOADING', 'READY');

-- CreateTable
CREATE TABLE "UserAvatar" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "status" "UserAvatarStatus" NOT NULL DEFAULT 'UPLOADING',
    "lastChunkAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserAvatar_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserAvatar_userId_idx" ON "UserAvatar"("userId");

-- CreateIndex
CREATE INDEX "UserAvatar_status_lastChunkAt_idx" ON "UserAvatar"("status", "lastChunkAt");

-- AddForeignKey
ALTER TABLE "UserAvatar" ADD CONSTRAINT "UserAvatar_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
