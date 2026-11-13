import { ShieldCheck } from 'lucide-react'
import { Button, Checkbox, Field, Input, Section } from '@/components/ui/primitives'
import { useSettings } from '@/stores/settings'

export function SettingsPanel() {
  const { state, update, pickMcaTool } = useSettings()
  if (!state) return null

  return (
    <div className="flex flex-col gap-6 p-3">
      <Section title="AI Assistance">
        <Checkbox
          checked={state.aiConsent}
          onChange={(aiConsent) => void update({ aiConsent })}
          label="Allow sending row labels and validation messages for AI assistance"
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
