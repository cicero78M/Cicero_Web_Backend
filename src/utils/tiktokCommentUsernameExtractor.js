// src/utils/tiktokCommentUsernameExtractor.js

const DEFAULT_USERNAME_PATHS = [
  "user.unique_id",
  "user.username",
  "user.nickname",
  "author.unique_id",
  "author.username",
  "author.user_name",
  "owner.unique_id",
  "owner.username",
  "comment_user.unique_id",
  "comment_user.username",
  "unique_id",
  "username",
  "user_name",
  "nickname",
  "screen_name",
];

const DEFAULT_REPLY_PATHS = [
  "replies",
  "reply",
  "reply_comment",
  "reply_comments",
  "sub_comments",
  "subComments",
  "children",
  "items",
  "comments",
  "comment_list",
  "commentList",
];

function readPathValue(source, path) {
  if (!source || typeof source !== "object") return null;
  return path.split(".").reduce((acc, key) => {
    if (!acc || typeof acc !== "object") return null;
    return acc[key] ?? null;
  }, source);
}

export function normalizeTiktokCommentUsername(username) {
  if (typeof username !== "string") return null;
  const normalized = username.trim().toLowerCase();
  if (!normalized) return null;
  return normalized.startsWith("@") ? normalized : `@${normalized}`;
}

function extractUsernameFromComment(comment, usernamePaths) {
  for (const path of usernamePaths) {
    const candidate = readPathValue(comment, path);
    const normalized = normalizeTiktokCommentUsername(candidate);
    if (normalized) return normalized;
  }
  return null;
}

function resolveReplies(comment, replyPaths) {
  const nested = [];
  for (const path of replyPaths) {
    const val = readPathValue(comment, path);
    if (Array.isArray(val)) {
      nested.push(...val);
      continue;
    }
    if (val && typeof val === "object") {
      if (Array.isArray(val.items)) {
        nested.push(...val.items);
      } else {
        nested.push(val);
      }
    }
  }
  return nested;
}

export function extractUsernamesFromCommentTree(comments = [], options = {}) {
  const usernamePaths = options.usernamePaths || DEFAULT_USERNAME_PATHS;
  const replyPaths = options.replyPaths || DEFAULT_REPLY_PATHS;

  if (!Array.isArray(comments) || comments.length === 0) {
    return [];
  }

  const queue = [...comments];
  const usernames = new Set();
  const visited = new WeakSet();

  while (queue.length) {
    const comment = queue.shift();
    if (!comment || typeof comment !== "object") continue;
    if (visited.has(comment)) continue;
    visited.add(comment);

    const username = extractUsernameFromComment(comment, usernamePaths);
    if (username) {
      usernames.add(username);
    }

    const nestedReplies = resolveReplies(comment, replyPaths);
    for (const reply of nestedReplies) {
      if (reply && typeof reply === "object") {
        queue.push(reply);
      }
    }
  }

  return [...usernames];
}
