'use strict'
define((require) => {
  let sprite = require('draw/sprite')
  let shadertoy = require('draw/shadertoy')
  let image = require('draw/image')
  let webcam = require('draw/webcam')
  let scope = require('draw/scope')
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
  let prophet = require('play/synth/prophet')
  let dsquare = require('play/synth/dsquare')
  let fmbass = require('play/synth/fmbass')
  let fm = require('play/synth/fm')
  let glass = require('play/synth/glass')

  let nullPlayer = { play: () => {}, stopped: true }
  let playerTypes = {
    // stop
    none: nullPlayer,
    stop: nullPlayer,
    '!': nullPlayer,
    // visualisations
    clouds: { play: sprite('clouds', {r:1,g:1,b:1,a:1}, {r:1,g:1,b:1,a:1}) },
    kal: { play: sprite('kaleidoscope', {r:1,g:1,b:1,a:1}, {r:1,g:1,b:1,a:1}) },
    swirl: { play: sprite('swirl', {r:1,g:1,b:1,a:1}, {r:1,g:1,b:1,a:1}) },
    lines: { play: sprite('lines', {r:0.2,g:0.25,b:0.9,a:1}, {r:0,g:0,b:0,a:1}) },
    blob: { play: sprite('blob', {r:0.8,g:0.8,b:0.8,a:1}, {r:0,g:0,b:0,a:0}) },
    meter: { play: sprite('meter', {r:0.9,g:0.0,b:0.9,a:1}, {r:0.1,g:0.1,b:0.1,a:1}) },
    streetlight: { play: sprite('streetlight', {r:1,g:1,b:1,a:1}, {r:0.0,g:0.0,b:0.0,a:1}) },
    grid: { play: sprite('grid', {r:1.0,g:0.2,b:0.1,a:1}, {r:0.0,g:0.0,b:0.0,a:0.0}) },
    glow: { play: sprite('glow', {r:1.0,g:0.8,b:0.6,a:1}, {r:0.5,g:0.4,b:0.3,a:0}, {additive:1,fade:1}) },
    stars: { play: sprite('stars', {r:1.0,g:0.8,b:0.6,a:1}, {r:0.3,g:0.2,b:0.1,a:0}, {additive:1,fade:1}) },
    bits: { play: sprite('bits', {r:1.0,g:1.0,b:1.0,a:1}, {r:0.1,g:0.1,b:0.1,a:1}) },
    gradient: { play: sprite('gradient', {r:1.0,g:1.0,b:1.0,a:1}, {r:0.1,g:0.1,b:0.1,a:1}) },
    shadertoy: { play: sprite(shadertoy, {r:1,g:1,b:1,a:1}, {r:1,g:1,b:1,a:1},) },
    image: { play: sprite(image, {r:1,g:1,b:1,a:1}, {r:1,g:1,b:1,a:0},) },
    webcam: { play: sprite(webcam, {r:1,g:1,b:1,a:1}, {r:1,g:1,b:1,a:0},) },
    scope: { play: sprite(scope, {r:1,g:1,b:1,a:1}, {r:1,g:1,b:1,a:0},) },
    lights: { play: sprite('lights', {r:1.0,g:1.0,b:1.0,a:1}, {r:0.5,g:0.4,b:0.3,a:0}, {additive:1}) },
    julia: { play: sprite('julia', {r:0.9,g:0.9,b:0.9,a:1}, {r:0.1,g:0.1,b:0.1,a:1}) },
    // instruments
    drums: { play: play, defaultDur: 1/2 },
    play: { play: play, defaultDur: 1/2 },
    sample: { play: sample },
    dsaw: { play: dsaw },
    dsine: { play: dsine },
    dbass: { play: dbass },
    ping: { play: ping },
    swell: { play: swell },
    bell: { play: bell },
    glock: { play: glock },
    piano: { play: piano },
    ethereal: { play: ethereal },
    noise: { play: noise },
    prophet: { play: prophet },
    dsquare: { play: dsquare },
    fmbass: { play: fmbass },
    fm: { play: fm },
    glass: { play: glass },
  }

  return playerTypes
})
