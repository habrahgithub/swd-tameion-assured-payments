"use client";
import {useEffect,useRef,useState} from 'react';
import {CommandCenter} from './command-center';
type Session={csrf_token:string;expires_at:string};
type Balance={amount:string;asset:'USDC';captured_at:string;network:string};
/** Only verified metadata enables the view. Bearer stays in HttpOnly cookie. */
export function OperatorDashboard({fetcher=fetch}:{fetcher?:typeof fetch}){
 const [session,setSession]=useState<Session|null>(null),[message,setMessage]=useState('Checking operator session…'),[balance,setBalance]=useState<Balance|null>(null),[busy,setBusy]=useState(false);
 const generation=useRef(0),controller=useRef<AbortController|null>(null);
 useEffect(()=>{
  const current=++generation.current,abort=new AbortController();
  void fetcher('/api/operator/session',{cache:'no-store',credentials:'same-origin',signal:abort.signal}).then(async response=>{
   const value=await response.json();if(current!==generation.current)return;
   if(!response.ok||value.authenticated!==true||typeof value.csrf_token!=='string'||typeof value.expires_at!=='string'||!Number.isFinite(Date.parse(value.expires_at))||Date.parse(value.expires_at)<=Date.now()||Date.parse(value.expires_at)>Date.now()+3600000)throw new Error();
   setSession({csrf_token:value.csrf_token,expires_at:value.expires_at});setMessage('Balance not verified. Refresh manually.');
  }).catch(()=>{if(current===generation.current)setMessage('Session unavailable. Sign in or ask the platform owner to verify access.');});
  return()=>{++generation.current;abort.abort();controller.current?.abort();};
 },[fetcher]);
 useEffect(()=>{if(!session)return;const timer=setTimeout(()=>{++generation.current;controller.current?.abort();setSession(null);setBalance(null);setBusy(false);setMessage('Session expired. Sign in again.');},Math.max(0,Date.parse(session.expires_at)-Date.now()));return()=>clearTimeout(timer);},[session]);
 async function refresh(){
  if(!session||busy)return;const current=generation.current;controller.current?.abort();const abort=new AbortController();controller.current=abort;setBusy(true);setBalance(null);setMessage('Checking wallet balance…');
  try{const response=await fetcher('/api/wallet/balance/refresh',{method:'POST',cache:'no-store',credentials:'same-origin',signal:abort.signal,headers:{'Content-Type':'application/json','X-Tameion-CSRF':session.csrf_token},body:'{}'});const value=await response.json();if(current!==generation.current)return;
   if(response.status===401){++generation.current;setSession(null);setBusy(false);setMessage('Session expired or revoked. Sign in again.');throw new Error();}
   if(!response.ok||value.asset!=='USDC'||typeof value.amount!=='string'||!/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(value.amount)||typeof value.captured_at!=='string'||!Number.isFinite(Date.parse(value.captured_at))||value.verification!=='READ_ONLY_BALANCE')throw new Error();
   setBalance(value);setMessage('Read-only observation. This does not establish affordability, fees or payment readiness.');
  }catch{if(current===generation.current)setMessage('Balance not verified. No payment action was taken.');}finally{if(current===generation.current)setBusy(false);}
 }
 async function logout(){
  if(!session)return;const csrf=session.csrf_token;++generation.current;controller.current?.abort();setSession(null);setBalance(null);setBusy(false);setMessage('Logging out…');
  try{const response=await fetcher('/api/operator/logout',{method:'POST',cache:'no-store',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Tameion-CSRF':csrf},body:'{}'});const value=await response.json();setMessage(response.ok&&value.revoked===true?'Logged out.':'Logout unverified. Private view is disabled; server revocation could not be confirmed.');}catch{setMessage('Logout unverified. Private view is disabled; server revocation could not be confirmed.');}
 }
 if(!session)return <main className="mx-auto max-w-xl space-y-4 p-6"><h1 className="text-xl font-semibold">Tameion operator access</h1><p role="status">{message}</p><a className="underline" href="/operator/login">Sign in</a></main>;
 const controls=<details className="absolute right-4 top-1 z-30"><summary className="flex min-h-11 cursor-pointer items-center rounded border bg-[var(--color-surface)] px-3 text-sm">Operator</summary><section aria-label="Operator session and wallet balance" className="absolute right-0 top-full flex w-[min(360px,calc(100vw-32px))] flex-wrap items-center gap-2 rounded border bg-[var(--color-surface)] p-3 text-xs shadow-lg"><span>Operator session verified</span><button className="min-h-11 rounded border px-3" onClick={refresh} disabled={busy}>Refresh wallet balance</button><button className="min-h-11 rounded border px-3" onClick={logout}>Log out</button><details className="w-full"><summary>Wallet balance status</summary><p role="status">{message}</p>{balance&&<p>{balance.amount} USDC · {balance.network} · Observed {balance.captured_at}</p>}</details></section></details>;
 return <CommandCenter operatorControls={controls}/>;
}
