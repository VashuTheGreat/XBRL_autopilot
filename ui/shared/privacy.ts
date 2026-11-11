/**
 * What may leave the machine for the AI (docs/11-security-privacy.md, ADR-0012). Used by the context bundle builder;
 * the sidecar checks the bundle again (src/services/fix_agent/privacy.py, same IDENTITY_ELEMENT: a pytest compares them).
 */

/** Local names of identity elements (CIN, company / people's names, PAN, DIN, addresses, contacts): never sent. Conservative on purpose. */
export const IDENTITY_ELEMENT = /(IdentityNumber|IdentificationNumber|PermanentAccountNumber|PAN|Name(Of|$)|^(First|Middle|Last)Name|Address|Email|Phone|Mobile|Fax|Website|Pin[Cc]ode|MembershipNumber|RegistrationNumber|DateOfBirth)/

/** Text values sent to the AI are cut to this length. */
export const MAX_AI_TEXT = 200

const CIN = /\b[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}\b/g
const PAN = /\b[A-Z]{5}\d{4}[A-Z]\b/g

export function isIdentityElement(qname: string): boolean {
  return IDENTITY_ELEMENT.test(qname.split(':').pop() ?? qname)
}

export function capText(s: string, max = MAX_AI_TEXT): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`
}

/** Free text (messages, MCA error lines) without the filing's CIN and company name, nor anything shaped like a CIN / PAN. */
export function scrubText(text: string, known: { cin?: string | null; company?: string | null } = {}): string {
  let out = text
  for (const [value, mark] of [
    [known.cin, '‹CIN›'],
    [known.company, '‹COMPANY›'],
  ] as const) {
    const v = value?.trim()
    if (v && v.length >= 3) out = out.replace(new RegExp(v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), mark)
  }
  return redactTyped(out.replace(CIN, '‹CIN›').replace(PAN, '‹PAN›'))
}

/** A typed dimension member is kept only when it is a sequence number ("1", "2"); others may be names. */
export function typedMemberForAi(value: string): string {
  return /^\d{1,4}$/.test(value.trim()) ? value.trim() : '‹typed›'
}

/** Typed members quoted in engine messages (`Axis="…"`) the same way. */
function redactTyped(text: string): string {
  return text.replace(/="([^"]*)"/g, (_m, v: string) => `="${typedMemberForAi(v)}"`)
}
