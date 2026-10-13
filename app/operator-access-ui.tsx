import type {ReactNode} from 'react';

type AccessShellProps={
 eyebrow:string;
 title:string;
 description:string;
 boundary?:ReactNode;
 details?:ReactNode;
 brandHref?:string;
 children:ReactNode;
};

function Brand({href}:{href?:string}){
 const content=<><span className="block text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--color-ink-muted)]">Tameion</span><span className="mt-1 block text-base font-semibold text-[var(--color-ink)]">Assured Payment — Command Center</span></>;
 return <header className="border-b border-[var(--color-border)] pb-4">{href?<a href={href} className="block w-fit rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-ink)]">{content}</a>:content}</header>;
}

export function OperatorAccessShell({eyebrow,title,description,boundary,details,brandHref,children}:AccessShellProps){
 return <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-5 py-6 sm:px-8 sm:py-8">
  <Brand href={brandHref}/>
  <section className="grid flex-1 items-center gap-8 py-10 lg:grid-cols-[minmax(0,1fr)_25rem] lg:gap-16">
   <div className="max-w-xl">
    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-ink-muted)]">{eyebrow}</p>
    <h1 className="mt-2 text-3xl font-semibold tracking-[-0.02em] text-[var(--color-ink)] sm:text-4xl">{title}</h1>
    <p className="mt-4 max-w-lg text-base leading-7 text-[var(--color-ink-muted)]">{description}</p>
    {details}
    {boundary&&<div className="mt-4 border-s-2 border-[var(--color-accent)] ps-3 text-sm leading-6 text-[var(--color-ink)]">{boundary}</div>}
   </div>
   {children}
  </section>
  <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border)] pt-4 text-xs text-[var(--color-ink-muted)]"><span>Private finance workspace</span><span>Payments require separate approval</span></footer>
 </main>;
}

export function OperatorAccessCard({heading,description,children}:{heading:string;description:string;children:ReactNode}){
 return <section aria-labelledby="operator-access-heading" className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-[0_18px_50px_rgba(11,19,43,0.06)] sm:p-7">
  <h2 id="operator-access-heading" className="text-xl font-semibold text-[var(--color-ink)]">{heading}</h2>
  <p className="mt-2 text-sm leading-6 text-[var(--color-ink-muted)]">{description}</p>
  {children}
 </section>;
}
