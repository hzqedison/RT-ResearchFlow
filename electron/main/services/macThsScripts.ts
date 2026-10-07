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
import { validateMacThsOrder, type MacThsMode, type MacThsOrder, type MacThsAction } from '../../shared/macThsTypes'

// Static, validated templates only. Live broker dialogs are never automatically confirmed.
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
      if not (exists button "模拟" of theWindow) then return false
      return my selectedButton(button "模拟" of theWindow) and not my selectedButton(button "A股" of theWindow)
    end if
    if not my selectedButton(button "A股" of theWindow) then return false
    if exists button "模拟" of theWindow then
      if my selectedButton(button "模拟" of theWindow) then return false
    end if
    return true
  end tell
end modeConfirmed

on selectMode(theWindow, theMode)
  tell application "System Events"
    if theMode is "simulation" then
      if not (exists button "模拟" of theWindow) then return false
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

on brokerLabel(theWindow)
  tell application "System Events"
    try
      set brokerTitle to value of attribute "AXTitle" of button of UI element 2 of row 1 of table 1 of scroll area 1 of theWindow
      if (brokerTitle as text) begins with "中信证券" and (count characters of (brokerTitle as text)) > 4 then return brokerTitle as text
    end try
    set candidates to {}
    repeat with labelText in static texts of theWindow
      try
        set candidate to value of labelText as text
        if candidate begins with "中信证券" and (count characters of candidate) > 4 then
          if candidates does not contain candidate then set end of candidates to candidate
        end if
      end try
    end repeat
    if count of candidates is 1 then return item 1 of candidates
  end tell
  return ""
end brokerLabel

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

on columnOf(headings, acceptedNames)
  repeat with columnNumber from 1 to count of headings
    if (item columnNumber of headings as text) is in acceptedNames then return columnNumber
  end repeat
  return 0
end columnOf

on showView(theWindow, viewName)
  tell application "System Events"
    if not (exists button viewName of theWindow) then return false
    click button viewName of theWindow
    delay 0.2
    if viewName is "委托" and (exists button "今天" of theWindow) then
      click button "今天" of theWindow
      delay 0.1
      if exists pop over 1 of theWindow then
        if not (exists button "今天" of pop over 1 of theWindow) then return false
        click button "今天" of pop over 1 of theWindow
      end if
      delay 0.15
    end if
    return true
  end tell
end showView

on orderSnapshot(theWindow)
  tell application "System Events"
    repeat with areaNumber in {4, 5}
      try
        set theTable to table 1 of scroll area areaNumber of theWindow
        set headings to value of attribute "AXTitle" of every button of group 1 of theTable
        set idColumn to my columnOf(headings, {"合同编号", "委托编号", "合同号", "委托号"})
        set codeColumn to my columnOf(headings, {"证券代码", "股票代码", "代码"})
        set priceColumn to my columnOf(headings, {"委托价格", "委托价", "价格"})
        set quantityColumn to my columnOf(headings, {"委托数量", "委托股数", "数量"})
        set sideColumn to my columnOf(headings, {"买卖标志", "买卖", "操作", "委托类别", "委托类型", "方向"})
        set stateColumn to my columnOf(headings, {"委托状态", "状态", "委托结果"})
        if idColumn is 0 or codeColumn is 0 or priceColumn is 0 or quantityColumn is 0 or sideColumn is 0 then error "unsupported table"
        if (count rows of theTable) > 2000 then error "unsupported table"
        set records to {}
        repeat with theRow in rows of theTable
          set cells to value of every static text of theRow
          set identifier to item idColumn of cells as text
          if identifier is not "" then
            set orderState to ""
            if stateColumn > 0 then set orderState to item stateColumn of cells as text
            set end of records to {identifier, item codeColumn of cells as text, item priceColumn of cells as text, item quantityColumn of cells as text, item sideColumn of cells as text, orderState}
          end if
        end repeat
        return records
      end try
    end repeat
  end tell
  error "unsupported table"
