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
import { validateNativeScriptRequest, type NativeScriptRequest } from '../../shared/macThsNativeProtocol'

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
        set orderEntries to {}
        repeat with theRow in rows of theTable
          set cells to value of every static text of theRow
          set identifier to item idColumn of cells as text
          if identifier is not "" then
            set orderState to ""
            if stateColumn > 0 then set orderState to item stateColumn of cells as text
            set end of orderEntries to {identifier, item codeColumn of cells as text, item priceColumn of cells as text, item quantityColumn of cells as text, item sideColumn of cells as text, orderState}
          end if
        end repeat
        return orderEntries
      end try
    end repeat
  end tell
  error "unsupported table"
end orderSnapshot

on exclusiveCancelTarget(theWindow, targetContract)
  tell application "System Events"
    try
      set recognizedTables to 0
      set matchingTargets to 0
      set selectedCount to 0
      set selectedTarget to false
      repeat with areaNumber in {4, 5}
        if exists scroll area areaNumber of theWindow then
          if (count of tables of scroll area areaNumber of theWindow) > 1 then return false
          if exists table 1 of scroll area areaNumber of theWindow then
            set theTable to table 1 of scroll area areaNumber of theWindow
            set headings to value of attribute "AXTitle" of every button of group 1 of theTable
            set idColumn to 0
            set idColumns to 0
            repeat with columnNumber from 1 to count of headings
              if (item columnNumber of headings as text) is in {"合同编号", "委托编号", "合同号", "委托号"} then
                set idColumns to idColumns + 1
                set idColumn to columnNumber
              end if
            end repeat
            if idColumns > 1 then return false
            if idColumns is 1 then
              set recognizedTables to recognizedTables + 1
              if recognizedTables > 1 then return false
              if (count of rows of theTable) > 2000 then return false
              repeat with candidateRow in rows of theTable
                set cellValues to value of every static text of candidateRow
                if (count of cellValues) < idColumn then return false
                set identifier to item idColumn of cellValues as text
                if identifier is "" then return false
                if identifier is targetContract then set matchingTargets to matchingTargets + 1
                set rowIsSelected to value of attribute "AXSelected" of candidateRow
                if (class of rowIsSelected) is not boolean then return false
                if rowIsSelected then
                  set selectedCount to selectedCount + 1
                  if identifier is not targetContract then return false
                  set selectedTarget to true
                end if
              end repeat
            end if
          end if
        end if
      end repeat
      return recognizedTables is 1 and matchingTargets is 1 and selectedCount is 1 and selectedTarget
    on error
      return false
    end try
  end tell
end exclusiveCancelTarget

on contractSnapshot(theWindow)
  set identifiers to {}
  repeat with entry in my orderSnapshot(theWindow)
    set end of identifiers to item 1 of entry as text
  end repeat
  return identifiers
end contractSnapshot

on matchingNewContracts(orderEntries, beforeContracts, theSide, theSymbol, thePrice, theQuantity)
  set identifiers to {}
  repeat with entry in orderEntries
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
      if exists sheet 1 of theWindow then return "NATIVE_CONFIRMATION_REQUIRED"
      if not my exclusiveCancelTarget(theWindow, "%CONTRACT%") then return "TABLE_UNSUPPORTED"
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

