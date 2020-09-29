'use strict'
define((require) => {
  let metronome = require('metronome')
  let evalParam = require('player/eval-param').evalParamFrame
  let system = require('play/system')

  let mainVars = {
    bpm: { setter: (v) => metronome.bpm(v), default:110 },
    scale: { setter: (v) => window.scaleChange(v.toLowerCase()), default:'major' },
    'main.amp': { setter: (v) => system.mainAmp(v), default:1 },
    'main.reverb': { setter: (v) => window.mainReverbChange(v), default:1 },
  }

  let reset = () => {
    for (let k in mainVars) {
      mainVars[k].setter(mainVars[k].default)
    }
  }

  let exists = (name) => {
    return mainVars[name] !== undefined
  }

  let set = (name, value) => {
    if (typeof value == "number") {
      mainVars[name].setter(value)
      delete mainVars[name].value
    } else {
      mainVars[name].value = value
    }
  }

  let update = (step, beat) => {
    for (let k in mainVars) {
      let v = mainVars[k]
      if (v.value) {
        mainVars[k].setter(evalParam(v.value, step, beat))
      }
    }
  }

  return {
    exists: exists,
    set: set,
    update: update,
    reset: reset,
  }
})
