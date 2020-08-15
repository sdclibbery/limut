'use strict'
define(function(require) {
  try { if (!AudioContext) { throw 1; } } catch(e) { document.body.innerHTML = 'Web Audio not supported in this browser!'; return; }

  require('predefined-vars')
  let CodeJar = require('editor/codejar')
  let withLineNumbers = require('editor/linenumbers')
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
  let highlight = (editor) => editor.innerHTML=editor.textContent
  let codejarEditor = CodeJar(editor, withLineNumbers(highlight))

  // Play/stop/comment ui
  let ctrlCode = (event, keys) => {
    if (event.isComposing || event.keyCode === 229) { return false }
    return (event.ctrlKey && (keys.includes(event.keyCode) || keys.includes(event.key)))
  }
  document.addEventListener("keydown", event => {
    if (ctrlCode(event, ['.'])) { window.stop() }
  })
  editor.addEventListener("keydown", event => {
    if (ctrlCode(event, [10, 13])) { window.go() }
  })
  editor.addEventListener("keydown", event => {
    if (ctrlCode(event, ['/'])) { window.comment() }
  })
  window.stop = () => {
    system.resume()
    players.instances = {}
    consoleOut('\n> Stop all players')
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
  }
  window.comment = () => {
    let selStart = editor.selectionStart
    let selEnd = editor.selectionEnd
    let selDir = editor.selectionDirection
    let code = editor.value
    let lineStart = editor.value.lastIndexOf('\n', selStart - 1) + 1
    if (code.slice(lineStart, lineStart+3) == '// ') {
      editor.value = code.slice(0, lineStart) + code.slice(lineStart + 3)
      editor.focus()
      editor.setSelectionRange(selStart - 3, selEnd - 3, selDir)
    } else {
      editor.value = code.slice(0, lineStart) + "// " + code.slice(lineStart)
      editor.focus()
      editor.setSelectionRange(selStart + 3, selEnd + 3, selDir)
    }
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
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
})
