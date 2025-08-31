'use strict';
define(function (require) {
  let {setChannel} = require('dmx')

  return (params) => {
    setChannel(0, 1)
    setChannel(3, 1/2)
  }
})
