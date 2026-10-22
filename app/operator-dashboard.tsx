"use client";
import {OPERATOR_SESSION_DURATION_MS,OPERATOR_SESSION_REVALIDATION_MS,OPERATOR_SESSION_CHECK_DEADLINE_MS} from "../src/operator-session-policy";
import {useCallback,useEffect,useRef,useState} from 'react';
import {flushSync} from 'react-dom';
import {CommandCenter} from './command-center';
import {OperatorAccessCard,OperatorAccessShell} from './operator-access-ui';
import {ThemeControl} from './theme-control';
import {PrivacyEntryIllustration} from './operator/privacy-entry-illustration';
import OperatorLogin from './operator/login/page';
type Session={csrf_token:string;expires_at:string};
type Balance={amount:string;asset:'USDC';captured_at:string;network:string};
const ORGANIZATION={name:'Star Wealth Dynamics LLC',id:'ORG-DEMO-001',environment:'Arc Testnet'} as const;

export function formatWalletAmount(amount:string,maxFractionDigits=2):string{
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
function clearFreshLoginMarker(){
 try{sessionStorage.removeItem('tameion-fresh-login');}catch{/* The marker is optional and never grants access. */}
}
/** The privacy curtain grants no authority. Every entry still verifies the
 * HttpOnly server session before mounting the private queue or reading balance. */
export function OperatorDashboard({fetcher=fetch,navigate=defaultNavigate}:{fetcher?:typeof fetch;navigate?:(path:string)=>void}){
 const [session,setSession]=useState<Session|null>(null),[message,setMessage]=useState('Checking session…'),[balance,setBalance]=useState<Balance|null>(null),[busy,setBusy]=useState(false),[viewOpen,setViewOpen]=useState(false),[opening,setOpening]=useState(false);
 const [showExact,setShowExact]=useState(false);
 const observedBalance=useRef<Balance|null>(null);
 function recordBalance(value:Balance|null){observedBalance.current=value;setBalance(value);}
 const generation=useRef(0),controller=useRef<AbortController|null>(null),openingRef=useRef(false),revalidationController=useRef<AbortController|null>(null);
 // The timestamps are untrusted, non-authorizing tab-local continuity only.
 // Server session budgets remain authoritative across reloads and clock changes.
 const cooldownKey='tameion.wallet-cooldown.v1',cooldownMs=30_000,maxRetryAfterMs=900_000;
 type WalletState={inflight:boolean;monotonicUntil:number;lastView:string|null};
 const walletState=useRef<WalletState>({inflight:false,monotonicUntil:0,lastView:null});
 const access=useRef({session,viewOpen});access.current={session,viewOpen};
 const walletRefresh=useRef<()=>void>(()=>{});
 function cancelWallet(){const prior=walletState.current;walletState.current={inflight:false,monotonicUntil:prior.monotonicUntil,lastView:null};}
 const displayWallet=useCallback((view:'dashboard'|'workflow')=>{const state=walletState.current;if(state.lastView===view)return;state.lastView=view;walletRefresh.current();},[]);
 function closePrivate(reason:string){++generation.current;cancelWallet();controller.current?.abort();revalidationController.current?.abort();openingRef.current=false;setOpening(false);setSession(null);setViewOpen(false);recordBalance(null);setBusy(false);setShowExact(false);setMessage(reason);}
 function expired(active:Session){if(Date.now()<Date.parse(active.expires_at))return false;closePrivate('Session expired. Sign in again.');return true;}
 async function verifiedSession(signal:AbortSignal,current:number):Promise<Session|null>{
  const response=await fetcher('/api/operator/session',{cache:'no-store',credentials:'same-origin',signal});const value=await response.json();if(current!==generation.current)return null;
  if(response.status===401){clearFreshLoginMarker();setMessage('Sign in to continue.');navigate('/operator/login');return null;}
  if(response.status===403){setMessage('Access could not be verified from this location. Use the approved workspace address or ask the platform owner to verify access.');return null;}
  if(!response.ok||value.authenticated!==true||typeof value.csrf_token!=='string'||typeof value.expires_at!=='string'||!Number.isFinite(Date.parse(value.expires_at))||Date.parse(value.expires_at)<=Date.now()||Date.parse(value.expires_at)>Date.now()+OPERATOR_SESSION_DURATION_MS)throw new Error();
  return {csrf_token:value.csrf_token,expires_at:value.expires_at};
 }
 useEffect(()=>{
  const current=++generation.current,abort=new AbortController();
  const url=new URL(window.location.href);if(url.searchParams.has('refresh_balance')){url.searchParams.delete('refresh_balance');window.history.replaceState(null,'',`${url.pathname}${url.search}${url.hash}`);}
  void verifiedSession(abort.signal,current).then(active=>{
   if(current!==generation.current)return;if(!active){clearFreshLoginMarker();return;}
   clearFreshLoginMarker();setSession(active);setViewOpen(false);setMessage('Session verified. Open the workspace to continue.');
  }).catch(()=>{if(current===generation.current){clearFreshLoginMarker();setMessage('Access service unavailable. Ask the platform owner to verify access.');}});
  const hidePrivate=()=>{++generation.current;cancelWallet();abort.abort();controller.current?.abort();revalidationController.current?.abort();openingRef.current=false;flushSync(()=>{setOpening(false);setViewOpen(false);recordBalance(null);setBusy(false);setShowExact(false);setMessage('Your session may still be active. Open the workspace to verify it.');});};
  const hideOnRestore=(event:PageTransitionEvent)=>{if(event.persisted)hidePrivate();};
  // Clear before the browser freezes a BFcache snapshot as well as on restore.
  window.addEventListener('pagehide',hidePrivate);window.addEventListener('pageshow',hideOnRestore);
  return()=>{++generation.current;cancelWallet();observedBalance.current=null;abort.abort();controller.current?.abort();revalidationController.current?.abort();window.removeEventListener('pagehide',hidePrivate);window.removeEventListener('pageshow',hideOnRestore);};
 },[fetcher,navigate]);
 useEffect(()=>{if(!session)return;const timer=setTimeout(()=>closePrivate('Session expired. Sign in again.'),Math.max(0,Date.parse(session.expires_at)-Date.now()));return()=>clearTimeout(timer);},[session]);
 // This GET validates the original session only. It neither renews authority nor
 // replaces session state, and its controller is independent of wallet refresh.
 useEffect(()=>{
  if(!session||!viewOpen)return;
  const active=session,current=generation.current;let due=Date.now()+OPERATOR_SESSION_REVALIDATION_MS,deadline=0,stopped=false;
  let timer:ReturnType<typeof setTimeout>|undefined,timeout:ReturnType<typeof setTimeout>|undefined,pending:AbortController|null=null;
  const currentAttempt=()=>!stopped&&current===generation.current;
  const fail=()=>{if(currentAttempt()&&!expired(active))closePrivate('Session revalidation not confirmed. Private view closed; sign in again. Server logout was not requested.');};
  const schedule=()=>{clearTimeout(timer);timer=setTimeout(check,Math.max(0,due-Date.now()));};
  function check(){
   if(!currentAttempt()||expired(active))return;
   if(pending){if(Date.now()>=deadline)fail();return;}
   if(Date.now()<due){schedule();return;}
   const abort=new AbortController();pending=abort;revalidationController.current=abort;deadline=Date.now()+OPERATOR_SESSION_CHECK_DEADLINE_MS;
   timeout=setTimeout(fail,OPERATOR_SESSION_CHECK_DEADLINE_MS);
   void (async()=>{
    try{
     const response=await fetcher('/api/operator/session',{method:'GET',cache:'no-store',credentials:'same-origin',signal:abort.signal});
     if(!currentAttempt()||expired(active))return;if(Date.now()>=deadline){fail();return;}
     const value=await response.json();
     if(!currentAttempt()||expired(active))return;if(Date.now()>=deadline){fail();return;}
     if(!response.ok||value?.authenticated!==true||value.csrf_token!==active.csrf_token||value.expires_at!==active.expires_at)throw new Error();
     due=Date.now()+OPERATOR_SESSION_REVALIDATION_MS;
     schedule(); // Quiet success: no wallet abort, message change or expiry reset.
    }catch{fail();}
    finally{clearTimeout(timeout);if(revalidationController.current===abort)revalidationController.current=null;pending=null;}
   })();
  }
  const resume=()=>{if(document.visibilityState!=='hidden')check();};
  schedule();window.addEventListener('focus',resume);document.addEventListener('visibilitychange',resume);
  return()=>{stopped=true;clearTimeout(timer);clearTimeout(timeout);pending?.abort();if(revalidationController.current===pending)revalidationController.current=null;window.removeEventListener('focus',resume);document.removeEventListener('visibilitychange',resume);};
 },[session,viewOpen,fetcher]);
 async function openWorkspace(){
  if(session&&expired(session))return;if(openingRef.current)return;openingRef.current=true;setOpening(true);setMessage('Verifying workspace access…');
  const current=generation.current,abort=new AbortController();controller.current?.abort();controller.current=abort;
  try{const active=await verifiedSession(abort.signal,current);if(current!==generation.current||(session&&expired(session)))return;if(!active){setSession(null);setViewOpen(false);return;}setSession(active);setViewOpen(true);setMessage(balance?'Balance observed. Refresh to update.':'Balance not checked. Refresh to update.');}
  catch{if(current===generation.current){setViewOpen(false);setMessage('Access service unavailable. Ask the platform owner to verify access.');}}
  finally{if(current===generation.current){openingRef.current=false;setOpening(false);}}
 }
 walletRefresh.current=()=>{
  const state=walletState.current,active=access.current;
  if(state.inflight||!active.session||!active.viewOpen||expired(active.session))return;
  const now=Date.now(),monotonic=performance.now();
  let metadata:{version:1;lastAttempt:number;cooldownUntil:number};
  const persist=(value:typeof metadata)=>{const text=JSON.stringify(value);sessionStorage.setItem(cooldownKey,text);if(sessionStorage.getItem(cooldownKey)!==text)throw new Error();};
  try{
   const raw=sessionStorage.getItem(cooldownKey);let stored;try{stored=raw===null?null:JSON.parse(raw);}catch{stored=undefined;}
   if(raw!==null&&(!stored||Object.keys(stored).sort().join(',')!=='cooldownUntil,lastAttempt,version'||stored.version!==1||!Number.isSafeInteger(stored.lastAttempt)||!Number.isSafeInteger(stored.cooldownUntil)||stored.lastAttempt<0||stored.lastAttempt>now||stored.cooldownUntil<stored.lastAttempt+cooldownMs||stored.cooldownUntil>now+maxRetryAfterMs)){
    // Repair is a consumed event, never permission to send this request.
    state.monotonicUntil=Math.max(state.monotonicUntil,monotonic+cooldownMs);persist({version:1,lastAttempt:now,cooldownUntil:now+cooldownMs});
    setMessage('Balance refresh paused: cooldown metadata could not be verified. Wait at least 30 seconds, then request again.');return;
   }
   if(monotonic<state.monotonicUntil||(stored&&now<stored.cooldownUntil)){
    setMessage(observedBalance.current?'Previous balance observation retained. Refresh temporarily unavailable; request again after the cooldown.':'No balance observed in this view. Refresh temporarily unavailable; request again after the cooldown.');return;
   }
   metadata={version:1,lastAttempt:now,cooldownUntil:now+cooldownMs};
   // Reserve before fetch; even failures consume this display/manual event.
   state.monotonicUntil=monotonic+cooldownMs;persist(metadata);
  }catch{
   state.monotonicUntil=Math.max(state.monotonicUntil,monotonic+cooldownMs);setMessage('Balance refresh paused: cooldown storage could not be verified. No balance request was sent.');return;
  }
  if(expired(active.session))return;
  state.inflight=true;
  const activeSession=active.session,current=generation.current,abort=new AbortController();controller.current=abort;
  const bound=()=>current===generation.current&&walletState.current===state&&access.current.viewOpen&&access.current.session?.csrf_token===activeSession.csrf_token&&access.current.session?.expires_at===activeSession.expires_at;
  setBusy(true);setShowExact(false);setMessage('Checking wallet balance…');
  const extendCooldown=(retry:string|null)=>{
   if(retry===null)return;const seconds=Number(retry),date=Date.parse(retry),until=Number.isFinite(seconds)&&seconds>=0?Date.now()+seconds*1000:date;
   if(!Number.isFinite(until)||until<=metadata.cooldownUntil||until>Date.now()+maxRetryAfterMs)return;
   metadata={...metadata,cooldownUntil:Math.ceil(until)};state.monotonicUntil=Math.max(state.monotonicUntil,performance.now()+until-Date.now());persist(metadata);
  };
  void(async()=>{
   try{
    const response=await fetcher('/api/wallet/balance/refresh',{method:'POST',cache:'no-store',credentials:'same-origin',signal:abort.signal,headers:{'Content-Type':'application/json','X-Tameion-CSRF':activeSession.csrf_token},body:'{}'});
    if(!bound()||expired(activeSession))return;
    const retry=response.headers.get('Retry-After');extendCooldown(retry);
    const value=await response.json();if(!bound()||expired(activeSession))return;
    if(retry===null&&typeof value?.retry_after==='number')extendCooldown(String(value.retry_after));
    if(response.status===401){closePrivate('Session expired or revoked. Sign in again.');return;}
    if(!response.ok||value?.asset!=='USDC'||typeof value.amount!=='string'||!/^(0|[1-9]\d*)(\.\d{1,18})?$/.test(value.amount)||typeof value.captured_at!=='string'||!Number.isFinite(Date.parse(value.captured_at))||value.verification!=='READ_ONLY_BALANCE')throw new Error();
    recordBalance(value);setMessage('Read-only balance observed.');
   }catch{if(bound()&&!expired(activeSession))setMessage('Balance refresh not verified. Any previous observation remains historical; no payment action was taken.');}
   finally{if(bound()){state.inflight=false;setBusy(false);}}
  })();
 };
 function refresh(){walletRefresh.current();}
 async function logout(){
  if(!session)return;const csrf=session.csrf_token;closePrivate('Logging out…');
  try{const response=await fetcher('/api/operator/logout',{method:'POST',cache:'no-store',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Tameion-CSRF':csrf},body:'{}'});const value=await response.json();setMessage(response.ok&&value.revoked===true?'Logged out.':'Logout unverified. Private view is disabled; server revocation could not be confirmed.');}catch{setMessage('Logout unverified. Private view is disabled; server revocation could not be confirmed.');}
 }
 if(!session)return <OperatorLogin accessNotice={message}/>;
 if(!viewOpen)return <OperatorAccessShell eyebrow="Private workspace" title="Your workspace is hidden" description="Review company payables and Arc Testnet activity." contentClassName="grid flex-1 items-center gap-5 py-6 lg:grid-cols-[minmax(0,1fr)_26rem] lg:gap-16 lg:py-12" introduction={<div className="max-w-xl"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-ink-muted)]">Private workspace</p><h1 className="mt-2 text-2xl font-semibold leading-8 tracking-tight sm:text-4xl">Your workspace is hidden</h1><p className="mt-3 text-sm leading-6 text-[var(--color-ink-muted)]">Review company payables and Arc Testnet activity.</p><PrivacyEntryIllustration/><p className="mt-3 text-xs leading-5 text-[var(--color-ink-muted)]">Open to continue. Payments need separate approval.</p></div>} boundary="Open to continue. Payments need separate approval." accessory={<ThemeControl/>}>
  <OperatorAccessCard heading="Continue" description="Your financial information stays hidden until you open it.">
   <p role="status" className="mt-4 text-sm leading-6 text-[var(--color-ink-muted)]">{message}</p>
   <button onClick={()=>void openWorkspace()} disabled={opening} className="mt-5 flex min-h-11 w-full items-center justify-center rounded bg-[var(--color-primary-action)] px-4 py-2 text-sm font-semibold text-white">{opening?'Checking access…':'Open workspace'}</button><button onClick={()=>void logout()} className="mt-3 min-h-11 w-full rounded border border-[var(--color-border-strong)] px-4 py-2 text-sm">Log out</button>
  </OperatorAccessCard>
 </OperatorAccessShell>;
 const controls=<div className="flex items-center gap-3"><div data-testid="organization-summary" className="hidden text-end sm:block"><p className="max-w-[19rem] truncate text-xs font-semibold">{ORGANIZATION.name}</p><p className="mono mt-0.5 text-[10px] text-[var(--color-ink-muted)]">{ORGANIZATION.id} · {ORGANIZATION.environment}</p></div><details className="relative z-30"><summary className="flex min-h-11 cursor-pointer items-center rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-1 text-xs font-medium sm:px-3 sm:text-sm">User</summary><section aria-label="User session and workspace" className="absolute right-0 top-[calc(100%+0.5rem)] flex w-[min(320px,calc(100vw-32px))] flex-col items-stretch gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-xs shadow-[var(--shadow-card)]"><div><p className="font-semibold">{ORGANIZATION.name}</p><p className="text-[var(--color-ink-muted)]">Internal pilot · {ORGANIZATION.environment}</p><p className="mono mt-1">{ORGANIZATION.id}</p></div><span>User session verified</span><ThemeControl/><button className="min-h-11 rounded-lg border border-[var(--color-border-strong)] px-3" onClick={logout}>Log out</button></section></details></div>;
 const walletSummary=<section aria-label="Read-only wallet balance" className={`relative overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 shadow-[var(--shadow-soft)] ${busy?'wallet-card-busy':''}`}>
  <div className="flex flex-wrap items-center justify-between gap-3">
  <div className="min-w-0 flex-1 basis-full sm:basis-0"><h2 className="flex items-center gap-2 text-sm font-semibold"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="size-4 shrink-0 text-[var(--color-ink-muted)]"><rect x="3.5" y="6" width="17" height="13" rx="2" stroke="currentColor" strokeWidth="1.7"/><path d="M3.5 9h17M16 14h1.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/><path d="M6 6V4.5h11" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>Wallet balance status</h2>
   {balance&&<>
    <p className="tabular mt-1 break-words text-lg font-semibold tracking-[-0.02em]"><bdi id="wallet-balance-amount" className="break-all" title={`Exact balance: ${balance.amount} ${balance.asset}`}>{showExact?balance.amount:formatWalletAmount(balance.amount)} {balance.asset}</bdi><span className="ms-2 text-xs font-medium tracking-normal text-[var(--color-ink-muted)]">{balance.network}</span><span className="block text-xs font-normal tracking-normal text-[var(--color-ink-muted)]">Observed <time dateTime={balance.captured_at} title={balance.captured_at}>{formatObservedAt(balance.captured_at)}</time></span></p>
    <p className="text-xs text-[var(--color-ink-muted)]">Read-only observation. This does not establish affordability, fees or payment readiness.</p>
    <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-ink-muted)]"><span>{showExact?'Exact balance':'Rounded balance'}</span><button type="button" aria-pressed={showExact} aria-controls="wallet-balance-amount" className="min-h-11 rounded px-2 font-semibold underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2" onClick={()=>setShowExact(value=>!value)}>{showExact?'Show rounded':'Show exact'}</button></div>
   </>}
   <p role="status" className="text-xs text-[var(--color-ink-muted)]">{message}</p>
  </div>
  <button className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[var(--color-border-strong)] px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2" onClick={()=>void refresh()} disabled={busy} aria-busy={busy}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className={`size-4 shrink-0 ${busy?'animate-spin':''}`}><path d="M20 11a8 8 0 0 0-14.6-4L4 9m0-4v4h4M4 13a8 8 0 0 0 14.6 4L20 15m0 4v-4h-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>{busy?'Checking balance…':'Refresh wallet balance'}</button>
  </div>{busy&&<span aria-hidden="true" className="wallet-refresh-progress absolute inset-x-0 bottom-0 h-0.5 bg-[var(--color-accent)]"/>}
 </section>;
 return <CommandCenter onDisplay={displayWallet} operatorControls={controls} walletSummary={walletSummary} walletBalance={balance??undefined} csrfToken={session.csrf_token} initialView="dashboard"/>;
}
