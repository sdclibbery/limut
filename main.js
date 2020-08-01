'use strict'
define(function(require) {
  try { if (!AudioContext) { throw 1; } } catch(e) { document.body.innerHTML = 'Web Audio not supported in this browser!'; return; }

  require('predefined-vars')
  let system = require('play/system')
  let drawSystem = require('draw/system')
  let metronome = require('metronome')
  let scale = require('music/scale')
  let parseExpression = require('player/parse-expression')
  let vars = require('vars')
  let players = require('player/players')
  let standardPlayer = require('player/standard')

  let sprite = require('draw/sprite')

  let percussion = require('play/percussion')
  let play = require('play/play')
  let dsaw = require('play/dsaw')
  let dsine = require('play/dsine')
  let dbass = require('play/dbass')
  let ping = require('play/ping')
  let swell = require('play/swell')
  let bell = require('play/bell')
  let glock = require('play/glock')
  let piano = require('play/piano')
  let ethereal = require('play/ethereal')

  let nullPlayer = () => {}
  let makePlayerFactory = (play, defaultDur) => (command) => {
    let doPlay = (es) => es.filter(e => e.amp === undefined || e.amp > 0).map(e => play(e))
    return {
      play: doPlay,
      getEventsForBeat: standardPlayer(command, defaultDur),
    }
  }
  let playerTypes = {
    // stop
    none: nullPlayer,
    stop: nullPlayer,
    '!': nullPlayer,
    // visualisations
    clouds: makePlayerFactory(sprite('clouds', {r:1,g:1,b:1,a:1}, {r:0.15,g:0.2,b:1,a:1})),
    kal: makePlayerFactory(sprite('kaleidoscope', {r:1,g:0.7,b:0.3,a:1}, {r:0,g:0.05,b:0.2,a:1})),
    swirl: makePlayerFactory(sprite('swirl', {r:1,g:0.5,b:0,a:1}, {r:0,g:0.0,b:0.4,a:1})),
    lines: makePlayerFactory(sprite('lines', {r:1,g:0.5,b:0.0,a:1}, {r:0,g:0.0,b:0.4,a:1})),
    blob: makePlayerFactory(sprite('blob', {r:0,g:0.3,b:0.9,a:1}, {r:0,g:0,b:0,a:0})),
    // instruments
    drums: makePlayerFactory(percussion.play, 1/2),
    play: makePlayerFactory(play, 1/2),
    dsaw: makePlayerFactory(dsaw),
    dsine: makePlayerFactory(dsine),
    dbass: makePlayerFactory(dbass),
    ping: makePlayerFactory(ping),
    swell: makePlayerFactory(swell),
    bell: makePlayerFactory(bell),
    glock: makePlayerFactory(glock),
    piano: makePlayerFactory(piano),
    ethereal: makePlayerFactory(ethereal),
  }

  let mainVars = {
    bpm: (command) => metronome.bpm(eval(parseExpression(command))),
    scale: (command) => window.scaleChange(command.toLowerCase()),
    'main.amp': (command) => window.mainAmpChange(eval(parseExpression(command))),
    'main.reverb': (command) => window.mainReverbChange(eval(parseExpression(command))),
  }

  let parseLine = (line) => {
    line = line.trim()
    let [k,v] = line.split('=').map(p => p.trim()).filter(p => p != '')
    k = k.toLowerCase()
    if (k.match(/^[a-z][a-z0-9_\.]*$/)) {
      if (typeof mainVars[k] == 'function') {
        mainVars[k](v)
      } else {
        v = parseExpression(v)
        vars[k] = v
      }
      return
    }
    let parts = line.split(/(\s+)/).map(p => p.trim()).filter(p => p != '')
    let playerId = parts[0].trim().toLowerCase()
    if (playerId) {
      let playerName = parts[1].trim()
      if (!playerName) { throw 'Missing player name' }
      if (playerName) {
        let command  = parts.slice(2).join('').trim()
        if (!command) { throw 'Player "'+playerName+'" Missing params' }
        let player = playerTypes[playerName.toLowerCase()]
        if (!player) { throw 'Player "'+playerName+'" not found' }
        players.instances[playerId] = player(command)
      } else {
        delete players.instances[playerId]
      }
    }
  }

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

  // Play/stop ui
  let codeTextArea = document.getElementById('code')
  document.addEventListener("keydown", event => {
    if (event.isComposing || event.keyCode === 229) { return; }
    if (event.key == '.' && event.ctrlKey) {
      window.stop()
    }
  })
  codeTextArea.addEventListener("keydown", event => {
    if (event.isComposing || event.keyCode === 229) { return; }
    if ((event.keyCode == 10 || event.keyCode == 13) && event.ctrlKey) {
      window.go()
    }
  })
  window.stop = () => {
    system.resume()
    players.instances = {}
  }
  window.go = () => {
    system.resume()
    players.instances = {}
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
  }

  let to255 = (x) => Math.min(Math.max(Math.floor(x*256), 0), 255)
  let compressorColor = (reduction) => {
    let c = Math.abs(reduction)/3
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
  let beatReadout = document.getElementById('beat-readout')
  let beat4Readout = document.getElementById('beat4-readout')
  let beat16Readout = document.getElementById('beat16-readout')
  let beat32Readout = document.getElementById('beat32-readout')
  let tick = (t) => {
    compressorReadout.style.backgroundColor = compressorColor(system.compressorReduction())
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
    }
    if (ctxGl) {
      try {
        drawSystem.frameStart(now, ctxGl, canvas.width, canvas.height)
      } catch (e) {
        let st = e.stack ? '\n'+e.stack.split('\n')[0] : ''
        consoleOut('Run Error from drawing: ' + e + st)
      }
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
})
