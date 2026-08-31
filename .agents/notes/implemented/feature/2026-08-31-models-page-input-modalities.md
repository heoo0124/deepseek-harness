# Agent Note: Models page edits input modalities

Status: implemented

English | [中文](2026-08-31-models-page-input-modalities.zh.md)

## Problem

Both LLM adapters already declared a model's accepted request modalities and both enforced them: `llm-deepseek` reads `inputModalities` and `llm-pi-ai` reads `input`, and the seam downgrades images to text placeholders for a model whose list omits `image` while `llm-deepseek` prices image payloads from the same declaration. Nothing about that was editable from the product. The Models settings page edited `contextWindow` and `maxTokens` and stopped there, so declaring a multimodal model meant leaving the GUI for `settings.yaml`.

[The pi-ai modality decision](../architecture/2026-08-12-pi-ai-route-default-input-modalities.md) settled the resolution chain and deliberately closed the configuration surface: "No configuration surface edits `input`." That exclusion is what this note reverses. Everything it decided about resolution — the entry → catalog → route chain, undeclared meaning `[text]`, an entry's empty list meaning no answer while the route's is refused, and the route value being a fallback rather than an override — stays exactly as shipped, and this note's writer is built to match it rather than to re-decide it.

The two families also do not agree on what an absent declaration means, which is the part that made a naive single field wrong:

- `llm-deepseek` defaults `inputModalities` to `['text']` and its schema refuses an empty list.
- `llm-pi-ai` reads an absent or empty `input` as "no answer here" and resolves it through the installed catalog entry, then the route's `defaultInput`.

## Decision

**Both model-catalog editors render one checkbox group per row, behind the row's existing capacity disclosure.** The group offers `text` and `image`, the complete modality vocabulary the seam declares today.

**Each family keeps its own field name.** `src/client/modality.ts` is the single writer, and it picks `inputModalities` or `input` from the family. A shared name was rejected because the empty states differ: normalizing pi-ai onto the deepseek field would need a mapping at every read and would collapse "declared text-only" into "inherited", a distinction the adapter's resolution actually observes.

**Text is the floor and cannot be cleared.** Clearing the last modality restores `['text']` rather than writing an empty list — deepseek's schema rejects one, and on pi-ai an empty list states "accepts nothing" instead of inheriting.

**An explicit declaration is never dropped for equaling the default.** Writing `input: ['text']` is kept rather than unset. This is the pi-ai half's whole point: an absent `input` still resolves through the installed catalog, so unsetting the field would widen a row the user just narrowed back to whatever the catalog entry says.

**The shared per-row validator became family-aware.** `validateDeepSeekModels` takes an optional family, defaulting to `deepseek` so existing call sites are unchanged, and pi-ai call sites pass `'pi-ai'`. Its modality rule only rejects values the checkbox group cannot write — a modality outside the pair, a repeat, an empty list, or a non-array — because those are what a hand-edited `settings.yaml` reaches the page with.

## Verification

Package suites cover the writer directly: both field names, the text floor, click-order-independent ordering, preservation of untouched fields, and the refusal to drop a narrowed declaration. Component suites render both editors, expand a row, and assert that toggling image writes that family's field. Mutating the writer so it records nothing turned seven of those cases red, so they are behavior evidence rather than coverage padding. `validateDeepSeekModels` cases pin that each family reads its own field and ignores the other's. The i18n source-ownership gate, the locale parity spec, `oxlint`, and the client aggregate `tsc -b` are green.

## Alternatives considered

**One shared field name with a translation layer.** Rejected because the mapping has to run at every read and write, and the pi-ai half loses the inherited-versus-declared distinction that its resolution depends on.

**A free-text or tag input.** Rejected because the vocabulary is a closed two-value set; a free field invites values the adapters reject and needs its own validation copy.

**Deriving the offered modalities from the seam's `ModelModalityMap`.** Rejected because that map is merge-extensible: a modality the seam adds is one this page cannot yet render or price, and a fixed list keeps that gap visible instead of drawing a box that resolves to nothing.

**Dropping the field when the result equals the floor.** Rejected above — it is the behavior the pi-ai tests pin against.

## Consequences

- A row the page has touched carries an explicit modality declaration, so narrowing a pi-ai model to text no longer silently inherits the catalog's list.
- Extending the modality vocabulary means editing `MODALITY_CHOICES`, the seam's `ModelModalityMap`, both adapters' gates, and the request-side downgrade and pricing paths together; the page's fixed list will not follow on its own.
- The checkbox group shows the resolved floor for a row with no declaration, so a pi-ai row inheriting `['text','image']` from its catalog entry renders as text-only until the row is edited. That reading is what both adapters resolve to, but it is not labeled as inherited.
