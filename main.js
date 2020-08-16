'use strict'
define(function(require) {
  try { if (!AudioContext) { throw 1; } } catch(e) { document.body.innerHTML = 'Web Audio not supported in this browser!'; return; }

  require('predefined-vars')
  let CodeJar = require('editor/codejar')
  let withLineNumbers = require('editor/linenumbers')
  let cursor = require('editor/cursor')
  let system = require('play/system')
  let drawSystem = require('draw/system')
  let metronome = require('metronome')
  let scale = require('music/scale')
  let parseLine = require('parse-line')
  let players = require('player/players')

  // accordions
  window.toggleAccordion = (id) => {
    document.getElementById(id).classList.toggle('closed')
  }

  // Bpm ui
  let bpmReadout = document.getElementById('bpm-readout')
  window.bpmChanged = function (bpm) {
    bpmReadout.innerText = bpm.toFixed(1)
  }
  window.bpmChanged(metronome.bpm())

  // Main amp UI
  let mainAmpReadout = document.getElementById('main-amp-readout')
  let mainAmpInput = document.getElementById('main-amp-slider')
  window.mainAmpChange = (amp) => {
    window.mainAmpChanged(system.mainAmp(amp))
  }
  window.mainAmpChanged = (mainAmp) => {
    mainAmpReadout.innerText = mainAmp.toFixed(2)
    mainAmpInput.value = mainAmp*100
  }
  window.mainAmpChanged(system.mainAmp())

  // Main reverb UI
  let mainReverbReadout = document.getElementById('main-reverb-readout')
  window.mainReverbChange = (reverb) => {
    window.mainReverbChanged(system.mainReverb(reverb))
  }
  window.mainReverbChanged = (mainReverb) => {
    mainReverbReadout.innerText = mainReverb.toFixed(2)
  }
  window.mainReverbChanged(system.mainReverb())

  // Scale ui
  let scaleReadout = document.getElementById('scale-readout')
  window.scaleChange = function (s) {
    window.scaleChanged(scale.set(s))
  }
  window.scaleChanged = function (s) {
    scaleReadout.innerText = s
  }
  window.scaleChanged(scale.current)

  // console ui
  let cons = document.getElementById('console')
  let consoleOut = (str) => {
    cons.value += '\n'+str
    cons.scrollTop = cons.scrollHeight
  }
  consoleOut('\n> Welcome to Limut')

  // CodeJar editor
  let editor = document.querySelector('.editor')
  let highlightLine = (l) => {
    let cs = l.split('//')
    let comment = cs.slice(1).join('//')
    if (comment.length) { comment = '<span class="hl-comment">//'+comment+'</span>' }
    let line = cs[0]
      .replace(/(\w+)(\s*=\s*)([^\s]+)/g, '<span class="hl-param">$1</span>$2<span class="hl-expression">$3</span>')
      .replace(/(\s*)(\w+)(\s+)(\w+)(\s+)([^,]+)/g, '$1<span class="hl-playerid">$2</span>$3<span class="hl-playertype">$4</span>$5<span class="hl-pattern">$6</span>')
      return '<span class="hl">'+line + comment+'</span>'
  }
  let highlight = (editor) => {
    let formatted = editor.textContent
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;")
      .split('\n')
      .map(l => highlightLine(l))
      .join('\n')
    editor.innerHTML = formatted
  }
  let codejarEditor = CodeJar(editor, highlight)//withLineNumbers(highlight))
  codejarEditor.updateCode(localStorage.getItem("limut-code"))
  codejarEditor.onUpdate(code => {
    localStorage.setItem("limut-code", code)
  })

  // Play/stop/comment ui
  let ctrlCode = (event, keys) => {
    if (event.isComposing || event.keyCode === 229) { return false }
    return (event.ctrlKey && (keys.includes(event.keyCode) || keys.includes(event.key)))
  }
  document.addEventListener("keydown", event => {
    if (ctrlCode(event, ['.'])) { window.stop() }
  })
  editor.addEventListener("keydown", event => {
    if (ctrlCode(event, [10, 13])) {
      event.preventDefault()
      window.go()
    }
  })
  editor.addEventListener("keydown", event => {
    if (ctrlCode(event, ['/'])) { window.comment() }
  })
  window.stop = () => {
    system.resume()
    players.instances = {}
    consoleOut('\n> Stop all players')
  }
  const stylesheet = document.styleSheets[0]
  let hlClass
  for(let i = 0; i < stylesheet.cssRules.length; i++) {
    if(stylesheet.cssRules[i].selectorText === '.hl') {
      hlClass = stylesheet.cssRules[i]
    }
  }
  window.go = () => {
    system.resume()
    players.instances = {}
    codejarEditor.toString().split('\n')
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
    hlClass.style.backgroundColor = '#4060d0ff'
    setTimeout(() => hlClass.style.background = '#00000040', 100)
  }
  window.comment = () => {
     codejarEditor.toggleComment()
  }

  // indicator helpers
  let to255 = (x) => Math.min(Math.max(Math.floor(x*256), 0), 255)
  let readoutColor = (x, lo, hi) => {
    let c = (Math.abs(x)-lo)/(hi-lo)
    return `rgb(${to255(Math.sin(c*1.57))},${to255(Math.cos(c*1.57))},0)`
  }

  // webgl canvas
  var canvas = document.getElementById("canvas")
  let onResize = () => {
    canvas.width = window.innerWidth
    canvas.height = window.innerHeight
  }
  window.addEventListener('resize', onResize, false)
  onResize()
  let ctxGl = canvas.getContext("webgl")
  if (!ctxGl) { ctxGl = canvas.getContext("experimental-webgl") }
  if (!ctxGl) { console.error('WebGL not supported!') }

  // Update
  let compressorReadout = document.getElementById('compressor-readout')
  let eventsReadout = document.getElementById('events-readout')
  let audioReadout = document.getElementById('audio-readout')
  let visualReadout = document.getElementById('visual-readout')
  let beatReadout = document.getElementById('beat-readout')
  let beat4Readout = document.getElementById('beat4-readout')
  let beat16Readout = document.getElementById('beat16-readout')
  let beat32Readout = document.getElementById('beat32-readout')
  let caret = document.querySelector('.caret')
  let eventLatency = 0
  let tick = (t) => {
    let now = system.timeNow()
    let beat = metronome.update(now)
    if (beat) {
      beatReadout.innerText = beat.count
      beat4Readout.innerText = (beat.count%4 + 1) + '/4'
      beat16Readout.innerText = (beat.count%16 + 1) + '/16'
      beat32Readout.innerText = (beat.count%32 + 1) + '/32'
      for (let playerName of Object.keys(players.instances)) {
        let player = players.instances[playerName]
        if (player !== undefined) {
          try {
            player.play(player.getEventsForBeat(beat))
          } catch (e) {
            let st = e.stack ? '\n'+e.stack.split('\n')[0] : ''
            consoleOut('Run Error from player '+playerName+': ' + e + st)
          }
        }
      }
      eventLatency = system.timeNow() - now
    }
    if (ctxGl) {
      try {
        drawSystem.frameStart(now, metronome.beatTime(now), ctxGl, canvas.width, canvas.height)
      } catch (e) {
        let st = e.stack ? '\n'+e.stack.split('\n')[0] : ''
        consoleOut('Run Error from drawing: ' + e + st)
      }
    }
    compressorReadout.style.backgroundColor = readoutColor(system.compressorReduction(), 0, 1)
    eventsReadout.style.backgroundColor = readoutColor(eventLatency, 0, metronome.advance())
    audioReadout.style.backgroundColor = readoutColor(system.latency(), 0, 0.1)
    visualReadout.style.backgroundColor = readoutColor(drawSystem.latency(), 0.02, 0.1)
    let caretPos = cursor.cursorPosition()
    caret.style.left = caretPos.left
    caret.style.top = caretPos.top
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
})
