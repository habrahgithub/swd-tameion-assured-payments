/** Shared approved navy / white / gold identity; no external font or asset. */
export function TameionBrand({compact=false,href,className}:{compact?:boolean;href?:string;className?:string}){
 const image=compact?<img src="/brand/tameion-app-icon.svg" alt="Tameion" width="38" height="38" className="size-[38px] shrink-0"/>:<img src="/brand/tameion-wordmark.svg" alt="Tameion" width="180" height="40" className="block h-auto max-w-full"/>;
 const classes=className??(compact?'inline-flex shrink-0 rounded-lg':'inline-flex w-[180px] max-w-full shrink-0 rounded-lg bg-[#0b132b] px-2 py-1');
 return href?<a href={href} aria-label="Tameion home" className={classes}>{image}</a>:<span className={classes}>{image}</span>;
}
