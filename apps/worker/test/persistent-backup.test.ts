import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';
import type {Database} from '@eh/db';import type pg from 'pg';
import {freshDatabase} from '../../../packages/db/test/support/db';
import {persistentBackup} from '../src/persistent-backup';import {encrypt,keyId} from '../src/backup';import {loadWorkerConfig} from '../src/config';
let db:Database,pool:pg.Pool,directory:string;
const key=Buffer.alloc(32,9);const plain=Buffer.from('fixture custom dump');
beforeEach(async()=>{const context=await freshDatabase();db=context.db;pool=context.pool;directory=await mkdtemp(join(tmpdir(),'eh-backup-test-'));});
afterEach(async()=>{await pool.end();await rm(directory,{recursive:true,force:true});});
function fixture(){const encrypted=encrypt(plain,key);return {fileName:'fixture.dump.enc',plainBytes:plain.length,encrypted,plainChecksum:createHash('sha256').update(plain).digest('hex'),encryptedChecksum:createHash('sha256').update(encrypted).digest('hex'),keyId:keyId(key),createdAt:new Date().toISOString()};}
it('retains one verified artifact after remote failure and resumes without dumping again',async()=>{
 const create=vi.fn(async()=>fixture());const upload=vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({fileId:'drive-file',webViewLink:''});
 const drive={configured:true,upload,listOld:async()=>[],remove:async()=>{}};
 const config=loadWorkerConfig({BACKUP_DIRECTORY:directory,BACKUP_ENCRYPTION_KEY:key.toString('base64'),DRIVE_BACKUP_FOLDER_ID:'folder',BACKUP_INSTANCE_ID:'test-instance'});
 await expect(persistentBackup(db,config,drive,'job-1',create)).rejects.toThrow(/Local backup saved/);
 expect((await readdir(directory)).filter(f=>f.endsWith('.dump.enc'))).toHaveLength(1);
 const result=await persistentBackup(db,config,drive,'job-1',create);expect(result.driveFileId).toBe('drive-file');expect(create).toHaveBeenCalledTimes(1);
 await persistentBackup(db,config,drive,'job-1',create);expect(upload).toHaveBeenCalledTimes(2);
 expect((await db.one<{result:string}>('SELECT result FROM backup_log'))?.result).toBe('OK');
 await writeFile(result.localFile,'corrupt');await expect(persistentBackup(db,config,drive,'job-1',create)).rejects.toThrow(/checksum/);
});
it('saves encrypted backups without any Google configuration',async()=>{
 const config=loadWorkerConfig({BACKUP_DIRECTORY:directory,BACKUP_ENCRYPTION_KEY:key.toString('base64')});const upload=vi.fn();
 const result=await persistentBackup(db,config,{configured:false,upload,listOld:async()=>[],remove:async()=>{}},'local',async()=>fixture());
 expect((await readFile(result.localFile)).subarray(0,6).toString()).toBe('EHBAK1');expect(upload).not.toHaveBeenCalled();expect(result.driveFileId).toBeNull();
});

it('keeps the local backup and reports the reason when the Drive folder is refused',async()=>{
 const create=vi.fn(async()=>fixture());const upload=vi.fn();
 const drive={configured:true,verifyFolder:async()=>{throw new Error('Drive permission denied (403). Share the backup folder with the service account as Editor.');},upload,listOld:async()=>[],remove:async()=>{}};
 const config=loadWorkerConfig({BACKUP_DIRECTORY:directory,BACKUP_ENCRYPTION_KEY:key.toString('base64'),DRIVE_BACKUP_FOLDER_ID:'folder',BACKUP_INSTANCE_ID:'test-instance'});
 await expect(persistentBackup(db,config,drive,'job-refused',create)).rejects.toThrow(/Drive permission denied/);
 expect((await readdir(directory)).filter(f=>f.endsWith('.dump.enc'))).toHaveLength(1);
 expect(upload).not.toHaveBeenCalled();
 const row=await db.one<{result:string;error_details:string}>('SELECT result,error_details FROM backup_log');
 expect(row?.result).toBe('FAILED');expect(row?.error_details).toContain('permission denied');
});

it('never uploads twice when the artifact already exists in Drive',async()=>{
 const create=vi.fn(async()=>fixture());const upload=vi.fn();
 const drive={configured:true,verifyFolder:async()=>({folderId:'folder',name:'Backups'}),findBackup:async()=>({fileId:'existing',webViewLink:''}),upload,listOld:async()=>[],remove:async()=>{}};
 const config=loadWorkerConfig({BACKUP_DIRECTORY:directory,BACKUP_ENCRYPTION_KEY:key.toString('base64'),DRIVE_BACKUP_FOLDER_ID:'folder',BACKUP_INSTANCE_ID:'test-instance'});
 const first=await persistentBackup(db,config,drive,'job-duplicate',create);
 expect(first.driveFileId).toBe('existing');
 expect(upload).not.toHaveBeenCalled();
 // A later run of the same job finds the recorded file ID and performs no remote call at all.
 await persistentBackup(db,config,drive,'job-duplicate',create);
 expect(upload).not.toHaveBeenCalled();
 expect(create).toHaveBeenCalledTimes(1);
 const manifest=JSON.parse(await readFile(join(directory,'BAK-'+createHash('sha256').update('test-instance:job-duplicate').digest('hex').slice(0,32)+'.json'),'utf8')) as {driveFileId:string};
 expect(manifest.driveFileId).toBe('existing');
});
