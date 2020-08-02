'use strict'
define((require) => {
  let standardPlayer = require('player/standard')

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
    swirl: makePlayerFactory(sprite('swirl', {r:0.9,g:0.9,b:0.9,a:1}, {r:0.1,g:0.1,b:0.3,a:1})),
    lines: makePlayerFactory(sprite('lines', {r:0.9,g:0.9,b:0.9,a:1}, {r:0,g:0,b:0,a:0})),
    blob: makePlayerFactory(sprite('blob', {r:0.8,g:0.8,b:0.8,a:1}, {r:0,g:0,b:0,a:0})),
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

  return playerTypes
})
