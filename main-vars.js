'use strict'
define((require) => {
  let metronome = require('metronome')
  let {evalParamFrame} = require('player/eval-param')
  let system = require('play/system')
  let scale = require('music/scale')
  let {units} = require('units')

  let toBpm = (v) => {
    if (typeof v === 'object' && v._units !== undefined) {
      return units(v, 'hz') * 60
    }
    return v
  }

  let mainVars = {
    bpm: { setter: (v) => metronome.bpm(toBpm(v)), default:110 },
    scale: { setter: (v) => { if (typeof v === 'string') { scale.set(v.toLowerCase()) } }, default:'major' },
    root: { setter: (v) => { scale.setRoot(v) }, default:0 },
    'beat.readouts': { setter: (v) => metronome.setBeatReadouts(v), default:[16,32] },
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

  let get = (name) => {
    let v = mainVars[name].value
    if (v === undefined) { return mainVars[name].default }
    let beat = metronome.beatTime(system.timeNow())
    return evalParamFrame(v, {idx:beat,count:beat}, beat)
  }

  let set = (name, value) => {
    let beat = metronome.beatTime(system.timeNow())
    mainVars[name].value = value
    mainVars[name].setter(evalParamFrame(mainVars[name].value, {idx:beat,count:beat}, beat))
  }

  let update = (step, beat) => {
    for (let k in mainVars) {
      let value = mainVars[k].value
      if (value !== undefined) {
        let v = evalParamFrame(value, {idx:step,count:beat}, beat)
        mainVars[k].setter(v)
      }
    }
  }

  return {
    exists: exists,
    get: get,
    set: set,
    update: update,
    reset: reset,
  }
})
