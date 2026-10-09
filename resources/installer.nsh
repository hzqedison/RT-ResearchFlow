!macro defineSafeInstallTargetCheck PREFIX
Function ${PREFIX}AssertSafeInstallDirectory
  Exch $R8
  Push $R9
  Push $R7
  Push $R6
  StrCmp $R8 "" tw_target_invalid

  # PathIsRelativeW does not distinguish drive-relative from fully qualified paths.
  # Accept only an alphabetic drive plus colon plus separator, or server/share/child UNC.
  StrCpy $R6 0
  tw_target_quote_scan:
  StrCpy $R9 $R8 1 $R6
  StrCmp $R9 '"' tw_target_invalid
  StrCmp $R9 "" tw_target_prefix
  IntOp $R6 $R6 + 1
  Goto tw_target_quote_scan

  tw_target_prefix:
  StrCpy $R7 $R8 1
  StrCpy $R9 $R8 3
  StrCmp $R9 "$R7:\" tw_target_drive
  StrCmp $R9 "$R7:/" tw_target_drive
  StrCpy $R9 $R8 2
  StrCmp $R9 "\\" tw_target_unc tw_target_invalid

  tw_target_drive:
  StrCpy $R6 0
  tw_target_drive_scan:
  StrCpy $R9 "ABCDEFGHIJKLMNOPQRSTUVWXYZ" 1 $R6
  StrCmp $R9 "" tw_target_invalid
  StrCmp $R7 $R9 tw_target_drive_child
  IntOp $R6 $R6 + 1
  Goto tw_target_drive_scan
  tw_target_drive_child:
  StrCpy $R9 $R8 1 3
  StrCmp $R9 "" tw_target_invalid tw_target_qualified

  tw_target_unc:
  StrCpy $R9 $R8 1 2
  StrCmp $R9 "" tw_target_invalid
  StrCmp $R9 "\" tw_target_invalid
  StrCmp $R9 "?" tw_target_invalid
  StrCmp $R9 "." tw_target_invalid
  StrCpy $R6 2
  tw_target_unc_server:
  StrCpy $R9 $R8 1 $R6
  StrCmp $R9 "" tw_target_invalid
  StrCmp $R9 "\" tw_target_unc_share_start
  IntOp $R6 $R6 + 1
  Goto tw_target_unc_server
  tw_target_unc_share_start:
  IntOp $R6 $R6 + 1
  StrCpy $R9 $R8 1 $R6
  StrCmp $R9 "" tw_target_invalid
  StrCmp $R9 "\" tw_target_invalid
  tw_target_unc_share:
  StrCpy $R9 $R8 1 $R6
  StrCmp $R9 "" tw_target_invalid
  StrCmp $R9 "\" tw_target_unc_child
  IntOp $R6 $R6 + 1
  Goto tw_target_unc_share
  tw_target_unc_child:
  IntOp $R6 $R6 + 1
  StrCpy $R9 $R8 1 $R6
  StrCmp $R9 "" tw_target_invalid
  StrCmp $R9 "\" tw_target_unc_child tw_target_qualified

  tw_target_qualified:
  GetFullPathName $R7 "$R8"
  StrCmp $R7 "" tw_target_invalid
  GetFullPathName $R9 "$R7\.."
  StrCmp $R9 "" tw_target_invalid
  # Normalize trailing separators on both native results before checking for a root.
  tw_target_trim_path:
  StrCpy $R6 $R7 1 -1
  StrCmp $R6 "\" tw_target_trim_path_next
  StrCmp $R6 "/" tw_target_trim_path_next tw_target_trim_parent
  tw_target_trim_path_next:
  StrCpy $R7 $R7 -1
  Goto tw_target_trim_path
  tw_target_trim_parent:
  StrCpy $R6 $R9 1 -1
  StrCmp $R6 "\" tw_target_trim_parent_next
  StrCmp $R6 "/" tw_target_trim_parent_next tw_target_compare
  tw_target_trim_parent_next:
  StrCpy $R9 $R9 -1
  Goto tw_target_trim_parent
  tw_target_compare:
  StrCmp $R7 $R9 tw_target_invalid
  System::Call 'kernel32::GetFileAttributesW(w "$R7") i .s'
  Pop $R9
  IntCmp $R9 -1 tw_target_valid 0 0
  IntOp $R9 $R9 & 0x10
  IntCmp $R9 0 tw_target_invalid tw_target_invalid tw_target_valid

  tw_target_invalid:
  Pop $R6
  Pop $R7
  Pop $R9
  Pop $R8
  SetErrorLevel 2
  Abort "安装目标不是有效的非根目录，已停止；未移动或删除本地数据。"

  tw_target_valid:
  Pop $R6
  Pop $R7
  Pop $R9
  Pop $R8
