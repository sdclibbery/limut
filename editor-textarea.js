'use strict'
define(function(require) {
  if ((new URLSearchParams(window.location.search)).get('textarea') === null) { return }

  let parseLine = require('parse-line')
  let system = require('play/system')
  let players = require('player/players')
  let mainVars = require('main-vars')
  let consoleOut = require('console')

  let codeTextArea = document.getElementById('code-textarea')
  codeTextArea.style.display = 'block'
  codeTextArea.value = localStorage.getItem('limut-code') || ''
  codeTextArea.addEventListener('change', () => localStorage.setItem('limut-code', codeTextArea.value))
  let ctrlCode = (event, keys) => {
    if (event.isComposing || event.keyCode === 229) { return false }
    return (event.ctrlKey && (keys.includes(event.keyCode) || keys.includes(event.key)))
  }
  document.addEventListener("keydown", event => {
    if (ctrlCode(event, ['.'])) { window.stop() }
  })
  codeTextArea.addEventListener("keydown", event => {
    if (ctrlCode(event, [10, 13])) { window.go() }
  })
  codeTextArea.addEventListener("keydown", event => {
    if (ctrlCode(event, ['/'])) { window.comment() }
  })
  window.stop = () => {
    system.resume()
    players.instances = {}
    consoleOut('\n> Stop all players')
  }
  window.go = () => {
    let selStart = codeTextArea.selectionStart
    let selEnd = codeTextArea.selectionEnd
    let selDir = codeTextArea.selectionDirection
    codeTextArea.focus()
    codeTextArea.setSelectionRange(0, 1e10)
    system.resume()
    players.instances = {}
    mainVars.reset()
    players.overrides = {}
    codeTextArea.value.split('\n')
    .map((l,i) => {return{line:l.trim(), num:i}})
    .map(({line,num}) => {return{line:line.replace(/\/\/.*/, ''),num:num}})
    .filter(({line}) => line != '')
    .map(({line,num}) => {
      try {
        parseLine(line)
        consoleOut('>'+line)
      } catch (e) {
        let st = e.stack ? '\n'+e.stack.split('\n')[0] : ''
        consoleOut('Error on line '+(num+1)+': ' + e + st)
      }
    })
    setTimeout(() => codeTextArea.setSelectionRange(selStart, selEnd, selDir), 100)
  }
  window.comment = () => {
    let selStart = codeTextArea.selectionStart
    let selEnd = codeTextArea.selectionEnd
    let selDir = codeTextArea.selectionDirection
    let code = codeTextArea.value
    let lineStart = codeTextArea.value.lastIndexOf('\n', selStart - 1) + 1
    if (code.slice(lineStart, lineStart+2) == '//') {
      codeTextArea.value = code.slice(0, lineStart) + code.slice(lineStart + 2)
      codeTextArea.focus()
      codeTextArea.setSelectionRange(selStart - 2, selEnd - 2, selDir)
    } else {
      codeTextArea.value = code.slice(0, lineStart) + "//" + code.slice(lineStart)
      codeTextArea.focus()
      codeTextArea.setSelectionRange(selStart + 2, selEnd + 2, selDir)
    }
  }

})