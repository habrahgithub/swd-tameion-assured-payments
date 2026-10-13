"use client";
import {useEffect,useRef,useState} from 'react';
import {CommandCenter} from './command-center';
import {OperatorAccessCard,OperatorAccessShell} from './operator-access-ui';
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
   if(response.status===401){setMessage('Sign-in required. Use your approved finance account to continue.');return;}
   if(response.status===403){setMessage('Access could not be verified from this location. Use the approved workspace address or ask the platform owner to verify access.');return;}
   if(!response.ok||value.authenticated!==true||typeof value.csrf_token!=='string'||typeof value.expires_at!=='string'||!Number.isFinite(Date.parse(value.expires_at))||Date.parse(value.expires_at)<=Date.now()||Date.parse(value.expires_at)>Date.now()+3600000)throw new Error();
   const verifiedSession={csrf_token:value.csrf_token,expires_at:value.expires_at};setSession(verifiedSession);
   const loginRefresh=typeof window!=='undefined'&&new URLSearchParams(window.location.search).get('refresh_balance')==='1';
   if(loginRefresh){const url=new URL(window.location.href);url.searchParams.delete('refresh_balance');window.history.replaceState(null,'',`${url.pathname}${url.search}${url.hash}`);void refresh(verifiedSession);}
   else setMessage('Balance not verified. Refresh manually.');
  }).catch(()=>{if(current===generation.current)setMessage('Access service unavailable. Ask the platform owner to verify access.');});
  return()=>{++generation.current;abort.abort();controller.current?.abort();};
 },[fetcher]);
 useEffect(()=>{if(!session)return;const timer=setTimeout(()=>{++generation.current;controller.current?.abort();setSession(null);setBalance(null);setBusy(false);setMessage('Session expired. Sign in again.');},Math.max(0,Date.parse(session.expires_at)-Date.now()));return()=>clearTimeout(timer);},[session]);
 async function refresh(activeSession=session){
  if(!activeSession||busy)return;const current=generation.current;controller.current?.abort();const abort=new AbortController();controller.current=abort;setBusy(true);setBalance(null);setMessage('Checking wallet balance…');
  try{const response=await fetcher('/api/wallet/balance/refresh',{method:'POST',cache:'no-store',credentials:'same-origin',signal:abort.signal,headers:{'Content-Type':'application/json','X-Tameion-CSRF':activeSession.csrf_token},body:'{}'});const value=await response.json();if(current!==generation.current)return;
   if(response.status===401){++generation.current;setSession(null);setBusy(false);setMessage('Session expired or revoked. Sign in again.');throw new Error();}
   if(!response.ok||value.asset!=='USDC'||typeof value.amount!=='string'||!/^(0|[1-9]\d*)(\.\d{1,18})?$/.test(value.amount)||typeof value.captured_at!=='string'||!Number.isFinite(Date.parse(value.captured_at))||value.verification!=='READ_ONLY_BALANCE')throw new Error();
   setBalance(value);setMessage('Read-only observation. This does not establish affordability, fees or payment readiness.');
  }catch{if(current===generation.current)setMessage('Balance not verified. No payment action was taken.');}finally{if(current===generation.current)setBusy(false);}
 }
 async function logout(){
  if(!session)return;const csrf=session.csrf_token;++generation.current;controller.current?.abort();setSession(null);setBalance(null);setBusy(false);setMessage('Logging out…');
  try{const response=await fetcher('/api/operator/logout',{method:'POST',cache:'no-store',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Tameion-CSRF':csrf},body:'{}'});const value=await response.json();setMessage(response.ok&&value.revoked===true?'Logged out.':'Logout unverified. Private view is disabled; server revocation could not be confirmed.');}catch{setMessage('Logout unverified. Private view is disabled; server revocation could not be confirmed.');}
 }
 if(!session)return <OperatorAccessShell eyebrow="Private finance workspace" title="Review payment obligations securely" description="Review business obligations and check the current Arc Testnet USDC settlement balance from one protected workspace." boundary="Signing in allows private financial review. Every payment still requires separate approval before release.">
  <OperatorAccessCard heading="Continue to the payment workspace" description="Sign in with your approved finance account.">
   <p role="status" className="mt-4 text-sm leading-6 text-[var(--color-ink-muted)]">{message}</p>
   <a className="mt-5 flex min-h-11 w-full items-center justify-center rounded bg-[var(--color-ink)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ink)]" href="/operator/login">Sign in securely</a>
  </OperatorAccessCard>
 </OperatorAccessShell>;
 const controls=<details className="absolute right-4 top-1 z-30"><summary className="flex min-h-11 cursor-pointer items-center rounded border bg-[var(--color-surface)] px-3 text-sm">Operator</summary><section aria-label="Operator session" className="absolute right-0 top-full flex w-[min(300px,calc(100vw-32px))] flex-wrap items-center gap-2 rounded border bg-[var(--color-surface)] p-3 text-xs shadow-lg"><span>Operator session verified</span><button className="min-h-11 rounded border px-3" onClick={logout}>Log out</button></section></details>;
 const walletSummary=<section aria-label="Read-only wallet balance" className="flex flex-wrap items-center justify-between gap-3 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
  <div className="min-w-0 flex-1 basis-full sm:basis-0"><h2 className="text-sm font-semibold">Wallet balance status</h2>
   {balance&&<p className="tabular text-base font-semibold">{balance.amount} USDC · {balance.network}<span className="block text-xs font-normal">Observed <time dateTime={balance.captured_at}>{balance.captured_at}</time></span></p>}
   <p role="status" className="text-xs text-[var(--color-ink-muted)]">{message}</p>
  </div>
  <button className="min-h-11 rounded border px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2" onClick={()=>void refresh()} disabled={busy}>Refresh wallet balance</button>
 </section>;
 return <CommandCenter operatorControls={controls} walletSummary={walletSummary} walletBalance={balance??undefined}/>;
}
