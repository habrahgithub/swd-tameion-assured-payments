"use client";
import {useEffect,useRef,useState} from 'react';
import {flushSync} from 'react-dom';
import {CommandCenter} from './command-center';
import {OperatorAccessCard,OperatorAccessShell} from './operator-access-ui';
import {ThemeControl} from './theme-control';
import {PrivacyEntryIllustration} from './operator/privacy-entry-illustration';
type Session={csrf_token:string;expires_at:string};
type Balance={amount:string;asset:'USDC';captured_at:string;network:string};
const ORGANIZATION={name:'Star Wealth Dynamics LLC',id:'ORG-DEMO-001',environment:'Arc Testnet'} as const;

export function formatWalletAmount(amount:string,maxFractionDigits=6):string{
 const [whole,fraction='']=amount.split('.');
 const scale=10n**BigInt(maxFractionDigits);
 const retained=fraction.slice(0,maxFractionDigits).padEnd(maxFractionDigits,'0');
 let scaled=BigInt(whole)*scale+BigInt(retained||'0');
 if((fraction[maxFractionDigits]??'0')>='5')scaled+=1n;
 const roundedWhole=(scaled/scale).toString().replace(/\B(?=(\d{3})+(?!\d))/g,',');
 let roundedFraction=(scaled%scale).toString().padStart(maxFractionDigits,'0').replace(/0+$/,'');
 while(roundedFraction.length<2)roundedFraction+='0';
 return `${roundedWhole}.${roundedFraction}`;
}

function formatObservedAt(value:string):string{
 return new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23',timeZone:'UTC',timeZoneName:'short'}).format(new Date(value));
}
const defaultNavigate=(path:string)=>window.location.replace(path);
function clearLegacyLoginMarker(){
 try{sessionStorage.removeItem('tameion-fresh-login');}catch{/* The marker is optional and never grants access. */}
}
/** The privacy curtain grants no authority. Every entry still verifies the
 * HttpOnly server session before mounting the private queue or reading balance. */
