"use client";

import { useEffect, useState } from "react";

interface ObligationSummary {
  obligation_id: string;
  service_category: string;
  amount: string;
  currency: "AED" | "USD";
  recurrence: string;
  due_date: string | null;
  commercial_terms: string;
}

interface ObligationDetail {
  aggregate: Record<string, unknown>;
  record: Record<string, unknown>;
  demo_arc_trust_seeded: boolean;
  pae_sealed: boolean;
  execution: Record<string, unknown> | null;
}

type PanelKey = "evidence" | "decision" | "authorization" | "settlement" | "timeline";

const PANELS: Array<{ key: PanelKey; label: string }> = [
  { key: "evidence", label: "1. Obligation & Evidence" },
  { key: "decision", label: "2. Agent Decision" },
  { key: "authorization", label: "3. Authorization / Safety Proof" },
  { key: "settlement", label: "4. Arc Settlement & Reconciliation" },
  { key: "timeline", label: "5. Evidence Timeline / Blocked Attack" },
];

async function postJson(url: string, body?: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  return { ok: response.ok, status: response.status, data };
}

function Pre({ value }: { value: unknown }) {
  return (
    <pre className="max-h-96 overflow-auto rounded-lg bg-slate-950 p-4 text-xs leading-relaxed text-slate-100">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export function CommandCenter() {
  const [obligations, setObligations] = useState<ObligationSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [panel, setPanel] = useState<PanelKey>("evidence");
  const [detail, setDetail] = useState<ObligationDetail | null>(null);
  const [lastResult, setLastResult] = useState<{ label: string; data: unknown } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/obligations")
      .then((r) => r.json())
      .then((data) => {
        setObligations(data.obligations);
        if (data.obligations[0]) setSelectedId(data.obligations[0].obligation_id);
      });
  }, []);

  const refreshDetail = async (id: string) => {
    const response = await fetch(`/api/obligations/${id}`);
    const data = await response.json();
    setDetail(data);
    return data as ObligationDetail;
  };

  useEffect(() => {
    if (selectedId) void refreshDetail(selectedId);
  }, [selectedId]);

  const run = async (label: string, action: () => Promise<{ ok: boolean; status: number; data: unknown }>) => {
    setBusy(true);
    try {
      const result = await action();
      setLastResult({ label, data: result.data });
      await refreshDetail(selectedId);
    } finally {
      setBusy(false);
    }
  };

  const selected = obligations.find((o) => o.obligation_id === selectedId);
  const aggregateVersion = (detail?.aggregate as { aggregate_version?: number } | undefined)?.aggregate_version;

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-6 py-10">
      <header className="space-y-2">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
          Tameion — Assured Payment Agent
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Command Center (prototype)</h1>
        <p className="max-w-3xl text-sm leading-6 text-slate-600">
          AI decides what should be paid; deterministic, cryptographically bound controls decide what can
          actually move. This is a PROTOTYPE build: execution below runs against a deterministic in-memory
          simulator, not a live Circle/Arc Testnet call — this environment holds no live provider
          credentials, so the J0-D connectivity spike has not been executed and Arc destination trust shown
          here is <span className="font-semibold text-amber-700">SIMULATED</span>, not real.
        </p>
      </header>

      <section className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
        <label className="text-sm font-medium text-slate-700" htmlFor="obligation-select">
          Obligation
        </label>
        <select
          id="obligation-select"
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm"
          value={selectedId}
          onChange={(event) => {
            setSelectedId(event.target.value);
            setLastResult(null);
          }}
        >
          {obligations.map((o) => (
            <option key={o.obligation_id} value={o.obligation_id}>
              {o.obligation_id} — {o.amount} {o.currency} ({o.service_category})
            </option>
          ))}
        </select>
        {selected && (
          <span className="text-xs text-slate-500">Terms: {selected.commercial_terms}</span>
        )}
      </section>

      <nav className="flex flex-wrap gap-2">
        {PANELS.map((p) => (
          <button
            key={p.key}
            onClick={() => setPanel(p.key)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
              panel === p.key ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            {p.label}
          </button>
        ))}
      </nav>

      <section className="grid gap-4 rounded-lg border border-slate-200 p-5">
        {panel === "evidence" && (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold">Obligation &amp; Evidence</h2>
            <p className="text-sm text-slate-600">
              Current authority aggregate for the selected obligation (aggregate_version is the concurrency
              root every later step is bound to).
            </p>
            <Pre value={detail} />
          </div>
        )}

        {panel === "decision" && (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold">Agent Decision</h2>
            <p className="text-sm text-slate-600">
              Runs the Finance Agent (read-only: it can only return a PAY/HOLD/ESCALATE recommendation — it
              cannot approve, sign, or execute anything).
            </p>
            <button
              disabled={busy || !selectedId}
              onClick={() => run("assess", () => postJson(`/api/obligations/${selectedId}/assess`))}
              className="w-fit rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Run Finance Agent Assessment
            </button>
            {lastResult?.label === "assess" && <Pre value={lastResult.data} />}
          </div>
        )}

        {panel === "authorization" && (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold">Authorization / Safety Proof</h2>
            <p className="text-sm text-slate-600">
              One T1 human approval atomically transitions reviewed aggregate N → authorized N+1, then the
              deterministic Safety Kernel evaluates all 10 required controls on N+1. A signed PAE is only
              produced when every control PASSes.
            </p>
            <button
              disabled={busy || !selectedId || aggregateVersion === undefined}
              onClick={() =>
                run("approve", () =>
                  postJson(`/api/obligations/${selectedId}/approve`, { expected_version: aggregateVersion }),
                )
              }
              className="w-fit rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Approve &amp; Seal PAE (reviewed v{aggregateVersion ?? "?"})
            </button>
            {lastResult?.label === "approve" && <Pre value={lastResult.data} />}
          </div>
        )}

        {panel === "settlement" && (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold">Arc Settlement &amp; Reconciliation</h2>
            <p className="text-sm text-slate-600">
              Execution Worker independently re-verifies the sealed PAE, re-resolves current destination/
              wallet trust, then submits (simulated) and reconciles one-to-one against the obligation.
            </p>
            <button
              disabled={busy || !selectedId || !detail?.pae_sealed}
              onClick={() => run("execute", () => postJson(`/api/obligations/${selectedId}/execute`))}
              className="w-fit rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Execute Sealed PAE (simulated Arc Testnet)
            </button>
            {!detail?.pae_sealed && <p className="text-xs text-amber-700">Approve the obligation first.</p>}
            {lastResult?.label === "execute" && <Pre value={lastResult.data} />}
          </div>
        )}

        {panel === "timeline" && (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold">Evidence Timeline / Blocked Attack</h2>
            <p className="text-sm text-slate-600">
              Demo attack path: after a PAE is sealed, mutate the destination as if it had been changed by a
              compromised session — the Execution Worker must BLOCK before any provider submission, with
              zero unauthorized movement.
            </p>
            <button
              disabled={busy || !selectedId || !detail?.pae_sealed}
              onClick={() => run("attack", () => postJson(`/api/obligations/${selectedId}/simulate-attack`))}
              className="w-fit rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Simulate Changed-Destination Attack
            </button>
            {!detail?.pae_sealed && <p className="text-xs text-amber-700">Approve the obligation first.</p>}
            {lastResult?.label === "attack" && <Pre value={lastResult.data} />}
          </div>
        )}
      </section>
    </main>
  );
}
