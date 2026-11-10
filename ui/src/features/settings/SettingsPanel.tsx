import { KeyRound, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { Button, Checkbox, Field, Input, Section, Select } from '@/components/ui/primitives'
import { useSettings } from '@/stores/settings'

const MODELS = [
  { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B (best quality, default)' },
  { id: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B (faster, cheaper)' },
  { id: 'qwen/qwen3.8-27b', label: 'Qwen 3.8 27B' },
]

export function SettingsPanel() {
  const { state, update, setGroqKey, clearGroqKey, pickMcaTool } = useSettings()
  const [key, setKey] = useState('')
  const [keyError, setKeyError] = useState<string | null>(null)
  if (!state) return null

  const saveKey = async () => {
    const problem = await setGroqKey(key)
    setKeyError(problem)
    if (!problem) setKey('')
  }

  return (
    <div className="flex flex-col gap-6 p-3">
      <Section title="AI (Groq)">
        <div className="flex items-center gap-2 text-xs">
          <KeyRound size={14} className={state.hasGroqKey ? 'text-ok' : 'text-muted'} />
          {state.hasGroqKey ? (state.groqKeyFromEnv ? 'Using the key from .env (development)' : 'API key saved, encrypted on this PC') : 'No API key — AI features are off'}
        </div>
        <Field label="Groq API key" error={keyError} hint="Stored encrypted with Windows DPAPI. Never shown again or sent anywhere except Groq.">
          <Input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="gsk_…"
            disabled={!state.canEncrypt}
          />
        </Field>
        <div className="flex gap-2">
          <Button variant="primary" disabled={!key.trim()} onClick={() => void saveKey()}>
            Save key
          </Button>
          {state.hasGroqKey && !state.groqKeyFromEnv && (
            <Button variant="danger" onClick={() => void clearGroqKey()}>
              Remove key
            </Button>
          )}
        </div>
        {!state.canEncrypt && <p className="text-[11px] text-err">Secure storage is unavailable on this system, so a key cannot be saved.</p>}
        <Field label="Model">
          <Select value={state.groqModel} onChange={(e) => void update({ groqModel: e.target.value })}>
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </Select>
        </Field>
        <Checkbox
          checked={state.aiConsent}
          onChange={(aiConsent) => void update({ aiConsent })}
          label="Allow sending row labels and validation messages to Groq"
        />
        <p className="flex gap-1.5 text-[11px] leading-relaxed text-muted">
          <ShieldCheck size={13} className="mt-px shrink-0" />
          CIN, company name, director and auditor details are never sent. Parsing, validation and XML generation stay on this PC.
        </p>
      </Section>

      <Section title="MCA Validation Tool">
        <Field label="Tool location" hint="MCA_XBRL_Valiation_Tool_V5.1.exe — download it from mca.gov.in">
          <Input value={state.mcaToolPath} readOnly placeholder="Not set" className="font-mono text-[11px]" />
        </Field>
        <div>
          <Button onClick={() => void pickMcaTool()}>Browse…</Button>
        </div>
      </Section>

      <Section title="Saving">
        <Field label="Autosave interval (seconds)" hint="Unsaved work is copied for crash recovery; your project file is only written when you save.">
          <Input
            key={state.autosaveSeconds}
            type="number"
            min={10}
            max={600}
            defaultValue={state.autosaveSeconds}
            onBlur={(e) => void update({ autosaveSeconds: Number(e.target.value) })}
          />
        </Field>
      </Section>
    </div>
  )
}
