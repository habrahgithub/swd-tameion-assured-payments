import type {ReactNode} from 'react';
import {TameionBrand} from './tameion-brand';

type AccessShellProps={
 eyebrow:string;
 title:string;
 description:string;
 boundary?:ReactNode;
 details?:ReactNode;
 brandHref?:string;
 accessory?:ReactNode;
 brand?:ReactNode;
 introduction?:ReactNode;
 shellClassName?:string;
 contentClassName?:string;
 children:ReactNode;
};

function Brand({href}:{href?:string}){
 return <TameionBrand href={href}/>;
}

export function OperatorAccessShell({eyebrow,title,description,boundary,details,brandHref,accessory,brand,introduction,shellClassName,contentClassName,children}:AccessShellProps){
 return <main className={shellClassName??"mx-auto flex min-h-screen w-full max-w-6xl flex-col px-5 py-5 sm:px-8 sm:py-7"}>
  <header className="flex items-center justify-between gap-4 border-b border-[var(--color-border)] pb-4">{brand??<Brand href={brandHref}/>}{accessory}</header>
  <section className={contentClassName??"grid flex-1 items-center gap-9 py-10 lg:grid-cols-[minmax(0,1fr)_26rem] lg:gap-20 lg:py-14"}>
   {introduction??<div className="max-w-xl">
    <div className="mb-6 flex size-14 items-center justify-center rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-soft)]"><TameionBrand compact/></div>
    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-ink-muted)]">{eyebrow}</p>
    <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em] text-[var(--color-ink)] sm:text-[42px] sm:leading-[1.08]">{title}</h1>
    <p className="mt-4 max-w-lg text-base leading-7 text-[var(--color-ink-muted)]">{description}</p>
    {details}
    {boundary&&<div className="mt-4 border-s-2 border-[var(--color-accent)] ps-3 text-sm leading-6 text-[var(--color-ink)]">{boundary}</div>}
   </div>}
   {children}
  </section>
  <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border)] pt-4 text-xs text-[var(--color-ink-muted)]"><span>Private finance workspace</span><span>Payments require separate approval</span></footer>
 </main>;
}

export function OperatorAccessCard({heading,description,children}:{heading:string;description:string;children:ReactNode}){
 return <section aria-labelledby="operator-access-heading" className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-card)] sm:p-7">
  <h2 id="operator-access-heading" className="text-xl font-semibold text-[var(--color-ink)]">{heading}</h2>
  <p className="mt-2 text-sm leading-6 text-[var(--color-ink-muted)]">{description}</p>
  {children}
 </section>;
}
