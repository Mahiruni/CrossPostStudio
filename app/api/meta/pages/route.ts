import { getChatGPTUser } from "@/app/chatgpt-auth";
import { facebookPageChoices } from "@/db/schema";
import { getDb } from "@/db";
import { json } from "@/lib/meta";
import { and, eq, gt } from "drizzle-orm";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return json({ error: "Sign in required." }, 401);
  const rows = await getDb().select({
    id: facebookPageChoices.pageId,
    name: facebookPageChoices.pageName,
  }).from(facebookPageChoices).where(and(
    eq(facebookPageChoices.userId, user.userId),
    gt(facebookPageChoices.expiresAt, new Date().toISOString()),
  ));
  return json({ pages: rows });
}

