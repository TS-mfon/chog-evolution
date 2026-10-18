# GenLayer adjudicator

`ClaimAdjudicator.py` is a version-pinned Intelligent Contract. It accepts a quest policy, HTTPS source URL, exact evidence text, SHA-256 evidence hash, and caller correlation reference. The leader judges the evidence; each validator independently fetches the source, verifies that its content hash matches the submitted evidence, repeats the judgment, and compares outcome, quest, evidence identity, and XP. If the source is unavailable or changed, validation rejects the leader result and cannot authorize XP.

The decision schema is `outcome` (`accepted`, `rejected`, `needs_review`, or `source_unavailable`), `evidence_hash`, `quest_id`, `reason`, `xp` (bounded to 10000 and forced to zero unless accepted), and `reference`. The reference is a caller-supplied correlation ID; the GenLayer transaction/decision reference must also be recorded by the submitting adapter from the actual network response. The contract does not award XP itself.

The adapter must submit deterministic chain facts separately, wait for the documented finalized state of the actual deployed GenLayer network, and validate the final decision against the exact stored quest policy before crediting XP. No deployed address, network, or chain values are claimed by this repository.
