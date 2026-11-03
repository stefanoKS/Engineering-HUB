import pg from 'pg';
import { Database } from '../packages/db/src/index.ts';
import { buildOverview, directory, taskScope } from '../apps/api/src/services/views.ts';
import { businessDate } from '../packages/domain/src/index.ts';
process.loadEnvFile('data/lan/api.env');
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:'-c default_transaction_read_only=on',max:3});
const db=new Database(pool);
const ctx={db,cache:new Map(),today:businessDate()};
try { for(const [name,load] of [['directory',()=>directory(ctx)],['scope',()=>taskScope(ctx)],['overview',()=>buildOverview(ctx,{})]] as const){try{await load();console.log(name+': PASS');}catch(error){console.log(name+': '+(error as Error).stack);break;}} } finally {await db.close();}
