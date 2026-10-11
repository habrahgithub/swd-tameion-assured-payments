"use client";
import {useState,type FormEvent} from 'react';
export default function OperatorLogin(){
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('Use your separately provisioned operator account.');
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(busy)return;const form=event.currentTarget,data=new FormData(form);setBusy(true);setMessage('Verifying operator access…');
  try{
   const bootstrap=await fetch('/api/operator/csrf',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-Tameion-CSRF-Bootstrap':'1'},body:'{}',signal:AbortSignal.timeout(10000)});const challenge=await bootstrap.json();if(!bootstrap.ok||typeof challenge.csrf_token!=='string')throw new Error();
   const response=await fetch('/api/operator/login',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-Tameion-CSRF':challenge.csrf_token},body:JSON.stringify({username:data.get('username'),password:data.get('password')}),signal:AbortSignal.timeout(15000)});const result=await response.json();if(!response.ok||result.authenticated!==true)throw new Error();window.location.assign('/');
  }catch{setMessage('Sign-in could not be verified. Access may be unavailable or rate limited. Try again after the stated access limit.');}
  finally{form.reset();setBusy(false);}
 }
 return <main className="mx-auto max-w-md space-y-5 p-6"><h1 className="text-2xl font-semibold">Tameion operator sign-in</h1><p>Operator access permits private viewing and manual read-only wallet balance checks. Payment controls remain separately gated.</p><form onSubmit={submit} className="space-y-4"><label className="block">Operator name<input className="mt-1 block min-h-11 w-full rounded border p-2" name="username" autoComplete="username" required maxLength={128} disabled={busy}/></label><label className="block">Password<input className="mt-1 block min-h-11 w-full rounded border p-2" type="password" name="password" autoComplete="current-password" required maxLength={1024} disabled={busy}/></label><button className="min-h-11 rounded border px-4 font-semibold" disabled={busy}>{busy?'Verifying…':'Sign in'}</button></form><p role="status">{message}</p></main>;
}