FunctionEnd

Function ${PREFIX}AssertSafeExistingInstallDirectory
  Exch $R8
  Push $R9
  Push "$R8"
  Call ${PREFIX}AssertSafeInstallDirectory
  # Old registry paths must be existing directories, not merely valid new targets.
  System::Call 'kernel32::GetFileAttributesW(w "$R8") i .s'
  Pop $R9
  IntCmp $R9 -1 tw_existing_invalid 0 0
  IntOp $R9 $R9 & 0x10
  IntCmp $R9 0 tw_existing_invalid tw_existing_invalid tw_existing_valid
  tw_existing_invalid:
  Pop $R9
  Pop $R8
  SetErrorLevel 2
  Abort "旧安装目录无效，已停止；未复制或执行旧卸载器，未移动或删除本地数据。"
  tw_existing_valid:
  Pop $R9
  Pop $R8
FunctionEnd
!macroend

!ifdef BUILD_UNINSTALLER
  !insertmacro defineSafeInstallTargetCheck "un."
!else
  !insertmacro defineSafeInstallTargetCheck ""
!endif

# A normal installer has no repair payload and must retain the refusal path.
# The trusted build may opt in only after fixing every reviewed D/K input and
# embedding the x86 Unicode launcher. The consumer, not NSIS, verifies the
# detached receipt/signature and source-owned legacy identity before mutation.
!ifndef BUILD_UNINSTALLER
  !ifdef RT_REPAIR_ENABLE_CHANNEL
    !ifndef RT_REPAIR_CHANNEL_PLUGIN_DIR
      !error "RT_REPAIR_CHANNEL_PLUGIN_DIR is required"
    !endif
    !ifndef RT_REPAIR_FIXED_NODE
      !error "RT_REPAIR_FIXED_NODE is required"
    !endif
    !ifndef RT_REPAIR_FIXED_CONSUMER
      !error "RT_REPAIR_FIXED_CONSUMER is required"
    !endif
    !ifndef RT_REPAIR_FIXED_RECEIPT
      !error "RT_REPAIR_FIXED_RECEIPT is required"
    !endif
    !ifndef RT_REPAIR_FIXED_SIGNATURE
      !error "RT_REPAIR_FIXED_SIGNATURE is required"
    !endif
    !ifndef RT_REPAIR_FIXED_PROGRAM_ROOT
      !error "RT_REPAIR_FIXED_PROGRAM_ROOT is required"
    !endif
    !ifndef RT_REPAIR_FIXED_RUNTIME_SEAL
      !error "RT_REPAIR_FIXED_RUNTIME_SEAL is required"
    !endif
    !ifndef RT_REPAIR_FIXED_PRIVATE_NODE
      !error "RT_REPAIR_FIXED_PRIVATE_NODE is required"
    !endif
    !ifndef RT_REPAIR_FIXED_NATIVE_HOST
      !error "RT_REPAIR_FIXED_NATIVE_HOST is required"
    !endif
    !ifndef RT_REPAIR_FIXED_JOB_HOST
      !error "RT_REPAIR_FIXED_JOB_HOST is required"
    !endif
    !addplugindir /x86-unicode "${RT_REPAIR_CHANNEL_PLUGIN_DIR}"
  !endif
!endif

!macro restoreExplicitRepairRegisters
  Pop $R9
  Pop $R8
  Pop $R7
  Pop $R6
  Pop $R5
  Pop $R4
  Pop $R3
  Pop $R2
  Pop $R1
  Pop $R0
!macroend