end orderSnapshot

on contractSnapshot(theWindow)
  set identifiers to {}
  repeat with entry in my orderSnapshot(theWindow)
    set end of identifiers to item 1 of entry as text
  end repeat
  return identifiers
end contractSnapshot

on matchingNewContracts(records, beforeContracts, theSide, theSymbol, thePrice, theQuantity)
  set identifiers to {}
  repeat with entry in records
    try
      set identifier to item 1 of entry as text
      set sideText to item 5 of entry as text
      set sideMatches to false
      if theSide is "buy" then
        set sideMatches to (sideText contains "买") and not (sideText contains "卖")
      else
        set sideMatches to (sideText contains "卖") and not (sideText contains "买")
      end if
      if beforeContracts does not contain identifier and (item 2 of entry as text) is theSymbol and sideMatches then
        if (item 3 of entry as number) is (thePrice as number) and (item 4 of entry as integer) is (theQuantity as integer) then
          set end of identifiers to identifier
        end if
      end if
    end try
  end repeat
  return identifiers
end matchingNewContracts

on readbackMatches(theWindow, theMode, theSide, theSymbol, thePrice, theQuantity)
  tell application "System Events"
    if not my modeConfirmed(theWindow, theMode) then return false
    if not my checkLayout(theWindow) then return false
    if (value of text field 2 of theWindow as text) is not theSymbol then return false
    if (value of text field 1 of theWindow as number) is not (thePrice as number) then return false
    if (value of text field 3 of theWindow as integer) is not (theQuantity as integer) then return false
    if theSide is "buy" then
      if not (exists button "确定买入" of theWindow) then return false
    else
      if not (exists button "确定卖出" of theWindow) then return false
    end if
    return true
  end tell
end readbackMatches

on fillOrder(theWindow, theMode, theSide, theSymbol, thePrice, theQuantity)
  tell application "System Events"
    if not my selectMode(theWindow, theMode) then return "MODE_UNVERIFIED"
    if not my checkLayout(theWindow) then return "LAYOUT_UNSUPPORTED"
    set originalBroker to ""
    if theMode is not "simulation" then
      set originalBroker to my brokerLabel(theWindow)
      if originalBroker is "" then return "BROKER_UNVERIFIED"
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
    if not my readbackMatches(theWindow, theMode, theSide, theSymbol, thePrice, theQuantity) then return "READBACK_MISMATCH"
    if theMode is not "simulation" and (my brokerLabel(theWindow)) is not originalBroker then return "BROKER_UNVERIFIED"
    return "FORM_READY"
  end tell
end fillOrder
`

const probe = `
      if not my selectMode(theWindow, "%MODE%") then return "MODE_UNVERIFIED"
      if not my checkLayout(theWindow) then return "LAYOUT_UNSUPPORTED"
      if "%MODE%" is not "simulation" and (my brokerLabel(theWindow)) is "" then return "BROKER_UNVERIFIED"
      return "READY"
`

const preview = `
      set fillResult to my fillOrder(theWindow, "%MODE%", "%SIDE%", "%SYMBOL%", "%PRICE%", "%QUANTITY%")
      return fillResult
`

const submit = `
      set fillResult to my fillOrder(theWindow, "%MODE%", "%SIDE%", "%SYMBOL%", "%PRICE%", "%QUANTITY%")
      if fillResult is not "FORM_READY" then return fillResult
      set originalBroker to my brokerLabel(theWindow)
      if not my showView(theWindow, "委托") then return "TABLE_UNSUPPORTED"
      try
        set beforeContracts to my contractSnapshot(theWindow)
      on error
        return "TABLE_UNSUPPORTED"
      end try
      if not my modeConfirmed(theWindow, "%MODE%") then return "MODE_UNVERIFIED"
      if "%MODE%" is not "simulation" and (originalBroker is "" or (my brokerLabel(theWindow)) is not originalBroker) then return "BROKER_UNVERIFIED"
      if not my readbackMatches(theWindow, "%MODE%", "%SIDE%", "%SYMBOL%", "%PRICE%", "%QUANTITY%") then return "READBACK_MISMATCH"
      if not (enabled of button "%SUBMIT%" of theWindow) then return "ORDER_CONTROL_DISABLED"
      set submitTouched to true
      click button "%SUBMIT%" of theWindow
      delay 0.35
