import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { dataRoot } from "./db";

function decodeConfiguredKey(value: string): Buffer {
  const trimmed = value.trim();
  const key = /^[a-f\d]{64}$/i.test(trimmed) ? Buffer.from(trimmed, "hex") : Buffer.from(trimmed, "base64");
  if (key.length !== 32) {
    throw new Error("CAPABILITY_MASTER_KEY must decode to exactly 32 bytes.");
  }
  return key;
}

function loadMasterKey(): Buffer {
  if (process.env.CAPABILITY_MASTER_KEY) {
    return decodeConfiguredKey(process.env.CAPABILITY_MASTER_KEY);
  }

  const keyPath = path.join(dataRoot, "master.key");
  if (existsSync(keyPath)) {
    return decodeConfiguredKey(readFileSync(keyPath, "utf8"));
  }

  const key = randomBytes(32);
  writeFileSync(keyPath, key.toString("base64"), { encoding: "utf8", mode: 0o600, flag: "wx" });
  return key;
}

let cachedKey: Buffer | null = null;

function masterKey(): Buffer {
  cachedKey ??= loadMasterKey();
  return cachedKey;
}

export function encryptCredentials(credentials: Record<string, unknown>): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(credentials), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptCredentials(payload: string | null): Record<string, unknown> {
  if (!payload) return {};
  const [version, ivValue, tagValue, ciphertextValue] = payload.split(".");
  if (version !== "v1" || !ivValue || !tagValue || !ciphertextValue) {
    throw new Error("Stored credentials use an unsupported format.");
  }
  const decipher = createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8")) as Record<string, unknown>;
}

export function credentialHint(credentials: Record<string, unknown>): string | null {
  const candidate = [credentials.apiKey, credentials.token, credentials.password]
    .find((value) => typeof value === "string" && value.length > 0);
  if (typeof candidate !== "string") return null;
  return `••••${candidate.slice(-4)}`;
}