!macro customExplicitRepairDispatch
  !ifndef BUILD_UNINSTALLER
    Push $R0
    Push $R1
    Push $R2
    Push $R3
    Push $R4
    Push $R5
    Push $R6
    Push $R7
    Push $R8
    Push $R9
    StrCpy $R8 "0"
    IfErrors 0 +2
      StrCpy $R8 "1"
    ${GetParameters} $R0
    StrLen $R1 $R0
    IntOp $R6 ${NSIS_MAX_STRLEN} - 1
    IntCmp $R1 $R6 rt_explicit_repair_refused 0 rt_explicit_repair_refused
    StrCpy $R2 "0"
    StrCpy $R3 "0"
    StrCpy $R4 ""
    StrCpy $R7 "0"

    rt_explicit_repair_scan:
    StrCmp $R2 $R1 rt_explicit_repair_eof
    StrCpy $R9 $R0 1 $R2
    IntOp $R2 $R2 + 1
    StrCmp $R9 '"' rt_explicit_repair_quote
    StrCmp $R9 "\" rt_explicit_repair_backslash
    StrCpy $R7 "0"
    StrCmp $R3 "1" rt_explicit_repair_append
    StrCmp $R9 " " rt_explicit_repair_token
    StrCmp $R9 "$\t" rt_explicit_repair_token
    Goto rt_explicit_repair_append
    rt_explicit_repair_backslash:
    IntOp $R7 $R7 + 1
    Goto rt_explicit_repair_append
    rt_explicit_repair_quote:
    # Odd preceding backslashes escape the quote; even ones end/start quoting.
    IntOp $R6 $R7 & 1
    StrCpy $R7 "0"
    StrCmp $R6 "1" rt_explicit_repair_escaped_quote
    IntOp $R3 $R3 ^ 1
    Goto rt_explicit_repair_scan
    rt_explicit_repair_escaped_quote:
    StrCpy $R4 $R4 -1
    Goto rt_explicit_repair_scan
    rt_explicit_repair_append:
    StrCpy $R4 "$R4$R9"
    Goto rt_explicit_repair_scan
    rt_explicit_repair_eof:
    StrCpy $R9 ""
    Goto rt_explicit_repair_token
    rt_explicit_repair_token:
    StrCmp $R4 "" rt_explicit_repair_empty_token
    StrCpy $R6 $R4 3
    StrCmp $R6 "/D=" rt_explicit_repair_not_requested
    StrCmp $R4 "/RTRepair" rt_explicit_repair_requested
    StrCpy $R6 $R4 9
    StrCmp $R6 "/RTRepair" rt_explicit_repair_refused
    StrCpy $R6 $R4 10
    StrCmp $R6 "--RTRepair" rt_explicit_repair_refused
    StrCmp $R6 "/RT-Repair" rt_explicit_repair_refused
    StrCpy $R6 $R4 7
    StrCmp $R6 "/repair" rt_explicit_repair_refused
    StrCpy $R6 $R4 8
    StrCmp $R6 "--repair" rt_explicit_repair_refused
    StrCpy $R4 ""
    rt_explicit_repair_empty_token:
    StrCmp $R9 "" rt_explicit_repair_not_requested
    Goto rt_explicit_repair_scan

    rt_explicit_repair_not_requested:
    StrCmp $R8 "1" rt_explicit_repair_restore_error
    !insertmacro restoreExplicitRepairRegisters
    ClearErrors
    Goto rt_explicit_repair_done
    rt_explicit_repair_restore_error:
    !insertmacro restoreExplicitRepairRegisters
    SetErrors
    Goto rt_explicit_repair_done
    rt_explicit_repair_requested:
    # No extra switches, including /S or /D=. The launcher independently
    # checks the exact process command line; argv supplies no authority.
    StrCmp $R0 "/RTRepair" 0 rt_explicit_repair_refused
    StrCmp $R8 "1" rt_explicit_repair_refused
    IfSilent rt_explicit_repair_refused
    MessageBox MB_YESNO|MB_ICONEXCLAMATION|MB_DEFBUTTON2 \
      "我确认正在本机执行显式修复；旧安装身份、备份、回执及签名必须通过独立核验。不确定时请选择否，原有数据将保留。是否继续？" \
      IDYES rt_explicit_repair_confirmed IDNO rt_explicit_repair_refused
    rt_explicit_repair_confirmed:
    !ifdef RT_REPAIR_ENABLE_CHANNEL
      # Launch pops first-in-last-out: consent, Node, consumer, receipt,
      # signature, owned payload, seal, private Node, native host, job host.
      Push "${RT_REPAIR_FIXED_JOB_HOST}"
      Push "${RT_REPAIR_FIXED_NATIVE_HOST}"
      Push "${RT_REPAIR_FIXED_PRIVATE_NODE}"
      Push "${RT_REPAIR_FIXED_RUNTIME_SEAL}"
      Push "${RT_REPAIR_FIXED_PROGRAM_ROOT}"
      Push "${RT_REPAIR_FIXED_SIGNATURE}"
      Push "${RT_REPAIR_FIXED_RECEIPT}"
      Push "${RT_REPAIR_FIXED_CONSUMER}"
      Push "${RT_REPAIR_FIXED_NODE}"
      Push "1"
      windows-install-repair-channel::Launch
      Pop $R9
      StrCmp $R9 "0" rt_explicit_repair_completed rt_explicit_repair_refused
    !else
      Goto rt_explicit_repair_refused
    !endif
    rt_explicit_repair_completed:
    !insertmacro restoreExplicitRepairRegisters
    ClearErrors
    SetErrorLevel 0
    Quit
    rt_explicit_repair_refused:
    !insertmacro restoreExplicitRepairRegisters
    SetErrorLevel 23
    Abort "显式修复未执行或未完成；不会回退普通安装或旧卸载器。请保留原有数据和修复日志。"
    rt_explicit_repair_done:
  !endif