%CONFIRM_SHEET%
      if not my modeConfirmed(theWindow, "%MODE%") then return "RECEIPT_UNKNOWN"
      if "%MODE%" is not "simulation" and (my brokerLabel(theWindow)) is not originalBroker then return "RECEIPT_UNKNOWN"
      if not my showView(theWindow, "委托") then return "RECEIPT_UNKNOWN"
      repeat 8 times
        set newContracts to my matchingNewContracts(my orderSnapshot(theWindow), beforeContracts, "%SIDE%", "%SYMBOL%", "%PRICE%", "%QUANTITY%")
        if count of newContracts is 1 then return "%ACCEPTED%|" & item 1 of newContracts
        if count of newContracts > 1 then return "RECEIPT_UNKNOWN"
        delay 0.35
      end repeat
      if count of newContracts is not 1 then return "RECEIPT_UNKNOWN"
      return "RECEIPT_UNKNOWN"
`

const liveSheet = `      if exists sheet 1 of theWindow then return "NATIVE_CONFIRMATION_REQUIRED"`

const simulationSheet = `      if exists sheet 1 of theWindow then
        set confirmationText to (value of every static text of sheet 1 of theWindow) as text
        if confirmationText does not contain "%SYMBOL%" or confirmationText does not contain "%QUANTITY%" or confirmationText does not contain "%PRICE%" or confirmationText does not contain "%SIDE_NAME%" then return "CONFIRMATION_UNRECOGNIZED"
        if not my modeConfirmed(theWindow, "simulation") then return "RECEIPT_UNKNOWN"
        click button "确认" of sheet 1 of theWindow
      end if`

const cancel = `
      if not my selectMode(theWindow, "%MODE%") then return "MODE_UNVERIFIED"
      set originalBroker to my brokerLabel(theWindow)
      if "%MODE%" is not "simulation" and originalBroker is "" then return "BROKER_UNVERIFIED"
      if not my showView(theWindow, "委托") then return "TABLE_UNSUPPORTED"
      try
        set currentContracts to my contractSnapshot(theWindow)
      on error
        return "TABLE_UNSUPPORTED"
      end try
      if currentContracts does not contain "%CONTRACT%" then return "TABLE_UNSUPPORTED"
      set matchedRows to {}
      repeat with areaNumber in {4, 5}
        try
          set theTable to table 1 of scroll area areaNumber of theWindow
          set headings to value of attribute "AXTitle" of every button of group 1 of theTable
          set idColumn to my columnOf(headings, {"合同编号", "委托编号", "合同号", "委托号"})
          if idColumn > 0 then
            repeat with candidateRow in rows of theTable
              set cellValues to value of every static text of candidateRow
              if (item idColumn of cellValues as text) is "%CONTRACT%" then set end of matchedRows to candidateRow
            end repeat
          end if
        end try
      end repeat
      if count of matchedRows is not 1 then return "TABLE_UNSUPPORTED"
      if not (exists button "撤单" of theWindow) then return "CANCEL_CONTROL_UNSUPPORTED"
      select item 1 of matchedRows
      if not my modeConfirmed(theWindow, "%MODE%") then return "MODE_UNVERIFIED"
      if "%MODE%" is not "simulation" and (my brokerLabel(theWindow)) is not originalBroker then return "BROKER_UNVERIFIED"
      if not (enabled of button "撤单" of theWindow) then return "ORDER_CONTROL_DISABLED"
      set submitTouched to true
      click button "撤单" of theWindow
      delay 0.3
      if exists sheet 1 of theWindow then return "NATIVE_CONFIRMATION_REQUIRED"
      repeat 8 times
        repeat with entry in my orderSnapshot(theWindow)
          if (item 1 of entry as text) is "%CONTRACT%" then
            set stateText to item 6 of entry as text
            if stateText contains "已撤" or stateText contains "全撤" or stateText contains "部撤" then return "%CANCELLED%"
          end if
        end repeat
        delay 0.35
      end repeat
      return "RECEIPT_UNKNOWN"
