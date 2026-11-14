/**
 * MandatoryInputService (docs/14 Step 5): the mandatory text / date / Yes-No items still empty, the tables an answer
 * makes mandatory, and the key answers Generate confirms — the engine's mandatoryInputs / requiredTables / keyAnswers
 * labelled with their statement. Writing goes through the engine's fact patch (setText, source user): the Session's
 * type, applicability and canonical-value checks, as every other edit. Electron-free.
 */
import { applyFactPatch, keyAnswers, mandatoryInputs, requiredTables, type Session } from '@xap/engine'
import type { KeyAnswerView, MandatoryView, SetMandatoryInput } from '@shared/mandatory'
import { engineProblems, ValidationError } from './errors'
import type { ProjectAccess } from './ports'

type Elrs = { elr(uri: string): { code: string; title: string } | null }

export class MandatoryInputService {
  constructor(
    private readonly projects: ProjectAccess,
    private readonly today: () => string = () => new Date().toISOString().slice(0, 10),
  ) {}

  list(): MandatoryView {
    const p = this.projects.project()
    const where = statementOf(p.authority.authority as unknown as Elrs)
    return {
      items: mandatoryInputs(p.session).map((i) => ({ ...i, ...where(i.elrUri) })),
      tables: requiredTables(p.session, this.today()).map((t) => ({ ...t, ...where(t.elrUri) })),
    }
  }

  keyAnswers(): KeyAnswerView[] {
    return keyAnswers(this.projects.project().session).map((k) => ({ ...k, decides: k.decides.map((d) => d.label) }))
  }

  /** Writes one item; an empty value is refused (removing a value is not what this dialog is for). */
  set(input: SetMandatoryInput): void {
    const p = this.projects.project()
    const value = input.value.trim()
    if (!value) throw new ValidationError(['Enter a value.'])
    try {
      applyFactPatch(p.session as Session, { op: 'setText', fact: { concept: input.concept, scope: input.scope }, value, source: { kind: 'user' } })
    } catch (err) {
      throw new ValidationError(engineProblems(err))
    }
    p.touch()
  }
}

const statementOf = (A: Elrs) => (uri: string) => {
  const e = A.elr(uri)
  return { elrCode: e?.code.slice(0, 6) ?? '', elrTitle: e?.title ?? '' }
}
