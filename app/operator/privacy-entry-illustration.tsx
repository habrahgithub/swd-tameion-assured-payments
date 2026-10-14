/** Calm conceptual composition: no session secrets or financial state. */
export function PrivacyEntryIllustration(){
 return <figure className="mt-4 max-w-md overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[#0b132b] p-3 shadow-[var(--shadow-soft)]">
  <svg viewBox="0 0 400 155" role="img" aria-label="Tameion shield and document illustration" className="block h-[90px] w-full sm:h-auto">
   <ellipse cx="200" cy="78" rx="165" ry="50" fill="none" stroke="#c5a059" strokeOpacity=".35"/>
   <ellipse cx="200" cy="78" rx="145" ry="42" transform="rotate(-14 200 78)" fill="none" stroke="#fff" strokeOpacity=".18"/>
   <g fill="#182235" stroke="#d8b66d" strokeOpacity=".7"><rect x="38" y="39" width="47" height="67" rx="5" transform="rotate(-12 61 72)"/><rect x="307" y="47" width="47" height="67" rx="5" transform="rotate(12 331 80)"/></g>
   <g stroke="#fff" strokeOpacity=".7" strokeWidth="2" strokeLinecap="round"><path d="m47 54 23-5m-21 15 26-5m-24 15 19-4m244-10 24 5m-26 5 27 6m-29 4 20 5"/></g>
   <g fill="#d8b66d"><circle cx="109" cy="52" r="3"/><circle cx="286" cy="107" r="3"/><circle cx="122" cy="115" r="2"/><circle cx="286" cy="40" r="2"/></g>
   <image href="/brand/tameion-app-icon.svg" x="140" y="17" width="120" height="120"/>
  </svg>
  <figcaption className="mt-1 text-center text-xs leading-5 text-[#d8b66d]">Concept illustration · Private workspace</figcaption>
 </figure>;
}
