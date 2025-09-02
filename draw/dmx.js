'use strict';
define(function (require) {
  let {setChannel} = require('dmx')

  return (params) => {
    for (let p in params) {
      if (p.startsWith('c')) {
        let channel = parseInt(p.substring(1))
        if (!isNaN(channel)) {
          setChannel(channel, params[p], params)
        }
      }
    }
  }
})
