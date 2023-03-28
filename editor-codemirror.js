'use strict'
define(function(require) {
  if ((new URLSearchParams(window.location.search)).get('textarea') !== null) { return }

  let system = require('play/system')
  let players = require('player/players')
  let {updateCode} = require('update-code')
  let consoleOut = require('console')

  let editorDiv = document.getElementById('code-codemirror')
  editorDiv.style.display = 'block'
  let editor = CodeMirror(editorDiv, {
    lineNumbers: true,
    lineWrapping: true,
    tabSize: 2,
    inputStyle: "textarea",
    smartIndent: false,
  })
  editor.setValue(localStorage.getItem('limut-code') || '')
  editor.on('change', () => localStorage.setItem('limut-code', editor.getValue()))
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
  window.stop = () => {
    system.resume()
    players.stopAll()
    consoleOut('> Stop all players')
  }
  window.go = () => {
    updateCode(editor.getValue())
    if (editor.getValue().trim() !== '') {
      editorDiv.style.backgroundColor = '#d9d9d980'
      setTimeout(() => editorDiv.style.backgroundColor = 'transparent', 150)
    }
  }
  window.comment = () => {
    editor.toggleComment()
  }

})