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
 if(!session)return <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-5 py-6 sm:px-8 sm:py-8">
  <header className="border-b border-[var(--color-border)] pb-4">
   <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--color-ink-muted)]">Tameion</p>
   <p className="mt-1 text-base font-semibold text-[var(--color-ink)]">Assured Payment — Command Center</p>
  </header>
  <section className="grid flex-1 items-center gap-8 py-10 lg:grid-cols-[minmax(0,1fr)_23rem] lg:gap-16">
   <div className="max-w-xl">
    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-ink-muted)]">Protected workspace</p>
    <h1 className="mt-2 text-3xl font-semibold tracking-[-0.02em] text-[var(--color-ink)] sm:text-4xl">Tameion operator access</h1>
    <p className="mt-4 max-w-lg text-base leading-7 text-[var(--color-ink-muted)]">Review genuine obligations and request a fresh, read-only Arc Testnet wallet balance from one protected dashboard.</p>
    <p className="mt-4 border-s-2 border-[var(--color-accent)] ps-3 text-sm leading-6 text-[var(--color-ink)]">Signing in grants access to private viewing. Payment authorization and execution remain separately controlled.</p>
   </div>
   <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-[0_18px_50px_rgba(11,19,43,0.06)] sm:p-6">
    <h2 className="text-lg font-semibold text-[var(--color-ink)]">Continue to your workspace</h2>
    <p role="status" className="mt-2 text-sm leading-6 text-[var(--color-ink-muted)]">{message}</p>
    <a className="mt-5 flex min-h-11 w-full items-center justify-center rounded bg-[var(--color-ink)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ink)]" href="/operator/login">Sign in securely</a>
   </div>
  </section>
  <footer className="border-t border-[var(--color-border)] pt-4 text-xs text-[var(--color-ink-muted)]">Private operator access · No assurance, no execution</footer>
 </main>;
 const controls=<details className="absolute right-4 top-1 z-30"><summary className="flex min-h-11 cursor-pointer items-center rounded border bg-[var(--color-surface)] px-3 text-sm">Operator</summary><section aria-label="Operator session" className="absolute right-0 top-full flex w-[min(300px,calc(100vw-32px))] flex-wrap items-center gap-2 rounded border bg-[var(--color-surface)] p-3 text-xs shadow-lg"><span>Operator session verified</span><button className="min-h-11 rounded border px-3" onClick={logout}>Log out</button></section></details>;
 const walletSummary=<section aria-label="Read-only wallet balance" className="flex flex-wrap items-center justify-between gap-3 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
  <div className="min-w-0 flex-1 basis-full sm:basis-0"><h2 className="text-sm font-semibold">Wallet balance status</h2>
   {balance&&<p className="tabular text-base font-semibold">{balance.amount} USDC · {balance.network}<span className="block text-xs font-normal">Observed <time dateTime={balance.captured_at}>{balance.captured_at}</time></span></p>}
   <p role="status" className="text-xs text-[var(--color-ink-muted)]">{message}</p>
  </div>
  <button className="min-h-11 rounded border px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2" onClick={refresh} disabled={busy}>Refresh wallet balance</button>
 </section>;
 return <CommandCenter operatorControls={controls} walletSummary={walletSummary}/>;
}
