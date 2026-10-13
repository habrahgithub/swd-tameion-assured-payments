"use client";
import {useState,type FormEvent} from 'react';
import {OperatorAccessCard,OperatorAccessShell} from '../../operator-access-ui';
export default function OperatorLogin(){
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('Ready for secure sign-in.');
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(busy)return;const form=event.currentTarget,data=new FormData(form);setBusy(true);setMessage('Verifying operator access…');
  try{
   const bootstrap=await fetch('/api/operator/csrf',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-Tameion-CSRF-Bootstrap':'1'},body:'{}',signal:AbortSignal.timeout(10000)});const challenge=await bootstrap.json();if(!bootstrap.ok||typeof challenge.csrf_token!=='string')throw new Error();
   const response=await fetch('/api/operator/login',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-Tameion-CSRF':challenge.csrf_token},body:JSON.stringify({username:data.get('username'),password:data.get('password')}),signal:AbortSignal.timeout(15000)});const result=await response.json();if(!response.ok||result.authenticated!==true)throw new Error();window.location.assign('/');
  }catch{setMessage('Sign-in could not be verified. Access may be unavailable or rate limited. Try again after the stated access limit.');}
  finally{form.reset();setBusy(false);}
 }
 const details=<dl className="mt-7 grid gap-3 text-sm sm:grid-cols-3 lg:grid-cols-1">
     <div className="border-s-2 border-[var(--color-border-strong)] ps-3"><dt className="font-semibold text-[var(--color-ink)]">Protected dashboard</dt><dd className="mt-1 text-[var(--color-ink-muted)]">Private records stay behind the operator session.</dd></div>
     <div className="border-s-2 border-[var(--color-border-strong)] ps-3"><dt className="font-semibold text-[var(--color-ink)]">Manual wallet check</dt><dd className="mt-1 text-[var(--color-ink-muted)]">Balance refresh runs only when you request it.</dd></div>
     <div className="border-s-2 border-[var(--color-accent)] ps-3"><dt className="font-semibold text-[var(--color-ink)]">Separate payment authority</dt><dd className="mt-1 text-[var(--color-ink-muted)]">Signing in does not approve or execute payment.</dd></div>
    </dl>;
 return <OperatorAccessShell eyebrow="Secure operator access" title="Sign in to Tameion" description="Open the protected workspace to review obligations and manually verify the Arc Testnet USDC wallet balance." details={details} brandHref="/">
   <OperatorAccessCard heading="Operator sign-in" description="Use your separately provisioned operator account.">
    <form onSubmit={submit} className="mt-6 space-y-5">
     <label className="block text-sm font-semibold text-[var(--color-ink)]">Operator name<input className="mt-2 block min-h-11 w-full rounded border border-[var(--color-border-strong)] bg-white px-3 py-2 font-normal outline-none transition focus:border-[var(--color-ink)] focus:ring-2 focus:ring-[var(--color-border-strong)] disabled:cursor-not-allowed disabled:bg-[var(--color-bg)]" name="username" autoComplete="username" required maxLength={128} disabled={busy}/></label>
     <label className="block text-sm font-semibold text-[var(--color-ink)]">Password<input className="mt-2 block min-h-11 w-full rounded border border-[var(--color-border-strong)] bg-white px-3 py-2 font-normal outline-none transition focus:border-[var(--color-ink)] focus:ring-2 focus:ring-[var(--color-border-strong)] disabled:cursor-not-allowed disabled:bg-[var(--color-bg)]" type="password" name="password" autoComplete="current-password" required maxLength={1024} disabled={busy}/></label>
     <button className="min-h-11 w-full rounded bg-[var(--color-ink)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ink)] disabled:cursor-wait disabled:opacity-50" disabled={busy}>{busy?'Verifying access…':'Sign in securely'}</button>
    </form>
    <p role="status" aria-live="polite" className="mt-5 border-t border-[var(--color-border)] pt-4 text-sm leading-6 text-[var(--color-ink-muted)]">{message}</p>
   </OperatorAccessCard>
  </OperatorAccessShell>;
}
