'use strict'
define(function(require) {
  let addVarFunction = require('predefined-vars').addVarFunction
  let {mainParam} = require('player/sub-param')

  let timeFunc = (args,e,b) => {
    if (typeof mainParam(args) === 'string' && mainParam(args).toLowerCase() === 'this') { // Per event time
        return {value: b - e.count, _finalResult:true} // This is the final result if used in lookup op; do not do a further lookup
    }
    return b // Global time function
  }
  timeFunc.interval = 'frame'
  addVarFunction('time', timeFunc)

  // TESTS // - Tests for time function are in player

})
  