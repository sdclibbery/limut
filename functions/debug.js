'use strict'
define(function(require) {
    let addVarFunction = require('predefined-vars').addVarFunction

    let log = (args, context) => {
      console.log(args)
      return args.value
    }
    addVarFunction('log', log)
  
    let throwFunc = (args, context) => {
      throw `Debug throw! ${JSON.stringify(args)}`
    }
    addVarFunction('throw', throwFunc)
  
})