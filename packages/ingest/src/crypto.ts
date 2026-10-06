import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const IV = 12;
const TAG = 16;

function keyBytes(keyB64: string): Buffer {
  const k = Buffer.from(keyB64, "base64");
  if (k.length !== 32) throw new Error("ENCRYPTION_KEY must be 32 bytes (base64)");
  return k;
}

/** AES-256-GCM. Output layout: iv(12) | authTag(16) | ciphertext. */
export function encrypt(plain: string, keyB64: string): Buffer {
  const iv = randomBytes(IV);
  const c = createCipheriv("aes-256-gcm", keyBytes(keyB64), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]);
}

export function decrypt(data: Buffer, keyB64: string): string {
  const d = createDecipheriv("aes-256-gcm", keyBytes(keyB64), data.subarray(0, IV));
  d.setAuthTag(data.subarray(IV, IV + TAG));
  return Buffer.concat([d.update(data.subarray(IV + TAG)), d.final()]).toString("utf8");
}
