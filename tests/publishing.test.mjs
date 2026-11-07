import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePublishState,isActivePublish,uploadRange,normalizedMessage,videoReady} from '../lib/publish-state.ts';
import {facebookRequest,FacebookRequestError} from '../lib/facebook-api.ts';

test('legacy and interrupted uploads are recoverable; a recent live attempt stays locked',()=>{
  const now=Date.now();
  const state={attemptId:'attempt',startedAt:new Date(now-3000).toISOString(),updatedAt:new Date(now-1000).toISOString(),phase:'uploading',progress:35,stage:'Uploading'};
  assert.equal(isActivePublish(parsePublishState(null),now),false);
  assert.equal(isActivePublish(parsePublishState(JSON.stringify(state)),now),true);
  assert.equal(isActivePublish({...state,updatedAt:new Date(now-91_000).toISOString()},now),false);
  assert.equal(isActivePublish({...state,phase:'processing'},now),false);
  assert.equal(isActivePublish({...state,updatedAt:new Date(now+1000).toISOString()},now),false);
  assert.equal(parsePublishState('{broken'),null);
});
test('upload ranges follow Facebook’s acknowledged offset and reject empty or out of bounds chunks',()=>{
  assert.deepEqual(uploadRange(256,512,1024),{start:256,end:512});
  assert.deepEqual(uploadRange(1024,1024,1024),{start:1024,end:1024});
  for(const [a,b] of [[0,0],[512,256],[-1,256],[0,1025],[0,undefined],[0.5,20]])assert.throws(()=>uploadRange(a,b,1024));
});
test('processing is not reported as a published video',()=>{
  assert.equal(videoReady({video_status:'processing'},true),false);
  assert.equal(videoReady({video_status:'ready'},false),false);
  assert.equal(videoReady({video_status:'ready'},true),true);
  assert.equal(normalizedMessage(' Biloo\r\nComing soon.\r\n'),'Biloo\nComing soon.');
});
test('Facebook errors are explicit failures and credentials remain in the authorization header',async()=>{
  const previous=globalThis.fetch;
  globalThis.fetch=async(url,options)=>{
    assert.equal(String(url).includes('access_token'),false);
    assert.equal(options.headers.Authorization,'Bearer private-test-token');
    return Response.json({error:{message:'Page publishing permission is missing.',code:200}},{status:400});
  };
  try{await assert.rejects(facebookRequest('https://graph.facebook.com/v26.0/page/feed','private-test-token',new FormData()),error=>error instanceof FacebookRequestError&&!error.uncertain&&error.code===200);}
  finally{globalThis.fetch=previous;}
});
test('a lost response is treated as uncertain so the app checks Facebook before retrying',async()=>{
  const previous=globalThis.fetch;
  globalThis.fetch=async()=>{throw new DOMException('Timed out','TimeoutError');};
  try{await assert.rejects(facebookRequest('https://graph.facebook.com/v26.0/page/feed','private-test-token',new FormData()),error=>error instanceof FacebookRequestError&&error.uncertain);}
  finally{globalThis.fetch=previous;}
});
