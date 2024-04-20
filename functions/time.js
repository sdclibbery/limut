'use strict'
define(function(require) {
  let addVarFunction = require('predefined-vars').addVarFunction
  let {mainParam} = require('player/sub-param')

  let timeFunc = (args,e,b) => {
    if (typeof mainParam(args) === 'string' && mainParam(args).toLowerCase() === 'this') { // Per event time
        return b - e.count
    }
    return b // Global time function
  }
  addVarFunction('time', timeFunc)

  // TESTS // - Tests for time function are in player

})
  