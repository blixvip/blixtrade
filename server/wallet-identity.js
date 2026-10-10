import crypto from "node:crypto";

// Separate proof of the Google subject, issued only after the OAuth callback. Site roles alone never identify a wallet.
export function verifyWalletIdentity(raw, memberEmail, secret, now = Date.now()) {
  if (typeof raw !== "string" || raw.length > 3000 || typeof secret !== "string" || secret.length < 32 || !memberEmail) return null;
  const parts = raw.split(".");
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[a-f0-9]{64}$/.test(parts[1])) return null;
  const want = crypto.createHmac("sha256", secret).update(`wallet-auth.${parts[0]}`).digest();
  if (!crypto.timingSafeEqual(want, Buffer.from(parts[1], "hex"))) return null;
  let p;
  try { p = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")); } catch { return null; }
  if (!p || typeof p.sub !== "string" || !/^[!-~]{1,200}$/.test(p.sub) || typeof p.email !== "string" || p.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) return null;
  if (p.email.toLowerCase() !== String(memberEmail).toLowerCase()) return null;
  if (!Number.isSafeInteger(p.iat) || !Number.isSafeInteger(p.exp) || p.iat < 0 || p.iat > now + 30_000 || p.exp <= now || p.exp <= p.iat || p.exp - p.iat > 30 * 86400_000) return null;
  return { sub: p.sub, email: p.email.toLowerCase(), authed: p.iat };
}
