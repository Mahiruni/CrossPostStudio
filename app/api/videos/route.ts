import { getChatGPTUser } from "@/app/chatgpt-auth";
import { videos as videoTable } from "@/db/schema";
import { getDb } from "@/db";
import { json, runtimeEnv, sameOrigin } from "@/lib/meta";
import { and, desc, eq } from "drizzle-orm";
import { publicDraft } from "@/lib/publishing";

const MAX_VIDEO_BYTES = 25 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const allowedVideoTypes = new Set(["video/mp4", "video/quicktime", "video/webm"]);
const allowedImageTypes = new Set(["image/jpeg", "image/png"]);

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return json({ error: "Sign in required." }, 401);
  const rows = await getDb().select().from(videoTable).where(eq(videoTable.userId, user.userId)).orderBy(desc(videoTable.createdAt));
  return json({ videos: rows.map(publicDraft) });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "Request origin could not be verified." }, 403);
  const user = await getChatGPTUser();
  if (!user) return json({ error: "Sign in required." }, 401);
  if (Number(request.headers.get("Content-Length")) > 26 * 1024 * 1024) return json({error:"This upload is too large."},413);
  const form = await request.formData();
  const postTypeValue = String(form.get("postType") ?? "video");
  if (!["video","image","text"].includes(postTypeValue)) return json({error:"Choose video, image or text."},400);
  const postType = postTypeValue === "image" || postTypeValue === "text" ? postTypeValue : "video";
  const mediaValue = form.get("media") ?? form.get("video");
  const file = mediaValue instanceof File ? mediaValue : null;
  const caption = String(form.get("caption") ?? "").trim();
  const sourceUrl = String(form.get("sourceUrl") ?? "").trim();
  const plannedAt = String(form.get("plannedAt") ?? "").trim();
  const rightsConfirmed = form.get("rightsConfirmed") === "true";

  if (postType === "text" && file) return json({error:"Choose an image or video post to attach media."},400);
  if (postType !== "text" && !file) return json({ error: `Choose a ${postType} file.` }, 400);
  if (postType === "text" && !caption) return json({ error: "Write the text for your Facebook post first." }, 400);
  if (postType === "video" && file && !allowedVideoTypes.has(file.type)) return json({ error: "Use MP4, MOV or WebM video." }, 415);
  if (postType === "image" && file && !allowedImageTypes.has(file.type)) return json({ error: "Use a JPG or PNG image." }, 415);
  if (postType === "video" && file && (file.size < 1 || file.size > MAX_VIDEO_BYTES)) return json({ error: "The video must be 25 MB or smaller." }, 413);
  if (postType === "image" && file && (file.size < 1 || file.size > MAX_IMAGE_BYTES)) return json({ error: "The image must be 10 MB or smaller." }, 413);
  if (!rightsConfirmed) return json({ error: "Confirm that you have permission to publish this post and its media." }, 400);
  if (caption.length > 2200) return json({ error: "Caption is too long." }, 400);
  if (postType === "video" && sourceUrl && !/^https:\/\/(www\.)?(tiktok\.com|vm\.tiktok\.com)\//i.test(sourceUrl)) return json({ error: "Use a valid TikTok link or leave the reference blank." }, 400);
  if (plannedAt && Number.isNaN(Date.parse(plannedAt))) return json({ error: "Choose a valid preferred time." }, 400);

  const bucket = runtimeEnv().BUCKET;
  if (file && !bucket) return json({ error: `Private ${postType} storage is not configured yet.` }, 503);

  const id = crypto.randomUUID();
  const key = file ? `${postType}s/${crypto.randomUUID()}` : null;
  const createdAt = new Date().toISOString();
  if (file && key && bucket) await bucket.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
  const mimeType = postType === "text" ? "text/plain" : file?.type ?? "application/octet-stream";
  const fileName = postType === "text" ? "Text post" : (file?.name ?? "Post").slice(0, 180);
  const fileSize = file?.size ?? 0;

  try {
    await getDb().insert(videoTable).values({
      id, userId: user.userId, r2Key: key, fileName,
      mimeType, size: fileSize, caption, sourceUrl: postType === "video" ? sourceUrl : "",
      plannedAt: plannedAt || null, status: "draft", createdAt,
    });
  } catch {
    if (key && bucket) await bucket.delete(key);
    return json({ error: "The draft could not be saved. Please try again." }, 500);
  }

  return json({ video: { id, fileName, fileSize, caption, sourceUrl: postType === "video" ? sourceUrl : "", plannedAt, createdAt, status: "draft", postType } }, 201);
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return json({ error: "Request origin could not be verified." }, 403);
  const user = await getChatGPTUser();
  if (!user) return json({ error: "Sign in required." }, 401);
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return json({ error: "Draft ID is required." }, 400);

  const [row] = await getDb().select().from(videoTable).where(and(eq(videoTable.id, id), eq(videoTable.userId, user.userId))).limit(1);
  if (!row) return json({ error: "Draft not found." }, 404);
  if (["publishing", "processing", "review"].includes(row.status)) return json({ error: "This post is being published. Try again after it finishes." }, 409);

  if (row.r2Key && runtimeEnv().BUCKET) await runtimeEnv().BUCKET!.delete(row.r2Key);
  await getDb().delete(videoTable).where(and(eq(videoTable.id, id), eq(videoTable.userId, user.userId)));
  return json({ deleted: true });
}

