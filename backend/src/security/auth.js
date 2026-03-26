import crypto from "node:crypto";

const SESSION_TTL_HOURS = 12;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const digest = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${digest}`;
}

export function isPasswordHashed(password) {
  return String(password || "").startsWith("scrypt:");
}

export function verifyPassword(password, storedPassword) {
  if (!storedPassword) {
    return false;
  }

  if (!isPasswordHashed(storedPassword)) {
    return password === storedPassword;
  }

  const [, salt, digest] = String(storedPassword).split(":");
  const candidate = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(digest, "hex"));
}

export function createSessionToken() {
  return crypto.randomBytes(32).toString("hex");
}

export function hashSessionToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

export function buildSessionExpiry(now = new Date()) {
  const expiresAt = new Date(now);
  expiresAt.setHours(expiresAt.getHours() + SESSION_TTL_HOURS);
  return expiresAt.toISOString();
}
