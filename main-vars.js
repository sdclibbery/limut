'use strict'
define((require) => {
  let metronome = require('metronome')

  let mainVars = {
    bpm: (v) => metronome.bpm(v),
    scale: (v) => window.scaleChange(v.toLowerCase()),
    'main.amp': (v) => window.mainAmpChange(v),
    'main.reverb': (v) => window.mainReverbChange(v),
  }

  return mainVars
})
