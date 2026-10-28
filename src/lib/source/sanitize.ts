// Team names come from a third party and are shown to the public: they must stay inert text and must not be able to
// reorder, hide or impersonate. Control characters become spaces; format characters (bidi, zero-width joiners, BOM),
// lone surrogates and blank-looking fillers are removed outright. Runs of combining marks are capped (Zalgo).
const CONTROL = /\p{Cc}/gu;
const REMOVE = /[\p{Cf}\p{Cs}͏ᅟᅠ឴឵⠀ㅤ︀-️ﾠ]/gu;
const MARK_RUN = /(\p{M}{2})\p{M}+/gu;
const VISIBLE = /[\p{L}\p{N}\p{S}\p{P}]/u;

export const MAX_NAME_LENGTH = 40;

/** Returns '' when nothing visible is left; callers treat that as a missing field. */
export function sanitizeName(input: string, max = MAX_NAME_LENGTH): string {
  const cleaned = input
    .normalize('NFC')
    .replace(CONTROL, ' ')
    .replace(REMOVE, '')
    .replace(MARK_RUN, '$1')
    .replace(/\s+/gu, ' ')
    .trim();
  if (!VISIBLE.test(cleaned)) return '';
  return Array.from(cleaned).slice(0, max).join('').trim();
}
