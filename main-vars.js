'use strict'
define((require) => {
  let metronome = require('metronome')
  let {evalParamEvent, evalParamFrame} = require('player/eval-param')
  let system = require('play/system')

  let mainVars = {
    bpm: { setter: (v) => metronome.bpm(v), default:110 },
    scale: { setter: (v) => { if (typeof v === 'string') { window.scaleChange(v.toLowerCase()) } }, default:'major' },
    'main.amp': { setter: (v) => system.mainAmp(v), default:1 },
    'main.reverb': { setter: (v) => window.mainReverbChange(v), default:1 },
  }

  let reset = () => {
    for (let k in mainVars) {
      mainVars[k].value = undefined
      mainVars[k].setter(mainVars[k].default)
    }
  }

  let exists = (name) => {
    return mainVars[name] !== undefined
  }

  let set = (name, value) => {
    let beat = metronome.beatTime(system.timeNow())
    mainVars[name].value = value
    mainVars[name].setter(evalParamFrame(mainVars[name].value, {idx:beat,count:beat}, beat))
  }

  let update = (step, beat) => {
    for (let k in mainVars) {
      let value = mainVars[k].value
      if (value) {
        let v = evalParamFrame(value, {idx:step,count:beat}, beat)
        mainVars[k].setter(v)
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
