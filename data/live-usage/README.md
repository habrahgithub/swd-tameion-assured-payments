# J0-C LIVE_USAGE_SET

This directory contains the privacy-safe J0-C genuine-usage dataset.

## Boundary

- Exactly five current business obligations are included.
- Raw invoices, names, addresses, invoice numbers, account numbers, card details and bank details are not committed.
- Counterparties and source destinations use opaque tokens; source payment routes are separately bound by `source_destination_evidence` fingerprints.
- The immutable J0-C record retains its original `PENDING_J0_D_TRUST_SEED` status. Current J0-D destination/source-wallet readiness is derived separately from the current authority aggregate and never rewrites this source snapshot. Source payment-route evidence remains a distinct provenance class.
- Amount, currency, due-date state, cadence, commercial category and currentness are retained because they are decision-relevant.
- Source documents remain private; SHA-256 binds the normalized public record to retained private evidence.
- candidate_selection_performed is fixed to false.
- No PAY/HOLD/ESCALATE result, candidate flag, rank, score, priority or payment recommendation belongs in J0-C.

## Auxiliary evidence

The source ledger also retains non-live-set classifications for a settled recurring bank charge, a personal outstanding charge, and a founder-remuneration attestation pending accounting/source corroboration.

Those auxiliary records are not executable obligations in this J0-C dataset.

## Schema correction and regression proof

The reviewed schema checked individual field types but did not encode the privacy and provenance relationships documented above. The schema owns this correction: destination references now accept only `DEST-J0C-` plus three digits or null; all date fields enforce calendar dates (including leap years) without depending on format assertion. Stated due dates require a date and true readiness; unstated dates require null and false readiness. PDF evidence requires document/snapshot/private-source metadata and forbids email hash scope. Email excerpts require excerpt/normalized-claim/raw-email-retention metadata and the normalized-claim hash scope.

Run from the repository root with Python `jsonschema` available. This uses the production schema and dataset, mutates only in-memory copies, and deliberately disables format assertion. Before correction, 61 of these 91 expectations failed; afterward all pass. Existing candidate-selection, pending Arc trust, fingerprint and unknown-property boundaries are also replayed. No private source values are used.

```bash
python3 - <<'PY'
import copy
import itertools
import json
from pathlib import Path
from jsonschema import Draft202012Validator

root = Path('data/live-usage')
schema = json.loads((root / 'LIVE_USAGE_SET.schema.json').read_text())
data = json.loads((root / 'LIVE_USAGE_SET.json').read_text())
Draft202012Validator.check_schema(schema)
v = Draft202012Validator(schema)  # Deliberately no format checker.
assert v.is_valid(data)
cases = []
def case(path, value, valid=False, delete=False):
    sample = copy.deepcopy(data)
    target = sample
    for key in path[:-1]:
        target = target[key]
    if delete:
        del target[path[-1]]
    else:
        target[path[-1]] = value
    cases.append((sample, valid))

for token in ('', 'not-an-opaque-token', 'DEST-J0C-01', 'DEST-J0C-001\n'):
    case(['records', 0, 'source_destination_reference_token'], token)
for token in (None, 'DEST-J0C-999'):
    case(['records', 0, 'source_destination_reference_token'], token, True)
for path in (['event_baseline_date'], ['records', 1, 'issue_date'],
             ['records', 1, 'due_date'], ['records', 1, 'currentness_attestation', 'recorded_at']):
    for value in ('', 'not-a-date', '0000-01-01', '2026-9-01', '2026-00-01', '2026-13-01',
                  '2026-04-31', '2026-02-29', '1900-02-29', '2026-09-27\n'):
        case(path, value)
    for value in ('2026-09-27', '2024-02-29', '2000-02-29'):
        case(path, value, True)
for date, status, known in itertools.product((None, '2026-09-27'),
        ('STATED_ON_SOURCE', 'NOT_STATED_ON_SOURCE'), (False, True)):
    sample = copy.deepcopy(data)
    sample['records'][0].update(due_date=date, due_date_status=status)
    sample['records'][0]['candidate_readiness']['due_date_known'] = known
    expected = (date is not None) == (status == 'STATED_ON_SOURCE') == known
    cases.append((sample, expected))
for index in (0, 1, 4):
    path = ['records', index, 'source_evidence', 0]
    evidence = data['records'][index]['source_evidence'][0]
    for field, alternatives in {
        'provenance_class': ('USER_SUPPLIED_SOURCE_DOCUMENT', 'USER_SUPPLIED_SOURCE_EXCERPT'),
        'currentness': ('IMMUTABLE_SOURCE_SNAPSHOT', 'NORMALIZED_SOURCE_CLAIM'),
        'retention': ('PRIVATE_SOURCE_NOT_COMMITTED', 'RAW_EMAIL_NOT_COMMITTED'),
    }.items():
        for value in alternatives:
            case(path + [field], value, value == evidence[field])
    if index == 4:
        case(path + ['content_hash_scope'], None, delete=True)
    else:
        case(path + ['content_hash_scope'], 'NORMALIZED_CLAIM_NOT_RAW_EMAIL')
# Replay existing fail-closed boundaries.
case(['candidate_selection_performed'], True)
case(['records', 0, 'arc_product_destination_status'], 'TRUSTED')
case(['records', 0, 'source_destination_evidence', 'fingerprint_sha256'], 'bad')
case(['records', 0, 'source_evidence', 0, 'unexpected'], True)
failures = sum(v.is_valid(sample) != expected for sample, expected in cases)
print(f'{len(cases)} cases; {failures} expectation failures')
assert failures == 0
PY
```
