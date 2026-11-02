/** Explicit, one-time server-console bootstrap. JSON arrives on stdin, never argv. */
import { z } from 'zod';
import { createPool, Database, toDatabaseConfig, newId } from '@eh/db';
import { EmployeeId, Password } from './auth/local';
import { hashPassword } from './auth/password';
async function main(){
 if(process.env.AUTH_MODE!=='local')throw new Error('AUTH_MODE=local required');
 let input=''; for await(const chunk of process.stdin){input+=String(chunk);if(input.length>4096)throw new Error('Input too large');}
 const body=z.object({employeeId:EmployeeId,name:z.string().trim().min(1).max(200),password:Password}).strict().parse(JSON.parse(input));
 const hash=await hashPassword(body.password);
 const db=new Database(createPool(toDatabaseConfig(process.env)));
 try{await db.transaction(async tx=>{
  await tx.advisoryLock('members:role-and-activation');
  const existing=await tx.one('SELECT member_id FROM local_accounts LIMIT 1');
  if(existing)throw new Error('Bootstrap refused: local accounts already exist');
  const id=newId('MEM');
  await tx.query("INSERT INTO members(member_id,name,role) VALUES($1,$2,'ADMIN')",[id,body.name]);
  await tx.query('INSERT INTO local_accounts(member_id,employee_id,password_hash) VALUES($1,$2,$3)',[id,body.employeeId,hash]);
  await tx.query("INSERT INTO audit_log(entity_type,entity_id,action,actor_email) VALUES('MEMBER',$1,'INITIAL_LOCAL_ADMIN_CREATED','server-operator')",[id]);
 });process.stdout.write('Administrator created. Change the temporary password at first login.\n');}finally{await db.close();}
}
main().catch(()=>{process.stderr.write('Bootstrap failed. Check input, database migration and whether an account already exists.\n');process.exitCode=1;});
