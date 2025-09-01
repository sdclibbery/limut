'use strict';
define(function (require) {
  let {setChannel} = require('dmx')

  return (params) => {
    // setChannel(1, 1, params)
    // setChannel(2, 1/2, params)
    setChannel(1, params.foo, params)
  }
})
