'use strict'
define(function(require) {
  require('polyfills')
  require('play/nodes/nodes')
  require('functions/time')
  require('functions/rand')
  require('functions/aggregators')
  require('functions/maths')
  require('functions/sliders')
  require('functions/midi-knob')
  require('functions/debug')
  require('predefined-var-defs')
  let mainVars = require('main-vars')
  let system = require('play/system')
  let drawSystem = require('draw/system')
  let metronome = require('metronome')
  let players = require('player/players')
  let consoleOut = require('console')
  require('editor-textarea')
  require('editor-codemirror')
  let {parseCode} = require('update-code')
  let {clearCallTree} = require('player/callstack')

  // Load presets
  let loadPresetCollection = (name) => {
    fetch(`preset/${name}.limut`)
    .then(response => response.text())
    .then((data) => {
      console.log(`Loaded ${name} presets`)
      parseCode(data)
    })
  }
  loadPresetCollection('percussion')
  loadPresetCollection('synth')

  // accordions
  window.toggleAccordion = (id) => {
    document.getElementById(id).classList.toggle('closed')
    document.getElementById(id).previousElementSibling.classList.toggle('opened')
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

  // indicator helpers
  let to255 = (x) => Math.min(Math.max(Math.floor(x*256), 0), 255)
  let to100 = (x) => Math.min(Math.max(Math.floor(x*100), 0), 100)
  let scaled = (x, lo, hi) => (Math.max(x,lo)-lo)/(hi-lo)
  let readoutColor = (x, lo, hi) => {
    let c = scaled(x, lo, hi)
    if (c > 1) {
      return `rgb(255,0,${to255(Math.cos((c-1)*1.57))})`
    }
    return `rgb(${to255(Math.sin(c*1.57))},${to255(Math.cos(c*1.57))},0)`
  }
  let vuMeterStyle = (style, x, lo, hi) => {
    let c = scaled(x, lo, hi)
    if (c > 1) {
      style.background = `rgb(255,0,${to255(Math.cos((c-1)*1.57))})`
    } else {
      style.background = `linear-gradient(to right, #0f0, #ff0 3em, #f00 4em)`
    }
    style.width = `${to100(c)}%`
  }

  // fullscreen
  window.fullscreen = () => {
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      consoleOut('> Fullscreen')
      let rfs = document.body.requestFullscreen || document.body.webkitRequestFullscreen
      rfs.call(document.body);
    } else {
      consoleOut('> Exit fullscreen')
      let efs = document.exitFullscreen || document.webkitExitFullscreen
      efs.call(document);
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
  let ctxGl = canvas.getContext("webgl2", { alpha: false })
  if (!ctxGl) {
    console.error('WebGL2 not supported!')
    alert('WebGL2 not supported in this browser; Limut cannot run. Try running in Chrome or Firefox.')
  }

  // Update
  let vuMeterL = document.getElementById('vu-meter-l')
  let vuMeterR = document.getElementById('vu-meter-r')
  let limiterReadout = document.getElementById('compressor-readout')
  let beatLatencyReadout = document.getElementById('beat-latency-readout')
  let visualReadout = document.getElementById('visual-readout')
  let beatReadout = document.getElementById('beat-readout')
  let beatReadouts = [document.getElementById('beat1-readout'),document.getElementById('beat2-readout'),document.getElementById('beat3-readout')]
  let lastBeatTime = 0 
  let beatLatency = 0
  let lastVisualsActive
  let tickCount = 0
  let tick = (t) => {
    clearCallTree()
    let now = system.timeNow()
    let beat = metronome.update(now)
    let beatTime = metronome.beatTime(now)
    let spectrum = system.spectrum()
    let pulse = spectrum[0]*spectrum[0] + spectrum[3]*spectrum[3]
    if (beat) {
      mainVars.update(Math.floor(beatTime), beatTime)
      beatReadout.innerText = `${beat.count}`.padStart(4, ' ')
      let bc = metronome.getBeatReadouts()
      if (typeof bc === 'number') { bc = [bc] }
      beatReadouts.forEach((r,i) => {
        let c = bc[i]
        r.style.display = !c ? 'none' : 'inline'
        r.innerText = ((beat.count%c + 1) + '/' + c).padStart(5, ' ')
      })
      Object.values(players.instances).forEach(player => {
        if (player !== undefined) {
          try {
            player.play(player.getEventsForBeat(beat))
          } catch (e) {
            consoleOut('🔴 Run Error from player '+player.id+': ' + e)
            console.log(e)
            clearCallTree()
          }
        }
      })
      let timeNow = (new Date()).getTime() / 1000
      beatLatency = ((timeNow - lastBeatTime) / beat.duration) - 1
      lastBeatTime = timeNow
      if (beatLatency > 0.03 && beat.count > 2) {
        console.log(`slow beatLatency ${beatLatency} at ${beat.count}`)
      }
    }
    try {
      system.frame(now, beatTime)
    } catch (e) {
      let st = e.stack ? '\n'+e.stack.split('\n')[0] : ''
      consoleOut('🔴 Run Error from audio updating: ' + e + st)
      console.log(e)
      clearCallTree()
    }
    tickCount++
    if (ctxGl) {
      try {
        let visualsActive = drawSystem.frameStart(now, beatTime, ctxGl, canvas.width, canvas.height, spectrum, pulse)
        if (visualsActive !== lastVisualsActive) {
          canvas.style.display = visualsActive ? 'block' : 'none'
        }
        lastVisualsActive = visualsActive
      } catch (e) {
        let st = e.stack ? '\n'+e.stack.split('\n')[0] : ''
        consoleOut('🔴 Run Error from drawing: ' + e + st)
        console.log(e)
        clearCallTree()
      }
    }
    vuMeterStyle(vuMeterL.style, system.meter('L'), -30, 0)
    vuMeterStyle(vuMeterR.style, system.meter('R'), -30, 0)
    limiterReadout.style.backgroundColor = readoutColor(-system.limiterReduction(), 0, 10)
    if (!!beat || tickCount % 20 == 0) {
      beatLatencyReadout.style.backgroundColor = readoutColor(beatLatency, 0, 0.05)
      visualReadout.style.backgroundColor = readoutColor(drawSystem.latency(), 0.02, 0.1)
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
  mainVars.reset()
})
