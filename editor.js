'use strict'
define(function(require) {
  let parseLine = require('parse-line')
  let system = require('play/system')
  let players = require('player/players')
  let mainVars = require('main-vars')
  let consoleOut = require('console')

  let editorDiv = document.getElementById('code')
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
    players.instances = {}
    consoleOut('> Stop all players')
  }
  window.go = () => {
    system.resume()
    players.instances = {}
    mainVars.reset()
    players.overrides = {}
    consoleOut('> Update code')
    editor.getValue().split('\n')
    .map((l,i) => {return{line:l.trim(), num:i}})
    .filter(({line}) => line != '')
    .map(({line,num}) => {
      try {
        parseLine(line, num)
      } catch (e) {
        let st = e.stack ? '\n'+e.stack.split('\n')[0] : ''
        consoleOut('Error on line '+(num+1)+': ' + e + st)
      }
    })
    editor.execCommand('selectAll')
    setTimeout(() => editor.execCommand('undoSelection'), 100)
  }
  window.comment = () => {
    editor.toggleComment()
  }

})