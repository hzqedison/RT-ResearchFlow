# Deliberately NOT included by the production builder yet. This is the reviewed
# dispatch seam for disposable Windows fixture installers. Missing artifacts or
# review pins are compile errors, never a fallback to the legacy uninstaller.
!ifndef RT_REPAIR_ISOLATED_FIXTURE_BUILD
  !error "Native repair dispatch requires isolated fixture review before production registration"
!endif
!ifndef RT_REPAIR_FIXTURE_APP_ID
  !error "Missing independent fixture app identity"
!endif
!if "${RT_REPAIR_FIXTURE_APP_ID}" == "com.tradewatcher.app"
  !error "Fixture dispatch must not use the production app identity"
!endif
!ifndef RT_REPAIR_REVIEWED_CONSUMER_FILE
  !error "Missing reviewed consumer artifact"
!endif
!ifndef RT_REPAIR_REVIEWED_NODE_FILE
  !error "Missing hash-pinned private Node artifact"
!endif
!ifndef RT_REPAIR_REVIEW_SHA256
  !error "Missing independent consumer capability review"
!endif
!ifndef RT_REPAIR_FIXTURE_SCOPE
  !error "Missing compiled selected scope"
!endif

# Caller replaces only the explicit-repair branch in an isolated fixture build;
# healthy upgrade/default/legacy guards stay in the actual production include.
# It must never call this macro on a prefix/malformed /RTRepair argument.
!macro RTReviewedExplicitRepairConsumer
  Push $R0
  Push $R1
  Push $R2
  Push $R3
  Push $R4
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/RTRepair" $R1
  IfErrors rt_reviewed_repair_rejected
  StrCmp $R1 "" 0 rt_reviewed_repair_rejected
  InitPluginsDir
  # The direct-child consumer collects its actual installer parent identity and
  # rechecks explicit intent/scope/target independently. argv is not authority.
  SetOutPath "$PLUGINSDIR"
  File /oname=rt-repair-node.exe "${RT_REPAIR_REVIEWED_NODE_FILE}"
  File /oname=rt-repair-consumer.cjs "${RT_REPAIR_REVIEWED_CONSUMER_FILE}"
  # INSTDIR is not initialized at this early dispatch point. The consumer must
  # read the terminal /D= from its genuine parent, never inherit a default path.
  ExecWait '"$PLUGINSDIR\rt-repair-node.exe" "$PLUGINSDIR\rt-repair-consumer.cjs" --explicit-repair --scope "${RT_REPAIR_FIXTURE_SCOPE}"' $R2
  IfErrors rt_reviewed_repair_rejected
  StrCmp $R2 "0" rt_reviewed_repair_completed rt_reviewed_repair_rejected
  rt_reviewed_repair_completed:
  Pop $R4
  Pop $R3
  Pop $R2
  Pop $R1
  Pop $R0
  SetErrorLevel 0
  # A repair consumer has already verified and committed the same-app payload.
  # Do not continue the normal installer path or run its old-uninstaller branch.
  Quit
  rt_reviewed_repair_rejected:
  Pop $R4
  Pop $R3
  Pop $R2
  Pop $R1
  Pop $R0
  SetErrorLevel 23
  Abort "Native repair consumer refused; no legacy uninstall fallback"
!macroend
