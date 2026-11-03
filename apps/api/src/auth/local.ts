/** Local identities use server-held password hashes, never claimed browser roles. */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { DomainError, effectiveRole } from '@eh/domain';
import { newToken, createSession, type Database } from '@eh/db';
import { dummyPassword, hashPassword, verifyPassword } from './password';
export const EmployeeId = z.string().regex(/^[A-Za-z0-9_-]{1,32}$/);
export const Password = z.string().min(4).max(128);
export async function localLogin(db: Database, employeeId: string, password: string, ttl: number, userAgent: string) {
 const found = await db.one<{ member_id: string; password_hash: string }>('SELECT member_id, password_hash FROM local_accounts WHERE employee_id=$1', [employeeId]);
 const matches = await verifyPassword(password, found?.password_hash ?? await dummyPassword);
 const result = await db.transaction(async tx => {
  if (!found) return null;
  const row = await tx.one<{ member_id: string; name: string; email: string | null; role: string; active: boolean; password_hash: string; password_version: number; must_change_password: boolean; locked_until: string | null }>(
   'SELECT a.*, m.name, m.email, m.role, m.active FROM local_accounts a JOIN members m USING(member_id) WHERE a.member_id=$1 FOR UPDATE OF a, m', [found.member_id]);
  if (!row || !row.active || (row.locked_until && new Date(row.locked_until).getTime() > Date.now())) return null;
  if (!matches || row.password_hash !== found.password_hash) {
   await tx.query("UPDATE local_accounts SET failed_attempts=failed_attempts+1, locked_until=CASE WHEN failed_attempts+1 >= 5 THEN now()+interval '15 minutes' ELSE NULL END WHERE member_id=$1", [row.member_id]);
   return null;
  }
  await tx.query('UPDATE local_accounts SET failed_attempts=0, locked_until=NULL WHERE member_id=$1', [row.member_id]);
  const token=newToken(), csrfToken=newToken(), expiresAt=new Date(Date.now()+ttl*60000);
  const tokenHash=createHash('sha256').update(token).digest('hex');
  await createSession(tx, { tokenHash, memberId:row.member_id, csrfToken, expiresAt, userAgentHash:createHash('sha256').update(userAgent).digest('hex') });
  await tx.query('UPDATE sessions SET local_password_version=$2 WHERE token_hash=$1', [tokenHash,row.password_version]);
  return { token, csrfToken, expiresAt:expiresAt.toISOString(), mustChangePassword:row.must_change_password,
   identity:{memberId:row.member_id,name:row.name,email:row.email ?? '',role:effectiveRole(row.role),active:true,verified:true} };
 });
 if (!result) throw new DomainError('UNAUTHENTICATED','Invalid employee ID or password, or account temporarily locked');
 return result;
}
export async function changePassword(db: Database, memberId: string, currentPassword: string, password: string) {
 const hash=await hashPassword(password);
 await db.transaction(async tx => {
  const account=await tx.one<{password_hash:string}>('SELECT password_hash FROM local_accounts WHERE member_id=$1 FOR UPDATE',[memberId]);
  if (!account || !await verifyPassword(currentPassword,account.password_hash)) throw new DomainError('VALIDATION_FAILED','Current password is incorrect');
  if (await verifyPassword(password,account.password_hash)) throw new DomainError('VALIDATION_FAILED','Choose a different password');
  await tx.query('UPDATE local_accounts SET password_hash=$2, must_change_password=false, password_version=password_version+1, failed_attempts=0, locked_until=NULL, updated_at=now() WHERE member_id=$1',[memberId,hash]);
  await tx.query('UPDATE sessions SET revoked_at=now() WHERE member_id=$1 AND revoked_at IS NULL',[memberId]);
  await tx.query("INSERT INTO audit_log(entity_type,entity_id,action,actor_member_id,actor_email) VALUES ('MEMBER',$1,'PASSWORD_CHANGED',$1,'')",[memberId]);
 });
}
