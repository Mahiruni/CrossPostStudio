import { videos, facebookConnections } from "@/db/schema";
import { getDb } from "@/db";
import { decryptToken, META_VERSION, runtimeEnv } from "@/lib/meta";
import { facebookRequest, FacebookRequestError, type FacebookResponse } from "@/lib/facebook-api";
import { isActivePublish, normalizedMessage, parsePublishState, uploadRange, videoReady, type PublishState } from "@/lib/publish-state";
import { and, eq, isNull, sql } from "drizzle-orm";

export type DraftRecord = typeof videos.$inferSelect;
type Connection = typeof facebookConnections.$inferSelect;
const graph = (path:string) => `https://graph.facebook.com/${META_VERSION}/${path}`;
const owner = (row:DraftRecord) => and(eq(videos.id,row.id),eq(videos.userId,row.userId));

export function publicDraft(row:DraftRecord) {
  const state=parsePublishState(row.publishState);
  return {id:row.id,fileName:row.fileName,fileSize:row.size,caption:row.caption,sourceUrl:row.sourceUrl,plannedAt:row.plannedAt??"",createdAt:row.createdAt,status:row.status,
    postType:row.mimeType==="text/plain"?"text":row.mimeType.startsWith("image/")?"image":"video",facebookVideoId:row.facebookVideoId,
    progress:row.status==="published"?100:state?.progress??0,stage:state?.stage??(row.status==="publishing"?"Previous upload needs checking":""),publishError:state?.error??null,
    canRecover:row.status==="interrupted"||(row.status==="publishing"&&!isActivePublish(state)),
    canCheck:["processing","review"].includes(row.status),
    facebookUrl:row.status==="published"&&row.facebookVideoId?`https://www.facebook.com/${encodeURIComponent(row.facebookVideoId)}`:null};
}
export async function ownedDraft(id:string,userId:string) {
  return (await getDb().select().from(videos).where(and(eq(videos.id,id),eq(videos.userId,userId))).limit(1))[0];
}
export async function pageConnection(userId:string) {
  return (await getDb().select().from(facebookConnections).where(eq(facebookConnections.userId,userId)).limit(1))[0];
}
async function update(row:DraftRecord,values:Partial<typeof videos.$inferInsert>,attemptId?:string) {
  await getDb().update(videos).set(values).where(and(owner(row),attemptId?sql`json_extract(${videos.publishState}, '$.attemptId') = ${attemptId}`:undefined));
  return (await ownedDraft(row.id,row.userId))!;
}
async function complete(row:DraftRecord,remoteId:string,state:PublishState) {
  const result=await update(row,{status:"published",facebookVideoId:remoteId,publishedAt:new Date().toISOString(),publishState:JSON.stringify({...state,phase:"done",progress:100,stage:"Published to Facebook",updatedAt:new Date().toISOString(),error:undefined}),r2Key:null});
  if(row.r2Key) { try { await runtimeEnv().BUCKET?.delete(row.r2Key); } catch { /* Successful publication takes priority over cleanup. */ } }
  return result;
}
function stateFor(row:DraftRecord):PublishState {
  return parsePublishState(row.publishState)??{attemptId:crypto.randomUUID(),startedAt:row.createdAt,updatedAt:new Date().toISOString(),phase:"interrupted",progress:0,stage:"Checking previous upload"};
}
async function remoteVideo(id:string,token:string) {
  try { return await facebookRequest(graph(`${encodeURIComponent(id)}?fields=id,status,published,permalink_url`),token); }
  catch(error) { if(error instanceof FacebookRequestError&&error.code===100) return facebookRequest(graph(`${encodeURIComponent(id)}?fields=id,status,permalink_url`),token); throw error; }
}
async function findPrevious(row:DraftRecord,connection:Connection,token:string,state:PublishState) {
  const isVideo=row.mimeType.startsWith("video/");
  const since=Math.floor((Date.parse(state.startedAt)-60_000)/1000);
  const fields=isVideo?"id,description,title,created_time,status,permalink_url":"id,message,created_time";
  let url=graph(`${encodeURIComponent(connection.pageId)}/${isVideo?"videos":"feed"}?fields=${encodeURIComponent(fields)}&limit=100&since=${since}`);
  const matches:FacebookResponse[]=[];
  for(let page=0;page<3;page++) {
    const result=await facebookRequest(url,token);
    for(const item of result.data??[]) {
      const message=normalizedMessage(item.description??item.message??"");
      const caption=normalizedMessage(row.caption);
      const after=Date.parse(item.created_time??"")>=since*1000;
      if(after&&((caption&&message===caption)||(isVideo&&item.title===row.fileName))) matches.push(item);
    }
    if(!result.paging?.next) return {matches,complete:true};
    const next=new URL(result.paging.next);
    if(next.origin!=="https://graph.facebook.com") throw new Error("Facebook returned an unexpected pagination URL.");
    next.searchParams.delete("access_token");
    url=next.toString();
  }
  return {matches,complete:false};
}
export async function reconcileDraft(row:DraftRecord,connection:Connection):Promise<DraftRecord> {
  if(row.status==="published"||row.status==="draft"||isActivePublish(parsePublishState(row.publishState))) return row;
  const state=stateFor(row);
  const token=await decryptToken(connection.tokenCiphertext,connection.tokenIv);
  if(row.facebookVideoId) {
    const remote=await remoteVideo(row.facebookVideoId,token);
    if(videoReady(remote.status,remote.published)&&(state.finishConfirmed||remote.published===true||remote.status?.publishing_phase?.status==="complete")) return complete(row,row.facebookVideoId,state);
    if(remote.status?.video_status==="error") return update(row,{status:"draft",facebookVideoId:null,publishState:JSON.stringify({...state,phase:"error",stage:"Facebook could not process this video",sessionId:undefined,finishConfirmed:false,error:"Facebook could not process the video. Your original is saved; try a fresh upload.",updatedAt:new Date().toISOString()})});
    if(state.finishConfirmed||["finishing","processing"].includes(state.phase)) return update(row,{status:"processing",publishState:JSON.stringify({...state,phase:"processing",stage:"Facebook is processing your video",progress:95,updatedAt:new Date().toISOString(),error:undefined})});
    return update(row,{status:"interrupted",publishState:JSON.stringify({...state,phase:"interrupted",stage:"Upload paused — ready to continue",updatedAt:new Date().toISOString()})});
  }
  const previous=await findPrevious(row,connection,token,state);
  if(previous.matches.length===1) {
    const found=previous.matches[0];
    if(row.mimeType.startsWith("video/")&&found.status?.video_status&&found.status.video_status!=="ready") return update(row,{facebookVideoId:found.id,status:"processing",publishState:JSON.stringify({...state,phase:"processing",finishConfirmed:true,progress:95,stage:"Facebook is processing your video",updatedAt:new Date().toISOString()})});
    return complete(row,found.id!,state);
  }
  if(previous.matches.length>1||!previous.complete||state.phase==="submitting"||state.phase==="review"||row.status==="review") return update(row,{status:"review",publishState:JSON.stringify({...state,phase:"review",stage:"Check Facebook before retrying",error:"We couldn’t safely confirm this post. Check your Page to avoid publishing a duplicate.",updatedAt:new Date().toISOString()})});
  return update(row,{status:"interrupted",publishState:JSON.stringify({...state,phase:"interrupted",stage:"Previous upload stopped — ready to continue",error:undefined,updatedAt:new Date().toISOString()})});
}
export async function claimDraft(row:DraftRecord) {
  const old=parsePublishState(row.publishState);
  const now=new Date().toISOString();
  const state:PublishState={...old,attemptId:crypto.randomUUID(),startedAt:old?.sessionId?old.startedAt:now,updatedAt:now,phase:old?.sessionId?"uploading":"starting",progress:old?.sessionId?old.progress:1,stage:old?.sessionId?"Resuming saved upload":"Preparing your post",error:undefined};
  const result=await getDb().update(videos).set({status:"publishing",publishState:JSON.stringify(state)}).where(and(owner(row),eq(videos.status,row.status),row.publishState===null?isNull(videos.publishState):eq(videos.publishState,row.publishState)));
  if(result.meta.changes!==1) throw new Error("This post is already being processed. Check its current status.");
  return {row:{...row,status:"publishing",publishState:JSON.stringify(state)},state};
}
export async function publishClaimed(row:DraftRecord,connection:Connection,state:PublishState):Promise<DraftRecord> {
  const save=async(patch:Partial<PublishState>,values:Partial<typeof videos.$inferInsert>={})=>{
    state={...state,...patch,updatedAt:new Date().toISOString()};
    row=await update(row,{...values,publishState:JSON.stringify(state)},state.attemptId);
  };
  try {
    const token=await decryptToken(connection.tokenCiphertext,connection.tokenIv);
    const isVideo=row.mimeType.startsWith("video/");
    const isText=row.mimeType==="text/plain";
    const object=!isText&&row.r2Key?await runtimeEnv().BUCKET?.get(row.r2Key):null;
    if(!isText&&!object) throw new FacebookRequestError("Your original file is unavailable. Upload it again.");
    if(object&&object.size>(isVideo?25:10)*1024*1024) throw new FacebookRequestError("This file exceeds the publishing size limit.");
    if(!isVideo) {
      const form=new FormData();
      if(isText) {if(!row.caption.trim()) throw new FacebookRequestError("Write some text before publishing.");form.set("message",row.caption);}
      else {form.set("source",new Blob([await object!.arrayBuffer()],{type:row.mimeType}),row.fileName);form.set("caption",row.caption);form.set("published","true");}
      await save({phase:"submitting",progress:40,stage:isText?"Publishing your text post":"Publishing your photo"});
      const result=await facebookRequest(graph(`${encodeURIComponent(connection.pageId)}/${isText?"feed":"photos"}`),token,form);
      const remoteId=result.post_id??result.id;
      if(!remoteId) throw new FacebookRequestError("Facebook did not return a post ID. Check the post status before retrying.",true);
      await save({phase:"done",progress:99,stage:"Confirming publication"},{facebookVideoId:remoteId});
      return await complete(row,remoteId,state);
    }
    const total=object!.size;
    const endpoint=`https://graph-video.facebook.com/${META_VERSION}/${encodeURIComponent(connection.pageId)}/videos`;
    if(!state.sessionId) {
      const form=new FormData();form.set("upload_phase","start");form.set("file_size",String(total));
      const result=await facebookRequest(endpoint,token,form);
      if(!result.upload_session_id||!result.video_id) throw new FacebookRequestError("Facebook did not create an upload session.");
      const range=uploadRange(result.start_offset??0,result.end_offset??total,total);
      await save({phase:"uploading",sessionId:String(result.upload_session_id),startOffset:range.start,endOffset:range.end,progress:4,stage:"Uploading video to Facebook"},{facebookVideoId:result.video_id});
    }
    let transfers=0;
    while((state.startOffset??0)<total) {
      if(++transfers>1000) throw new FacebookRequestError("Facebook did not finish the upload. Continue the saved upload from your queue.");
      const range=uploadRange(state.startOffset??0,state.endOffset??total,total);
      const chunk=await runtimeEnv().BUCKET!.get(row.r2Key!,{range:{offset:range.start,length:range.end-range.start}});
      if(!chunk) throw new FacebookRequestError("The saved video chunk is unavailable.");
      const form=new FormData();form.set("upload_phase","transfer");form.set("upload_session_id",state.sessionId!);form.set("start_offset",String(range.start));form.set("video_file_chunk",new Blob([await chunk.arrayBuffer()],{type:row.mimeType}),row.fileName);
      const result=await facebookRequest(endpoint,token,form);
      const next=uploadRange(result.start_offset??range.end,result.end_offset??total,total);
      if(next.start<=range.start) throw new FacebookRequestError("Facebook paused the upload. Continue from your saved queue.");
      await save({startOffset:next.start,endOffset:next.end,progress:Math.min(90,4+Math.round(next.start/total*86)),stage:"Uploading video to Facebook"});
    }
    await save({phase:"finishing",progress:93,stage:"Sending the video for processing"});
    const form=new FormData();form.set("upload_phase","finish");form.set("upload_session_id",state.sessionId!);form.set("title",row.fileName.slice(0,100));form.set("description",row.caption);form.set("published","true");
    const finished=await facebookRequest(endpoint,token,form);
    const remoteId=finished.id??finished.video_id??row.facebookVideoId;
    if(!remoteId) throw new FacebookRequestError("Facebook did not confirm the video ID.",true);
    await save({phase:"processing",finishConfirmed:true,progress:95,stage:"Facebook is processing your video"},{facebookVideoId:remoteId,status:"processing"});
    try { return await reconcileDraft(row,connection); } catch { return row; }
  } catch(error) {
    const uncertain=error instanceof FacebookRequestError?error.uncertain:true;
    const message=error instanceof Error?error.message:"Publishing could not finish. Your original is saved.";
    const submitted=["submitting","finishing","processing","done"].includes(state.phase);
    const status=submitted&&uncertain?(row.facebookVideoId?"processing":"review"):state.sessionId?"interrupted":"draft";
    await save({phase:status==="processing"?"processing":status==="review"?"review":status==="interrupted"?"interrupted":"error",stage:status==="processing"?"Checking Facebook confirmation":status==="review"?"Check Facebook before retrying":"Ready to retry",error:message},{status});
    console.warn("Publishing attempt paused",{draftId:row.id,phase:state.phase,status,message});
    return row;
  }
}
