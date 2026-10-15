"use client";

import {useEffect,useId,useState} from 'react';
import styles from './login-branding.module.css';
import {TameionBrand} from '../../tameion-brand';

export function LoginBrand(){
 return <TameionBrand href="/" className={styles.brand}/>;
}

export function LoginIntroduction(){
 return <div className={styles.introduction}>
  <p className={styles.eyebrow}>Secure finance access</p>
  <h1 className={styles.headline}>From invoice to <span>assured payment.</span></h1>
  <p className={styles.support}>AI understands the obligation.<br className={styles.desktopBreak}/> You control the transaction.</p>
  <p className={styles.ecosystem}>Circle · Arc · USDC</p>
  <LoginJourney/>
  <p className={styles.boundary}>Private obligation review. Payments require separate approval.</p>
 </div>;
}

/** One declarative timeline. State responds only to user / platform events. */
export function LoginJourney(){
 const [paused,setPaused]=useState(false);
 const [reduced,setReduced]=useState(true);
 const [hidden,setHidden]=useState(true);
 useEffect(()=>{
  const preference=window.matchMedia('(prefers-reduced-motion: reduce)');
  const syncPreference=()=>setReduced(preference.matches);
  const syncVisibility=()=>setHidden(document.visibilityState==='hidden');
  syncPreference();syncVisibility();
  preference.addEventListener('change',syncPreference);
  document.addEventListener('visibilitychange',syncVisibility);
  return ()=>{
   preference.removeEventListener('change',syncPreference);
   document.removeEventListener('visibilitychange',syncVisibility);
  };
 },[]);
 const motion=reduced?'static':paused||hidden?'paused':'running';
 return <figure className={styles.journey} data-testid="login-journey" data-motion={motion}>
  <JourneyScene/>
  <JourneyScene compact/>
  <figcaption className={styles.caption}>
   <span>Illustrative workflow</span>
   <button type="button" onClick={()=>setPaused(value=>!value)} disabled={reduced} aria-label={paused||reduced?'Play illustration':'Pause illustration'} aria-pressed={paused||reduced} className={styles.motionControl}>
    <span aria-hidden="true">{paused||reduced?'▷':'Ⅱ'}</span> {reduced?'Motion reduced':paused?'Play':'Pause'}
   </button>
  </figcaption>
 </figure>;
}

