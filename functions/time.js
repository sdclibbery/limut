'use strict'
define(function(require) {
  let addVarFunction = require('predefined-vars').addVarFunction

  let timeFunc = (args,e,b) => {
    return b // Global time function
  }
  timeFunc.interval = 'frame'
  addVarFunction('time', timeFunc)

  // TESTS // - Tests for time function are in player

})
  