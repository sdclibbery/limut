'use strict';
define(function (require) {
  let {setChannel} = require('dmx')
  let {evalParamEvent} = require('player/eval-param')

  return (params) => {
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
