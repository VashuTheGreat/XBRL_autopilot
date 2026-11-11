import { useState } from 'react'
import type { InstanceImportMode } from '@shared/project'
import { Button, ChoiceCards, Dialog, Section } from '@/components/ui/primitives'
import { useProject } from '@/stores/project'

const MODES: ReadonlyArray<{ id: InstanceImportMode; label: string; hint: string }> = [
  { id: 'both', label: 'Open that filing', hint: 'Every fact as filed, current and previous year. Checked by regenerating it.' },
  { id: 'next', label: "Start next year's filing", hint: "Last year's figures become this year's previous year." },
]

/** File → Import XBRL Instance… (docs/08-ui-ux.md). The file is picked in main after the choice. */
export function ImportXbrlDialog() {
  const { importXbrlOpen, closeImportXbrl, importXbrl } = useProject()
  const [mode, setMode] = useState<InstanceImportMode>('both')
  const [busy, setBusy] = useState(false)

  const choose = async () => {
    setBusy(true)
    await importXbrl(mode)
    setBusy(false)
  }

  return (
    <Dialog
      open={importXbrlOpen}
      title="Import XBRL instance"
      onClose={closeImportXbrl}
      width={600}
      footer={
        <>
          <Button variant="ghost" onClick={closeImportXbrl}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void choose()} disabled={busy} data-testid="import-xbrl-choose">
            {busy ? 'Importing…' : 'Choose file…'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-[12px] text-muted">
          An AOC-4 XBRL instance from any software (e.g. Webtel). The taxonomy, company and periods are read from the file, C&amp;I 2016 or Ind AS 2017.
        </p>
        <Section title="Use it to">
          <ChoiceCards<InstanceImportMode> label="Import mode" value={mode} options={MODES} onChange={setMode} testIdPrefix="import-mode" />
        </Section>
      </div>
    </Dialog>
  )
}
