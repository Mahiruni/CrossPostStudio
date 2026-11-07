"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight, ArrowUpRight, Check, CheckCheck, ChevronDown, CircleAlert,
  CircleHelp, ExternalLink, FileText, Film, House, Image as ImageIcon,
  Link2, LoaderCircle, LockKeyhole, MoreHorizontal, Plus, Radio,
  RefreshCw, Send, ShieldCheck, Sparkles, Trash2, Type, Upload, Video, X,
} from "lucide-react";

type PostType = "video" | "image" | "text";
type Draft = {
  id:string; fileName:string; fileSize:number; caption:string; sourceUrl:string;
  plannedAt:string; createdAt:string; status:string; postType?:PostType;
  facebookVideoId?:string|null; facebookUrl?:string|null;
  progress?:number; stage?:string; publishError?:string|null; canRecover?:boolean; canCheck?:boolean;
};
type View = "overview" | "compose" | "queue" | "connections";
type Operation = {kind:"upload"|"publish";progress:number;label:string};
type PageChoice = {id:string;name:string};
const navigation = [
  {id:"overview" as const,label:"Overview",short:"Home",icon:House,color:"amber"},
  {id:"compose" as const,label:"Create post",short:"Create",icon:Plus,color:"green"},
  {id:"queue" as const,label:"Post queue",short:"Queue",icon:FileText,color:"blue"},
  {id:"connections" as const,label:"Channels",short:"Channels",icon:Radio,color:"violet"},
];
const formats = [
  {id:"video" as const,label:"Video",icon:Video,color:"coral"},
  {id:"image" as const,label:"Image",icon:ImageIcon,color:"blue"},
  {id:"text" as const,label:"Text",icon:Type,color:"violet"},
];
let completionAudioContext: AudioContext | null = null;

function prepareCompletionSound() {
  if (typeof window === "undefined") return;
  const AudioContextConstructor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) return;
  try {
    completionAudioContext ??= new AudioContextConstructor();
    if (completionAudioContext.state === "suspended") void completionAudioContext.resume().catch(() => {});
  } catch { /* Audio is an enhancement; completion is still shown on screen. */ }
}

function playCompletionSound() {
  const context = completionAudioContext;
  if (!context) return;
  void context.resume().then(() => {
    const start = context.currentTime + 0.02;
    [659.25, 783.99, 987.77].forEach((frequency, index) => {
      const noteStart = start + index * 0.1;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, noteStart);
      gain.gain.setValueAtTime(0.0001, noteStart);
      gain.gain.exponentialRampToValueAtTime(0.1, noteStart + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + 0.32);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(noteStart);
      oscillator.stop(noteStart + 0.34);
    });
  }).catch(() => {});
}

function uploadDraftWithProgress(form: FormData, onProgress: (percent: number) => void): Promise<{ video: Draft }> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", "/api/videos");
    request.withCredentials = true;
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.min(99, Math.round(event.loaded / event.total * 100)));
      }
    });
    request.addEventListener("load", () => {
      let result: { video?: Draft; error?: string } = {};
      try { result = JSON.parse(request.responseText || "{}"); } catch { /* handled as an invalid response below */ }
      if (request.status < 200 || request.status >= 300) {
        reject(new Error(result.error || `Upload failed (${request.status || "network"}).`));
      } else if (!result.video) {
        reject(new Error("The upload finished, but the draft could not be confirmed."));
      } else {
        resolve({ video: result.video });
      }
    });
    request.addEventListener("error", () => reject(new Error("The upload was interrupted. Please try again.")));
    request.addEventListener("abort", () => reject(new Error("The upload was cancelled.")));
    request.send(form);
  });
}

async function readJson<T>(response:Response):Promise<T> {
  const value=await response.json().catch(()=>({})) as T&{error?:string};
  if(!response.ok) throw new Error(value.error||`Request failed (${response.status}).`);
  return value;
}
function bytes(size:number) {return size<1048576?`${Math.max(1,Math.round(size/1024))} KB`:`${(size/1048576).toFixed(1)} MB`;}
function dateLabel(value:string) {return new Date(value).toLocaleDateString(undefined,{month:"short",day:"numeric"});}
function statusLabel(status:string) {return ({draft:"Draft",publishing:"Uploading",processing:"Processing",published:"Published",interrupted:"Paused",review:"Needs review"} as Record<string,string>)[status]??"Draft";}
function Wordmark(){return <span className="wordmark"><span className="brand-symbol"><ArrowUpRight size={21} strokeWidth={2.5}/></span><span>crosspost<small>STUDIO</small></span></span>;}
function FacebookMark({large=false}:{large?:boolean}) {return <span className={"facebook-mark "+(large?"large":"")}>f</span>;}
function Progress({progress,label,compact=false}:{progress:number;label:string;compact?:boolean}) {
  const value=Math.min(100,Math.max(0,Math.round(progress)));
  return <div className={"progress-component "+(compact?"compact-progress":"")}><div className="progress-label"><strong>{label}</strong><span>{100-value}% remaining</span></div><div className="progress-track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}><span style={{width:`${value}%`}}/></div></div>;
}

