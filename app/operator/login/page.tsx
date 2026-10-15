"use client";
import {useState,type FormEvent} from 'react';
import {OperatorAccessCard,OperatorAccessShell} from '../../operator-access-ui';
import {ThemeControl} from '../../theme-control';
import {LoginBrand,LoginIntroduction} from './login-branding';
import styles from './login-branding.module.css';
export default function OperatorLogin({navigate=(path:string)=>window.location.assign(path),accessNotice}:{navigate?:(path:string)=>void;accessNotice?:string}={}){
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('Ready for secure sign-in.');
 const visibleMessage=message==='Ready for secure sign-in.'?(accessNotice??message):message;
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(busy)return;const form=event.currentTarget,data=new FormData(form);setBusy(true);setMessage('Verifying account access…');
  try{
   const bootstrap=await fetch('/api/operator/csrf',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-Tameion-CSRF-Bootstrap':'1'},body:'{}',signal:AbortSignal.timeout(10000)});const challenge=await bootstrap.json();if(!bootstrap.ok||typeof challenge.csrf_token!=='string')throw new Error();
   const response=await fetch('/api/operator/login',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-Tameion-CSRF':challenge.csrf_token},body:JSON.stringify({username:data.get('username'),password:data.get('password')}),signal:AbortSignal.timeout(15000)});const result=await response.json();if(!response.ok||result.authenticated!==true)throw new Error();try{sessionStorage.setItem('tameion-fresh-login','1');}catch{/* Storage only selects the first view; the server session remains authoritative. */}navigate('/');
  }catch{setMessage('Sign-in could not be verified. Access may be unavailable or rate limited. Try again after the stated access limit.');}
  finally{form.reset();setBusy(false);}
 }
 return <OperatorAccessShell eyebrow="Secure finance access" title="Sign in to Tameion" description="Review company payables and Arc Testnet activity." brand={<LoginBrand/>} introduction={<LoginIntroduction/>} shellClassName={styles.shell} contentClassName={styles.content} brandHref="/" accessory={<ThemeControl/>}>
   <OperatorAccessCard heading="Sign in to Tameion" description="Use your Tameion account.">
    <form onSubmit={submit} className="mt-6 space-y-5">
     <label className="block text-sm font-semibold text-[var(--color-ink)]">Username<input className="mt-2 block min-h-11 w-full rounded border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 font-normal text-[var(--color-ink)] outline-none transition focus:border-[var(--color-ink)] focus:ring-2 focus:ring-[var(--color-border-strong)] disabled:cursor-not-allowed disabled:bg-[var(--color-bg)]" name="username" autoComplete="username" required maxLength={128} disabled={busy}/></label>
     <label className="block text-sm font-semibold text-[var(--color-ink)]">Password<input className="mt-2 block min-h-11 w-full rounded border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 font-normal text-[var(--color-ink)] outline-none transition focus:border-[var(--color-ink)] focus:ring-2 focus:ring-[var(--color-border-strong)] disabled:cursor-not-allowed disabled:bg-[var(--color-bg)]" type="password" name="password" autoComplete="current-password" required maxLength={1024} disabled={busy}/></label>
     <button className="min-h-11 w-full rounded bg-[var(--color-primary-action)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ink)] disabled:cursor-wait disabled:opacity-50" disabled={busy}>{busy?'Verifying access…':'Sign in securely'}</button>
    </form>
    <p role="status" aria-live="polite" className="mt-5 border-t border-[var(--color-border)] pt-4 text-sm leading-6 text-[var(--color-ink-muted)]">{visibleMessage}</p>
   </OperatorAccessCard>
  </OperatorAccessShell>;
}
