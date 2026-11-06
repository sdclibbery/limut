'use strict'
define(function(require) {
  let system = require('play/system')
  let players = require('player/players')
  let {updateCode,cancelUpdate} = require('update-code')
  let consoleOut = require('console')
  let fxMixChain = require('play/effects/fxMixChain')
  let envelope = require('play/envelopes')
  let sliders = require('functions/sliders')
  let {findSliders,injectInlineIds,formatValue} = require('inline-sliders')

  let editorDiv = document.getElementById('code-codemirror')
  editorDiv.style.display = 'block'
  let editor = CodeMirror(editorDiv, {
    mode: "limut",
    lineNumbers: true,
    lineWrapping: true,
    tabSize: 2,
    inputStyle: "textarea",
    smartIndent: false,
    matchBrackets: true,
  })
  if ((new URLSearchParams(window.location.search)).get('nosave') === null) {
    editor.setValue(localStorage.getItem('limut-code') || '')
    editor.on('change', () => localStorage.setItem('limut-code', editor.getValue()))
  }
  let changeListeners = []
  let applyingRemote = false
  editor.on('change', (cm, changeObj) => {
    if (applyingRemote) { return }
    if (changeListeners.length === 0) { return }
    for (let i = 0; i < changeListeners.length; i++) { changeListeners[i](changeObj) }
  })
  let cursorListeners = []
  editor.on('cursorActivity', () => {
    if (cursorListeners.length === 0) { return }
    let pos = editor.getCursor()
    for (let i = 0; i < cursorListeners.length; i++) { cursorListeners[i]({ line: pos.line, ch: pos.ch }) }
  })

  let peerCursors = new Map()
  let buildCursorWidget = (peerName, color) => {
    let el = document.createElement('span')
    el.className = 'remote-cursor'
    el.style.position = 'relative'
    el.style.display = 'inline-block'
    el.style.width = '0'
    el.style.height = '1em'
    el.style.borderLeft = '2px solid ' + color
    el.style.marginLeft = '-1px'
    el.style.verticalAlign = 'text-top'
    el.style.zIndex = '5'
    el.style.pointerEvents = 'none'
    let label = document.createElement('span')
    label.textContent = peerName
    label.style.position = 'absolute'
    label.style.top = '-0.95em'
    label.style.left = '-1px'
    label.style.background = color
    label.style.color = 'white'
    label.style.padding = '0 3px'
    label.style.fontSize = '0.7em'
    label.style.lineHeight = '1.1em'
    label.style.fontFamily = 'sans-serif'
    label.style.borderRadius = '2px'
    label.style.whiteSpace = 'nowrap'
    el.appendChild(label)
    return el
  }
  let setPeerCursor = (peerId, peerName, pos, color) => {
    let existing = peerCursors.get(peerId)
    if (existing) { existing.clear() }
    let lastLine = editor.lastLine()
    let line = Math.max(0, Math.min(pos.line, lastLine))
    let ch = Math.max(0, Math.min(pos.ch, editor.getLine(line) ? editor.getLine(line).length : 0))
    let widget = buildCursorWidget(peerName, color)
    let bookmark = editor.setBookmark({ line: line, ch: ch }, { widget: widget, insertLeft: true })
    peerCursors.set(peerId, bookmark)
  }
  let removePeerCursor = (peerId) => {
    let existing = peerCursors.get(peerId)
    if (existing) { existing.clear() }
    peerCursors.delete(peerId)
  }
  let inlineWidgets = []
  let clearInlineWidgets = () => {
    inlineWidgets.forEach(w => { w.bookmark.clear(); w.mark.clear() })
    inlineWidgets = []
  }
  // A bookmark only goes when a deletion spans it, so remove a widget once its call is edited away
  editor.on('changes', () => {
    for (let i = inlineWidgets.length-1; i >= 0; i--) {
      let w = inlineWidgets[i]
      let pos = w.bookmark.find()
      if (pos && /\bslider\s*\{$/.test(editor.getLine(pos.line).slice(0, pos.ch))) { continue }
      w.bookmark.clear()
      w.mark.clear()
      inlineWidgets.splice(i, 1)
    }
  })
  let writeLiteral = (w, value) => {
    let range = w.mark.find()
    if (!range) { return }
    let text = String(value)
    let from = range.from || range
    let to = range.to || range
    let needsComma = !w.hasValue && !w.empty
    editor.replaceRange(text + (needsComma ? ', ' : ''), from, to, '+slider')
    if (needsComma) {
      w.mark.clear()
      w.mark = editor.markText(from, {line:from.line, ch:from.ch+text.length}, { inclusiveLeft:true, inclusiveRight:true, clearWhenEmpty:false })
      w.hasValue = true
    }
  }
  let buildInlineWidgets = (sites) => {
    clearInlineWidgets()
    sites.forEach((site, n) => {
      let input = document.createElement('input')
      input.type = 'range'
      input.min = 0
      input.max = 1000
      input.className = 'inline-slider'
      input.style.display = 'none'
      let w = {
        n: n,
        input: input,
        hasValue: site.hasValue,
        empty: site.empty,
        mark: editor.markText(editor.posFromIndex(site.valueFrom), editor.posFromIndex(site.valueTo), { inclusiveLeft:true, inclusiveRight:true, clearWhenEmpty:false }),
        bookmark: editor.setBookmark(editor.posFromIndex(site.valueFrom), { widget: input }), // Before the number, so it doesn't move as the number's width changes
      }
      let apply = () => {
        let slider = sliders.getInlineSlider(n)
        if (!slider) { return }
        let value = formatValue(sliders.sliderFromInput(slider, parseFloat(input.value)))
        sliders.setInlineValue(slider, value)
        writeLiteral(w, value)
      }
      input.oninput = apply
      // Writing the literal makes CodeMirror redraw the line, detaching the input, which kills a native
      // range drag. So drag by hand with document listeners, which survive the redraw.
      let setFromX = (x) => {
        let rect = input.getBoundingClientRect()
        if (rect.width <= 0) { return }
        input.value = Math.round(1000 * Math.min(Math.max((x - rect.left) / rect.width, 0), 1))
        apply()
      }
      input.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) { return }
        e.preventDefault()
        input.focus()
        setFromX(e.clientX)
        let move = (e) => setFromX(e.clientX)
        let up = () => {
          document.removeEventListener('pointermove', move)
          document.removeEventListener('pointerup', up)
          document.removeEventListener('pointercancel', up)
        }
        document.addEventListener('pointermove', move)
        document.addEventListener('pointerup', up)
        document.addEventListener('pointercancel', up)
      })
      inlineWidgets.push(w)
    })
  }
  // After every update, including section reruns: a slider in a section block only exists while its section is active
  sliders.onSweep(() => {
    inlineWidgets.forEach(w => {
      let slider = sliders.getInlineSlider(w.n)
      if (!slider) { w.input.style.display = 'none'; return }
      let update = () => { w.input.value = sliders.inputFromSlider(slider, slider.value) }
      slider.updateWidget = update // Peers get the literal through the collab text delta, so only the widget moves
      update()
      w.input.style.display = ''
    })
  })

  let ctrlCode = (event, keys) => {
    if (event.isComposing || event.keyCode === 229) { return false }
    return ((event.ctrlKey || event.metaKey) && (keys.includes(event.keyCode) || keys.includes(event.key)))
  }
  document.addEventListener("keydown", event => {
    if (ctrlCode(event, ['.', 190])) { window.stop() }
  })
  editorDiv.addEventListener("keydown", event => {
    if (ctrlCode(event, [10, 13])) { window.go() }
  })
  editorDiv.addEventListener("keydown", event => {
    if (ctrlCode(event, ['/', 191])) { window.comment() }
  })
  let isRunning = false
  let runStateListeners = []
  let notifyRunState = () => {
    for (let i = 0; i < runStateListeners.length; i++) { runStateListeners[i](isRunning) }
  }
  window.stop = () => {
    system.resume()
    cancelUpdate() // An update still parsing (blocked on an include fetch) must not write into the state we are about to tear down
    fxMixChain.disconnectAll()
    players.stopAll()
    envelope.releaseAllLive() // Backstop: any live voice not released by its player's destroy (one whose event was never registered) still stops here
    consoleOut('> Stop all players')
    isRunning = false
    notifyRunState()
  }
  window.go = () => {
    let code = editor.getValue()
    let sites = findSliders(code)
    buildInlineWidgets(sites)
    updateCode(injectInlineIds(code, sites))
    if (editor.getValue().trim() !== '') {
      editorDiv.style.backgroundColor = '#d9d9d980'
      setTimeout(() => editorDiv.style.backgroundColor = 'transparent', 150)
    }
    isRunning = true
    notifyRunState()
  }
  window.comment = () => {
    editor.toggleComment()
  }

  return {
    getValue: () => editor.getValue(),
    setValue: (v) => {
      applyingRemote = true
      try { editor.setValue(v) } finally { applyingRemote = false }
    },
    onChange: (cb) => { changeListeners.push(cb) },
    applyChange: (change) => {
      applyingRemote = true
      try { editor.replaceRange(change.text, change.from, change.to) } finally { applyingRemote = false }
    },
    isRunning: () => isRunning,
    onRunStateChange: (cb) => { runStateListeners.push(cb) },
    onCursorChange: (cb) => { cursorListeners.push(cb) },
    getCursor: () => {
      let pos = editor.getCursor()
      return { line: pos.line, ch: pos.ch }
    },
    setPeerCursor: setPeerCursor,
    removePeerCursor: removePeerCursor,
  }
})