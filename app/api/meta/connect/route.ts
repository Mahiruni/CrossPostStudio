import { getChatGPTUser, chatGPTSignInPath } from "@/app/chatgpt-auth";
import { metaAppConfigs } from "@/db/schema";
import { getDb } from "@/db";
import { base64Url, callbackUrl, decryptToken, signState } from "@/lib/meta";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.redirect(new URL(chatGPTSignInPath("/"), request.url));

  const [config] = await getDb().select().from(metaAppConfigs).where(eq(metaAppConfigs.userId, user.userId)).limit(1);
  if (!config) {
    return NextResponse.redirect(new URL("/?meta=setup", request.url));
  }
  let appSecret: string;
  try { appSecret = await decryptToken(config.appSecretCiphertext, config.appSecretIv); }
  catch { return NextResponse.redirect(new URL("/?meta=setup", request.url)); }

  const payload = base64Url(new TextEncoder().encode(JSON.stringify({
    userId: user.userId,
    nonce: crypto.randomUUID(),
    expiresAt: Date.now() + 10 * 60 * 1000,
  })));
  const state = payload + "." + await signState(payload, appSecret);
  const authorize = new URL("https://www.facebook.com/" + "v26.0/dialog/oauth");
  authorize.searchParams.set("client_id", config.appId);
  authorize.searchParams.set("redirect_uri", callbackUrl(request));
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("scope", "pages_show_list,pages_read_engagement,pages_manage_posts");

  const response = NextResponse.redirect(authorize);
  response.cookies.set("meta_oauth_state", state, {
    httpOnly: true, secure: true, sameSite: "lax", path: "/api/meta/callback", maxAge: 600,
  });
  return response;
}

