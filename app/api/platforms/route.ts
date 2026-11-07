import { getChatGPTUser } from "@/app/chatgpt-auth";
import { facebookConnections, metaAppConfigs } from "@/db/schema";
import { getDb } from "@/db";
import { json, runtimeEnv } from "@/lib/meta";
import { socialPlatforms } from "@/lib/platforms";
import { eq } from "drizzle-orm";

type ProviderEnv = Cloudflare.Env & {
  LINKEDIN_CLIENT_ID?: string;
  TIKTOK_CLIENT_KEY?: string;
  GOOGLE_CLIENT_ID?: string;
};

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return json({ error: "Sign in required." }, 401);

  const db = getDb();
  const [[facebook], [meta]] = await Promise.all([
    db.select({ accountName: facebookConnections.pageName }).from(facebookConnections)
      .where(eq(facebookConnections.userId, user.userId)).limit(1),
    db.select({ appId: metaAppConfigs.appId }).from(metaAppConfigs)
      .where(eq(metaAppConfigs.userId, user.userId)).limit(1),
  ]);
  const env = runtimeEnv() as ProviderEnv;

  return json({
    platforms: socialPlatforms.map((platform) => {
      const configured = platform.connection === "meta"
        ? Boolean(meta)
        : platform.id === "linkedin"
          ? Boolean(env.LINKEDIN_CLIENT_ID)
          : platform.id === "tiktok"
            ? Boolean(env.TIKTOK_CLIENT_KEY)
            : Boolean(env.GOOGLE_CLIENT_ID);
      return {
        ...platform,
        configured,
        connected: platform.id === "facebook" ? Boolean(facebook) : false,
        accountName: platform.id === "facebook" ? facebook?.accountName ?? null : null,
        status: platform.id === "facebook" && facebook ? "connected" : configured ? "ready_to_connect" : "setup_required",
      };
    }),
  });
}
