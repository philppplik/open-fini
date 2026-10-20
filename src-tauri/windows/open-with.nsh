; OpenFini: extra Windows installer steps (bundle.windows.nsis.installerHooks in tauri.conf.json).
;
; Tauri registers the types in tauri.windows.conf.json (.ofini, .ofext) as real file associations: they open
; in OpenFini on double click. Registering every other type the same way would silently take over the user's
; default program for PNG, PDF, TXT and so on. So all other types are only offered under "Open with" and in
; Settings > Apps > Default apps: the extension gets an OpenWithProgids entry (no default is changed), and the
; app is listed with its capabilities so a user can assign types to it on purpose.
;
; The extension lists below must match app/src/platform/file-types.js (tests/packaging/os-integration.test.js
; checks it). The hook runs inside windows/installer.nsi (custom template). It is plain NSIS; it has only been exercised by the release workflow on windows-latest.

!macro OPENFINI_OPENWITH_ADD EXT
  WriteRegStr SHCTX "Software\Classes\.${EXT}\OpenWithProgids" "OpenFini.File" ""
  WriteRegStr SHCTX "Software\OpenFini\Capabilities\FileAssociations" ".${EXT}" "OpenFini.File"
!macroend

!macro OPENFINI_OPENWITH_REMOVE EXT
  DeleteRegValue SHCTX "Software\Classes\.${EXT}\OpenWithProgids" "OpenFini.File"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Document icon for the types OpenFini owns (the icon file is a bundle resource, see tauri.windows.conf.json).
  WriteRegStr SHCTX "Software\Classes\OpenFini.Document\DefaultIcon" "" "$INSTDIR\ofini-doc.ico"
  WriteRegStr SHCTX "Software\Classes\OpenFini.Extension\DefaultIcon" "" "$INSTDIR\ofini-doc.ico"

  ; $OpenWithChoice comes from the "Windows integration" page of windows/installer.nsi (default: on).
  ${If} $OpenWithChoice = 1
  ; Shared handler for the types OpenFini can open but does not own.
  WriteRegStr SHCTX "Software\Classes\OpenFini.File" "" "${PRODUCTNAME} file"
  WriteRegStr SHCTX "Software\Classes\OpenFini.File\DefaultIcon" "" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr SHCTX "Software\Classes\OpenFini.File\shell\open" "" "Open with ${PRODUCTNAME}"
  WriteRegStr SHCTX "Software\Classes\OpenFini.File\shell\open\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""

  ; Name shown in the "Open with" list.
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe" "FriendlyAppName" "${PRODUCTNAME}"
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\shell\open\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""

  ; Capabilities: makes OpenFini appear in Settings > Apps > Default apps.
  WriteRegStr SHCTX "Software\OpenFini\Capabilities" "ApplicationName" "${PRODUCTNAME}"
  WriteRegStr SHCTX "Software\OpenFini\Capabilities" "ApplicationDescription" "A lightweight, open-source creative suite."
  WriteRegStr SHCTX "Software\OpenFini\Capabilities\FileAssociations" ".ofini" "OpenFini.Document"
  WriteRegStr SHCTX "Software\OpenFini\Capabilities\FileAssociations" ".ofext" "OpenFini.Extension"
  !insertmacro OPENFINI_OPENWITH_ADD "psd"
  !insertmacro OPENFINI_OPENWITH_ADD "psb"
  !insertmacro OPENFINI_OPENWITH_ADD "idml"
  !insertmacro OPENFINI_OPENWITH_ADD "svg"
  !insertmacro OPENFINI_OPENWITH_ADD "png"
  !insertmacro OPENFINI_OPENWITH_ADD "jpg"
  !insertmacro OPENFINI_OPENWITH_ADD "jpeg"
  !insertmacro OPENFINI_OPENWITH_ADD "webp"
  !insertmacro OPENFINI_OPENWITH_ADD "gif"
  !insertmacro OPENFINI_OPENWITH_ADD "bmp"
  !insertmacro OPENFINI_OPENWITH_ADD "avif"
  !insertmacro OPENFINI_OPENWITH_ADD "pdf"
  !insertmacro OPENFINI_OPENWITH_ADD "ai"
  !insertmacro OPENFINI_OPENWITH_ADD "afdesign"
  !insertmacro OPENFINI_OPENWITH_ADD "afphoto"
  !insertmacro OPENFINI_OPENWITH_ADD "afpub"
  !insertmacro OPENFINI_OPENWITH_ADD "docx"
  !insertmacro OPENFINI_OPENWITH_ADD "odt"
  !insertmacro OPENFINI_OPENWITH_ADD "rtf"
  !insertmacro OPENFINI_OPENWITH_ADD "md"
  !insertmacro OPENFINI_OPENWITH_ADD "markdown"
  !insertmacro OPENFINI_OPENWITH_ADD "tex"
  !insertmacro OPENFINI_OPENWITH_ADD "latex"
  !insertmacro OPENFINI_OPENWITH_ADD "html"
  !insertmacro OPENFINI_OPENWITH_ADD "htm"
  !insertmacro OPENFINI_OPENWITH_ADD "css"
  !insertmacro OPENFINI_OPENWITH_ADD "js"
  !insertmacro OPENFINI_OPENWITH_ADD "mjs"
  !insertmacro OPENFINI_OPENWITH_ADD "json"
  !insertmacro OPENFINI_OPENWITH_ADD "txt"
  !insertmacro OPENFINI_OPENWITH_ADD "csv"
  WriteRegStr SHCTX "Software\RegisteredApplications" "OpenFini" "Software\OpenFini\Capabilities"
  ${EndIf}

  !insertmacro UPDATEFILEASSOC
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro OPENFINI_OPENWITH_REMOVE "psd"
  !insertmacro OPENFINI_OPENWITH_REMOVE "psb"
  !insertmacro OPENFINI_OPENWITH_REMOVE "idml"
  !insertmacro OPENFINI_OPENWITH_REMOVE "svg"
  !insertmacro OPENFINI_OPENWITH_REMOVE "png"
  !insertmacro OPENFINI_OPENWITH_REMOVE "jpg"
  !insertmacro OPENFINI_OPENWITH_REMOVE "jpeg"
  !insertmacro OPENFINI_OPENWITH_REMOVE "webp"
  !insertmacro OPENFINI_OPENWITH_REMOVE "gif"
  !insertmacro OPENFINI_OPENWITH_REMOVE "bmp"
  !insertmacro OPENFINI_OPENWITH_REMOVE "avif"
  !insertmacro OPENFINI_OPENWITH_REMOVE "pdf"
  !insertmacro OPENFINI_OPENWITH_REMOVE "ai"
  !insertmacro OPENFINI_OPENWITH_REMOVE "afdesign"
  !insertmacro OPENFINI_OPENWITH_REMOVE "afphoto"
  !insertmacro OPENFINI_OPENWITH_REMOVE "afpub"
  !insertmacro OPENFINI_OPENWITH_REMOVE "docx"
  !insertmacro OPENFINI_OPENWITH_REMOVE "odt"
  !insertmacro OPENFINI_OPENWITH_REMOVE "rtf"
  !insertmacro OPENFINI_OPENWITH_REMOVE "md"
  !insertmacro OPENFINI_OPENWITH_REMOVE "markdown"
  !insertmacro OPENFINI_OPENWITH_REMOVE "tex"
  !insertmacro OPENFINI_OPENWITH_REMOVE "latex"
  !insertmacro OPENFINI_OPENWITH_REMOVE "html"
  !insertmacro OPENFINI_OPENWITH_REMOVE "htm"
  !insertmacro OPENFINI_OPENWITH_REMOVE "css"
  !insertmacro OPENFINI_OPENWITH_REMOVE "js"
  !insertmacro OPENFINI_OPENWITH_REMOVE "mjs"
  !insertmacro OPENFINI_OPENWITH_REMOVE "json"
  !insertmacro OPENFINI_OPENWITH_REMOVE "txt"
  !insertmacro OPENFINI_OPENWITH_REMOVE "csv"
  DeleteRegKey SHCTX "Software\Classes\OpenFini.File"
  DeleteRegKey SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe"
  DeleteRegKey SHCTX "Software\OpenFini"
  DeleteRegValue SHCTX "Software\RegisteredApplications" "OpenFini"
  !insertmacro UPDATEFILEASSOC
!macroend
