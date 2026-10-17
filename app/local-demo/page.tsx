import { headers } from "next/headers";
import { localNextRequestAllowed } from "../../src/demo/local-walkthrough";
import { LocalWalkthrough } from "./walkthrough";

export const dynamic = "force-dynamic";
export default async function LocalDemoPage() {
  const requestHeaders=await headers();
  const hosted=Boolean(process.env.VERCEL || process.env.VERCEL_ENV || process.env.CF_PAGES || process.env.NETLIFY || process.env.RENDER);
  if(!localNextRequestAllowed(new Headers(requestHeaders),hosted))return <main className="p-6"><h1>Local synthetic walkthrough</h1><p role="alert">LOCAL_ONLY: direct loopback access required. No mock journey activated.</p></main>;
  return <LocalWalkthrough />;
}
