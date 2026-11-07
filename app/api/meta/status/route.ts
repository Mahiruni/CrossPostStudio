import { getChatGPTUser } from "@/app/chatgpt-auth";
import { facebookConnections } from "@/db/schema";
import { getDb } from "@/db";
import { json, sameOrigin } from "@/lib/meta";
import { eq } from "drizzle-orm";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return json({ error: "Sign in required." }, 401);
  const [connection] = await getDb().select({
    pageName: facebookConnections.pageName,
    pageId: facebookConnections.pageId,
  }).from(facebookConnections).where(eq(facebookConnections.userId, user.userId)).limit(1);
  return json({ connected: Boolean(connection), pageName: connection?.pageName ?? null, pageId: connection?.pageId ?? null });
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return json({ error: "Request origin could not be verified." }, 403);
  const user = await getChatGPTUser();
  if (!user) return json({ error: "Sign in required." }, 401);
  await getDb().delete(facebookConnections).where(eq(facebookConnections.userId, user.userId));
  return json({ disconnected: true });
}

