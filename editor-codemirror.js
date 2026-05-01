'use strict'
define(function(require) {
  let system = require('play/system')
  let players = require('player/players')
  let {updateCode} = require('update-code')
  let consoleOut = require('console')
  let fxMixChain = require('play/effects/fxMixChain')

  let editorDiv = document.getElementById('code-codemirror')
  editorDiv.style.display = 'block'
  let editor = CodeMirror(editorDiv, {
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
    fxMixChain.disconnectAll()
    players.stopAll()
    consoleOut('> Stop all players')
    isRunning = false
    notifyRunState()
  }
  window.go = () => {
    updateCode(editor.getValue())
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