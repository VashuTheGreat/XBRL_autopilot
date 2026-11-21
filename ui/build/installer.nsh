; Included by electron-builder (electron-builder.yml → nsis.include). Runs elevated (perMachine: true).
; The projects folder (docs/17): <Program Files>\XBRL_Autopilot\Projects, writable by every user so the app can save
; filings there without admin rights. The uninstaller leaves it alone: it holds the user's filings.

!macro customInstall
  CreateDirectory "$PROGRAMFILES64\XBRL_Autopilot\Projects"
  ; *S-1-5-32-545 = BUILTIN\Users (locale-independent); (OI)(CI)M = modify, inherited by files and subfolders
  nsExec::ExecToLog 'icacls "$PROGRAMFILES64\XBRL_Autopilot" /grant *S-1-5-32-545:(OI)(CI)M /T /C /Q'
  Pop $0
!macroend
