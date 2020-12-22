'use strict'
define(function(require) {
  require('polyfills')
  require('predefined-vars')
  let system = require('play/system')
  let drawSystem = require('draw/system')
  let metronome = require('metronome')
  let scale = require('music/scale')
  let players = require('player/players')
  let mainVars = require('main-vars')
  let vars = require('vars')
  let consoleOut = require('console')
  require('editor-textarea')
  require('editor-codemirror')

  // accordions
  window.toggleAccordion = (id) => {
    document.getElementById(id).classList.toggle('closed')
  }

  // Main amp UI
  let mainAmpInput = document.getElementById('main-amp-slider')
  window.mainAmpChange = (amp) => {
    let newAmp = system.mainAmpUi(amp)
    window.mainAmpChanged(newAmp)
    canvas.style.opacity = Math.min(Math.max(newAmp, 0), 1)
  }
  window.mainAmpChanged = () => {
    mainAmpInput.value = system.mainAmpUi()*100
  }
  window.mainAmpChanged()

  // Main reverb UI
  window.mainReverbChange = (reverb) => {
    window.mainReverbChanged(system.mainReverb(reverb))
  }
  window.mainReverbChanged = (mainReverb) => {}
  window.mainReverbChanged(system.mainReverb())

  // Scale ui
  window.scaleChange = function (s) {
    window.scaleChanged(scale.set(s))
  }
  window.scaleChanged = function (s) {}
  window.scaleChanged(scale.current)

  // indicator helpers
  let to255 = (x) => Math.min(Math.max(Math.floor(x*256), 0), 255)
  let readoutColor = (x, lo, hi) => {
    let c = Math.max((Math.abs(x)-lo)/(hi-lo), 0)
    if (c > 1) {
      c = c-1
      return `rgb(255,0,${to255(Math.cos(c*1.57))})`
    }
    return `rgb(${to255(Math.sin(c*1.57))},${to255(Math.cos(c*1.57))},0)`
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

  // webgl canvas
  var canvas = document.getElementById("canvas")
  let onResize = () => {
    canvas.width = window.innerWidth
    canvas.height = window.innerHeight
  }
  window.addEventListener('resize', onResize, false)
  onResize()
  let ctxGl = canvas.getContext("webgl2")
  if (!ctxGl) { console.error('WebGL2 not supported!') }

  // Update
  let compressorReadout = document.getElementById('compressor-readout')
  let beatLatencyReadout = document.getElementById('beat-latency-readout')
  let visualReadout = document.getElementById('visual-readout')
  let beatReadout = document.getElementById('beat-readout')
  let beat12Readout = document.getElementById('beat12-readout')
  let beat16Readout = document.getElementById('beat16-readout')
  let beat32Readout = document.getElementById('beat32-readout')
  let lastBeatTime = 0 
  let beatLatency = 0
  let lastVisualsActive
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
      mainVars.update(Math.floor(beatTime), beatTime)
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
      let timeNow = (new Date()).getTime() / 1000
      beatLatency = ((timeNow - lastBeatTime) / beat.duration) - 1
      lastBeatTime = timeNow
    }
    try {
      system.frame(now, beatTime)
    } catch (e) {
      let st = e.stack ? '\n'+e.stack.split('\n')[0] : ''
      consoleOut('Run Error from audio updating: ' + e + st)
    }
    if (ctxGl) {
      try {
        let visualsActive = drawSystem.frameStart(now, beatTime, ctxGl, canvas.width, canvas.height, spectrum, pulse)
        if (visualsActive !== lastVisualsActive) {
console.log(visualsActive, lastVisualsActive)
          canvas.style.display = visualsActive ? 'block' : 'none'
        }
        lastVisualsActive = visualsActive
      } catch (e) {
        let st = e.stack ? '\n'+e.stack.split('\n')[0] : ''
        consoleOut('Run Error from drawing: ' + e + st)
      }
    }
    compressorReadout.style.backgroundColor = readoutColor(system.compressorReduction(), 0, -0.1)
    beatLatencyReadout.style.backgroundColor = readoutColor(beatLatency, 0, 0.05)
    visualReadout.style.backgroundColor = readoutColor(drawSystem.latency(), 0.02, 0.1)
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
  mainVars.reset()
})
