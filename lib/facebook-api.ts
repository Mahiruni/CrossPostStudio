export type FacebookResponse = {
  id?: string; post_id?: string; video_id?: string; success?: boolean;
  upload_session_id?: string | number; start_offset?: string | number; end_offset?: string | number;
  published?: boolean; permalink_url?: string; title?: string; description?: string; message?: string; created_time?: string;
  status?: { video_status?: string; processing_progress?: number; publishing_phase?: {status?:string} };
  data?: FacebookResponse[]; paging?: {next?:string};
  error?: {message?:string;code?:number;error_subcode?:number};
};
export class FacebookRequestError extends Error {
  uncertain:boolean; code?:number;
  constructor(message:string, uncertain=false, code?:number) { super(message); this.name="FacebookRequestError"; this.uncertain=uncertain; this.code=code; }
}
export async function facebookRequest(url:string, token:string, body?:FormData, timeoutMs=25_000):Promise<FacebookResponse> {
  let response:Response;
  try { response=await fetch(url,{method:body?"POST":"GET",headers:{Authorization:`Bearer ${token}`},body,signal:AbortSignal.timeout(timeoutMs)}); }
  catch { throw new FacebookRequestError("Facebook did not respond in time. We’ll check the saved upload before trying again.",true); }
  const result=await response.json().catch(()=>null) as FacebookResponse|null;
  if (!result) throw new FacebookRequestError("Facebook returned an unreadable response. Check the saved post status before retrying.",true);
  if(!response.ok||result.error||result.success===false) {
    const error=result.error;
    const message=error?.code===190?"Facebook authorization has expired. Reconnect your Page in Channels.":error?.message??`Facebook could not complete the request (${response.status}).`;
    throw new FacebookRequestError(message,false,error?.code);
  }
  return result;
}
