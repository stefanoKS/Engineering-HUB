/** Foreground supervisor; suitable for a Windows Task Scheduler startup task. */
import {parseEnv} from 'node:util';
import {spawn} from 'node:child_process';
import {mkdir,writeFile,unlink,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const state=resolve(root,'data/lan/host.pid');await mkdir(dirname(state),{recursive:true});
try{const old=Number(await readFile(state,'utf8'));try{process.kill(old,0);throw new Error('LAN host already running; stop it before starting another instance');}catch(error){if(error.code!=='ESRCH')throw error;await unlink(state);}}catch(error){if(error.code!=='ENOENT')throw error;}
const cleanEnv={...process.env};for(const key of ['DATABASE_URL','AUTH_MODE','GOOGLE_SERVICE_ACCOUNT_JSON','BACKUP_ENCRYPTION_KEY','DEV_AUTH_ENABLED','NODE_ENV','APP_ENV','PORT','HOST','PUBLIC_ORIGIN'])delete cleanEnv[key];
for(const key of Object.keys(cleanEnv))if(/^(GOOGLE_|BACKUP_|GMAIL_|CALENDAR_|EXPORT_|REQUEST_INBOX_)/.test(key))delete cleanEnv[key];
const children=[];let stopping=false;
function stop(){stopping=true;for(const child of children)child.kill('SIGTERM');}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
await writeFile(state,String(process.pid),{mode:0o600,flag:'wx'});
try{
 const specs=await Promise.all([['api.env','apps/api/dist/main.js'],['worker.env','apps/worker/dist/main.js']].map(async([envFile,entry])=>({entry,configured:parseEnv(await readFile(resolve(root,'data/lan',envFile),'utf8'))})));
 for(const {entry,configured} of specs){
  const child=spawn(process.execPath,[resolve(root,entry)],{cwd:root,env:{...cleanEnv,...configured},windowsHide:true,stdio:'inherit'});
  children.push(child);child.on('error',error=>{console.error(error.message);stop();});child.on('exit',code=>{if(!stopping){console.error(entry+' stopped: '+code);process.exitCode=1;stop();}});
 }
 console.log('Engineering-HUB LAN host started. Keep this process running. Ctrl+C stops both services.');
 await Promise.all(children.map(child=>new Promise(resolve=>child.once('close',resolve))));
}finally{stop();await Promise.all(children.filter(child=>child.exitCode===null&&child.signalCode===null).map(child=>new Promise(resolve=>child.once('close',resolve))));await unlink(state).catch(()=>{});}
