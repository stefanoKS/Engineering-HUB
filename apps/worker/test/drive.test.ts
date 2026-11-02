import {afterEach,it,expect,vi} from 'vitest';
const captured=vi.hoisted(()=>({subject:undefined as string|undefined,scopes:[] as string[]}));
vi.mock('google-auth-library',()=>({JWT:class{constructor(input:{subject?:string;scopes:string[]}){captured.subject=input.subject;captured.scopes=input.scopes;}async authorize(){return {access_token:'fixture'};}}}));
import {GoogleDriveTransport} from '../src/transports';
afterEach(()=>vi.unstubAllGlobals());
it('uses Shared Drive support and the optional approved delegated identity',async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({files:[]}))).mockResolvedValueOnce(new Response(JSON.stringify({id:'saved'})));
 vi.stubGlobal('fetch',fetcher);
 const drive=new GoogleDriveTransport({credentialsJson:JSON.stringify({client_email:'fixture@example.invalid',private_key:'fixture'}),delegatedUser:'backup@example.invalid'});
 expect(await drive.findBackup('folder','BAK-123abc')).toBeNull();
 expect((await drive.upload({name:'backup',content:Buffer.from('encrypted'),mimeType:'application/octet-stream',folderId:'folder'})).fileId).toBe('saved');
 expect(captured.subject).toBe('backup@example.invalid');expect(captured.scopes).toEqual(['https://www.googleapis.com/auth/drive.file']);
 expect(fetcher.mock.calls[0]![0]).toContain('includeItemsFromAllDrives=true');expect(fetcher.mock.calls[1]![0]).toContain('supportsAllDrives=true');
});
