# Assessment v5 synthetic regression

`protocol.json` and the original family contract were frozen before the v5 generator and this oracle were implemented. The protocol remains unchanged; the family contract was revised once in the documented second development iteration. `fresh-oracle.mjs` was written from the public family contract before reading the generator. It computes labels solely from public text, skill and declared grade. The separate hand-computed fixtures cover all 24 families and additional boundary cases. This is implementation independence within a developer-authored exercise, not expert or conceptual independence.

`baseline-v4.mjs` is an exact copy of the pre-change assessment module. Legacy labels are computed by the earlier semantic reference oracle on complete baseline forms, then cached by public prompt across 10,000 seeds per category. Neither fresh nor legacy reference labels read the stored answer key. Missing cache entries or conflicting labels fail closed.

Reproduce:

- `node --test tests/assessment-v5.test.mjs`
- `node scripts/evaluate-assessment-v5.mjs`

The evaluator writes `evaluation-results.json` and evaluates both versions on the same frozen seed intervals. This run takes approximately one minute because it reconstructs the legacy label cache. Training sizes are cumulative; the memorizer receives oracle labels during training, then infers only from public text, format and sorted choices. It does not inspect hidden answers, concept IDs or applied flags at inference.

Profiles model fixed synthetic knowledge coverage, not people. Their `unorderedPairPassFlipRate` is exactly `2*p*(N-p)/(N*(N-1))`, the fraction of unordered pairs of forms with different pass outcomes. It is not a measured human test-retest reliability statistic. The `legacy-only` and `fresh-plus-knowledge` profiles have intentionally different covered item counts between v4 and v5, so they diagnose the new form structure rather than compare equal human ability.

Concept overlap uses all unordered form pairs. Fresh prompt repetition counts occurrences after the first identical public text; distinct answers are counted within each fresh family. Text variation is not new concept coverage: all v5 forms still contain the same four fresh family concepts for a category. Small answer spaces and exact prompt collisions are reported rather than hidden.

There are no human participants, unseen conceptual holdout, LLM solver, proctoring, professional-grade validation, or hiring-outcome data. Lower exact-prompt memorizer pass rates support only that narrow regression claim. Partial profiles can remain highly seed-sensitive, and some pass-flip metrics worsen.

## Second development iteration

`iteration-1-results.json` preserves the initial findings, including Frontend Junior memorizer passes of 19.33% after 500 training forms and Accessibility Junior fresh prompt repetitions of 25.33%. In response, Accessibility Junior added semantically meaningful hidden and inert-ancestor states on eight buttons; its oracle and hand fixtures were updated from the revised contract before inspecting the implementation. SQL Senior also removed an irrelevant unused limit input. `evaluation-results.json` is the second iteration on the SAME frozen development seeds. This is adaptive development reuse, explicitly not a new independent holdout. The original baseline report remains available for audit.

## Additional reviewer attack

Run `node scripts/evaluate-assessment-modal.mjs`. This post-hoc diagnostic adds a training-only modal-answer fallback for unseen exact prompts, grouped by public prefix before the data line. Saved results are in `modal-results.json`. Unlike the primary benchmark it uses stored answer keys as training labels; inference remains public-only. Its nontrivial pass rates are an explicit remaining weakness, not covered by the narrow exact-replay reduction claim.
