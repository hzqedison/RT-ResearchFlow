/*! @license
Adapted control layout from zetatez/evolving, commit c6119456fb035d3f3348da675bb1b6a68ee79391.
MIT License

Copyright (c) 2021 Lorenzo

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
import type { MacThsMode, MacThsOrder, MacThsAction } from '../../shared/macThsTypes'

// No credentials, shell commands, numbered navigation buttons, or broad revoke operations.
const helpers = `
on selectedButton(theButton)
  tell application "System Events"
    try
      if (value of attribute "AXSelected" of theButton) as boolean then return true
    end try
    try
      if (value of attribute "AXValue" of theButton) as integer is 1 then return true
    end try
  end tell
  return false
end selectedButton

on modeConfirmed(theWindow, theMode)
  tell application "System Events"
    if theMode is "simulation" then
      return my selectedButton(button "模拟" of theWindow) and not my selectedButton(button "A股" of theWindow)
    else
      return my selectedButton(button "A股" of theWindow) and not my selectedButton(button "模拟" of theWindow)
    end if
  end tell
end modeConfirmed

on selectMode(theWindow, theMode)
  tell application "System Events"
    if theMode is "simulation" then
      click button "模拟" of theWindow
    else
      click button "A股" of theWindow
    end if
    delay 0.3
    if not my modeConfirmed(theWindow, theMode) then return false
    if not (exists button "股票" of theWindow) then return false
    click button "股票" of theWindow
    delay 0.2
    return my modeConfirmed(theWindow, theMode)
  end tell
end selectMode

on checkLayout(theWindow)
  tell application "System Events"
    if (count of text fields of theWindow) is not 3 then return false
    if not (exists button "买入" of theWindow) then return false
    if not (exists button "卖出" of theWindow) then return false
    if not (exists button "确定买入" of theWindow) and not (exists button "确定卖出" of theWindow) then return false
    repeat with theField in text fields of theWindow
      try
        if (value of attribute "AXSubrole" of theField) is "AXSecureTextField" then return false
      end try
    end repeat
    return true
  end tell
end checkLayout

on contractSnapshot(theWindow)
  tell application "System Events"
    repeat with areaNumber in {4, 5}
      try
        set theTable to table 1 of scroll area areaNumber of theWindow
        set headings to value of attribute "AXTitle" of every button of group 1 of theTable
        set contractColumn to 0
        repeat with columnNumber from 1 to count of headings
          if (item columnNumber of headings as text) is in {"合同编号", "委托编号", "合同号", "委托号"} then set contractColumn to columnNumber
        end repeat
        if contractColumn is 0 then error "unsupported table"
        set identifiers to {}
        repeat with theRow in rows of theTable
          set cells to value of every static text of theRow
          if (count of cells) >= contractColumn then
            set candidate to item contractColumn of cells as text
            if candidate is not "" then set end of identifiers to candidate
          end if
        end repeat
        return identifiers
      end try
    end repeat
  end tell
  error "unsupported table"
end contractSnapshot

on fillOrder(theWindow, theMode, theSide, theSymbol, thePrice, theQuantity)
  tell application "System Events"
    if not my selectMode(theWindow, theMode) then return "MODE_UNVERIFIED"
    if not my checkLayout(theWindow) then return "LAYOUT_UNSUPPORTED"
    if theMode is "livePreview" then
      set brokerMatched to false
      repeat with labelText in static texts of theWindow
        try
          if (value of labelText as text) contains "中信证券" then set brokerMatched to true
        end try
      end repeat
      if not brokerMatched then
        try
          set brokerTitle to value of attribute "AXTitle" of button of UI element 2 of row 1 of table 1 of scroll area 1 of theWindow
          if (brokerTitle as text) contains "中信证券" then set brokerMatched to true
        end try
      end if
      if not brokerMatched then return "BROKER_UNVERIFIED"
    end if
    if theSide is "buy" then
      click button "买入" of theWindow
    else
      click button "卖出" of theWindow
    end if
    delay 0.15
    if not my modeConfirmed(theWindow, theMode) then return "MODE_UNVERIFIED"
    set value of attribute "AXFocused" of text field 2 of theWindow to true
    set value of text field 2 of theWindow to theSymbol
    delay 0.25
    set value of text field 1 of theWindow to thePrice
    set value of text field 3 of theWindow to theQuantity
    delay 0.1
    if (value of text field 2 of theWindow as text) is not theSymbol then return "READBACK_MISMATCH"
    if (value of text field 1 of theWindow as number) is not (thePrice as number) then return "READBACK_MISMATCH"
    if (value of text field 3 of theWindow as integer) is not (theQuantity as integer) then return "READBACK_MISMATCH"
    if not my modeConfirmed(theWindow, theMode) then return "MODE_UNVERIFIED"
    return "FORM_READY"
  end tell
end fillOrder
`

export function macThsScript(action: MacThsAction, mode: MacThsMode, order?: MacThsOrder, contractNo = ''): string {
  // The caller validates every literal; there is no renderer-provided script.
  const requestedMode = mode === 'simulation' ? 'simulation' : 'livePreview'
  const side = order?.side === 'sell' ? 'sell' : 'buy'
  const symbol = order?.symbol ?? '000001'
  const price = order?.price ?? '1.00'
  const quantity = order?.quantity ?? 100
  const body = action === 'probe' ? `
      if not my checkLayout(theWindow) then return "LAYOUT_UNSUPPORTED"
      return "READY"
  ` : action === 'preview' || action === 'submitSimulation' ? `
      set fillResult to my fillOrder(theWindow, "${requestedMode}", "${side}", "${symbol}", "${price}", "${quantity}")
      if fillResult is not "FORM_READY" then return fillResult
      ${action === 'preview' ? 'return "FORM_READY"' : `
      if not my modeConfirmed(theWindow, "simulation") then return "MODE_UNVERIFIED"
      click button "委托" of theWindow
      delay 0.3
      try
        set beforeContracts to my contractSnapshot(theWindow)
      on error
        return "TABLE_UNSUPPORTED"
      end try
      if not my modeConfirmed(theWindow, "simulation") then return "MODE_UNVERIFIED"
      set submitTouched to true
      click button "${side === 'buy' ? '确定买入' : '确定卖出'}" of theWindow
      delay 0.3
      if exists sheet 1 of theWindow then
        set confirmationText to value of every static text of sheet 1 of theWindow
        set confirmationText to confirmationText as text
        if confirmationText does not contain "${symbol}" then return "CONFIRMATION_UNRECOGNIZED"
        if confirmationText does not contain "${quantity}" then return "CONFIRMATION_UNRECOGNIZED"
        if confirmationText does not contain "${side === 'buy' ? '买入' : '卖出'}" then return "CONFIRMATION_UNRECOGNIZED"
        if not my modeConfirmed(theWindow, "simulation") then return "RECEIPT_UNKNOWN"
        click button "确认" of sheet 1 of theWindow
      end if
      delay 0.6
      click button "委托" of theWindow
      set afterContracts to my contractSnapshot(theWindow)
      set newContracts to {}
      repeat with identifier in afterContracts
        if beforeContracts does not contain (identifier as text) then set end of newContracts to identifier as text
      end repeat
      if count of newContracts is not 1 then return "RECEIPT_UNKNOWN"
      return "SIMULATION_ACCEPTED|" & item 1 of newContracts
      `}
  ` : action === 'cancelSimulation' ? `
      if not my selectMode(theWindow, "simulation") then return "MODE_UNVERIFIED"
      click button "委托" of theWindow
      delay 0.3
      try
        set currentContracts to my contractSnapshot(theWindow)
      on error
        return "TABLE_UNSUPPORTED"
      end try
      if currentContracts does not contain "${contractNo}" then return "TABLE_UNSUPPORTED"
      set matchedRows to {}
      repeat with areaNumber in {4, 5}
        try
          repeat with candidateRow in rows of table 1 of scroll area areaNumber of theWindow
            set cellValues to value of every static text of candidateRow
            if cellValues contains "${contractNo}" then set end of matchedRows to candidateRow
          end repeat
        end try
      end repeat
      if count of matchedRows is not 1 then return "TABLE_UNSUPPORTED"
      if not (exists button "撤单" of theWindow) then return "CANCEL_CONTROL_UNSUPPORTED"
      select item 1 of matchedRows
      if not my modeConfirmed(theWindow, "simulation") then return "MODE_UNVERIFIED"
      set submitTouched to true
      click button "撤单" of theWindow
      delay 0.2
      if exists sheet 1 of theWindow then
        set confirmationText to (value of every static text of sheet 1 of theWindow) as text
        if confirmationText does not contain "${contractNo}" then return "CONFIRMATION_UNRECOGNIZED"
        click button "确认" of sheet 1 of theWindow
      end if
      return "RECEIPT_UNKNOWN"
  ` : `
      if not my selectMode(theWindow, "${requestedMode}") then return "MODE_UNVERIFIED"
      click button "${action === 'queryDeals' ? '成交' : '委托'}" of theWindow
      return "VIEW_OPENED"
  `
  return helpers + `
on run
  set submitTouched to false
  tell application "System Events"
    if not (exists process "同花顺") then return "CLIENT_NOT_RUNNING"
  end tell
  tell application "同花顺" to activate
  tell application "System Events"
    tell process "同花顺"
      try
        if count of windows is 0 then return "TRADE_VIEW_REQUIRED"
        set theWindow to window 1
        if count of sheets of theWindow is not 0 then return "TRADE_VIEW_REQUIRED"
        if not (exists button "A股" of theWindow) or not (exists button "模拟" of theWindow) then return "TRADE_VIEW_REQUIRED"
        ${body}
      on error errorText number errorNumber
        if submitTouched then return "RECEIPT_UNKNOWN"
        if errorNumber is -1743 or errorNumber is -25211 then return "AUTOMATION_DENIED"
        return "SCRIPT_ERROR"
      end try
    end tell
  end tell
end run
`
}
