import { env } from "cloudflare:workers";

type RuntimeEnv = {
  TOKEN_ENCRYPTION_KEY?: string;
  DB?: D1Database;
  BUCKET?: R2Bucket;
};

export const META_VERSION = "v26.0";

export function runtimeEnv(): RuntimeEnv {
  return env as unknown as RuntimeEnv;
}

export function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

export async function signState(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return base64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value))));
}

function encryptionKey(): Promise<CryptoKey> {
  const secret = runtimeEnv().TOKEN_ENCRYPTION_KEY;
  if (!secret || !/^[a-f0-9]{64}$/i.test(secret)) throw new Error("TOKEN_ENCRYPTION_KEY is not configured.");
  const raw = Uint8Array.from(secret.match(/.{2}/g) ?? [], (hex) => Number.parseInt(hex, 16));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptToken(value: string): Promise<{ ciphertext: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await encryptionKey();
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(value));
  return { ciphertext: base64Url(new Uint8Array(encrypted)), iv: base64Url(iv) };
}

export async function decryptToken(ciphertext: string, iv: string): Promise<string> {
  const key = await encryptionKey();
  const clear = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64Url(iv) }, key, fromBase64Url(ciphertext));
  return new TextDecoder().decode(clear);
}

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin; }
  catch { return false; }
}

export function callbackUrl(request: Request): string {
  return new URL("/api/meta/callback", request.url).toString();
}

