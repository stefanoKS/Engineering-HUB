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