!macroend

!macro rtDefaultCheckRegistration HIVE ACCESS KEY
  System::Call 'advapi32::RegOpenKeyExW(p ${HIVE}, w "${KEY}", i 0, i ${ACCESS}, *p .s) i .s'
  Pop $R0
  Pop $R1
  ${If} $R0 == 0
    System::Call 'advapi32::RegCloseKey(p $R1) i .s'
    Pop $R0
    StrCpy $R2 "1"
  ${ElseIf} $R0 != 2
  ${AndIf} $R0 != 3
    Goto rt_default_registry_unreadable
  ${EndIf}
!macroend

!ifndef BUILD_UNINSTALLER
Function rtProbeFreshInstallDefault
  Exch $R0
  Push $R1
  Push $R2
  Push $R3
  Push $R4
  Push $R5
  Push $R6
  Push $R7
  Push $R8
  Push $R9
  StrCpy $R1 "0"
  StrCpy $R2 $R0 3
  System::Call 'kernel32::GetDriveTypeW(w "$R2") i .s'
  Pop $R3
  StrCmp $R3 "3" 0 rt_default_probe_done
  System::Call 'kernel32::GetFileAttributesW(w "$R2") i .s'
  Pop $R3
  IntOp $R4 $R3 & 0x410
  StrCmp $R4 "16" 0 rt_default_probe_done

  # A registered install never reaches this function. An unregistered existing
  # target is not proved owned, even when its name looks like this product.
  System::Call 'kernel32::GetFileAttributesW(w "$R0") i .s'
  Pop $R3
  StrCmp $R3 "-1" 0 rt_default_probe_unsafe
  System::Call 'kernel32::GetLastError() i .s'
  Pop $R3
  StrCmp $R3 "2" rt_default_probe_parent
  StrCmp $R3 "3" rt_default_probe_parent rt_default_probe_done
  rt_default_probe_parent:
  GetFullPathName $R5 "$R0\.."
  System::Call 'kernel32::GetFileAttributesW(w "$R5") i .s'
  Pop $R3
  StrCmp $R3 "-1" rt_default_probe_missing_parent
  IntOp $R4 $R3 & 0x410
  StrCmp $R4 "16" rt_default_probe_create rt_default_probe_unsafe
  rt_default_probe_missing_parent:
  System::Call 'kernel32::GetLastError() i .s'
  Pop $R3
  StrCmp $R3 "2" rt_default_probe_root_parent
  StrCmp $R3 "3" rt_default_probe_root_parent rt_default_probe_done
  rt_default_probe_root_parent:
  StrCpy $R5 $R2
  rt_default_probe_create:
  System::Call 'ole32::CoCreateGuid(g .s) i .s'
  Pop $R3
  Pop $R6
  StrCmp $R3 "0" 0 rt_default_probe_done
  StrCpy $R8 "$R5\.RT-ResearchFlow-default-probe-$R6"
  # CreateDirectoryW must succeed for this new unique name. Collision is NOT
  # ownership. Never reuse a probe, change ACLs, or delete an existing object.
  System::Call 'kernel32::CreateDirectoryW(w "$R8", p 0) i .s'
  Pop $R3
  StrCmp $R3 "0" rt_default_probe_done
  # DELETE_ON_CLOSE uses owned handles, not pathname-based recursive cleanup.
  # Without FILE_SHARE_DELETE, the opened probe directory cannot be replaced.
  System::Call 'kernel32::CreateFileW(w "$R8", i 0x10080, i 3, p 0, i 3, i 0x06200080, p 0) p .s'
  Pop $R9
  StrCmp $R9 "-1" rt_default_probe_retained
  System::Call 'kernel32::CreateFileW(w "$R8\probe", i 0x40010000, i 0, p 0, i 1, i 0x04000080, p 0) p .s'
  Pop $R7
  StrCmp $R7 "-1" rt_default_probe_close_directory
  System::Call 'kernel32::WriteFile(p $R7, m "x", i 1, *i .s, p 0) i .s'
  Pop $R3
  Pop $R4
  StrCmp $R3 "0" rt_default_probe_close_file
  StrCmp $R4 "1" 0 rt_default_probe_close_file
  StrCpy $R1 "1"
  rt_default_probe_close_file:
  System::Call 'kernel32::CloseHandle(p $R7) i .s'
  Pop $R3
  StrCmp $R3 "0" 0 rt_default_probe_close_directory
  StrCpy $R1 "0"
  rt_default_probe_close_directory:
  System::Call 'kernel32::CloseHandle(p $R9) i .s'
  Pop $R3
  StrCmp $R3 "0" rt_default_probe_retained
  System::Call 'kernel32::GetFileAttributesW(w "$R8") i .s'
  Pop $R3
  StrCmp $R3 "-1" rt_default_probe_done
  rt_default_probe_retained:
  StrCpy $R1 "0"
  DetailPrint "Owned default-path probe could not be cleaned: $R8; no recursive deletion attempted."
  Goto rt_default_probe_done
  rt_default_probe_unsafe:
  StrCpy $R1 "2"
  rt_default_probe_done:
  StrCpy $R0 $R1
  Pop $R9
  Pop $R8
  Pop $R7
  Pop $R6
  Pop $R5
  Pop $R4
  Pop $R3
  Pop $R2
  Pop $R1
  Exch $R0
