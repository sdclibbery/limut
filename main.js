'use strict';
define(function(require) {
  try { if (!AudioContext) { throw 1; } } catch(e) { document.body.innerHTML = 'Web Audio not supported in this browser!'; return; }

  let system = require('play/system');
  let metronome = require('metronome');
  let scale = require('music/scale');
  let standardPlayer = require('player/standard')
  let parseExpression = require('player/parse-expression')
  let vars = require('vars')
  let percussion = require('play/percussion')
  let play = require('play/play')
  let dsaw = require('play/dsaw')
  let dbass = require('play/dbass')
  let ping = require('play/ping')
  let swell = require('play/swell')

  // Players
  let nullPlayer = () => {}
  let players = {
    // stop
    none: nullPlayer,
    stop: nullPlayer,
    '!': nullPlayer,
    // instruments
    drums: standardPlayer(percussion.play),
    play: standardPlayer(play),
    dsaw: standardPlayer(dsaw),
    dbass: standardPlayer(dbass),
    ping: standardPlayer(ping),
    swell: standardPlayer(swell),
  };
  let playerInstances = {}

  let mainVars = {
    bpm: (command) => metronome.bpm(eval(parseExpression(command))),
    scale: (command) => window.scaleChange(command.toLowerCase()),
    mainamp: (command) => window.mainAmpChange(eval(parseExpression(command))),
    mainreverb: (command) => window.mainReverbChange(eval(parseExpression(command))),
  }

  let parseLine = (line) => {
    line = line.trim()
    if (line.toLowerCase().startsWith('vars.')) {
      let [k,v] = line.split('=').map(p => p.trim()).filter(p => p != '')
      k = k.toLowerCase().replace('vars.', '')
      if (typeof mainVars[k] == 'function') {
        mainVars[k](v)
      } else {
        v = parseExpression(v)
        vars[k] = v
      }
      return
    }
    let parts = line.split(/(\s+)/).map(p => p.trim()).filter(p => p != '')
    let playerId = parts[0].trim()
    if (playerId) {
      let playerName = parts[1].trim()
      if (playerName) {
        let command  = parts.slice(2).join('').trim()
        playerInstances[playerId] = players[playerName.toLowerCase()](command)
      } else {
        delete playerInstances[playerId]
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
  });
  window.stop = () => {
    system.resume()
    playerInstances = {};
  }
  window.go = () => {
    system.resume()
    playerInstances = {}
    codeTextArea.value.split('\n')
    .map(l => l.trim())
    .map(line => line.replace(/\/\/.*/, ''))
    .filter(l => l != '')
    .map(parseLine)
  }

  // Update
  let beatReadout = document.getElementById('beat-readout')
  let tick = function () {
    let beat = metronome.update(system.timeNow());
    if (beat) {
      beatReadout.innerText = beat.count
      for (let player of Object.values(playerInstances)) {
        if (typeof player === 'function') { player(beat) }
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
