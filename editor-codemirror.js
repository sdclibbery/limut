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
  }
})