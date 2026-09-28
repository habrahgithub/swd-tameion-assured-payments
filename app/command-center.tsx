"use client";

import { useEffect, useMemo, useState } from "react";

interface ObligationSummary {
  obligation_id: string;
  service_category: string;
  amount: string;
  currency: "AED" | "USD";
  recurrence: string;
  due_date: string | null;
  commercial_terms: string;
}

interface AggregateView {
  aggregate_version: number;
  state: string;
  amount: string;
  asset: string;
  network: string;
  destination_address: string;
  destination_verification_status: string;
  destination_operational_status: string;
  source_wallet_ref: string;
  execution_state: string;
  pae_state: string;
}

interface ObligationDetail {
  aggregate: AggregateView;
  record: Record<string, unknown>;
  demo_arc_trust_seeded: boolean;
  pae_sealed: boolean;
  execution: { status: string; provider_ref: string | null } | null;
}

type PanelKey = "obligations" | "assessment" | "authorization" | "assurance" | "reconciliation";

const PANELS: Array<{ key: PanelKey; label: string }> = [
  { key: "obligations", label: "Obligations" },
  { key: "assessment", label: "Assessment" },
  { key: "authorization", label: "Authorization" },
  { key: "assurance", label: "Assurance & Execution" },
  { key: "reconciliation", label: "Reconciliation & Evidence" },
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

type Tone = "neutral" | "info" | "success" | "warning" | "danger";

const TONE_STYLE: Record<Tone, { border: string; text: string }> = {
  neutral: { border: "border-l-[3px] border-l-[var(--color-border)]", text: "text-[var(--color-ink-muted)]" },
  info: { border: "border-l-[3px] border-l-[var(--color-ink)]", text: "text-[var(--color-ink)]" },
  success: { border: "border-l-[3px] border-l-[var(--color-success)]", text: "text-[var(--color-success)]" },
  warning: { border: "border-l-[3px] border-l-[var(--color-warning)]", text: "text-[var(--color-warning)]" },
  danger: { border: "border-l-[3px] border-l-[var(--color-danger)]", text: "text-[var(--color-danger)]" },
};

/** Explicit workflow state, never expressed by colour alone. */
function workflowState(detail: ObligationDetail | null): { label: string; tone: Tone; explanation: string } {
  if (!detail) return { label: "Loading", tone: "neutral", explanation: "" };
  const { aggregate, execution } = detail;

  if (execution?.status === "SETTLED" && aggregate.state === "RECONCILED") {
    return { label: "Reconciled", tone: "success", explanation: "Settlement matches the authorized obligation exactly." };
  }
  if (execution?.status === "BLOCKED" || aggregate.execution_state === "BLOCKED") {
    return {
      label: "Blocked",
      tone: "danger",
      explanation: "A pre-submit or reconciliation check failed. No unauthorized movement occurred.",
    };
  }
  if (execution?.status === "UNKNOWN") {
    return {
      label: "Provider response unknown",
      tone: "warning",
      explanation: "Awaiting provider/chain truth. The system will not blind-retry submission.",
    };
  }
  if (execution?.status === "FAILED") {
    return { label: "Execution failed", tone: "danger", explanation: "Provider confirmed the attempt failed." };
  }
  if (aggregate.execution_state === "SUBMITTED" || aggregate.execution_state === "SUBMITTING") {
    return { label: "Submitted to provider", tone: "info", explanation: "Simulated Arc Testnet submission in flight." };
  }
  if (detail.pae_sealed && aggregate.state === "AUTHORIZED") {
    return {
      label: "Authorized — PAE sealed",
      tone: "success",
      explanation: "Human authorization is bound to a signed Payment Authorization Envelope, ready for execution.",
    };
  }
  if (aggregate.state === "APPROVAL_PENDING") {
    return { label: "Awaiting human authorization", tone: "neutral", explanation: "No approval has been recorded yet." };
  }
  return { label: aggregate.state, tone: "neutral", explanation: "" };
}

function StateLine({ tone, label, explanation }: { tone: Tone; label: string; explanation?: string }) {
  const style = TONE_STYLE[tone];
  return (
    <div className={`${style.border} pl-3 py-1`}>
      <p className={`text-[13px] font-semibold uppercase tracking-wide ${style.text}`}>{label}</p>
      {explanation && <p className="mt-0.5 text-[13px] text-[var(--color-ink-muted)]">{explanation}</p>}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-[var(--color-border)] py-1.5">
      <dt className="text-[13px] text-[var(--color-ink-muted)]">{label}</dt>
      <dd className="tabular text-[13px] font-medium text-[var(--color-ink)]">{value}</dd>
    </div>
  );
}

function EvidencePanel({ value }: { value: unknown }) {
  return (
    <details className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs">
      <summary className="cursor-pointer select-none text-[var(--color-ink-muted)]">Raw evidence / response</summary>
      <pre className="tabular mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-[var(--color-ink)]">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}

function PrimaryButton({
  onClick,
  disabled,
  children,
  danger,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-fit rounded px-4 py-2 text-[13px] font-semibold tracking-wide text-white transition disabled:cursor-not-allowed disabled:opacity-40 ${
        danger ? "bg-[var(--color-danger)] hover:opacity-90" : "bg-[var(--color-ink)] hover:opacity-90"
      }`}
    >
      {children}
    </button>
  );
}

type ActionResult = { label: string; data: unknown; ok: boolean; status: number };

function actionErrorMessage(data: unknown): string {
  if (data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string") {
    return (data as { error: string }).error;
  }
  return "The request did not succeed.";
}

function ActionResultBanner({ result }: { result: ActionResult }) {
  if (result.ok) return null;
  return (
    <div className="border-l-[3px] border-l-[var(--color-danger)] bg-[var(--color-surface)] px-3 py-2">
      <p className="text-[13px] font-semibold uppercase tracking-wide text-[var(--color-danger)]">
        Refused (HTTP {result.status})
      </p>
      <p className="mt-0.5 text-[13px] text-[var(--color-ink)]">{actionErrorMessage(result.data)}</p>
    </div>
  );
}

export function CommandCenter() {
  const [obligations, setObligations] = useState<ObligationSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [panel, setPanel] = useState<PanelKey>("obligations");
  const [detail, setDetail] = useState<ObligationDetail | null>(null);
  const [lastResult, setLastResult] = useState<ActionResult | null>(null);
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
      setLastResult({ label, data: result.data, ok: result.ok, status: result.status });
      await refreshDetail(selectedId);
    } finally {
      setBusy(false);
    }
  };

  const selected = obligations.find((o) => o.obligation_id === selectedId);
  const state = useMemo(() => workflowState(detail), [detail]);
  const aggregateVersion = detail?.aggregate?.aggregate_version;

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-5 px-6 py-8">
      <header className="flex items-baseline justify-between border-b border-[var(--color-border)] pb-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--color-ink-muted)]">
            Tameion
          </p>
          <h1 className="text-xl font-semibold text-[var(--color-ink)]">Assured Payment — Command Center</h1>
        </div>
        <p className="max-w-sm text-right text-[12px] leading-5 text-[var(--color-ink-muted)]">
          Execution here is simulated (no live Circle/Arc credentials in this build). Arc destination trust
          shown is a labeled simulation, not a completed J0-D spike.
        </p>
      </header>

      <div className="grid grid-cols-[280px_1fr] gap-5">
        <aside className="border-r border-[var(--color-border)] pr-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
            Obligations
          </p>
          <ul>
            {obligations.map((o) => (
              <li key={o.obligation_id}>
                <button
                  onClick={() => {
                    setSelectedId(o.obligation_id);
                    setLastResult(null);
                  }}
                  className={`flex w-full flex-col gap-0.5 border-b border-[var(--color-border)] px-2 py-2 text-left transition ${
                    o.obligation_id === selectedId ? "bg-[var(--color-surface)]" : "hover:bg-[var(--color-surface)]"
                  }`}
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="text-[12px] font-medium text-[var(--color-ink)]">{o.obligation_id}</span>
                    <span className="tabular shrink-0 text-[12px] text-[var(--color-ink-muted)]">
                      {o.amount} {o.currency}
                    </span>
                  </span>
                  <span className="truncate text-[12px] text-[var(--color-ink-muted)]">
                    {o.service_category.replaceAll("_", " ").toLowerCase()}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="flex flex-col gap-4">
          {selected && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold text-[var(--color-ink)]">{selected.obligation_id}</h2>
                <p className="text-[12px] text-[var(--color-ink-muted)]">{selected.commercial_terms}</p>
              </div>
              <StateLine tone={state.tone} label={state.label} explanation={state.explanation} />
            </div>
          )}

          <nav className="flex gap-5 border-b border-[var(--color-border)]">
            {PANELS.map((p) => (
              <button
                key={p.key}
                onClick={() => setPanel(p.key)}
                className={`border-b-2 pb-2 text-[13px] font-medium transition ${
                  panel === p.key
                    ? "border-[var(--color-ink)] text-[var(--color-ink)]"
                    : "border-transparent text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
                }`}
              >
                {p.label}
              </button>
            ))}
          </nav>

          <div className="min-h-[320px]">
            {panel === "obligations" && detail && (
              <dl className="max-w-md">
                <Field label="Amount (authoritative)" value={`${detail.aggregate.amount} ${detail.aggregate.asset}`} />
                <Field label="Network" value={detail.aggregate.network} />
                <Field label="Aggregate version" value={String(detail.aggregate.aggregate_version)} />
                <Field label="Source wallet" value={detail.aggregate.source_wallet_ref} />
                <Field
                  label="Destination trust"
                  value={`${detail.aggregate.destination_verification_status} / ${detail.aggregate.destination_operational_status}${detail.demo_arc_trust_seeded ? " (simulated)" : ""}`}
                />
              </dl>
            )}

            {panel === "assessment" && (
              <div className="max-w-xl space-y-3">
                <p className="text-[13px] text-[var(--color-ink-muted)]">
                  The Finance Agent reads this obligation and returns exactly one PAY / HOLD / ESCALATE
                  recommendation with reasons. It cannot approve, sign, or execute anything.
                </p>
                <PrimaryButton disabled={busy || !selectedId} onClick={() => run("assess", () => postJson(`/api/obligations/${selectedId}/assess`))}>
                  Run assessment
                </PrimaryButton>
                {lastResult?.label === "assess" && <ActionResultBanner result={lastResult} />}
                {lastResult?.label === "assess" && <EvidencePanel value={lastResult.data} />}
              </div>
            )}

            {panel === "authorization" && (
              <div className="max-w-xl space-y-3">
                <p className="text-[13px] text-[var(--color-ink-muted)]">
                  Authorizing this exact intent (aggregate v{aggregateVersion ?? "?"}) atomically advances
                  reviewed → authorized state, runs the deterministic Safety Kernel, and — only if every
                  control PASSes — seals a signed Payment Authorization Envelope.
                </p>
                <div className="flex gap-3">
                  <PrimaryButton
                    disabled={busy || !selectedId || aggregateVersion === undefined}
                    onClick={() =>
                      run("approve", () =>
                        postJson(`/api/obligations/${selectedId}/approve`, { expected_version: aggregateVersion }),
                      )
                    }
                  >
                    Authorize this exact intent
                  </PrimaryButton>
                </div>
                {lastResult?.label === "approve" && <ActionResultBanner result={lastResult} />}
                {lastResult?.label === "approve" && <EvidencePanel value={lastResult.data} />}
              </div>
            )}

            {panel === "assurance" && (
              <div className="max-w-xl space-y-3">
                <p className="text-[13px] text-[var(--color-ink-muted)]">
                  The Execution Worker independently re-verifies the sealed envelope and current destination/
                  wallet trust before submitting — a changed destination is blocked here, before any provider
                  call.
                </p>
                <div className="flex flex-wrap items-center gap-4">
                  <PrimaryButton disabled={busy || !selectedId || !detail?.pae_sealed} onClick={() => run("execute", () => postJson(`/api/obligations/${selectedId}/execute`))}>
                    Submit for execution (simulated)
                  </PrimaryButton>
                  <button
                    disabled={busy || !selectedId || !detail?.pae_sealed}
                    onClick={() =>
                      run("prime-packet", async () => {
                        const response = await fetch(`/api/obligations/${selectedId}/prime-approval-packet`);
                        return { ok: response.ok, status: response.status, data: await response.json() };
                      })
                    }
                    className="text-[13px] font-medium text-[var(--color-ink)] underline decoration-[var(--color-border)] underline-offset-4 hover:decoration-[var(--color-ink)] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    View exact intent for a real J2 transfer (Prime approval packet)
                  </button>
                </div>
                {!detail?.pae_sealed && (
                  <p className="text-[12px] text-[var(--color-warning)]">Authorize the obligation first.</p>
                )}
                {lastResult?.label === "execute" && <ActionResultBanner result={lastResult} />}
                {lastResult?.label === "execute" && <EvidencePanel value={lastResult.data} />}
                {lastResult?.label === "prime-packet" && <ActionResultBanner result={lastResult} />}
                {lastResult?.label === "prime-packet" && lastResult.ok && (
                  <div className="max-w-xl border-l-[3px] border-l-[var(--color-warning)] pl-3">
                    <p className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-[var(--color-warning)]">
                      Retained Prime gate — not submitted
                    </p>
                    <pre className="tabular whitespace-pre-wrap text-[12px] leading-relaxed text-[var(--color-ink)]">
                      {(lastResult.data as { text?: string })?.text ?? JSON.stringify(lastResult.data, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}

            {panel === "reconciliation" && (
              <div className="max-w-xl space-y-3">
                <p className="text-[13px] text-[var(--color-ink-muted)]">
                  Demonstration attack: mutate the destination after authorization, as if a compromised
                  session changed it. Expected result — blocked before submission, zero unauthorized
                  movement.
                </p>
                <PrimaryButton
                  danger
                  disabled={busy || !selectedId || !detail?.pae_sealed}
                  onClick={() => run("attack", () => postJson(`/api/obligations/${selectedId}/simulate-attack`))}
                >
                  Simulate changed-destination attack
                </PrimaryButton>
                {!detail?.pae_sealed && (
                  <p className="text-[12px] text-[var(--color-warning)]">Authorize the obligation first.</p>
                )}
                {lastResult?.label === "attack" && <ActionResultBanner result={lastResult} />}
                {lastResult?.label === "attack" && <EvidencePanel value={lastResult.data} />}
                {detail && <EvidencePanel value={detail} />}
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
