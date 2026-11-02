import { useState } from 'react';
import { api, queryString } from '../api/client';
import { useQuery, queryCache } from '../state/cache';
import { useI18n } from '../i18n';
import { ErrorBox } from '../components/ui';
import { useSave } from '../components/forms';
export function PasswordScreen({required,onChanged,onCancel}:{required:boolean;onChanged:()=>void;onCancel:()=>void}) {
 const {t}=useI18n(); const [current,setCurrent]=useState(''),[password,setPassword]=useState(''),[repeat,setRepeat]=useState('');const save=useSave();
 return <main className="login-screen"><form className="login-card stack" onSubmit={e=>{e.preventDefault();if(password===repeat)void save.run(()=>api.post('/api/account/password',{currentPassword:current,password}),{onSuccess:onChanged});}}>
  <h2>{t('local.change')}</h2>{required&&<p>{t('local.required')}</p>}
  <label className="field"><span>{t('local.current')}</span><input type="password" autoComplete="current-password" value={current} onChange={e=>setCurrent(e.target.value)} required maxLength={128}/></label>
  <label className="field"><span>{t('local.newPassword')}</span><input type="password" autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} required minLength={12} maxLength={128}/></label>
  <label className="field"><span>{t('local.repeat')}</span><input type="password" autoComplete="new-password" value={repeat} onChange={e=>setRepeat(e.target.value)} required maxLength={128}/></label>
  <ErrorBox error={save.error}/><button className="button" disabled={save.state==='saving'||password!==repeat}>{t('local.change')}</button><button type="button" className="button secondary" onClick={onCancel}>{t(required?'nav.signOut':'action.cancel')}</button>
 </form></main>;
}
type Account={employeeId:string;memberId:string;name:string;role:string;active:boolean;mustChangePassword:boolean};
export function LocalAccountsScreen(){
 const freshKey=()=>typeof crypto.randomUUID==='function'?crypto.randomUUID():'account-'+Date.now()+'-'+Math.random().toString(36).slice(2);
 const [idempotencyKey,setIdempotencyKey]=useState(freshKey);
 const {t}=useI18n();const [page,setPage]=useState(1),[query,setQuery]=useState('');
 const [employeeId,setEmployeeId]=useState(''),[name,setName]=useState(''),[password,setPassword]=useState(''),[role,setRole]=useState('MEMBER'),[memberId,setMemberId]=useState('');
 const [reset,setReset]=useState<Account|null>(null),[confirmed,setConfirmed]=useState(false),[notice,setNotice]=useState('');const save=useSave();
 const list=useQuery<{items:Account[]}>('local-accounts'+queryString({page,query}),()=>api.get('/api/admin/accounts'+queryString({page,query})));
 return <div className="screen stack"><h2>{t('local.accounts')}</h2><ErrorBox error={list.error}/>
 <input aria-label={t('filter.query')} placeholder={t('filter.query')} value={query} onChange={e=>{setQuery(e.target.value);setPage(1);}}/>
 <table className="table"><thead><tr><th>{t('local.employeeId')}</th><th>{t('members.name')}</th><th>{t('members.role')}</th><th>{t('members.active')}</th><th>{t('column.actions')}</th></tr></thead><tbody>{list.data?.items.map(a=><tr key={a.memberId}><td>{a.employeeId}</td><td>{a.name}</td><td>{a.role}</td><td>{a.active?'ON':'OFF'}</td><td><button onClick={()=>{setReset(a);setPassword('');setConfirmed(false);setNotice('');}}>{t('local.reset')}</button></td></tr>)}</tbody></table>
 <div className="inline-actions"><button disabled={page===1} onClick={()=>setPage(page-1)}>{t('local.previous')}</button><span>{page}</span><button disabled={(list.data?.items.length??0)<25} onClick={()=>setPage(page+1)}>{t('local.next')}</button></div>
 <form className="card stack" onSubmit={e=>{e.preventDefault();void save.run(()=>reset?api.post('/api/admin/accounts/'+reset.memberId+'/reset-password',{password,confirmed}):api.post('/api/admin/accounts',{idempotencyKey,employeeId,name,password,role,...(memberId?{memberId}:{})}),{onSuccess:()=>{setIdempotencyKey(freshKey());setPassword('');setNotice(t('local.saved'));setReset(null);queryCache.invalidate(['local-accounts','members']);}});}}>
 <fieldset className="stack" disabled={save.state==='saving'||save.state==='unknown'}><h3>{reset?t('local.reset')+' · '+reset.employeeId:t('local.create')}</h3>
 {!reset&&<><label className="field"><span>{t('local.employeeId')}</span><input value={employeeId} onChange={e=>setEmployeeId(e.target.value)} required pattern="[A-Za-z0-9_-]{1,32}"/></label>
 <label className="field"><span>{t('members.name')}</span><input value={name} onChange={e=>setName(e.target.value)} required maxLength={200}/></label>
 <label className="field"><span>{t('members.role')}</span><select value={role} onChange={e=>setRole(e.target.value)}>{['ADMIN','MANAGER','MEMBER','VIEWER'].map(r=><option key={r}>{r}</option>)}</select></label>
 <label className="field"><span>{t('local.linkMember')}</span><input value={memberId} onChange={e=>setMemberId(e.target.value)}/></label></>}
 <label className="field"><span>{t('local.temporary')}</span><input type="password" autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} required minLength={12} maxLength={128}/></label>
 {reset&&<label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>{t('local.resetConfirm')}</label>}
 </fieldset><ErrorBox error={save.error}/>{notice&&<p role="status">{notice}</p>}<button className="button" disabled={save.state==='saving'||(!!reset&&!confirmed)}>{t('action.save')}</button>{reset&&<button type="button" onClick={()=>{setReset(null);setPassword('');}}>{t('action.cancel')}</button>}
 </form></div>;
}
