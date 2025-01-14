'use strict'
define(function(require) {
    let addVarFunction = require('predefined-vars').addVarFunction

  let logFunc = (args, context) => {
    console.log(args)
    return args.value
  }
  addVarFunction('log', logFunc)
})