// Private versioned JXA protocol. The legacy templates above retain their MIT attribution.
const nativeAxProgram = String.raw`(function(q) {
  var p = {version:1,nonce:q.nonce,action:q.action,phase:q.action === 'execute' ? 'before_submit' : 'observed',
    clientVersion:null,layoutProfile:null,fields:{account:'missing',mode:'missing',tradingDate:'missing',headers:'missing',readback:'missing',receipt:'missing'},
    account:null,mode:null,tradingDate:null,readback:null,target:null,beforeContracts:null,contractMatch:null,submitTouched:false,code:'SCRIPT_ERROR'};
  function done(code) { p.code=code; return JSON.stringify(p); }
  function list(object, name) { try { var a=object[name](); return Array.isArray(a) ? a : []; } catch (_) { return []; } }
  function attr(object, name) { try { return object.attributes.byName(name).value(); } catch (_) { return null; } }
  function text(value) { return typeof value === 'string' && value.length <= 128 ? value.trim() : ''; }
  function value(object) { try { return text(object.value()); } catch (_) { return ''; } }
  function named(object, name) { try { var b=object.buttons.byName(name); return b.exists() ? b : null; } catch (_) { return null; } }
  function selected(object) { return attr(object,'AXSelected') === true || attr(object,'AXValue') === 1; }
  function enabled(object) { return attr(object,'AXEnabled') === true; }
  function unique(values) { return values.filter(function(x,i) { return values.indexOf(x) === i; }); }
  function date(raw) {
    var s=text(raw).replace(/\//g,'-');
    if (/^\d{8}$/.test(s)) s=s.slice(0,4)+'-'+s.slice(4,6)+'-'+s.slice(6);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    var y=Number(s.slice(0,4)),m=Number(s.slice(5,7)),d=Number(s.slice(8,10));
    var check=new Date(Date.UTC(y,m-1,d));
    return check.getUTCFullYear()===y && check.getUTCMonth()===m-1 && check.getUTCDate()===d ? s : null;
  }
  function integer(raw, zero) { var s=text(String(raw)); if (!/^\d{1,7}$/.test(s)) return null; var n=Number(s); return n >= (zero?0:1) && n<=1000000 ? n : null; }
  function cents(raw) { var m=/^(\d{1,5})(?:\.(\d{1,2}))?$/.exec(text(raw)); if (!m) return null; var n=Number(m[1])*100+Number(((m[2]||'')+'00').slice(0,2)); return n>0 ? n : null; }
  function market(raw) { var map={'上海':'SH','沪市':'SH','上海A股':'SH','SH':'SH','深圳':'SZ','深市':'SZ','深圳A股':'SZ','SZ':'SZ','北京':'BJ','北交所':'BJ','BJ':'BJ'}; return map[text(raw)]||null; }
  function side(raw) { return ['买入','证券买入','买'].indexOf(raw)>=0 ? 'buy' : ['卖出','证券卖出','卖'].indexOf(raw)>=0 ? 'sell' : null; }
  function state(raw) {
    if (['已报','已确认','已成','已成交','全部成交','部成','部分成交'].indexOf(raw)>=0) return 'accepted';
    if (['已撤','全撤','已撤单','全部撤单'].indexOf(raw)>=0) return 'cancelled';
    if (['部撤','部分撤单'].indexOf(raw)>=0) return 'partially_cancelled';
    return null;
  }
  function label(object) { return text(attr(object,'AXDescription')) || text(attr(object,'AXTitle')); }
  function broker(w) {
    var candidates=[];
    try {
      var b=w.scrollAreas()[0].tables()[0].rows()[0].uiElements()[1].buttons()[0];
      var t=text(attr(b,'AXTitle')); if (t.indexOf('中信证券')===0 && t.length>4) candidates.push(t);
    } catch (_) {}
    list(w,'staticTexts').forEach(function(s) { var v=value(s); if(v.indexOf('中信证券')===0 && v.length>4)candidates.push(v); });
    return unique(candidates).length===1;
  }
  function account(w) {
    if (!broker(w)) { p.fields.account='missing'; return null; }
    var candidates=[], seenMasked=false, invalid=false;
    list(w,'popUpButtons').concat(list(w,'comboBoxes')).forEach(function(control) {
      var l=label(control),kind=['资金账号','资金账户'].indexOf(l)>=0 ? 'fund_account' : ['股东账号','证券账户'].indexOf(l)>=0 ? 'shareholder_account' : null;
      if (!kind) return;
      var raw=text(attr(control,'AXValue')) || value(control), selection=selected(control);
      var children=attr(control,'AXSelectedChildren');
      if (!selection && Array.isArray(children) && children.length===1) selection=selected(children[0]) && (value(children[0])===raw || text(attr(children[0],'AXTitle'))===raw);
      if (!selection) return;
      if (/[*＊•●…]/.test(raw)) { seenMasked=true; return; }
      if (!/^[A-Z0-9]{6,32}$/.test(raw)) { invalid=true; return; }
      candidates.push({kind:kind,value:raw,broker:'citics',selected:true});
    });
    if(candidates.length!==1 || seenMasked || invalid) {
      p.fields.account=candidates.length>1 || (candidates.length && (seenMasked||invalid)) ? 'ambiguous' : seenMasked ? 'masked_only' : invalid ? 'invalid' : 'missing'; return null;
    }
    p.fields.account='recognized'; return candidates[0];
  }
  function mode(w) {
    var live=named(w,'A股'),sim=named(w,'模拟'),l=!!live&&selected(live),s=!!sim&&selected(sim);
    if(l===s) { p.fields.mode=l?'ambiguous':'missing'; return null; }
    var actual=s?'simulation':'live'; if(actual!==(q.mode==='simulation'?'simulation':'live')) { p.fields.mode='invalid'; return null; }
    p.fields.mode='recognized'; return actual;
  }
  function column(headings,names,required) {
    var matches=[]; headings.forEach(function(h,i) {if(names.indexOf(h)>=0)matches.push(i);});
    if(matches.length>1 || (required && matches.length!==1)) throw new Error('table');
    return matches.length ? matches[0] : -1;
  }
  function rows(w) {
    var tables=[], areas=list(w,'scrollAreas');
    [3,4].forEach(function(i) {
      if(!areas[i])return;
      var ts=list(areas[i],'tables'); if(ts.length!==1)return;
      var groups=list(ts[0],'groups'); if(groups.length!==1)return;
      var headings=list(groups[0],'buttons').map(function(b){return text(attr(b,'AXTitle'));});
      if(headings.length>24)return;
      try {
        var ix={id:column(headings,['合同编号','委托编号','合同号','委托号'],true),symbol:column(headings,['证券代码','股票代码','代码'],true),
          price:column(headings,['委托价格','委托价','价格'],true),quantity:column(headings,['委托数量','委托股数','数量'],true),
          side:column(headings,['买卖标志','买卖','操作','委托类别','委托类型','方向'],true),
          date:column(headings,['委托日期','交易日期'],true),market:column(headings,['交易市场','证券市场','市场'],true),
          state:column(headings,['委托状态','状态','委托结果'],false),filled:column(headings,['成交数量','已成数量'],false),cancelled:column(headings,['撤单数量','已撤数量'],false)};
        var rr=list(ts[0],'rows'); if(rr.length>64)throw new Error('table');
        var parsed=rr.map(function(row) {
          var cells=list(row,'staticTexts').map(value); if(cells.length!==headings.length)throw new Error('table');
          var item={contractNo:cells[ix.id],symbol:cells[ix.symbol],market:market(cells[ix.market]),side:side(cells[ix.side]),
            priceCents:cents(cells[ix.price]),quantity:integer(cells[ix.quantity],false),tradingDate:date(cells[ix.date]),
            observation:ix.state<0?null:state(cells[ix.state]),filledQuantity:ix.filled<0||cells[ix.filled]===''?null:integer(cells[ix.filled],true),
            cancelledQuantity:ix.cancelled<0||cells[ix.cancelled]===''?null:integer(cells[ix.cancelled],true)};
          if(!/^[a-zA-Z0-9-]{1,32}$/.test(item.contractNo)||!/^\d{6}$/.test(item.symbol)||!item.market||!item.side||!item.priceCents||!item.quantity||!item.tradingDate)throw new Error('table');
          if((ix.filled>=0&&cells[ix.filled]!==''&&item.filledQuantity===null)||(ix.cancelled>=0&&cells[ix.cancelled]!==''&&item.cancelledQuantity===null))throw new Error('table');
          if((item.filledQuantity||0)+(item.cancelledQuantity||0)>item.quantity)throw new Error('table');
          return {fact:item,row:row};
        });
        if(unique(parsed.map(function(x){return x.fact.contractNo;})).length!==parsed.length)throw new Error('table');
        tables.push(parsed);
      } catch (_) { p.fields.headers='invalid'; }
    });
    if(tables.length!==1) { p.fields.headers=tables.length>1?'ambiguous':p.fields.headers; return null; }
    p.fields.headers='recognized'; return tables[0];
  }
  function observedDate(w,entries) {
    var dates=[],invalid=false;
    list(w,'popUpButtons').concat(list(w,'staticTexts')).forEach(function(control) {
      if(['委托日期','交易日期','当前交易日期'].indexOf(label(control))<0)return;
      if(attr(control,'AXRole')!=='AXStaticText' && !selected(control))return;
      var parsed=date(text(attr(control,'AXValue'))||value(control)); if(parsed)dates.push(parsed); else invalid=true;
    });
    dates=unique(dates);
    if(invalid||dates.length>1) {p.fields.tradingDate=dates.length>1?'ambiguous':'invalid';return null;}
    if(!dates.length && entries) dates=unique(entries.map(function(x){return x.fact.tradingDate;}));
    if(dates.length!==1) {p.fields.tradingDate=dates.length>1?'ambiguous':'missing';return null;}
    p.fields.tradingDate='recognized';return dates[0];
  }
  function sameAccount(a,b) {return !!a&&!!b&&a.kind===b.kind&&a.value===b.value&&a.broker===b.broker&&a.selected===true&&b.selected===true;}
  function sameOrder(a,b) {return !!a&&!!b&&['symbol','market','side','priceCents','quantity'].every(function(k){return a[k]===b[k];});}
  function exclusiveCancelSelection(entries) {
    if(!entries)return false;
    var selectedRows=[],uncertain=false;
    entries.forEach(function(entry) {
      var s=attr(entry.row,'AXSelected'),v=attr(entry.row,'AXValue');
      var a=typeof s==='boolean'?s:null,b=v===1?true:v===0?false:null;
      if((a===null&&b===null)||(a!==null&&b!==null&&a!==b)){uncertain=true;return;}
      if(a!==null?a:b)selectedRows.push(entry.fact);
    });
    return !uncertain&&selectedRows.length===1&&selectedRows[0].contractNo===q.contractNo
      &&selectedRows[0].tradingDate===q.expectedDate&&sameOrder(selectedRows[0],q.order);
  }
  function readback(w) {
    var fields=list(w,'textFields'), buy=named(w,'确定买入'),sell=named(w,'确定卖出');
    if(fields.length!==3||!!buy===!!sell||fields.some(function(f){return attr(f,'AXSubrole')==='AXSecureTextField';}))return null;
    var markets=[];
    list(w,'popUpButtons').concat(list(w,'staticTexts')).forEach(function(c) {
      if(['市场','证券市场','交易市场'].indexOf(label(c))<0)return;
      if(attr(c,'AXRole')!=='AXStaticText'&&!selected(c))return;
      var m=market(text(attr(c,'AXValue'))||value(c));if(m)markets.push(m);
    });
    markets=unique(markets); if(markets.length!==1)return null;
    var result={symbol:value(fields[1]),market:markets[0],side:buy?'buy':'sell',priceCents:cents(value(fields[0])),quantity:integer(value(fields[2]),false)};
    return /^\d{6}$/.test(result.symbol)&&result.priceCents&&result.quantity ? result : null;
  }
  function sheets(w) {return list(w,'sheets').length>0;}
  function observeReceipt(w,baseline) {
    var currentAccount=account(w),actualMode=mode(w);
    if(!sameAccount(currentAccount,q.expectedAccount)||!actualMode)return done('RECEIPT_UNKNOWN');
    p.account=currentAccount;p.mode=actualMode;
    var current=rows(w);if(!current)return done('RECEIPT_UNKNOWN');
    var matches=current.filter(function(x) {
      return sameOrder(x.fact,q.order)&&x.fact.tradingDate===q.expectedDate&&(q.contractNo ? x.fact.contractNo===q.contractNo : baseline!==null && baseline.indexOf(x.fact.contractNo)<0);
    });
    if(matches.length!==1) {p.fields.receipt=matches.length>1?'ambiguous':'missing';return done('RECEIPT_UNKNOWN');}
    var target=matches[0].fact;
    if(q.contractNo ? ['cancelled','partially_cancelled'].indexOf(target.observation)<0 : target.observation!=='accepted')return done('RECEIPT_UNKNOWN');
    p.target=target;p.tradingDate=target.tradingDate;p.fields.tradingDate='recognized';p.fields.receipt='recognized';
    p.contractMatch=q.contractNo?'unique_target':'unique_new';
    return done(q.contractNo ? (q.mode==='simulation'?'SIMULATION_CANCELLED':'LIVE_CANCELLED') : (q.mode==='simulation'?'SIMULATION_ACCEPTED':'LIVE_ACCEPTED'));
  }
  try {
    var app=Application('同花顺'),system=Application('System Events'),process=system.processes.byName('同花顺');
    if(!process.exists())return done('CLIENT_NOT_RUNNING');
    var v=text(app.version());if(!/^[0-9][a-zA-Z0-9._-]{0,39}$/.test(v))return done('LAYOUT_UNSUPPORTED');
    p.clientVersion=v;
    var windows=list(process,'windows');if(windows.length!==1)return done('TRADE_VIEW_REQUIRED');
    var w=windows[0];if(!named(w,'A股'))return done('TRADE_VIEW_REQUIRED');
    p.layoutProfile='citics-explicit-ax-v1';
    if(sheets(w))return done('NATIVE_CONFIRMATION_REQUIRED');
    p.mode=mode(w);if(!p.mode)return done('MODE_UNVERIFIED');
    p.account=account(w);if(!p.account)return done('ACCOUNT_IDENTITY_UNAVAILABLE');
    var entries=rows(w);
    p.tradingDate=observedDate(w,entries);
    if(q.action==='observe_context')return done(p.tradingDate?'READY':'TRADING_DATE_UNAVAILABLE');
    if(q.action==='observe_cancel_target') {
      if(!entries)return done('TABLE_UNSUPPORTED');
      var targets=entries.filter(function(x){return x.fact.contractNo===q.contractNo;});
      if(targets.length!==1){p.fields.receipt=targets.length>1?'ambiguous':'missing';return done('TARGET_UNVERIFIED');}
      p.target=targets[0].fact;p.tradingDate=p.target.tradingDate;p.fields.tradingDate='recognized';p.fields.receipt='recognized';
      return done('TARGET_OBSERVED');
    }
    if(!sameAccount(p.account,q.expectedAccount)||p.clientVersion!==q.expectedClientVersion)return done('ACCOUNT_IDENTITY_UNAVAILABLE');
    if(!q.order||!q.expectedDate)return done('RECEIPT_UNKNOWN');
    if(q.action==='observe_receipt') {
      p.beforeContracts=q.beforeContracts;
      return observeReceipt(w,q.beforeContracts);
    }
    if(!entries)return done('TABLE_UNSUPPORTED');
    var targetRow=null;
    if(q.contractNo) {
      var targets=entries.filter(function(x){return x.fact.contractNo===q.contractNo&&sameOrder(x.fact,q.order)&&x.fact.tradingDate===q.expectedDate;});
      if(targets.length!==1)return done('TARGET_UNVERIFIED');
      targetRow=targets[0].row;p.tradingDate=targets[0].fact.tradingDate;p.fields.tradingDate='recognized';
    }
    if(p.tradingDate!==q.expectedDate)return done('TRADING_DATE_UNAVAILABLE');
    p.beforeContracts=entries.map(function(x){return x.fact.contractNo;});
    if(!q.contractNo) {
      var direction=named(w,q.order.side==='buy'?'买入':'卖出');
      if(!direction||list(w,'textFields').length!==3)return done('LAYOUT_UNSUPPORTED');
      direction.click();delay(0.15);
      var fields=list(w,'textFields');if(fields.length!==3)return done('LAYOUT_UNSUPPORTED');
      fields[1].value=q.order.symbol;fields[0].value=(q.order.priceCents/100).toFixed(2);fields[2].value=String(q.order.quantity);
      delay(0.2);p.readback=readback(w);
      if(!p.readback||!sameOrder(p.readback,q.order)) {p.readback=null;p.fields.readback='invalid';return done('READBACK_MISMATCH');}
      p.fields.readback='recognized';
    } else targetRow.select();
    // Final checks bind the main-process witness, not a new in-script broker label.
    var finalAccount=account(w),finalMode=mode(w);
    if(!sameAccount(finalAccount,q.expectedAccount)||!finalMode)return done('ACCOUNT_IDENTITY_UNAVAILABLE');
    p.account=finalAccount;p.mode=finalMode;
    var finalEntries=rows(w);if(!finalEntries)return done('TABLE_UNSUPPORTED');
    if(q.contractNo) {
      var finalTarget=finalEntries.filter(function(x){return x.fact.contractNo===q.contractNo&&sameOrder(x.fact,q.order)&&x.fact.tradingDate===q.expectedDate;});
      if(finalTarget.length!==1||!exclusiveCancelSelection(finalEntries))return done('TARGET_UNVERIFIED');
    } else {
      var finalReadback=readback(w);
      if(!sameOrder(finalReadback,q.order))return done('READBACK_MISMATCH');
      var finalDate=observedDate(w,finalEntries);if(finalDate!==q.expectedDate)return done('TRADING_DATE_UNAVAILABLE');
      if(JSON.stringify(finalEntries.map(function(x){return x.fact.contractNo;}).sort())!==JSON.stringify(p.beforeContracts.slice().sort()))return done('RECEIPT_UNKNOWN');
      p.readback=finalReadback;
    }
    var button=named(w,q.contractNo?'撤单':q.order.side==='buy'?'确定买入':'确定卖出');
    if(!button||!enabled(button))return done('ORDER_CONTROL_DISABLED');
    if(sheets(w))return done('NATIVE_CONFIRMATION_REQUIRED');
    if(q.contractNo&&!exclusiveCancelSelection(rows(w)))return done('TARGET_UNVERIFIED');
    p.submitTouched=true;p.phase='after_submit';button.click();delay(0.3);
    if(sheets(w))return done('NATIVE_CONFIRMATION_REQUIRED');
    // No polling can click a submit/confirmation button again.
    for(var attempt=0;attempt<8;attempt++) {
      var result=observeReceipt(w,p.beforeContracts);
      if(p.contractMatch!==null)return result;
      if(sheets(w))return done('NATIVE_CONFIRMATION_REQUIRED');
      delay(0.25);
    }
    return done('RECEIPT_UNKNOWN');
  } catch(error) {
    if(p.submitTouched)return done('RECEIPT_UNKNOWN');
    var number=Number(error && (error.errorNumber||error.number));
    return done(number===-1743||number===-25211?'AUTOMATION_DENIED':'SCRIPT_ERROR');
  }
})(__NATIVE_REQUEST__)`

export function macThsNativeScript(request: NativeScriptRequest): string {
  validateNativeScriptRequest(request)
  const json = JSON.stringify(request).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
  return nativeAxProgram.replace('__NATIVE_REQUEST__', () => json)
}
