/**
 * Input-modality editing shared by both model-catalog editors.
 *
 * The two adapter families name one model's accepted request modalities
 * differently, and the difference is semantic rather than cosmetic:
 *
 * - `llm-deepseek` reads `inputModalities` and defaults it to `['text']`, so an
 *   absent field already means text-only and its schema refuses an empty list.
 * - `llm-pi-ai` reads `input`, where absent and empty both mean "no answer
 *   here" and resolution falls through to the installed catalog entry, then the
 *   route's `defaultInput`. Writing `[]` there would state an answer — a model
 *   that accepts nothing — instead of inheriting one.
 *
 * So this module writes each family's own field under its own empty-state rule
 * rather than normalizing both to one name. A shared name would need a mapping
 * at every read, and the pi-ai half would lose the distinction between
 * "declared text-only" and "inherited".
 *
 * @module dsh-client-ui-settings-models/modality
 */

import type { DeepSeekModelDraft } from './DeepSeekModelsEditor.tsx'

/**
 * The adapter family whose field name a draft is written with. Mirrors the
 * `family` discriminant {@link ProviderEditor} branches on to choose an editor.
 */
export type ModalityFamily = 'deepseek' | 'pi-ai'

/**
 * The modalities a profile may declare.
 *
 * Fixed rather than derived from the seam's merge-extensible `ModelModalityMap`:
 * a modality the seam adds is one this page cannot yet offer, and a fixed list
 * keeps that gap visible instead of rendering an unknown box.
 */
export const MODALITY_CHOICES = ['text', 'image'] as const

/** One modality a user may toggle. */
export type ModalityChoice = typeof MODALITY_CHOICES[number]

/**
 * The modalities one row declares, or the floor when it declares none.
 *
 * A row with no field reports the floor rather than `undefined`, because that is
 * what both adapters resolve an absent declaration to: deepseek's schema
 * default, and pi-ai's inheritance once its catalog and route are consulted.
 * Rendering the floor is therefore what the row already means, and the checkbox
 * group offers it as the state to edit away from.
 *
 * @param model - one drafted model row.
 * @param family - the adapter family reading this row.
 * @returns the effective modalities, never empty.
 */
export function effectiveModalities(
  model: DeepSeekModelDraft,
  family: ModalityFamily,
): readonly ModalityChoice[] {
  const value = model[fieldOf(family)]
  if (!Array.isArray(value)) return ['text']
  const declared = value.filter((entry): entry is ModalityChoice =>
    (MODALITY_CHOICES as readonly unknown[]).includes(entry))
  return declared.length === 0 ? ['text'] : declared
}

/**
 * One row with one modality toggled, written for one family.
 *
 * Text cannot be cleared: it is the floor every supported protocol carries, and
 * both families treat its absence as an answer worth refusing — deepseek's
 * schema rejects a list that omits nothing, and an image-only model would have
 * no way to receive the prompt. Clearing the last modality restores text rather
 * than writing `[]`.
 *
 * The field is written rather than dropped when the result equals the floor.
 * Dropping it would keep pi-ai's inheritance, which is the *opposite* of what a
 * user typing into this row asked for: a row the catalog still answers for
 * would snap back to the catalog's own list the moment the user narrowed it to
 * text. An explicit declaration is editable; an inherited one is not.
 *
 * @param model - one drafted model row.
 * @param family - the adapter family writing this row.
 * @param modality - the modality being turned on or off.
 * @param enabled - whether that modality is being selected.
 * @returns a detached row carrying the new modality declaration.
 */
export function withModality(
  model: DeepSeekModelDraft,
  family: ModalityFamily,
  modality: ModalityChoice,
  enabled: boolean,
): DeepSeekModelDraft {
  const next = new Set(effectiveModalities(model, family))
  if (enabled) next.add(modality)
  else next.delete(modality)
  // Text comes back rather than leaving the set empty: see the JSDoc above.
  if (next.size === 0) next.add('text')
  return { ...model, [fieldOf(family)]: MODALITY_CHOICES.filter(choice => next.has(choice)) }
}

/**
 * The offending value in one row's modality declaration, when it has one.
 *
 * Only the value domain is checked. The structural rules each family owns —
 * deepseek's non-empty list, pi-ai's inheritance on absence — are ones the
 * toggle above cannot produce, so a failure here means a value this page did
 * not write: a row edited in `settings.yaml` that the section now renders.
 *
 * @param model - one drafted model row.
 * @param family - the adapter family reading this row.
 * @returns the offending spelling, or `undefined` when the row is acceptable.
 */
export function invalidModality(
  model: DeepSeekModelDraft,
  family: ModalityFamily,
): string | undefined {
  const value = model[fieldOf(family)]
  if (value === undefined) return undefined
  // One spelling for every JSON type: `String` would name every object
  // `[object Object]`. The `undefined` JSON cannot spell is the one the guard
  // above returned, so this overload resolves to `string` for the rest.
  if (!Array.isArray(value)) return JSON.stringify(value)
  for (const entry of value) {
    if (!(MODALITY_CHOICES as readonly unknown[]).includes(entry)) return String(entry)
  }
  if (value.length === 0) return '(empty)'
  if (new Set(value).size !== value.length) return value.join(', ')
  return undefined
}

/** The field name one family's rows carry. */
function fieldOf(family: ModalityFamily): string {
  return family === 'deepseek' ? 'inputModalities' : 'input'
}