FunctionEnd
!endif

!ifndef BUILD_UNINSTALLER
Function rtSelectFreshInstallDirectory
    Push $R0
    Push $R1
    Push $R2
    Push $R9
    StrCpy $R9 "0"
    IfErrors 0 +2
      StrCpy $R9 "1"
    StrCpy $R2 "0"
    # Read both exact compiled keys in BOTH hives/views, without changing the
    # caller's registry view. An empty/present key is still an existing record.
    !insertmacro rtDefaultCheckRegistration 0x80000001 0x0201 "${INSTALL_REGISTRY_KEY}"
    !insertmacro rtDefaultCheckRegistration 0x80000001 0x0101 "${INSTALL_REGISTRY_KEY}"
    !insertmacro rtDefaultCheckRegistration 0x80000002 0x0201 "${INSTALL_REGISTRY_KEY}"
    !insertmacro rtDefaultCheckRegistration 0x80000002 0x0101 "${INSTALL_REGISTRY_KEY}"
    !insertmacro rtDefaultCheckRegistration 0x80000001 0x0201 "${UNINSTALL_REGISTRY_KEY}"
    !insertmacro rtDefaultCheckRegistration 0x80000001 0x0101 "${UNINSTALL_REGISTRY_KEY}"
    !insertmacro rtDefaultCheckRegistration 0x80000002 0x0201 "${UNINSTALL_REGISTRY_KEY}"
    !insertmacro rtDefaultCheckRegistration 0x80000002 0x0101 "${UNINSTALL_REGISTRY_KEY}"
    StrCmp $R2 "1" rt_default_restore
    !insertmacro GetDParameter $R0
    StrCmp $R0 "" 0 rt_default_restore
    Push "D:\Program Files\RT-ResearchFlow"
    Call rtProbeFreshInstallDefault
    Pop $R0
    StrCmp $R0 "2" rt_default_unsafe
    StrCmp $R0 "1" rt_default_choose_d
    Push "K:\Program Files\RT-ResearchFlow"
    Call rtProbeFreshInstallDefault
    Pop $R0
    StrCmp $R0 "2" rt_default_unsafe
    StrCmp $R0 "1" rt_default_choose_k rt_default_restore
    rt_default_choose_d:
    StrCpy $INSTDIR "D:\Program Files\RT-ResearchFlow"
    Goto rt_default_restore
    rt_default_choose_k:
    StrCpy $INSTDIR "K:\Program Files\RT-ResearchFlow"
    # D/K unavailable: retain the upstream scope default; never change scope.
    rt_default_restore:
    StrCmp $R9 "1" rt_default_restore_error
    Pop $R9
    Pop $R2
    Pop $R1
    Pop $R0
    ClearErrors
    Goto rt_default_done
    rt_default_restore_error:
    Pop $R9
    Pop $R2
    Pop $R1
    Pop $R0
    SetErrors
    Goto rt_default_done
    rt_default_registry_unreadable:
    rt_default_unsafe:
    Pop $R9
    Pop $R2
    Pop $R1
    Pop $R0
    SetErrorLevel 2
    Abort "无法证明新装目录安全或注册记录为空，已停止；未运行旧卸载器或删除已有文件。"
    rt_default_done:
