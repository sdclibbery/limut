'use strict'
define(function(require) {
  try { if (!AudioContext) { throw 1; } } catch(e) { document.body.innerHTML = 'Web Audio not supported in this browser!'; return; }

  require('polyfills')
  require('predefined-vars')
  let system = require('play/system')
  let drawSystem = require('draw/system')
  let metronome = require('metronome')
  let scale = require('music/scale')
  let parseLine = require('parse-line')
  let players = require('player/players')
  let vars = require('vars')
  let consoleOut = require('console')

  // accordions
  window.toggleAccordion = (id) => {
    document.getElementById(id).classList.toggle('closed')
  }

  // fullscreen
  window.fullscreen = () => {
    if (!document.fullscreenElement) {
      consoleOut('> Fullscreen')
      document.body.requestFullscreen();
    } else {
      if (document.exitFullscreen) {
        consoleOut('> Exit fullscreen')
        document.exitFullscreen(); 
      }
    }
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

  // Play/stop/comment ui
  let editorDiv = document.getElementById('code')
  let editor = CodeMirror(editorDiv, {
    lineNumbers: true,
    lineWrapping: true,
    tabSize: 2,
    inputStyle: "textarea",
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
  let beatLatencyReadout = document.getElementById('beat-latency-readout')
  let audioReadout = document.getElementById('audio-readout')
  let visualReadout = document.getElementById('visual-readout')
  let beatReadout = document.getElementById('beat-readout')
  let beat12Readout = document.getElementById('beat12-readout')
  let beat16Readout = document.getElementById('beat16-readout')
  let beat32Readout = document.getElementById('beat32-readout')
  let lastBeat = 0 
  let beatLatency = 0
  let tick = (t) => {
    let now = system.timeNow()
    let beat = metronome.update(now)
    let beatTime = metronome.beatTime(now)
    let spectrum = system.spectrum()
    let pulse = spectrum[0]*spectrum[0] + spectrum[3]*spectrum[3]
    vars.pulse = pulse
    vars.time = beatTime
    if (beat) {
      beatReadout.innerText = beat.count
      beat12Readout.innerText = (beat.count%12 + 1) + '/12'
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
      beatLatency = ((now - lastBeat) / beat.duration) - 1
      lastBeat = now
    }
    if (ctxGl) {
      try {
        drawSystem.frameStart(now, beatTime, ctxGl, canvas.width, canvas.height, spectrum, pulse)
      } catch (e) {
        let st = e.stack ? '\n'+e.stack.split('\n')[0] : ''
        consoleOut('Run Error from drawing: ' + e + st)
      }
    }
    compressorReadout.style.backgroundColor = readoutColor(system.compressorReduction(), 0, 1)
    beatLatencyReadout.style.backgroundColor = readoutColor(beatLatency, 0, metronome.advance())
    audioReadout.style.backgroundColor = readoutColor(system.latency(), 0, 0.1)
    visualReadout.style.backgroundColor = readoutColor(drawSystem.latency(), 0.02, 0.1)
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
})
