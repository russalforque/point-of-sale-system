; AppData holds business records and is deliberately retained on uninstall.
!macro NSIS_HOOK_POSTINSTALL
  CreateShortcut "$DESKTOP\Sellix POS.lnk" "$INSTDIR\Sellix POS.exe"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  Delete "$DESKTOP\Sellix POS.lnk"
!macroend
