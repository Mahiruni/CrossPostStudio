import { getChatGPTUser } from "@/app/chatgpt-auth";
import { facebookConnections, facebookPageChoices } from "@/db/schema";
import { getDb } from "@/db";
import { json, sameOrigin } from "@/lib/meta";
import { and, eq, gt } from "drizzle-orm";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "Request origin could not be verified." }, 403);
  const user = await getChatGPTUser();
  if (!user) return json({ error: "Sign in required." }, 401);
  const payload = await request.json().catch(() => ({})) as { pageId?: string };
  if (!payload.pageId || payload.pageId.length > 64) return json({ error: "Choose a valid Page." }, 400);

  const db = getDb();
  const [choice] = await db.select().from(facebookPageChoices).where(and(
    eq(facebookPageChoices.userId, user.userId),
    eq(facebookPageChoices.pageId, payload.pageId),
    gt(facebookPageChoices.expiresAt, new Date().toISOString()),
  )).limit(1);
  if (!choice) return json({ error: "This Page selection expired. Connect again." }, 409);

  await db.insert(facebookConnections).values({
    userId: user.userId,
    pageId: choice.pageId,
    pageName: choice.pageName,
    tokenCiphertext: choice.tokenCiphertext,
    tokenIv: choice.tokenIv,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }).onConflictDoUpdate({
    target: facebookConnections.userId,
    set: {
      pageId: choice.pageId,
      pageName: choice.pageName,
      tokenCiphertext: choice.tokenCiphertext,
      tokenIv: choice.tokenIv,
      updatedAt: new Date().toISOString(),
    },
  });
  await db.delete(facebookPageChoices).where(eq(facebookPageChoices.userId, user.userId));
  return json({ connected: true, pageName: choice.pageName });
}

