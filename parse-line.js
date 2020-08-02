'use strict'
define((require) => {
  let players = require('player/players')
  let parseExpression = require('player/parse-expression')
  let standardPlayer = require('player/standard')
  let metronome = require('metronome')
  let vars = require('vars')

  let sprite = require('draw/sprite')
  let percussion = require('play/percussion')
  let play = require('play/play')
  let dsaw = require('play/dsaw')
  let dsine = require('play/dsine')
  let dbass = require('play/dbass')
  let ping = require('play/ping')
  let swell = require('play/swell')
  let bell = require('play/bell')
  let glock = require('play/glock')
  let piano = require('play/piano')
  let ethereal = require('play/ethereal')

  let nullPlayer = () => {}
  let makePlayerFactory = (play, defaultDur) => (command) => {
    let doPlay = (es) => es.filter(e => e.amp === undefined || e.amp > 0).map(e => play(e))
    return {
      play: doPlay,
      getEventsForBeat: standardPlayer(command, defaultDur),
    }
  }
  let playerTypes = {
    // stop
    none: nullPlayer,
    stop: nullPlayer,
    '!': nullPlayer,
    // visualisations
    clouds: makePlayerFactory(sprite('clouds', {r:1,g:1,b:1,a:1}, {r:0.15,g:0.2,b:1,a:1})),
    kal: makePlayerFactory(sprite('kaleidoscope', {r:1,g:0.7,b:0.3,a:1}, {r:0,g:0.05,b:0.2,a:1})),
    swirl: makePlayerFactory(sprite('swirl', {r:1,g:0.5,b:0,a:1}, {r:0,g:0.0,b:0.4,a:1})),
    lines: makePlayerFactory(sprite('lines', {r:1,g:0.5,b:0.0,a:1}, {r:0,g:0.0,b:0.4,a:1})),
    blob: makePlayerFactory(sprite('blob', {r:0,g:0.3,b:0.9,a:1}, {r:0,g:0,b:0,a:0})),
    // instruments
    drums: makePlayerFactory(percussion.play, 1/2),
    play: makePlayerFactory(play, 1/2),
    dsaw: makePlayerFactory(dsaw),
    dsine: makePlayerFactory(dsine),
    dbass: makePlayerFactory(dbass),
    ping: makePlayerFactory(ping),
    swell: makePlayerFactory(swell),
    bell: makePlayerFactory(bell),
    glock: makePlayerFactory(glock),
    piano: makePlayerFactory(piano),
    ethereal: makePlayerFactory(ethereal),
  }

  let mainVars = {
    bpm: (command) => metronome.bpm(eval(parseExpression(command))),
    scale: (command) => window.scaleChange(command.toLowerCase()),
    'main.amp': (command) => window.mainAmpChange(eval(parseExpression(command))),
    'main.reverb': (command) => window.mainReverbChange(eval(parseExpression(command))),
  }

  let parseLine = (line) => {
    line = line.trim()
    let [k,v] = line.split('=').map(p => p.trim()).filter(p => p != '')
    k = k.toLowerCase()
    if (k.match(/^[a-z][a-z0-9_\.]*$/)) {
      if (typeof mainVars[k] == 'function') {
        mainVars[k](v)
      } else {
        v = parseExpression(v)
        vars[k] = v
      }
      return
    }
    let parts = line.split(/(\s+)/).map(p => p.trim()).filter(p => p != '')
    let playerId = parts[0].trim().toLowerCase()
    if (playerId) {
      let playerName = parts[1].trim()
      if (!playerName) { throw 'Missing player name' }
      if (playerName) {
        let command  = parts.slice(2).join('').trim()
        if (!command) { throw 'Player "'+playerName+'" Missing params' }
        let player = playerTypes[playerName.toLowerCase()]
        if (!player) { throw 'Player "'+playerName+'" not found' }
        players.instances[playerId] = player(command)
      } else {
        delete players.instances[playerId]
      }
    }
  }

  return parseLine
})