export function OperatorDashboard({fetcher=fetch,navigate=defaultNavigate}:{fetcher?:typeof fetch;navigate?:(path:string)=>void}){
 const [session,setSession]=useState<Session|null>(null),[message,setMessage]=useState('Checking user session…'),[balance,setBalance]=useState<Balance|null>(null),[busy,setBusy]=useState(false),[viewOpen,setViewOpen]=useState(false),[opening,setOpening]=useState(false);
 const generation=useRef(0),controller=useRef<AbortController|null>(null),openingRef=useRef(false);
 async function verifiedSession(signal:AbortSignal,current:number):Promise<Session|null>{
  const response=await fetcher('/api/operator/session',{cache:'no-store',credentials:'same-origin',signal});const value=await response.json();if(current!==generation.current)return null;
  if(response.status===401){setMessage('Sign-in required. Redirecting to secure sign-in…');navigate('/operator/login');return null;}
  if(response.status===403){setMessage('Access could not be verified from this location. Use the approved workspace address or ask the platform owner to verify access.');return null;}
  if(!response.ok||value.authenticated!==true||typeof value.csrf_token!=='string'||typeof value.expires_at!=='string'||!Number.isFinite(Date.parse(value.expires_at))||Date.parse(value.expires_at)<=Date.now()||Date.parse(value.expires_at)>Date.now()+3600000)throw new Error();
  return {csrf_token:value.csrf_token,expires_at:value.expires_at};
 }
 useEffect(()=>{
  const current=++generation.current,abort=new AbortController();clearLegacyLoginMarker();
  const url=new URL(window.location.href);if(url.searchParams.has('refresh_balance')){url.searchParams.delete('refresh_balance');window.history.replaceState(null,'',`${url.pathname}${url.search}${url.hash}`);}
  void verifiedSession(abort.signal,current).then(active=>{
   if(current!==generation.current||!active)return;
   setSession(active);setViewOpen(false);setMessage('Your session is active. Open the workspace when you are ready.');
  }).catch(()=>{if(current===generation.current)setMessage('Access service unavailable. Ask the platform owner to verify access.');});
  const hidePrivate=()=>{++generation.current;abort.abort();controller.current?.abort();openingRef.current=false;flushSync(()=>{setOpening(false);setViewOpen(false);setBalance(null);setBusy(false);setMessage('Your session may still be active. Open the workspace to verify it.');});};
  const hideOnRestore=(event:PageTransitionEvent)=>{if(event.persisted)hidePrivate();};
  // Clear before the browser freezes a BFcache snapshot as well as on restore.
  window.addEventListener('pagehide',hidePrivate);window.addEventListener('pageshow',hideOnRestore);
  return()=>{++generation.current;abort.abort();controller.current?.abort();window.removeEventListener('pagehide',hidePrivate);window.removeEventListener('pageshow',hideOnRestore);};
 },[fetcher,navigate]);
 useEffect(()=>{if(!session)return;const timer=setTimeout(()=>{++generation.current;controller.current?.abort();setSession(null);setViewOpen(false);setBalance(null);setBusy(false);setMessage('Session expired. Sign in again.');},Math.max(0,Date.parse(session.expires_at)-Date.now()));return()=>clearTimeout(timer);},[session]);
 async function openWorkspace(){
  if(openingRef.current)return;openingRef.current=true;setOpening(true);setMessage('Verifying workspace access…');
  const current=generation.current,abort=new AbortController();controller.current?.abort();controller.current=abort;
  try{const active=await verifiedSession(abort.signal,current);if(current!==generation.current)return;if(!active){setSession(null);setViewOpen(false);return;}setSession(active);setViewOpen(true);void refresh(active);}
  catch{if(current===generation.current){setViewOpen(false);setMessage('Access service unavailable. Ask the platform owner to verify access.');}}
  finally{if(current===generation.current){openingRef.current=false;setOpening(false);}}
 }
 async function refresh(activeSession=session){
  if(!activeSession||busy)return;const current=generation.current;controller.current?.abort();const abort=new AbortController();controller.current=abort;setBusy(true);setBalance(null);setMessage('Checking wallet balance…');
  try{const response=await fetcher('/api/wallet/balance/refresh',{method:'POST',cache:'no-store',credentials:'same-origin',signal:abort.signal,headers:{'Content-Type':'application/json','X-Tameion-CSRF':activeSession.csrf_token},body:'{}'});const value=await response.json();if(current!==generation.current)return;
   if(response.status===401){++generation.current;setSession(null);setViewOpen(false);setBusy(false);setMessage('Session expired or revoked. Sign in again.');throw new Error();}
   if(!response.ok||value.asset!=='USDC'||typeof value.amount!=='string'||!/^(0|[1-9]\d*)(\.\d{1,18})?$/.test(value.amount)||typeof value.captured_at!=='string'||!Number.isFinite(Date.parse(value.captured_at))||value.verification!=='READ_ONLY_BALANCE')throw new Error();
   setBalance(value);setMessage('Read-only observation. This does not establish affordability, fees or payment readiness.');
  }catch{if(current===generation.current)setMessage('Balance not verified. No payment action was taken.');}finally{if(current===generation.current)setBusy(false);}
 }
 async function logout(){
  if(!session)return;const csrf=session.csrf_token;++generation.current;controller.current?.abort();setSession(null);setViewOpen(false);setBalance(null);setBusy(false);setMessage('Logging out…');
  try{const response=await fetcher('/api/operator/logout',{method:'POST',cache:'no-store',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Tameion-CSRF':csrf},body:'{}'});const value=await response.json();setMessage(response.ok&&value.revoked===true?'Logged out.':'Logout unverified. Private view is disabled; server revocation could not be confirmed.');}catch{setMessage('Logout unverified. Private view is disabled; server revocation could not be confirmed.');}
 }
 if(!session||!viewOpen)return <OperatorAccessShell eyebrow="Private finance workspace" title={session?"Your private workspace is hidden":"Checking workspace access"} description={session?"Open your workspace to review company obligations and separate Arc Testnet demo entries.":"Verifying your access to the secure finance workspace."} contentClassName="grid flex-1 items-center gap-5 py-6 lg:grid-cols-[minmax(0,1fr)_26rem] lg:gap-16 lg:py-12" introduction={session?<div className="max-w-xl"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-ink-muted)]">Private workspace</p><h1 className="mt-2 text-2xl font-semibold leading-8 tracking-tight sm:text-4xl">Your private workspace is hidden</h1><p className="mt-3 text-sm leading-6 text-[var(--color-ink-muted)]">Open your workspace to review company obligations and separate Arc Testnet demo entries.</p><PrivacyEntryIllustration/><p className="mt-3 text-xs leading-5 text-[var(--color-ink-muted)]">This screen hides private content. Opening verifies your existing session; payments still require separate approval.</p></div>:undefined} boundary="This screen hides private content. Opening the workspace verifies your existing session; it does not approve or release a payment." accessory={<ThemeControl/>}>
  <OperatorAccessCard heading={session?"Continue to your workspace":"Secure workspace access"} description={session?"Your financial information stays hidden until you choose to open it.":"Signed-out visitors continue to the branded sign-in page."}>
   <p role="status" className="mt-4 text-sm leading-6 text-[var(--color-ink-muted)]">{message}</p>
   {session?<><button onClick={()=>void openWorkspace()} disabled={opening} className="mt-5 flex min-h-11 w-full items-center justify-center rounded bg-[var(--color-primary-action)] px-4 py-2 text-sm font-semibold text-white">{opening?'Verifying access…':'Open workspace'}</button><button onClick={()=>void logout()} className="mt-3 min-h-11 w-full rounded border border-[var(--color-border-strong)] px-4 py-2 text-sm">Log out</button></>:<a className="mt-5 flex min-h-11 w-full items-center justify-center rounded border border-[var(--color-border-strong)] px-4 py-2 text-sm font-semibold" href="/operator/login">Sign in securely</a>}
  </OperatorAccessCard>
 </OperatorAccessShell>;
 const controls=<div className="flex items-center gap-3"><div data-testid="organization-summary" className="hidden text-end sm:block"><p className="max-w-[19rem] truncate text-xs font-semibold">{ORGANIZATION.name}</p><p className="mono mt-0.5 text-[10px] text-[var(--color-ink-muted)]">{ORGANIZATION.id} · {ORGANIZATION.environment}</p></div><details className="relative z-30"><summary className="flex min-h-11 cursor-pointer items-center rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 text-sm font-medium">User</summary><section aria-label="User session and workspace" className="absolute right-0 top-[calc(100%+0.5rem)] flex w-[min(320px,calc(100vw-32px))] flex-col items-stretch gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-xs shadow-[var(--shadow-card)]"><div><p className="font-semibold">{ORGANIZATION.name}</p><p className="text-[var(--color-ink-muted)]">Internal pilot · {ORGANIZATION.environment}</p><p className="mono mt-1">{ORGANIZATION.id}</p></div><span>User session verified</span><ThemeControl/><button className="min-h-11 rounded-lg border border-[var(--color-border-strong)] px-3" onClick={logout}>Log out</button></section></details></div>;
 const walletSummary=<section aria-label="Read-only wallet balance" className={`relative overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 shadow-[var(--shadow-soft)] ${busy?'wallet-card-busy':''}`}>
  <div className="flex flex-wrap items-center justify-between gap-3">
  <div className="min-w-0 flex-1 basis-full sm:basis-0"><h2 className="flex items-center gap-2 text-sm font-semibold"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="size-4 shrink-0 text-[var(--color-ink-muted)]"><rect x="3.5" y="6" width="17" height="13" rx="2" stroke="currentColor" strokeWidth="1.7"/><path d="M3.5 9h17M16 14h1.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/><path d="M6 6V4.5h11" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>Wallet balance status</h2>
   {balance&&<p className="tabular mt-1 text-lg font-semibold tracking-[-0.02em]"><bdi title={`Exact balance: ${balance.amount} ${balance.asset}`}>{formatWalletAmount(balance.amount)} {balance.asset}</bdi><span className="ms-2 text-xs font-medium tracking-normal text-[var(--color-ink-muted)]">{balance.network}</span><span className="block text-xs font-normal tracking-normal text-[var(--color-ink-muted)]">Observed <time dateTime={balance.captured_at} title={balance.captured_at}>{formatObservedAt(balance.captured_at)}</time></span></p>}
   <p role="status" className="text-xs text-[var(--color-ink-muted)]">{message}</p>
  </div>
  <button className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[var(--color-border-strong)] px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2" onClick={()=>void refresh()} disabled={busy} aria-busy={busy}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className={`size-4 shrink-0 ${busy?'animate-spin':''}`}><path d="M20 11a8 8 0 0 0-14.6-4L4 9m0-4v4h4M4 13a8 8 0 0 0 14.6 4L20 15m0 4v-4h-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>{busy?'Checking balance…':'Refresh wallet balance'}</button>
  </div>{busy&&<span aria-hidden="true" className="wallet-refresh-progress absolute inset-x-0 bottom-0 h-0.5 bg-[var(--color-accent)]"/>}
 </section>;
 return <CommandCenter operatorControls={controls} walletSummary={walletSummary} walletBalance={balance??undefined} csrfToken={session.csrf_token}/>;
}