FunctionEnd
!endif

!macro customSelectFreshInstallDirectory
  !ifndef BUILD_UNINSTALLER
    Call rtSelectFreshInstallDirectory
  !endif
!macroend

!macro customInit
  Push "$INSTDIR"
  Call AssertSafeInstallDirectory
!macroend

!macro customValidateInstallTarget
  Push "$INSTDIR"
  Call AssertSafeInstallDirectory
!macroend

!macro customValidateOldInstallDirectory OLD_PATH
  Push "${OLD_PATH}"
  Call AssertSafeExistingInstallDirectory
!macroend

!macro preflightOldInstallDirectory ROOT_KEY
  # Reuse the exact uninstall parser, including legacy registry-key fallback.
  # The dependency function returns after validation, before any uninstall effect.
  Push $R0
  Push "${ROOT_KEY}"
  StrCpy $preflightOldInstallPaths "1"
  Call uninstallOldVersion
  # uninstallOldVersion exchanges its root argument with the previous root value.
  Pop $rootKey
  StrCpy $preflightOldInstallPaths ""
  Pop $R0
!macroend

!macro customPreflightOldInstallDirectories
  !insertmacro preflightOldInstallDirectory SHELL_CONTEXT
  ${if} $installMode == "all"
    !insertmacro preflightOldInstallDirectory HKEY_CURRENT_USER
  ${endif}
!macroend

!macro customRemoveFiles
  Push "$INSTDIR"
  Call un.AssertSafeInstallDirectory
  StrCpy $R8 "0"

  IfFileExists "$INSTDIR.__trade_watch_data_preserved\*.*" 0 tw_no_stale_data
    Abort "检测到上次未完成的数据保护目录：$INSTDIR.__trade_watch_data_preserved。请先保留该目录并联系支持。"

  tw_no_stale_data:
  IfFileExists "$INSTDIR\data\*.*" 0 tw_data_moved
    ClearErrors
    Rename "$INSTDIR\data" "$INSTDIR.__trade_watch_data_preserved"
    IfErrors 0 +2
      Abort "无法保护本地数据目录，已停止更新或卸载。"
    StrCpy $R8 "1"

  tw_data_moved:
  ${if} ${isUpdated}
    CreateDirectory "$PLUGINSDIR\old-install"

    Push ""
    Call un.atomicRMDir
    Pop $R0

    ${if} $R0 != 0
      DetailPrint "File is busy, aborting: $R0"
      Push ""
      Call un.restoreFiles
      Pop $R0
      Abort `Can't rename "$INSTDIR" to "$PLUGINSDIR\old-install".`
    ${endif}
  ${endif}

  RMDir /r "$INSTDIR"

  StrCmp $R8 "1" 0 tw_data_restored
    CreateDirectory "$INSTDIR"
    ClearErrors
    Rename "$INSTDIR.__trade_watch_data_preserved" "$INSTDIR\data"
    IfErrors 0 tw_data_restored
      Abort "程序文件已处理，但本地数据仍安全保存在：$INSTDIR.__trade_watch_data_preserved"

  tw_data_restored:
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    ${ifNot} ${Silent}
      MessageBox MB_YESNO|MB_ICONEXCLAMATION|MB_DEFBUTTON2 \
        "是否同时删除本地数据库、配置和备份？默认选择“否”以保留数据。" \
        IDNO tw_keep_local_data
      RMDir /r "$INSTDIR\data"
      RMDir "$INSTDIR"
      tw_keep_local_data:
    ${endif}
  ${endif}
!macroend