function JourneyScene({compact=false}:{compact?:boolean}){
 const id=useId().replace(/:/g,'');
 const fill=`url(#${id}-glass)`,gold=`url(#${id}-gold)`,glow=`url(#${id}-glow)`;
 const positions=compact?{doc:'translate(17 48) scale(.57)',ai:'translate(119 49) scale(.61)',human:'translate(231 50) scale(.66)',shield:'translate(88 151) scale(.66)',arc:'translate(232 158) scale(.52)'}:{doc:'translate(30 147)',ai:'translate(222 164)',human:'translate(350 178)',shield:'translate(466 168)',arc:'translate(635 195)'};
 return <svg className={compact?styles.mobileScene:styles.desktopScene} viewBox={compact?'0 0 340 230':'0 0 760 390'} role="img" aria-labelledby={`${id}-title ${id}-desc`}>
  <title id={`${id}-title`}>From invoice to assured payment — concept flow</title>
  <desc id={`${id}-desc`}>Bills and invoices reach AI assessment, then human approval and assurance, before an orbital Arc and Circle wallets scene. A return pulse represents reconciliation. This is an illustration, not a live transaction.</desc>
  <defs>
   <linearGradient id={`${id}-glass`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#fff" stopOpacity=".94"/><stop offset=".5" stopColor="#182235" stopOpacity=".8"/><stop offset="1" stopColor="#0b132b"/></linearGradient>
   <linearGradient id={`${id}-gold`} x1="0" y1="0" x2=".8" y2="1"><stop stopColor="#fff"/><stop offset=".45" stopColor="#d8b66d"/><stop offset="1" stopColor="#c5a059" stopOpacity=".45"/></linearGradient>
   <radialGradient id={`${id}-halo`}><stop stopColor="#c5a059" stopOpacity=".2"/><stop offset="1" stopColor="#c5a059" stopOpacity="0"/></radialGradient>
   <filter id={`${id}-glow`} x="-70%" y="-70%" width="240%" height="240%"><feGaussianBlur stdDeviation="3"/></filter>
   <pattern id={`${id}-stars`} width="87" height="69" patternUnits="userSpaceOnUse"><circle cx="18" cy="20" r=".8" fill="#d8b66d" opacity=".45"/><circle cx="63" cy="49" r=".5" fill="#fff" opacity=".4"/></pattern>
  </defs>
  <rect width="100%" height="100%" fill="#0b132b"/>
  <ellipse cx={compact?272:610} cy={compact?168:160} rx={compact?150:285} ry={compact?115:200} fill={`url(#${id}-halo)`}/>
  <rect width="100%" height="100%" fill={`url(#${id}-stars)`}/>
  {!compact&&<g fill="none" stroke="#fff" opacity=".08"><path d="M386-20C570-62 814 30 794 257" strokeWidth="2"/><path d="M383-14C570-52 814 38 790 257" strokeWidth="10"/></g>}
  <g fill="none" stroke="#c5a059" strokeWidth="1" opacity=".32">
   <path d={compact?'M40 80C87 127 122 56 157 74S280 109 276 77C307 136 79 110 113 183S218 222 270 179':'M57 246C165 280 181 184 266 208S326 229 390 220S450 173 507 215S570 294 639 227'}/>
   {!compact&&<><path d="M30 265C154 315 192 197 268 221S343 255 396 231S465 183 512 228S588 284 711 217"/><path d="M20 220C140 263 206 169 269 190S350 211 398 210S465 151 518 203S591 263 686 214"/></>}
  </g>
  <path className={styles.outgoing} d={compact?'M45 81C95 94 104 63 158 74S231 95 270 78C300 117 80 118 112 179S208 212 270 180':'M58 243C165 276 181 183 266 208S326 229 390 220S450 173 507 215S570 294 650 228'} fill="none" stroke="#d8b66d" strokeWidth="2" pathLength="100"/>
  <path className={styles.returnPulse} d={compact?'M275 197Q197 258 38 109':'M707 279Q462 409 59 281'} fill="none" stroke="#fff" strokeWidth="1.5" pathLength="100"/>
  <g transform={positions.doc}>
   <g className={styles.documents}>
    <path d="M-9 23 54 35 74 135 13 122Z" fill={fill} stroke="#fff" strokeOpacity=".28"/>
    <path d="M10-29 77-13 91 79 26 65Z" fill={fill} stroke="#d8b66d" strokeOpacity=".5"/>
    <path d="M25 9 115 29 135 160 45 140Z" fill={fill} stroke="#fff" strokeWidth="1.5"/>
    <path d="m44 39 34 7m-31 8 45 10m-41 9 59 13m-57 2 60 14m-56 3 30 7m-27 5 52 11" fill="none" stroke="#fff" opacity=".6" strokeWidth="4"/>
    <path d="m54 88 60 14" stroke="#c5a059" strokeWidth="7"/>
    <path d="m0 65 26 4 8 62-26-6Z" fill="#fff" opacity=".85"/>
    <path d="m8 80 16 3m-15 5 17 3m-15 5 16 3" stroke="#0b132b" strokeWidth="2" opacity=".6"/>
   </g>
   <g className={styles.particles} fill="#d8b66d"><rect x="146" y="54" width="5" height="5"/><rect x="160" y="74" width="3" height="3"/><rect x="141" y="90" width="4" height="4"/></g>
  </g>
  <g transform={positions.ai}>
   <g className={styles.ai}>
    <path d="m4-20 62 12 10 85-60-12Z" fill="none" stroke="#d8b66d" strokeWidth="4" opacity=".4" filter={glow}/>
    <path d="m-11-8 62 12 10 85-60-12Z" fill={fill} stroke="#c5a059" opacity=".45"/>
    <path d="m-4-15 62 12 10 85-60-12Z" fill={fill} stroke="#d8b66d" opacity=".65"/>
    <path d="m4-20 62 12 10 85-60-12Z" fill="#182235" stroke="#d8b66d" strokeWidth="2"/>
    <path d="m11-10 49 10 9 65-48-10Z" fill="none" stroke="#fff" strokeOpacity=".55" strokeDasharray="2 3"/>
    <text x="39" y="35" textAnchor="middle" fill="#fff" fontSize="25" fontWeight="600" transform="rotate(10 39 35)">AI</text>
    <path className={styles.scan} d="m15 12 49 10" stroke="#d8b66d" strokeWidth="3"/>
   </g>
  </g>
  <g transform={positions.human}>
   <ellipse cx="40" cy="77" rx="47" ry="9" fill="none" stroke="#d8b66d" opacity=".5"/>
   <ellipse cx="40" cy="80" rx="38" ry="5" fill="#c5a059" opacity=".12"/>
   <g className={styles.human}>
    <ellipse cx="40" cy="29" rx="34" ry="43" fill="none" stroke="#d8b66d" strokeWidth="4" opacity=".35" filter={glow}/>
    <ellipse cx="40" cy="29" rx="34" ry="43" fill={fill} stroke="#fff" strokeOpacity=".65"/>
    <circle cx="40" cy="13" r="10" fill={gold}/>
    <path d="M23 55v-5c0-23 34-23 34 0v5" fill={gold}/>
   </g>
  </g>
  <g transform={positions.shield}>
   <ellipse cx="42" cy="99" rx="45" ry="7" fill="#c5a059" opacity=".18"/>
   <g className={styles.assurance}>
    <path d="M42-16 80 0v38c0 25-17 42-38 57C21 80 4 63 4 38V0Z" fill="none" stroke="#d8b66d" strokeWidth="7" opacity=".3" filter={glow}/>
    <path d="M42-16 80 0v38c0 25-17 42-38 57C21 80 4 63 4 38V0Z" fill={fill} stroke="#d8b66d" strokeWidth="3"/>
    <path d="M42-7 72 6v31c0 21-14 36-30 48C26 73 12 58 12 37V6Z" fill="#c5a059" fillOpacity=".14" stroke="#fff" strokeOpacity=".45"/>
    <path d="m25 38 12 13 23-31" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"/>
   </g>
  </g>
  <g transform={positions.arc}>
   <g className={styles.wallets}>
    <circle r="89" fill="none" stroke="#d8b66d" opacity=".17"/>
    <ellipse rx="115" ry="58" transform="rotate(-26)" fill="none" stroke="#d8b66d" opacity=".7"/>
    <ellipse rx="100" ry="69" transform="rotate(24)" fill="none" stroke="#fff" opacity=".32"/>
    <ellipse rx="78" ry="88" transform="rotate(-34)" fill="none" stroke="#c5a059" opacity=".45"/>
    <circle r="65" fill={fill} stroke="#fff" strokeOpacity=".6"/>
    <circle r="56" fill="none" stroke="#d8b66d" strokeWidth="2" opacity=".6"/>
    <ellipse rx="65" ry="26" transform="rotate(-27)" fill="none" stroke="#fff" opacity=".4"/>
    <path d="M-28 22C-11-31 11-31 29 22" fill="none" stroke={gold} strokeWidth="9"/>
    {[[66,-78],[-88,-39],[82,72]].map(([x,y],i)=><g key={i} transform={`translate(${x} ${y})`}><circle r="21" fill={fill} stroke="#d8b66d"/><path d="M-6-10C-18-2-10 13 0 10M6 10C18 2 10-13 0-10" fill="none" stroke="#d8b66d" strokeWidth="3"/><path d="m-2 4 4-8" stroke="#fff" strokeWidth="3"/></g>)}
    <g className={styles.satellite}><circle cx="-36" cy="89" r="6" fill={gold}/><circle cx="103" cy="-5" r="5" fill={gold}/></g>
   </g>
   <circle className={styles.orbitGlow} r="69" fill="none" stroke="#d8b66d" strokeWidth="5" filter={glow}/>
  </g>
  {!compact&&<g><path d="M0 339 64 307 89 315 118 301 167 339 247 352 298 331 347 345 411 327 459 344 524 329 577 346 647 328 706 318 760 345V390H0Z" fill="#111827"/><path d="m64 307 25 8 29-14 49 38m131-8 49 14 64-18m236 1 59-10" fill="none" stroke="#fff" opacity=".1"/><path d="M0 366Q400 318 760 366" fill="none" stroke="#c5a059" opacity=".24"/></g>}
  <g fill="#fff" fontSize={compact?13:14} fontFamily="system-ui, sans-serif" textAnchor="middle">
   {compact?<><text x="52" y="14"><tspan x="52">Bills &amp;</tspan><tspan x="52" dy="15">invoices</tspan></text><text x="144" y="14"><tspan x="144">AI</tspan><tspan x="144" dy="15">assessment</tspan></text><text x="273" y="14"><tspan x="273">Human</tspan><tspan x="273" dy="15">approval</tspan></text><text x="116" y="138">Assurance</text><text x="236" y="223">Arc · Circle wallets</text></>:<><text x="102" y="109">Bills &amp; invoices</text><text x="265" y="124">AI assessment</text><text x="390" y="130">Human approval</text><text x="508" y="118">Assurance</text><text x="637" y="90">Arc</text><text x="677" y="50">Circle wallets</text></>}
  </g>
  {!compact&&<g stroke="#fff" strokeOpacity=".45" fill="#fff"><path d="M102 115v23m163-8v15m125-9v20m118-32v20m129-49v27m62-66v35"/><circle cx="102" cy="138" r="2"/><circle cx="265" cy="145" r="2"/><circle cx="390" cy="156" r="2"/><circle cx="508" cy="144" r="2"/></g>}
 </svg>;
}