export default function Home() {
  const [view,setView]=useState<View>("overview");
  const [menuOpen,setMenuOpen]=useState(false);
  const [modal,setModal]=useState(false);
  const [drafts,setDrafts]=useState<Draft[]>([]);
  const [filter,setFilter]=useState("all");
  const [postType,setPostType]=useState<PostType>("video");
  const [file,setFile]=useState<File|null>(null);
  const [caption,setCaption]=useState("");
  const [sourceUrl,setSourceUrl]=useState("");
  const [rights,setRights]=useState(false);
  const [notice,setNotice]=useState("");
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [workingId,setWorkingId]=useState("");
  const [checkingId,setCheckingId]=useState("");
  const [operation,setOperation]=useState<Operation|null>(null);
  const [connected,setConnected]=useState(false);
  const [pageName,setPageName]=useState("");
  const [metaReady,setMetaReady]=useState(false);
  const [metaAppId,setMetaAppId]=useState("");
  const [metaAppSecret,setMetaAppSecret]=useState("");
  const [metaSaving,setMetaSaving]=useState(false);
  const [pageChoices,setPageChoices]=useState<PageChoice[]>([]);
  const [selectedPage,setSelectedPage]=useState("");
  const announced=useRef(new Set<string>());
  const publishingRef=useRef("");
  const closeMenuRef=useRef<HTMLButtonElement>(null);
  const preview=useMemo(()=>file?URL.createObjectURL(file):"",[file]);
  useEffect(()=>{if(preview)return ()=>URL.revokeObjectURL(preview);},[preview]);
  useEffect(()=>{
    if(!menuOpen&&!modal)return;
    const old=document.body.style.overflow;
    document.body.style.overflow="hidden";
    const escape=(event:KeyboardEvent)=>{
      if(event.key==="Escape"){setMenuOpen(false);setModal(false);}
      if(event.key==="Tab") {
        const dialog=document.querySelector(menuOpen?"#studio-drawer":".help-modal");
        const controls=dialog?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input,textarea,select,[tabindex="0"]');
        if(controls?.length){const first=controls[0],last=controls[controls.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}
      }
    };
    document.addEventListener("keydown",escape);closeMenuRef.current?.focus();
    return ()=>{document.body.style.overflow=old;document.removeEventListener("keydown",escape);};
  },[menuOpen,modal]);

  function go(next:View) {setView(next);setMenuOpen(false);setNotice("");setError("");window.scrollTo({top:0,behavior:"smooth"});}
  function applyDraft(next:Draft) {
    setDrafts(current=>current.map(row=>row.id===next.id?next:row));
    if(next.status==="published"&&!announced.current.has(next.id)) {
      announced.current.add(next.id);setNotice("Done — your post is published to Facebook.");playCompletionSound();
    }
  }
  async function refresh(quiet=false) {
    if(!quiet)setLoading(true);
    const results=await Promise.allSettled([
      fetch("/api/meta/status",{cache:"no-store"}).then(readJson<{connected:boolean;pageName:string|null}>),
      fetch("/api/videos",{cache:"no-store"}).then(readJson<{videos:Draft[]}>),
      fetch("/api/meta/config",{cache:"no-store"}).then(readJson<{configured:boolean;appId:string|null}>),
    ]);
    const status=results[0],posts=results[1],config=results[2];
    if(status.status==="fulfilled"){setConnected(status.value.connected);setPageName(status.value.pageName||"");}
    if(posts.status==="fulfilled"){setDrafts(posts.value.videos);for(const row of posts.value.videos)if(row.status==="published")announced.current.add(row.id);}
    if(config.status==="fulfilled"){setMetaReady(config.value.configured);if(config.value.appId)setMetaAppId(config.value.appId);}
    for(const result of results)if(result.status==="rejected")setError(result.reason instanceof Error?result.reason.message:"Your workspace could not load.");
    setLoading(false);
  }
  useEffect(()=>{
    void refresh();
    const query=new URLSearchParams(window.location.search),meta=query.get("meta");
    if(!meta)return;
    window.history.replaceState({},"",window.location.pathname);setView("connections");
    if(meta==="select")fetch("/api/meta/pages",{cache:"no-store"}).then(readJson<{pages:PageChoice[]}>).then(result=>{setPageChoices(result.pages);setSelectedPage(result.pages[0]?.id||"");if(!result.pages.length)setError("No publishable Pages were returned. Check your Page access and reconnect.");}).catch(e=>setError(e.message));
    else if(meta==="oauth_error")setError("Facebook authorization did not complete. Try connecting again.");
    else if(meta==="no_pages")setError("No Page with publishing access was found on this account.");
    else if(meta==="setup")setNotice("Save your Meta app settings to enable Page connection.");
  },[]);
  const activeIds=drafts.filter(row=>["publishing","processing"].includes(row.status)).map(row=>row.id).join(",");
  useEffect(()=>{
    if(!activeIds)return;
    let stopped=false,busy=false;
    const poll=async()=>{
      if(busy)return;busy=true;
      const results=await Promise.allSettled(activeIds.split(",").map(id=>fetch(`/api/videos/${encodeURIComponent(id)}/publish`,{cache:"no-store"}).then(readJson<{video:Draft;checkError?:string}>)));
      if(!stopped)for(const result of results)if(result.status==="fulfilled"){
        const row=result.value.video;
        if(row.status==="draft"&&publishingRef.current===row.id)continue;
        if(result.value.checkError)row.publishError=result.value.checkError;
        applyDraft(row);
      }
      busy=false;
    };
    void poll();const timer=window.setInterval(poll,4000);
    return ()=>{stopped=true;window.clearInterval(timer);};
  },[activeIds]);
  useEffect(()=>{
    const current=drafts.find(row=>row.id===workingId);
    if(current&&operation?.kind==="publish")setOperation({kind:"publish",progress:current.progress??0,label:current.stage||"Preparing your post"});
  },[drafts,workingId]);

  function chooseType(next:PostType){setPostType(next);setFile(null);setSourceUrl("");setError("");}
  function acceptFile(next:File|undefined){
    if(!next)return;
    const allowed=postType==="video"?["video/mp4","video/quicktime","video/webm"]:["image/jpeg","image/png"];
    if(!allowed.includes(next.type))return setError(postType==="video"?"Choose an MP4, MOV or WebM video.":"Choose a JPG or PNG image.");
    if(next.size<1||next.size>(postType==="video"?25:10)*1024*1024)return setError(`Choose a ${postType} smaller than ${postType==="video"?25:10} MB.`);
    setFile(next);setError("");
  }
  async function saveDraft(){
    setError("");setNotice("");
    if(postType!=="text"&&!file)return setError(`Add your ${postType} first.`);
    if(postType==="text"&&!caption.trim())return setError("Write your post text first.");
    if(!rights)return setError("Confirm that you have permission to publish this content.");
    if(sourceUrl&&!/^https:\/\/(www\.)?(tiktok\.com|vm\.tiktok\.com)\//i.test(sourceUrl.trim()))return setError("Use a valid TikTok link or leave the reference empty.");
    prepareCompletionSound();setSaving(true);setOperation({kind:"upload",progress:0,label:postType==="text"?"Saving your post":`Uploading your ${postType}`});
    try{
      const form=new FormData();form.set("postType",postType);if(file)form.set("media",file);form.set("caption",caption.trim());form.set("sourceUrl",sourceUrl.trim());form.set("rightsConfirmed","true");
      const result=await uploadDraftWithProgress(form,progress=>setOperation({kind:"upload",progress,label:progress>=99?"Finishing your private save":postType==="text"?"Saving your post":`Uploading your ${postType}`}));
      setDrafts(current=>[result.video,...current]);setFile(null);setCaption("");setSourceUrl("");setRights(false);setPostType("video");go("queue");setNotice("Done — your private draft is ready to publish.");playCompletionSound();
    }catch(e){setError(e instanceof Error?e.message:"Your draft could not be saved.");}
    finally{setSaving(false);setOperation(null);}
  }
  async function publish(draft:Draft){
    if(workingId)return;
    publishingRef.current=draft.id;prepareCompletionSound();setError("");setNotice("");setWorkingId(draft.id);setOperation({kind:"publish",progress:draft.progress??0,label:"Preparing your post"});
    // Show and poll the saved job while the request stays open.
    setDrafts(current=>current.map(row=>row.id===draft.id?{...row,status:"publishing",canRecover:false}:row));
    try{
      const result=await fetch(`/api/videos/${encodeURIComponent(draft.id)}/publish`,{method:"POST",signal:AbortSignal.timeout(180_000)}).then(readJson<{video:Draft;pageName:string}>);
      applyDraft(result.video);
      if(result.video.status==="processing")setNotice("Your upload is complete. Facebook is processing the video; this queue will keep checking.");
      else if(result.video.publishError)setError(result.video.publishError);
    }catch(e){setError(e instanceof Error?e.message:"The connection was interrupted. Check the saved publishing status.");await checkStatus(draft.id,true);}
    finally{publishingRef.current="";setWorkingId("");setOperation(null);}
  }
  async function checkStatus(id:string,quiet=false){
    if(!quiet){setError("");setNotice("");}setCheckingId(id);
    try{
      const result=await fetch(`/api/videos/${encodeURIComponent(id)}/publish`,{cache:"no-store"}).then(readJson<{video:Draft;checkError?:string}>);
      applyDraft(result.video);
      if(result.checkError)setError(result.checkError);
      else if(!quiet&&result.video.status==="interrupted")setNotice("The previous upload stopped. Continue publishing to resume it safely.");
      else if(!quiet&&result.video.status!=="published")setNotice(result.video.stage||"The saved post status is up to date.");
    }catch(e){if(!quiet)setError(e instanceof Error?e.message:"Status could not be checked.");}
    finally{setCheckingId("");}
  }
  async function removeDraft(id:string){
    if(!window.confirm("Delete this private draft and its saved media?"))return;
    try{await fetch(`/api/videos?id=${encodeURIComponent(id)}`,{method:"DELETE"}).then(readJson);setDrafts(current=>current.filter(row=>row.id!==id));setNotice("Post removed from your workspace.");}
    catch(e){setError(e instanceof Error?e.message:"This post could not be removed.");}
  }
  async function saveMetaConfig(){
    setError("");setNotice("");
    if(!/^\d{5,30}$/.test(metaAppId.trim()))return setError("Enter the numeric Meta App ID.");
    if(metaAppSecret.trim().length<16)return setError("Enter the App Secret from your Meta developer app.");
    setMetaSaving(true);
    try{const result=await fetch("/api/meta/config",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({appId:metaAppId.trim(),appSecret:metaAppSecret.trim()})}).then(readJson<{configured:boolean;appId:string}>);setMetaReady(result.configured);setMetaAppId(result.appId);setMetaAppSecret("");setNotice("Your Meta credentials are saved securely.");}
    catch(e){setError(e instanceof Error?e.message:"Credentials could not be saved.");}finally{setMetaSaving(false);}
  }
  async function connectPage(){
    if(!selectedPage)return;
    try{const result=await fetch("/api/meta/select",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({pageId:selectedPage})}).then(readJson<{pageName:string}>);setConnected(true);setPageName(result.pageName);setPageChoices([]);setNotice(`${result.pageName} is connected.`);await refresh(true);}
    catch(e){setError(e instanceof Error?e.message:"Page could not be connected.");}
  }
  async function disconnect(){
    if(!window.confirm(`Disconnect ${pageName||"your Facebook Page"}?`))return;
    try{await fetch("/api/meta/status",{method:"DELETE"}).then(readJson);setConnected(false);setPageName("");setNotice("Your Page is disconnected.");}
    catch(e){setError(e instanceof Error?e.message:"Page could not be disconnected.");}
  }
  async function copyCallback(){
    const url=`${window.location.origin}/api/meta/callback`;
    try{await navigator.clipboard.writeText(url);setNotice("Callback URL copied.");}catch{setNotice(url);}
  }
  const counts={drafts:drafts.filter(row=>["draft","interrupted","review"].includes(row.status)).length,active:drafts.filter(row=>["publishing","processing"].includes(row.status)).length,published:drafts.filter(row=>row.status==="published").length};
  const filtered=drafts.filter(row=>filter==="all"||filter==="draft"&&["draft","interrupted","review"].includes(row.status)||filter==="active"&&["publishing","processing"].includes(row.status)||filter==="published"&&row.status==="published");
  const rowProps={publish,checkStatus,remove:removeDraft,connected,workingId,checkingId};

  return <div className="studio-app">
    <header className="studio-header">
      <div className="header-leading"><button className={"hamburger "+(menuOpen?"is-open":"")} aria-label="Open navigation menu" aria-expanded={menuOpen} aria-controls="studio-drawer" onClick={()=>setMenuOpen(true)}><span/><span/><span/></button><button className="brand-button" aria-label="Crosspost Studio home" onClick={()=>go("overview")}><Wordmark/></button></div>
      <nav className="desktop-nav" aria-label="Main navigation">{navigation.map(({id,label,icon:Icon,color})=><button key={id} onClick={()=>go(id)} aria-current={view===id?"page":undefined} className={view===id?"active":""}><Icon size={16} className={`color-${color}`}/>{label}</button>)}</nav>
      <button className="header-channel" onClick={()=>go("connections")} aria-label="Manage Facebook connection"><FacebookMark/><span><strong>{connected?pageName:"Connect a Page"}</strong><small><i className={connected?"live-dot":"offline-dot"}/>{connected?"Connected":"Ready when you are"}</small></span><ChevronDown size={14}/></button>
    </header>

    {menuOpen&&<div className="drawer-overlay" onClick={e=>{if(e.target===e.currentTarget)setMenuOpen(false)}}><aside className="studio-drawer" id="studio-drawer" role="dialog" aria-modal="true" aria-label="Navigation menu"><div className="drawer-header"><Wordmark/><button ref={closeMenuRef} className="icon-button" aria-label="Close navigation menu" onClick={()=>setMenuOpen(false)}><X size={20}/></button></div><div className="drawer-workspace"><span className="workspace-avatar">M</span><div><strong>My creative space</strong><small>Your private workspace</small></div><LockKeyhole size={15}/></div><span className="eyebrow drawer-label">YOUR STUDIO</span><nav>{navigation.map(({id,label,icon:Icon,color})=><button key={id} onClick={()=>go(id)} className={view===id?"active":""}><span className={`icon-tile ${color}`}><Icon size={19}/></span><strong>{label}</strong>{id==="queue"&&drafts.length>0?<b>{drafts.length}</b>:<ArrowUpRight size={15}/>}</button>)}</nav><div className="drawer-bottom"><div className="drawer-status"><i className={connected?"live-dot":"offline-dot"}/><span>{connected?`Connected to ${pageName}`:"Your workspace is private"}</span></div><button onClick={()=>{setMenuOpen(false);setModal(true)}}><CircleHelp size={17}/> How publishing works <ArrowUpRight size={14}/></button><p>Made for your next great post.</p></div></aside></div>}

    <main className="studio-content">
      {notice&&<div className="notice" role="status"><span className="message-symbol"><CheckCheck size={19}/></span><span>{notice}</span><button className="icon-button" aria-label="Dismiss notification" onClick={()=>setNotice("")}><X size={16}/></button></div>}
      {error&&<div className="error-banner" role="alert"><CircleAlert size={19}/><span>{error}</span><button className="icon-button" aria-label="Dismiss error" onClick={()=>setError("")}><X size={16}/></button></div>}
      {operation&&<div className="operation-card"><span className="icon-tile green"><LoaderCircle className="spin" size={20}/></span><Progress progress={operation.progress} label={operation.label}/></div>}

      {view==="overview"&&<>
        <div className="page-heading"><div><span className="eyebrow"><i/> YOUR CREATIVE SPACE</span><h1>A little more you.<br className="mobile-break"/> A lot more possibility.</h1><p>From an idea to your audience. Give every post its moment.</p></div><span className="workspace-pill"><LockKeyhole size={13}/> Private workspace</span></div>
        <section className="hero-grid">
          <div className="creative-hero"><div className="hero-orbit orbit-one"/><div className="hero-orbit orbit-two"/><div className="hero-copy"><span className="hero-tag"><Sparkles size={14}/> Create. Connect. Share.</span><h2>Good stories<br/>deserve to<br/><em>go further.</em></h2><p>Video, photo, or a few well chosen words.<br/>Make it yours. Then make it live.</p><div className="hero-actions"><button className="primary light" onClick={()=>go("compose")}><Plus size={17}/> Create a post <ArrowUpRight size={17}/></button><button className="hero-secondary" onClick={()=>go("queue")}>Your queue <ArrowRight size={16}/></button></div></div><div className="hero-art" aria-hidden="true"><div className="art-spark spark-one">✳</div><div className="art-card art-photo"><div className="art-landscape"><span/><i/><b/></div><div><span className="art-dot blue"/><strong>Something worth sharing.</strong></div></div><div className="art-card art-video"><span className="play-circle"><Video size={25}/></span><span>Your story.<br/><strong>In motion.</strong></span><i>00:15</i></div><div className="art-card art-text"><span className="quote-symbol">“</span><p>A small thought.<br/>A new conversation.</p><div><span/><span/><span/></div></div><div className="art-spark spark-two">✦</div></div><div className="hero-bottom"><span><i/> YOUR NEXT CHAPTER STARTS HERE</span><ArrowUpRight size={20}/></div></div>
          <aside className="channel-card"><div className="card-kicker"><span>YOUR CHANNEL</span><span className={connected?"connection-badge":"connection-badge offline"}><i/>{connected?"Connected":"Not connected"}</span></div><div className="channel-identity"><FacebookMark large/><div><h3>{connected?pageName:"Your Facebook Page"}</h3><p>{connected?"One connection. Every format.":"Bring your audience closer."}</p></div></div><div className="channel-divider"/><p className="channel-intro">One space.<br/><strong>Three ways to show up.</strong></p><div className="format-list">{formats.map(({id,label,icon:Icon,color})=><button key={id} onClick={()=>{chooseType(id);go("compose")}}><span className={`icon-tile ${color}`}><Icon size={20}/></span><span><strong>{label} posts</strong><small>{id==="video"?"Let the story move":id==="image"?"Make a lasting impression":"Start a conversation"}</small></span><ArrowUpRight size={16}/></button>)}</div><button className="channel-link" onClick={()=>go("connections")}>{connected?"Manage your channel":"Connect your Page"}<ArrowRight size={16}/></button></aside>
        </section>
        <section className="stat-grid" aria-label="Workspace statistics">{[{label:"Ready to create",value:counts.drafts,detail:"Private drafts",icon:FileText,color:"violet"},{label:"On its way",value:counts.active,detail:"Uploading or processing",icon:Send,color:"blue"},{label:"Out in the world",value:counts.published,detail:"Published posts",icon:CheckCheck,color:"green"}].map(({label,value,detail,icon:Icon,color})=><article key={label}><span className={`icon-tile ${color}`}><Icon size={20}/></span><div><span>{label}</span><strong>{loading?"—":String(value).padStart(2,"0")}</strong><small>{detail}</small></div><span className="stat-orbit"/></article>)}</section>
        <div className="section-heading"><div><span className="eyebrow">YOUR LATEST WORK</span><h2>Fresh from your studio.</h2></div><button className="text-link" onClick={()=>go("queue")}>See all posts <ArrowUpRight size={16}/></button></div>
        {loading?<div className="loading-card"><LoaderCircle className="spin" size={20}/> Opening your studio…</div>:drafts.length?<div className="post-list">{drafts.slice(0,3).map(draft=><PostRow key={draft.id} draft={draft} {...rowProps}/>)}</div>:<EmptyState create={()=>go("compose")}/>}
        <div className="studio-note"><ShieldCheck size={17}/><span>Created by you. Reviewed by you. Published when you’re ready.</span><button onClick={()=>setModal(true)}>How it works <ArrowUpRight size={13}/></button></div>
      </>}

      {view==="compose"&&<>
        <div className="page-heading"><div><span className="eyebrow">MAKE SOMETHING WORTH SHARING</span><h1>Your next great post.</h1><p>A story, a snapshot, a thought. Start with what you want to say.</p></div><div className="destination-pill"><FacebookMark/><span>{pageName||"Facebook Page"}</span><i className={connected?"live-dot":"offline-dot"}/></div></div>
        <div className="compose-grid"><section className="composer-card"><div className="composer-topline"><strong>Post details</strong><span><LockKeyhole size={12}/> Saved privately first</span></div><div className="post-type-switch" role="group" aria-label="Post type">{formats.map(({id,label,icon:Icon,color})=><button key={id} type="button" disabled={saving} onClick={()=>chooseType(id)} className={postType===id?"active":""} aria-pressed={postType===id}><span className={`format-dot ${color}`}><Icon size={17}/></span>{label}</button>)}</div>
          {postType!=="text"?<div className="form-section"><div className="field-heading"><label htmlFor="post-media">Your {postType}</label><span>{postType==="video"?"Up to 25 MB":"Up to 10 MB"}</span></div><label className={"upload-zone "+(file?"has-file":"")} htmlFor="post-media" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(!saving)acceptFile(e.dataTransfer.files[0])}}><input key={postType} disabled={saving} id="post-media" type="file" accept={postType==="video"?"video/mp4,video/quicktime,video/webm":"image/jpeg,image/png"} onChange={e=>acceptFile(e.target.files?.[0])}/>{file?<div className="file-row">{postType==="image"?<img src={preview} alt="Selected image"/>:<video src={preview} muted playsInline/>}<div><strong>{file.name}</strong><small>{bytes(file.size)}</small><span><Check size={13}/> Ready to review</span></div><button className="icon-button" type="button" aria-label="Remove selected file" disabled={saving} onClick={e=>{e.preventDefault();setFile(null)}}><X size={17}/></button></div>:<div className="upload-copy"><span className={`upload-symbol ${postType==="video"?"coral":"blue"}`}><Upload size={24}/><i><Plus size={10}/></i></span><strong>Drop it here. Make it yours.</strong><p>Drag your {postType} or <u>choose a file</u></p><small>{postType==="video"?"MP4, MOV or WebM":"JPG or PNG"} · Your original, at its best</small></div>}</label></div>:<div className="text-composer-note"><span className="icon-tile violet"><Type size={21}/></span><div><strong>Just your words. All your voice.</strong><p>Write a text post and let the conversation begin.</p></div></div>}
          <div className="form-section"><div className="field-heading"><label htmlFor="post-caption">{postType==="text"?"Your post":"Add a caption"}</label><span>{postType==="text"?"Required":"Optional"}</span></div><textarea id="post-caption" disabled={saving} value={caption} maxLength={2200} rows={6} onChange={e=>setCaption(e.target.value)} placeholder={postType==="text"?"What’s on your mind?":"Tell the story behind your post…"}/><div className="caption-meta"><span>Make room for your voice. Hashtags welcome.</span><span>{caption.length.toLocaleString()} / 2,200</span></div></div>
          {postType==="video"&&<details className="source-details"><summary><Link2 size={15}/><span>Add a source reference</span><small>Optional</small><ChevronDown size={14}/></summary><div><label htmlFor="source-url">TikTok reference link</label><input id="source-url" type="url" value={sourceUrl} disabled={saving} onChange={e=>setSourceUrl(e.target.value)} placeholder="https://www.tiktok.com/@you/video/…"/><p>A private reference to the original post.</p></div></details>}
          <label className="rights"><input type="checkbox" checked={rights} disabled={saving} onChange={e=>setRights(e.target.checked)}/><span><strong>I own this content or have permission to share it.</strong><small>I’ll include any required creator credit.</small></span></label><div className="form-actions"><button className="secondary" disabled={saving} onClick={()=>go("overview")}>Cancel</button><button className="primary" disabled={saving} onClick={saveDraft}>{saving?<LoaderCircle className="spin" size={16}/>:<Check size={16}/>} {saving?"Saving your draft…":"Save private draft"}<ArrowRight size={16}/></button></div>
        </section><aside className="preview-column"><div className="preview-heading"><span className="eyebrow">A LITTLE SNEAK PEEK</span><span className="preview-live"><i/> Live preview</span></div><div className="preview-card"><div className="preview-page"><span className="preview-avatar">{(pageName||"M").slice(0,1)}</span><span><strong>{pageName||"Your Facebook Page"}</strong><small>Just now · Preview</small></span><MoreHorizontal size={19}/></div>{caption&&postType!=="text"&&<p className="preview-caption">{caption}</p>}{postType==="text"?<div className="text-post-body">{caption||<span>Your next conversation<br/>starts right here.</span>}</div>:file?<div className={`media-preview ${postType}`}>{postType==="image"?<img src={preview} alt="Facebook post preview"/>:<video src={preview} playsInline controls/>}</div>:<div className={`media-placeholder ${postType}`}><span className={`icon-tile ${postType==="video"?"coral":"blue"}`}>{postType==="video"?<Video size={29}/>:<ImageIcon size={29}/>}</span><strong>Your {postType}. Front and center.</strong><small>Add a file to see it here.</small><span className="placeholder-orbit"/></div>}<div className="preview-social"><span>♡ Like</span><span>Comment</span><span>Share <ArrowUpRight size={12}/></span></div></div><div className="preview-tip"><span className="icon-tile green"><ShieldCheck size={18}/></span><div><strong>{connected?"Ready when you are.":"One connection away."}</strong><p>{connected?"Save your draft, review it in the queue, then publish to your Page.":"Connect your Facebook Page to bring your post to your audience."}</p>{!connected&&<button className="text-link" onClick={()=>go("connections")}>Connect your Page <ArrowRight size={14}/></button>}</div></div></aside></div>
      </>}

      {view==="queue"&&<><div className="page-heading"><div><span className="eyebrow">IDEAS IN GOOD COMPANY</span><h1>Your posts. In one place.</h1><p>A private space for work in progress and stories already shared.</p></div><button className="primary" onClick={()=>go("compose")}><Plus size={17}/> Create a post</button></div><div className="queue-toolbar"><div className="queue-filters">{[{id:"all",label:"All posts"},{id:"draft",label:"Drafts"},{id:"active",label:"In progress"},{id:"published",label:"Published"}].map(item=><button key={item.id} className={filter===item.id?"active":""} onClick={()=>setFilter(item.id)}>{item.label}{item.id==="all"&&<span>{drafts.length}</span>}</button>)}</div><button className="icon-button refresh-button" aria-label="Refresh posts" onClick={()=>refresh(true)}><RefreshCw size={17}/></button></div>{loading?<div className="loading-card"><LoaderCircle className="spin" size={20}/> Opening your posts…</div>:filtered.length?<div className="post-list">{filtered.map(draft=><PostRow key={draft.id} draft={draft} {...rowProps}/>)}</div>:<EmptyState create={()=>go("compose")} filtered={filter!=="all"}/>}<div className="queue-footnote"><LockKeyhole size={14}/><span>Drafts stay private. Publishing progress is saved as it happens.</span></div></>}

      {view==="connections"&&<><div className="page-heading"><div><span className="eyebrow">BRING YOUR AUDIENCE CLOSER</span><h1>A place for your stories.</h1><p>Connect your Facebook Page and turn your next idea into a post.</p></div><span className="workspace-pill"><ShieldCheck size={14}/> Secure connection</span></div><div className="connections-layout"><section className="connection-main"><div className="card-kicker"><span>CONNECTED CHANNEL</span><span className={connected?"connection-badge":"connection-badge offline"}><i/>{connected?"Connected":"Not connected"}</span></div><div className="connection-identity"><FacebookMark large/><div><h2>{pageName||"Facebook Page"}</h2><p>{connected?"Your video, image and text posts go here.":"Connect a Page you manage to get started."}</p></div></div><div className="connection-benefits"><span><Video size={17} className="color-coral"/>Video</span><span><ImageIcon size={17} className="color-blue"/>Image</span><span><Type size={17} className="color-violet"/>Text</span></div><div className="connection-actions">{connected?<><span><CheckCheck size={17}/>Ready for your next post</span><button className="secondary" onClick={disconnect}>Disconnect</button></>:metaReady?<a className="primary" href="/api/meta/connect">Connect with Facebook <ArrowUpRight size={16}/></a>:<button className="primary" onClick={()=>document.getElementById("meta-settings")?.setAttribute("open","")}>Set up Facebook <ArrowRight size={16}/></button>}</div>{pageChoices.length>0&&<div className="page-picker"><label htmlFor="page-choice">Choose your Page</label><select id="page-choice" value={selectedPage} onChange={e=>setSelectedPage(e.target.value)}>{pageChoices.map(page=><option key={page.id} value={page.id}>{page.name}</option>)}</select><button className="primary" onClick={connectPage}>Connect selected Page</button></div>}</section><aside className="connection-guide"><span className="icon-tile violet"><Sparkles size={21}/></span><h3>Your voice.<br/>Your audience.<br/><em>All connected.</em></h3><p>Every post starts as a private draft. You choose what goes live and when.</p><div><LockKeyhole size={16}/><span>Private drafts</span></div><div><ShieldCheck size={16}/><span>Encrypted credentials</span></div><div><CheckCheck size={16}/><span>Review before publishing</span></div></aside></div><details id="meta-settings" className="settings-panel" open={!metaReady}><summary><span className="icon-tile blue"><Radio size={19}/></span><span><strong>Meta app settings</strong><small>{metaReady?"Credentials configured securely":"Add your Meta developer app credentials"}</small></span><span className="settings-state">{metaReady?"Configured":"Setup needed"}</span><ChevronDown size={18}/></summary><div className="settings-content"><div className="settings-fields"><label>Meta App ID<input inputMode="numeric" autoComplete="off" value={metaAppId} onChange={e=>setMetaAppId(e.target.value)} placeholder="Numeric App ID"/></label><label>Meta App Secret<input type="password" autoComplete="new-password" value={metaAppSecret} onChange={e=>setMetaAppSecret(e.target.value)} placeholder={metaReady?"Enter a replacement secret":"App Secret"}/></label></div><div className="settings-bottom"><span><LockKeyhole size={13}/>Your secret is encrypted and never displayed.</span><button className="primary" onClick={saveMetaConfig} disabled={metaSaving}>{metaSaving?"Saving securely…":metaReady?"Replace credentials":"Save credentials"}</button></div><div className="callback-card"><span><strong>Facebook callback URL</strong><small>Use this address in your Meta app’s valid OAuth redirect URIs.</small></span><button className="secondary" onClick={copyCallback}><Link2 size={15}/> Copy URL</button></div></div></details></>}
      <footer className="studio-footer"><span>crosspost<span>studio</span></span><p>A space for stories that go further.</p><button onClick={()=>setModal(true)}><CircleHelp size={14}/> Help</button></footer>
    </main>

    <nav className="mobile-nav" aria-label="Main navigation">{navigation.map(({id,short,icon:Icon,color})=><button key={id} className={view===id?"active":""} aria-current={view===id?"page":undefined} onClick={()=>go(id)}><Icon size={17} className={`color-${color}`}/><span>{short}</span>{id==="queue"&&counts.active>0&&<i/>}</button>)}</nav>
    {modal&&<div className="modal-backdrop" onClick={e=>{if(e.target===e.currentTarget)setModal(false)}}><section className="help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title"><button className="icon-button modal-close" aria-label="Close help" onClick={()=>setModal(false)}><X size={21}/></button><span className="icon-tile green"><Sparkles size={25}/></span><span className="eyebrow">YOUR POST’S NEXT CHAPTER</span><h2 id="help-title">A little care.<br/>A better post.</h2><p>Upload an original video or photo, or write a text post. Save it privately, review it in your queue, and publish to a Facebook Page you manage.</p><div className="help-steps"><span><b>01</b>Create your draft</span><span><b>02</b>Make it feel like you</span><span><b>03</b>Share when you’re ready</span></div><button className="primary" onClick={()=>{setModal(false);go("compose")}}>Let’s create <ArrowRight size={16}/></button></section></div>}
  </div>;
}

