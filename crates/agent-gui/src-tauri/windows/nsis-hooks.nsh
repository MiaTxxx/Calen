!macro RefreshCalenShortcut ShortcutPath
  ${If} ${FileExists} "${ShortcutPath}"
    Delete "${ShortcutPath}"
    CreateShortcut "${ShortcutPath}" "$INSTDIR\${MAINBINARYNAME}.exe" "" "$INSTDIR\calen-icon.ico" 0
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Existing shortcuts can retain the pre-Calen icon because the executable path stayed stable.
  !insertmacro RefreshCalenShortcut "$DESKTOP\${PRODUCTNAME}.lnk"
  !insertmacro RefreshCalenShortcut "$SMPROGRAMS\${PRODUCTNAME}.lnk"
  !insertmacro RefreshCalenShortcut "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
