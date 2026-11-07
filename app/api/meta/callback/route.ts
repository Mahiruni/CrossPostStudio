import { getChatGPTUser, chatGPTSignInPath } from "@/app/chatgpt-auth";
import { facebookPageChoices, metaAppConfigs } from "@/db/schema";
import { getDb } from "@/db";
import { decryptToken, encryptToken, fromBase64Url } from "@/lib/meta";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

type TokenResponse = { access_token?: string; error?: { message?: string } };
type PagesResponse = { data?: Array<{ id: string; name: string; access_token: string; tasks?: string[] }> };

function hasPublishTask(tasks: string[] | undefined) {
  return !tasks?.length || tasks.includes("CREATE_CONTENT");
}

export async function GET(request: NextRequest) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.redirect(new URL(chatGPTSignInPath("/"), request.url));

  const redirectHome = (reason: string) => NextResponse.redirect(new URL("/?meta=" + encodeURIComponent(reason), request.url));
  const [config] = await getDb().select().from(metaAppConfigs).where(eq(metaAppConfigs.userId, user.userId)).limit(1);
  if (!config) return redirectHome("setup");
  let appSecret: string;
  try { appSecret = await decryptToken(config.appSecretCiphertext, config.appSecretIv); }
  catch { return redirectHome("setup"); }
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const savedState = request.cookies.get("meta_oauth_state")?.value;

  if (!code || !state || !savedState || state !== savedState) return redirectHome("oauth_error");

  const [payload, signature] = state.split(".");
  if (!payload || !signature) return redirectHome("oauth_error");

  try {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(appSecret), {name:"HMAC",hash:"SHA-256"}, false, ["verify"]);
    const valid = await crypto.subtle.verify("HMAC", key, fromBase64Url(signature), new TextEncoder().encode(payload));
    const parsed = JSON.parse(new TextDecoder().decode(fromBase64Url(payload))) as { userId: string; expiresAt: number };
    if (!valid || parsed.userId !== user.userId || parsed.expiresAt < Date.now()) return redirectHome("oauth_error");

    const tokenUrl = new URL("https://graph.facebook.com/v26.0/oauth/access_token");
    tokenUrl.searchParams.set("client_id", config.appId);
    tokenUrl.searchParams.set("client_secret", appSecret);
    tokenUrl.searchParams.set("redirect_uri", new URL("/api/meta/callback", request.url).toString());
    tokenUrl.searchParams.set("code", code);
    const shortToken = await fetch(tokenUrl).then((response) => response.json() as Promise<TokenResponse>);
    if (!shortToken.access_token) return redirectHome("oauth_error");

    const longUrl = new URL("https://graph.facebook.com/v26.0/oauth/access_token");
    longUrl.searchParams.set("grant_type", "fb_exchange_token");
    longUrl.searchParams.set("client_id", config.appId);
    longUrl.searchParams.set("client_secret", appSecret);
    longUrl.searchParams.set("fb_exchange_token", shortToken.access_token);
    const longToken = await fetch(longUrl).then((response) => response.json() as Promise<TokenResponse>);
    const userToken = longToken.access_token ?? shortToken.access_token;

    const pagesUrl = new URL("https://graph.facebook.com/v26.0/me/accounts");
    pagesUrl.searchParams.set("fields", "id,name,access_token,tasks");
    pagesUrl.searchParams.set("limit", "100");
    pagesUrl.searchParams.set("access_token", userToken);
    const pages = await fetch(pagesUrl).then((response) => response.json() as Promise<PagesResponse>);
    const choices = (pages.data ?? []).filter((page) => page.id && page.name && page.access_token && hasPublishTask(page.tasks));
    if (!choices.length) return redirectHome("no_pages");

    const db = getDb();
    await db.delete(facebookPageChoices).where(eq(facebookPageChoices.userId, user.userId));
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    for (const page of choices) {
      const encrypted = await encryptToken(page.access_token);
      await db.insert(facebookPageChoices).values({
        userId: user.userId, pageId: page.id, pageName: page.name,
        tokenCiphertext: encrypted.ciphertext, tokenIv: encrypted.iv, expiresAt,
      });
    }

    const response = NextResponse.redirect(new URL("/?meta=select", request.url));
    response.cookies.delete("meta_oauth_state");
    return response;
  } catch {
    return redirectHome("oauth_error");
  }
}

