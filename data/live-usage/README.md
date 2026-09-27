# J0-C LIVE_USAGE_SET

This directory contains the privacy-safe J0-C genuine-usage dataset.

## Boundary

- Exactly five current business obligations are included.
- Raw invoices, names, addresses, invoice numbers, account numbers, card details and bank details are not committed.
- Counterparties and destinations use opaque tokens.
- Amount, currency, due-date state, cadence, commercial category and currentness are retained because they are decision-relevant.
- Source documents remain private; SHA-256 binds the normalized public record to retained private evidence.
- candidate_selection_performed is fixed to false.
- No PAY/HOLD/ESCALATE result, candidate flag, rank, score, priority or payment recommendation belongs in J0-C.

## Auxiliary evidence

The source ledger also retains non-live-set classifications for a settled recurring bank charge, a personal outstanding charge, and a founder-remuneration attestation pending accounting/source corroboration.

Those auxiliary records are not executable obligations in this J0-C dataset.