function EmptyState({create,filtered=false}:{create:()=>void;filtered?:boolean}){return <div className="empty-state"><div className="empty-illustration"><span className="icon-tile blue"><ImageIcon size={24}/></span><span className="icon-tile coral"><Video size={26}/></span><span className="icon-tile violet"><Type size={24}/></span></div><span className="eyebrow">A LITTLE BLANK SPACE</span><h3>{filtered?"Nothing here just yet.":"Your next story belongs here."}</h3><p>{filtered?"Your posts will appear here as they move through the queue.":"Make something that feels like you. We’ll take care of the rest."}</p><button className="primary" onClick={create}><Plus size={16}/>Create a post</button></div>;}
function PostRow({draft,publish,checkStatus,remove,connected,workingId,checkingId}:{draft:Draft;publish:(draft:Draft)=>void;checkStatus:(id:string)=>void;remove:(id:string)=>void;connected:boolean;workingId:string;checkingId:string}) {
  const type=draft.postType??"video";
  const Icon=type==="video"?Video:type==="image"?ImageIcon:Type;
  const active=["publishing","processing"].includes(draft.status),busy=workingId===draft.id||checkingId===draft.id;
  const future=Boolean(draft.plannedAt&&Date.parse(draft.plannedAt)>Date.now());
  return <article className={`post-row post-${draft.status}`}><div className="post-row-top"><span className={`post-type-icon ${type==="video"?"coral":type==="image"?"blue":"violet"}`}><Icon size={23}/><i>{type==="video"?<Film size={10}/>:type==="image"?<ImageIcon size={10}/>:<Type size={10}/>}</i></span><div className="post-info"><div className="post-title"><h3>{type==="text"?draft.caption.split("\n")[0]||"Text post":draft.fileName}</h3><span className={`post-status ${draft.status}`}><i/>{statusLabel(draft.status)}</span></div><p>{type==="text"?"Text post":draft.caption||`${type==="video"?"Video":"Image"} post · Your original file`}</p><div className="post-meta"><span className="format-label">{type==="image"?"IMAGE":type.toUpperCase()}</span><span className="meta-dot"/>{type!=="text"&&<><span>{bytes(draft.fileSize)}</span><span className="meta-dot"/></>}<span>{dateLabel(draft.createdAt)}</span>{draft.sourceUrl&&<a href={draft.sourceUrl} target="_blank" rel="noreferrer"><Link2 size={11}/>Source</a>}</div></div><div className="post-actions">{draft.status==="published"&&draft.facebookUrl?<a className="secondary" href={draft.facebookUrl} target="_blank" rel="noreferrer">View post <ExternalLink size={13}/></a>:draft.canRecover||["draft","interrupted"].includes(draft.status)?<button className="primary" disabled={!connected||Boolean(workingId)||busy||future} onClick={()=>publish(draft)}>{busy?<LoaderCircle className="spin" size={14}/>:<Send size={14}/>}<span>{busy?"Publishing…":draft.canRecover||draft.status==="interrupted"?"Continue publishing":future?"Available later":"Publish post"}</span></button>:<button className="secondary" disabled={busy} onClick={()=>checkStatus(draft.id)}><RefreshCw size={14} className={busy?"spin":""}/>{busy?"Checking…":"Check status"}</button>}{!["published","publishing","processing","review"].includes(draft.status)&&<button className="icon-button delete-post" disabled={Boolean(workingId)} aria-label={`Delete ${draft.fileName}`} onClick={()=>remove(draft.id)}><Trash2 size={16}/></button>}</div></div>{active&&<Progress compact progress={draft.progress??0} label={draft.stage||"Checking the saved publishing status"}/>} {draft.publishError&&<div className="post-error"><CircleAlert size={14}/><span>{draft.publishError}</span></div>}</article>;
}
