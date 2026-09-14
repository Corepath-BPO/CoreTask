-- A thumbs-up on a comment. One per person per comment; the pair is the key.

CREATE TABLE "comment_likes" (
    "commentId" UUID NOT NULL,
    "userId"    UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comment_likes_pkey" PRIMARY KEY ("commentId", "userId")
);

CREATE INDEX "comment_likes_userId_idx" ON "comment_likes"("userId");

ALTER TABLE "comment_likes" ADD CONSTRAINT "comment_likes_commentId_fkey"
    FOREIGN KEY ("commentId") REFERENCES "comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "comment_likes" ADD CONSTRAINT "comment_likes_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
