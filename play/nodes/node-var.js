'use strict'
define(function(require) {
  let addVarFunction = require('predefined-vars').addVarFunction

  let addNodeFunction = (k, v) => {
    v.dontEvalArgs = true
    v._chordPlaceholder = true // Don't evaluate node functions during chord expansion; hold a placeholder slot instead
    addVarFunction(k, v)
  }

  let combineParams = (args, e) => {
    let params = {}
    Object.assign(params, e, args)
    params.value = args.value // Do not take "value" from the event, it will be set to the pattern value which we won't want
    params.__event = e // For eval audio params to access the 'real' event
    return params
  }

  return {
    addNodeFunction: addNodeFunction,
    combineParams: combineParams
  }
})