`

const query = `
      if not my selectMode(theWindow, "%MODE%") then return "MODE_UNVERIFIED"
      if "%MODE%" is not "simulation" and (my brokerLabel(theWindow)) is "" then return "BROKER_UNVERIFIED"
      if not my showView(theWindow, "%VIEW%") then return "TABLE_UNSUPPORTED"
      return "VIEW_OPENED"
`

const envelope = `
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
        if not (exists button "A股" of theWindow) then return "TRADE_VIEW_REQUIRED"
%BODY%
      on error errorText number errorNumber
        if submitTouched then return "RECEIPT_UNKNOWN"
        if errorNumber is -1743 or errorNumber is -25211 then return "AUTOMATION_DENIED"
        return "SCRIPT_ERROR"
      end try
    end tell
  end tell
end run
`

export function macThsScript(action: MacThsAction, mode: MacThsMode, order?: MacThsOrder, contractNo = ''): string {
  const nativeActions: MacThsAction[] = ['probe', 'preview', 'submitSimulation', 'submitLive', 'cancelSimulation', 'cancelLive', 'queryOrders', 'queryDeals']
  if (!nativeActions.includes(action)) throw new Error('Unsupported native action')
  if (!['simulation', 'livePreview', 'live'].includes(mode)) throw new Error('Invalid mode')
  const value = order ? validateMacThsOrder(order) : null
  if (['preview', 'submitSimulation', 'submitLive'].includes(action) && (!value || value.mode !== mode)) throw new Error('Invalid order')
  if ((action === 'submitLive' || action === 'cancelLive') && mode !== 'live') throw new Error('Live mode required')
  if ((action === 'submitSimulation' || action === 'cancelSimulation') && mode !== 'simulation') throw new Error('Simulation mode required')
  if ((action === 'cancelLive' || action === 'cancelSimulation') && !/^[a-zA-Z0-9-]{1,32}$/.test(contractNo)) throw new Error('Invalid contract')
  const template = action === 'probe' ? probe : action === 'preview' ? preview
    : action === 'submitLive' || action === 'submitSimulation' ? submit
    : action === 'cancelLive' || action === 'cancelSimulation' ? cancel : query
  const body = template.replaceAll('%CONFIRM_SHEET%', mode === 'simulation' ? simulationSheet : liveSheet)
  const tokens: Record<string, string> = {
    '%MODE%': mode, '%SIDE%': value?.side ?? 'buy', '%SYMBOL%': value?.symbol ?? '000001',
    '%PRICE%': value?.price ?? '1.00', '%QUANTITY%': String(value?.quantity ?? 100),
    '%SUBMIT%': value?.side === 'sell' ? '确定卖出' : '确定买入',
    '%SIDE_NAME%': value?.side === 'sell' ? '卖出' : '买入', '%CONTRACT%': contractNo,
    '%VIEW%': action === 'queryDeals' ? '成交' : '委托',
    '%ACCEPTED%': mode === 'simulation' ? 'SIMULATION_ACCEPTED' : 'LIVE_ACCEPTED',
    '%CANCELLED%': mode === 'simulation' ? 'SIMULATION_CANCELLED' : 'LIVE_CANCELLED',
  }
  const resolved = body.replace(/%[A-Z_]+%/g, token => tokens[token] ?? '')
  return helpers + envelope.replace('%BODY%', resolved)
}
