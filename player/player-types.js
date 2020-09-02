'use strict'
define((require) => {
  let standardPlayer = require('player/standard')

  let sprite = require('draw/sprite')
  let shadertoy = require('draw/shadertoy')
  let image = require('draw/image')
  let play = require('play/synth/play')
  let sample = require('play/synth/sample')
  let dsaw = require('play/synth/dsaw')
  let dsine = require('play/synth/dsine')
  let dbass = require('play/synth/dbass')
  let ping = require('play/synth/ping')
  let swell = require('play/synth/swell')
  let bell = require('play/synth/bell')
  let glock = require('play/synth/glock')
  let piano = require('play/synth/piano')
  let ethereal = require('play/synth/ethereal')
  let noise = require('play/synth/noise')

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
    clouds: makePlayerFactory(sprite('clouds', {r:1,g:1,b:1,a:1}, {r:1,g:1,b:1,a:1})),
    kal: makePlayerFactory(sprite('kaleidoscope', {r:1,g:1,b:1,a:1}, {r:1,g:1,b:1,a:1})),
    swirl: makePlayerFactory(sprite('swirl', {r:1,g:1,b:1,a:1}, {r:1,g:1,b:1,a:1})),
    lines: makePlayerFactory(sprite('lines', {r:0.2,g:0.25,b:0.9,a:1}, {r:0,g:0,b:0,a:1})),
    blob: makePlayerFactory(sprite('blob', {r:0.8,g:0.8,b:0.8,a:1}, {r:0,g:0,b:0,a:0})),
    meter: makePlayerFactory(sprite('meter', {r:0.9,g:0.0,b:0.9,a:1}, {r:0.1,g:0.1,b:0.1,a:1})),
    streetlight: makePlayerFactory(sprite('streetlight', {r:1,g:1,b:1,a:1}, {r:0.0,g:0.0,b:0.0,a:1})),
    grid: makePlayerFactory(sprite('grid', {r:1.0,g:0.2,b:0.1,a:1}, {r:0.0,g:0.0,b:0.0,a:1})),
    shadertoy: makePlayerFactory(sprite(shadertoy, {r:1,g:1,b:1,a:1}, {r:1,g:1,b:1,a:1},)),
    image: makePlayerFactory(sprite(image, {r:1,g:1,b:1,a:1}, {r:1,g:1,b:1,a:0},)),
    // instruments
    drums: makePlayerFactory(play, 1/2),
    play: makePlayerFactory(play, 1/2),
    sample: makePlayerFactory(sample),
    dsaw: makePlayerFactory(dsaw),
    dsine: makePlayerFactory(dsine),
    dbass: makePlayerFactory(dbass),
    ping: makePlayerFactory(ping),
    swell: makePlayerFactory(swell),
    bell: makePlayerFactory(bell),
    glock: makePlayerFactory(glock),
    piano: makePlayerFactory(piano),
    ethereal: makePlayerFactory(ethereal),
    noise: makePlayerFactory(noise),
  }

  return playerTypes
})
