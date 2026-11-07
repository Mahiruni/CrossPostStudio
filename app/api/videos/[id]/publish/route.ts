import { waitUntil } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { json, sameOrigin } from "@/lib/meta";
import { isActivePublish, parsePublishState } from "@/lib/publish-state";
import { claimDraft, ownedDraft, pageConnection, publicDraft, publishClaimed, reconcileDraft } from "@/lib/publishing";

export async function GET(_request:Request,context:{params:Promise<{id:string}>}) {
  const user=await getChatGPTUser();
  if(!user) return json({error:"Sign in required."},401);
  const {id}=await context.params;
  let row=await ownedDraft(id,user.userId);
  if(!row) return json({error:"Post not found."},404);
  const connection=await pageConnection(user.userId);
  let checkError:string|undefined;
  if(connection) {
    try {row=await reconcileDraft(row,connection);}
    catch(error){checkError=error instanceof Error?error.message:"Facebook status could not be checked.";}
  }
  return json({video:publicDraft(row),pageName:connection?.pageName,checkError});
}

export async function POST(request:Request,context:{params:Promise<{id:string}>}) {
  if(!sameOrigin(request)) return json({error:"Request origin could not be verified."},403);
  const user=await getChatGPTUser();
  if(!user) return json({error:"Sign in required."},401);
  const {id}=await context.params;
  let row=await ownedDraft(id,user.userId);
  if(!row) return json({error:"Post not found."},404);
  const connection=await pageConnection(user.userId);
  if(!connection) return json({error:"Connect your Facebook Page before publishing."},409);
  if(row.status==="published") return json({video:publicDraft(row),pageName:connection.pageName});
  if(isActivePublish(parsePublishState(row.publishState))) return json({video:publicDraft(row),pageName:connection.pageName},202);
  if(row.plannedAt&&Date.parse(row.plannedAt)>Date.now()) return json({error:"This post has a future timing preference. Publish when you’re ready."},409);
  try {
    row=await reconcileDraft(row,connection);
    if(["published","processing"].includes(row.status)) return json({video:publicDraft(row),pageName:connection.pageName});
    if(row.status==="review") return json({error:"Check your Facebook Page before retrying. This prevents a duplicate post.",video:publicDraft(row)},409);
    const claimed=await claimDraft(row);
    const work=publishClaimed(claimed.row,connection,claimed.state);
    waitUntil(work.then(()=>{}));
    const result=await work;
    return json({video:publicDraft(result),pageName:connection.pageName});
  } catch(error) {
    return json({error:error instanceof Error?error.message:"Publishing could not finish. Your saved post is still available."},502);
  }
}
