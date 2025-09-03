'use strict';
define(function (require) {
  let {setChannel} = require('dmx')
  let {evalParamEvent} = require('player/eval-param')
  let {mainParamUnits} = require('player/sub-param')

  let evalMainParamEvent = (params, p, def, units) => {
    let v = params[p]
    if (v === undefined) { return def }
    v = evalParamEvent(v, params)
    if (v === undefined) { return def }
    return mainParamUnits(v, units, def)
  }

  return (params) => {
    let dur = evalMainParamEvent(params, 'dur', 1, 'b')
    let sus = evalMainParamEvent(params, 'sus', dur, 'b')
    params.endTime = params._time + sus * params.beat.duration
    let baseChannel = evalParamEvent(params.base, params) || 1 // Base channel offset (which must also be 1-based)
    for (let p in params) {
      if (p.startsWith('c')) {
        let channel = parseInt(p.substring(1))
        if (!isNaN(channel)) {
          channel += baseChannel - 1 // Base channel is 1-based
          setChannel(channel, params[p], params)
        }
      }
    }
  }
})
