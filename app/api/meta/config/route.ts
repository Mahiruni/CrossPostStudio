import { getChatGPTUser } from "@/app/chatgpt-auth";
import { metaAppConfigs } from "@/db/schema";
import { getDb } from "@/db";
import { encryptToken, json, sameOrigin } from "@/lib/meta";
import { eq } from "drizzle-orm";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return json({ error: "Sign in required." }, 401);
  const [config] = await getDb().select({ appId: metaAppConfigs.appId }).from(metaAppConfigs)
    .where(eq(metaAppConfigs.userId, user.userId)).limit(1);
  return json({ configured: Boolean(config), appId: config?.appId ?? null });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "Request origin could not be verified." }, 403);
  const user = await getChatGPTUser();
  if (!user) return json({ error: "Sign in required." }, 401);
  const body = await request.json().catch(() => ({})) as { appId?: unknown; appSecret?: unknown };
  const appId = typeof body.appId === "string" ? body.appId.trim() : "";
  const appSecret = typeof body.appSecret === "string" ? body.appSecret.trim() : "";
  if (!/^\d{5,30}$/.test(appId)) return json({ error: "Enter the numeric Meta App ID." }, 400);
  if (appSecret.length < 16 || appSecret.length > 256) return json({ error: "Enter a valid Meta App Secret (16–256 characters)." }, 400);

  try {
    const encrypted = await encryptToken(appSecret);
    const now = new Date().toISOString();
    await getDb().insert(metaAppConfigs).values({
      userId: user.userId,
      appId,
      appSecretCiphertext: encrypted.ciphertext,
      appSecretIv: encrypted.iv,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: metaAppConfigs.userId,
      set: { appId, appSecretCiphertext: encrypted.ciphertext, appSecretIv: encrypted.iv, updatedAt: now },
    });
    return json({ configured: true, appId });
  } catch {
    return json({ error: "Meta credentials could not be saved securely. Check the private encryption setting and try again." }, 503);
  }
}
