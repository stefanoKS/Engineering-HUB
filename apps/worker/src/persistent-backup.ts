/** A durable local artifact is committed before remote I/O. Retry uses the same job artifact. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createBackupArtifact, decrypt, parseEncryptionKey, type BackupArtifact } from './backup';
import type { WorkerConfig } from './config';
import type { DriveTransport } from './transports';
import type { Database } from '@eh/db';
type Manifest={fileName:string;plainChecksum:string;encryptedChecksum:string;keyId:string;createdAt:string;driveFileId?:string};
export async function persistentBackup(db:Database,config:WorkerConfig,drive:DriveTransport,jobId:string,create=createBackupArtifact){
 const key=parseEncryptionKey(config.BACKUP_ENCRYPTION_KEY??'');
 if(config.DRIVE_BACKUP_FOLDER_ID&&config.BACKUP_INSTANCE_ID==='local')throw new Error('Set a unique BACKUP_INSTANCE_ID before enabling Drive uploads');
 const id='BAK-'+createHash('sha256').update(config.BACKUP_INSTANCE_ID+':'+jobId).digest('hex').slice(0,32);
 const directory=resolve(config.BACKUP_DIRECTORY);await mkdir(directory,{recursive:true,mode:0o700});
 const manifestPath=join(directory,id+'.json');const artifactPath=join(directory,id+'.dump.enc');
 let manifest:Manifest;
 try {manifest=JSON.parse(await readFile(manifestPath,'utf8')) as Manifest;}
 catch(error){
  if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
  const artifact:BackupArtifact=await create({pgDumpPath:config.PG_DUMP_PATH,connection:config.database,encryptionKey:key});
  // Authenticity/decryption is checked before a manifest can declare this backup usable.
  if(createHash('sha256').update(decrypt(artifact.encrypted,key)).digest('hex')!==artifact.plainChecksum)throw new Error('Backup verification failed');
  manifest={fileName:id+'.dump.enc',plainChecksum:artifact.plainChecksum,encryptedChecksum:artifact.encryptedChecksum,keyId:artifact.keyId,createdAt:artifact.createdAt};
  await writeFile(artifactPath+'.tmp',artifact.encrypted,{mode:0o600});await rename(artifactPath+'.tmp',artifactPath);
  await writeFile(manifestPath+'.tmp',JSON.stringify(manifest),{mode:0o600});await rename(manifestPath+'.tmp',manifestPath);
 }
 const content=await readFile(artifactPath);
 if(createHash('sha256').update(content).digest('hex')!==manifest.encryptedChecksum)throw new Error('Stored backup checksum mismatch');
 let uploadError='';
 if(config.DRIVE_BACKUP_FOLDER_ID&&!manifest.driveFileId){
  try{
   if(!drive.configured)throw new Error('DRIVE_NOT_CONFIGURED');
   const existing=await drive.findBackup?.(config.DRIVE_BACKUP_FOLDER_ID,id);
   const uploaded=existing??await drive.upload({name:manifest.fileName,content,mimeType:'application/octet-stream',folderId:config.DRIVE_BACKUP_FOLDER_ID,appProperties:{backupId:id,plainChecksum:manifest.plainChecksum,keyId:manifest.keyId}});
   manifest.driveFileId=uploaded.fileId;
   await writeFile(manifestPath+'.tmp',JSON.stringify(manifest),{mode:0o600});await rename(manifestPath+'.tmp',manifestPath);
  }catch(error){uploadError=(error as Error).message.slice(0,500);}
 }
 const schema=await db.one<{version:number}>('SELECT COALESCE(max(version),0) AS version FROM schema_migrations');
 await db.query(
  "INSERT INTO backup_log(backup_id,schema_version,backup_reference,result,checksum,size_bytes,manifest,error_details) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(backup_id) DO UPDATE SET backup_reference=EXCLUDED.backup_reference,result=EXCLUDED.result,manifest=EXCLUDED.manifest,error_details=EXCLUDED.error_details",
  [id,schema?.version??0,manifest.driveFileId??artifactPath,uploadError?'FAILED':'OK',manifest.encryptedChecksum,content.length,JSON.stringify({...manifest,localSaved:true,remoteConfigured:!!config.DRIVE_BACKUP_FOLDER_ID}),uploadError]);
 if(uploadError)throw new Error('Local backup saved; Drive upload pending: '+uploadError);
 return {backupId:id,localFile:artifactPath,driveFileId:manifest.driveFileId??null};
}
