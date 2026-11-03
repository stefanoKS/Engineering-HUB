import {afterEach,it,expect,vi} from 'vitest';
const captured=vi.hoisted(()=>({subject:undefined as string|undefined,scopes:[] as string[]}));
vi.mock('google-auth-library',()=>({JWT:class{constructor(input:{subject?:string;scopes:string[]}){captured.subject=input.subject;captured.scopes=input.scopes;}async authorize(){return {access_token:'fixture'};}}}));
import {GoogleDriveTransport} from '../src/transports';
const credentials=JSON.stringify({client_email:'fixture@example.invalid',private_key:'fixture'});
afterEach(()=>vi.unstubAllGlobals());

it('verifies the destination folder and uses Shared Drive support with the delegated identity',async()=>{
 const fetcher=vi.fn()
  .mockResolvedValueOnce(new Response(JSON.stringify({id:'folder',name:'Backups',mimeType:'application/vnd.google-apps.folder'})))
  .mockResolvedValueOnce(new Response(null,{status:200,headers:{location:'https://upload.example/session'}}))
  .mockResolvedValueOnce(new Response(JSON.stringify({id:'saved',webViewLink:'https://drive.example/saved'})));
 vi.stubGlobal('fetch',fetcher);
 const drive=new GoogleDriveTransport({credentialsJson:credentials,delegatedUser:'backup@example.invalid'});
 expect(await drive.verifyFolder('folder')).toEqual({folderId:'folder',name:'Backups'});
 const uploaded=await drive.upload({name:'backup',content:Buffer.from('encrypted'),mimeType:'application/octet-stream',folderId:'folder'});
 expect(uploaded).toEqual({fileId:'saved',webViewLink:'https://drive.example/saved'});
 expect(captured.subject).toBe('backup@example.invalid');
 expect(captured.scopes).toEqual(['https://www.googleapis.com/auth/drive.file']);
 expect(fetcher.mock.calls[0]![0]).toContain('fields=id,name,mimeType');
 expect(fetcher.mock.calls[1]![0]).toContain('uploadType=resumable');
 expect((fetcher.mock.calls[2]![1] as {headers:Record<string,string>}).headers['Content-Range']).toBe('bytes 0-8/9');
});

it('sends a large backup in chunks and resumes an interrupted chunk instead of restarting',async()=>{
 const fetcher=vi.fn()
  .mockResolvedValueOnce(new Response(null,{status:200,headers:{location:'https://upload.example/session'}}))
  .mockResolvedValueOnce(new Response(null,{status:308,headers:{range:'bytes=0-262143'}}))
  .mockResolvedValueOnce(new Response(JSON.stringify({id:'saved'})));
 vi.stubGlobal('fetch',fetcher);
 const drive=new GoogleDriveTransport({credentialsJson:credentials,chunkBytes:256*1024,attempts:2});
 const content=Buffer.alloc(300*1024,7);
 const uploaded=await drive.upload({name:'big',content,mimeType:'application/octet-stream',folderId:'folder'});
 expect(uploaded.fileId).toBe('saved');
 const ranges=fetcher.mock.calls.slice(1).map(call=>(call[1] as {headers:Record<string,string>}).headers['Content-Range']);
 // The second chunk starts where the session reported, never from byte zero again.
 expect(ranges).toEqual(['bytes 0-262143/307200','bytes 262144-307199/307200']);
});

it('retries a failed chunk after asking the session how far it got',async()=>{
 const fetcher=vi.fn()
  .mockResolvedValueOnce(new Response(null,{status:200,headers:{location:'https://upload.example/session'}}))
  .mockRejectedValueOnce(new Error('socket hang up'))
  .mockResolvedValueOnce(new Response(null,{status:308,headers:{range:'bytes=0-1'}}))
  .mockResolvedValueOnce(new Response(JSON.stringify({id:'saved'})));
 vi.stubGlobal('fetch',fetcher);
 const drive=new GoogleDriveTransport({credentialsJson:credentials,attempts:3});
 const uploaded=await drive.upload({name:'retry',content:Buffer.from('abcd'),mimeType:'application/octet-stream',folderId:'folder'});
 expect(uploaded.fileId).toBe('saved');
 const status=(fetcher.mock.calls[2]![1] as {headers:Record<string,string>}).headers['Content-Range'];
 expect(status).toBe('bytes */4');
 const resumed=(fetcher.mock.calls[3]![1] as {headers:Record<string,string>}).headers['Content-Range'];
 expect(resumed).toBe('bytes 2-3/4');
});

it('reports a readable permission error for a folder the service account cannot use',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response('forbidden',{status:403})));
 const drive=new GoogleDriveTransport({credentialsJson:credentials});
 await expect(drive.verifyFolder('folder')).rejects.toThrow(/permission denied \(403\)/);
 await expect(drive.verifyFolder('folder')).rejects.toThrow(/Share the backup folder/);
});

it('refuses a destination that is not a folder',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({id:'file',mimeType:'application/octet-stream'}))));
 const drive=new GoogleDriveTransport({credentialsJson:credentials});
 await expect(drive.verifyFolder('folder')).rejects.toThrow(/not a folder/);
});

