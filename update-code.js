'use strict'
define((require) => {
  let parseLine = require('parse-line')
  let system = require('play/system')
  let players = require('player/players')
  let mainVars = require('main-vars')
  let consoleOut = require('console')

  let updateCode = (code) => {
    system.resume()
    players.instances = {}
    mainVars.reset()
    players.overrides = {}
    consoleOut('> Update code')
    code.split('\n')
    .map((l,i) => {return{line:l.trim(), num:i}})
    .filter(({line}) => line != '')
    .map(({line,num}) => {
      try {
        parseLine(line, num)
      } catch (e) {
        let st = e.stack ? '\n'+e.stack.split('\n')[0] : ''
        consoleOut('Error on line '+(num+1)+': ' + e + st)
      }
    })
  }

  return updateCode
})