'use strict'
define(function(require) {
  let addVarFunction = require('predefined-vars').addVarFunction

  let addNodeFunction = (k, v) => {
    v.dontEvalArgs = true
    v._thisVar = true // Do not evaluate node functions during expand-chords; should rename _thisVar really
    addVarFunction(k, v)
  }

  let combineParams = (args, e) => {
    let params = {}
    Object.assign(params, e, args)
    params.__event = e // For eval audio params to access the 'real' event
    return params
  }

  return {
    addNodeFunction: addNodeFunction,
    combineParams: combineParams
  }
})