it('does not skip bytes when Drive returns 308 without a Range', async () => {
 const fetcher=vi.fn()
  .mockResolvedValueOnce(new Response(null,{headers:{location:'https://upload.example/session'}}))
  .mockResolvedValueOnce(new Response(null,{status:308}))
  .mockResolvedValueOnce(new Response(JSON.stringify({id:'saved'})));
 vi.stubGlobal('fetch',fetcher);
 await new GoogleDriveTransport({credentialsJson:credentials}).upload({name:'retry',content:Buffer.from('abcd'),mimeType:'application/octet-stream',folderId:'folder'});
 expect(fetcher.mock.calls.slice(1).map(call=>call[1].headers['Content-Range'])).toEqual(['bytes 0-3/4','bytes 0-3/4']);
});

it('resumes a persisted session after a worker restart', async () => {
 const fetcher=vi.fn()
  .mockResolvedValueOnce(new Response(null,{status:308,headers:{range:'bytes=0-262143'}}))
  .mockResolvedValueOnce(new Response(JSON.stringify({id:'saved'})));
 vi.stubGlobal('fetch',fetcher);
 const saved=vi.fn();
 await new GoogleDriveTransport({credentialsJson:credentials}).upload({name:'resume',content:Buffer.alloc(300*1024),mimeType:'application/octet-stream',folderId:'folder',resumeSession:'https://upload.example/session',saveSession:saved});
 expect(fetcher.mock.calls.map(call=>call[1].headers['Content-Range'])).toEqual(['bytes */307200','bytes 262144-307199/307200']);
 expect(saved).not.toHaveBeenCalled();
});

it('rejects a readable folder without upload permission',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({id:'folder',mimeType:'application/vnd.google-apps.folder',capabilities:{canAddChildren:false}}))));
 await expect(new GoogleDriveTransport({credentialsJson:credentials}).verifyFolder('folder')).rejects.toThrow(/cannot add files/);
});

it('reserves a file identity before starting an upload and reuses it after a lost completion',async()=>{
 const fetcher=vi.fn()
  .mockResolvedValueOnce(new Response(JSON.stringify({ids:['reserved']})))
  .mockResolvedValueOnce(new Response(null,{headers:{location:'https://upload.example/session'}}))
  .mockResolvedValueOnce(new Response(JSON.stringify({id:'reserved'})));
 vi.stubGlobal('fetch',fetcher);
 const saveFileId=vi.fn(async()=>undefined);
 const input={name:'backup',content:Buffer.from('abcd'),mimeType:'application/octet-stream',folderId:'folder'};
 await new GoogleDriveTransport({credentialsJson:credentials}).upload({...input,saveFileId});
 expect(saveFileId).toHaveBeenCalledWith('reserved');
 expect(JSON.parse(fetcher.mock.calls[1]![1].body).id).toBe('reserved');
 const retry=vi.fn()
  .mockResolvedValueOnce(new Response('exists',{status:409}))
  .mockResolvedValueOnce(new Response(JSON.stringify({id:'reserved',size:'4'})));
 vi.stubGlobal('fetch',retry);
 expect((await new GoogleDriveTransport({credentialsJson:credentials}).upload({...input,resumeFileId:'reserved',saveFileId})).fileId).toBe('reserved');
 expect(saveFileId).toHaveBeenCalledTimes(1);
 expect(JSON.parse(retry.mock.calls[0]![1].body).id).toBe('reserved');
});

it('uploads a backup larger than the default 8 MiB chunk',async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(new Response(null,{headers:{location:'https://upload.example/session'}}))
  .mockResolvedValueOnce(new Response(null,{status:308,headers:{range:'bytes=0-8388607'}}))
  .mockResolvedValueOnce(new Response(JSON.stringify({id:'large'})));
 vi.stubGlobal('fetch',fetcher);
 const result=await new GoogleDriveTransport({credentialsJson:credentials}).upload({name:'large',content:Buffer.alloc(9*1024*1024),mimeType:'application/octet-stream',folderId:'folder'});
 expect(result.fileId).toBe('large');
 expect(fetcher.mock.calls.slice(1).map(call=>call[1].headers['Content-Range'])).toEqual(['bytes 0-8388607/9437184','bytes 8388608-9437183/9437184']);
});

it('restarts an expired session with the same reserved file ID',async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(new Response('expired',{status:404}))
  .mockResolvedValueOnce(new Response(null,{headers:{location:'https://upload.example/new-session'}}))
  .mockResolvedValueOnce(new Response(JSON.stringify({id:'reserved'})));
 vi.stubGlobal('fetch',fetcher);
 const saveSession=vi.fn(async()=>undefined);
 await new GoogleDriveTransport({credentialsJson:credentials}).upload({name:'backup',content:Buffer.from('abcd'),mimeType:'application/octet-stream',folderId:'folder',resumeFileId:'reserved',resumeSession:'https://upload.example/expired',saveSession});
 expect(JSON.parse(fetcher.mock.calls[1]![1].body).id).toBe('reserved');
 expect(saveSession).toHaveBeenCalledWith('https://upload.example/new-session');
});
