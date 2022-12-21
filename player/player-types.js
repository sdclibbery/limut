'use strict'
define((require) => {
  let sprite = require('draw/sprite').create
  let shadertoy = require('draw/shadertoy')
  let image = require('draw/image')
  let webcam = require('draw/webcam')
  let scope = require('draw/scope')
  let buffer = require('draw/buffer')
  let play = require('play/synth/play')
  let sample = require('play/synth/sample')
  let piano = require('play/synth/piano')
  let noise = require('play/synth/noise')
  let pwm = require('play/synth/pwm')
  let fm = require('play/synth/fm')
  let supersaw = require('play/synth/supersaw')
  let external = require('play/synth/external')
  let wave = require('play/synth/wave')
  let dwave = require('play/synth/dwave')
  let ambi = require('play/synth/ambi')
  let pitchedPercussion = require('play/synth/percussion/pitched')
  let impulse = require('play/synth/percussion/impulse')

  let nullPlayer = { play: () => {}, stopped: true }
  let playerTypes = {
    // stop
    none: nullPlayer,
    stop: nullPlayer,
    '!': nullPlayer,
    // visualisations
    scope: { play: sprite(scope, {r:1,g:1,b:1,a:1}, {r:1,g:1,b:1,a:0},) },
    meter: { play: sprite('meter', {r:0.9,g:0.0,b:0.9,a:1}, {r:0.1,g:0.1,b:0.1,a:1}) },
    readout: { play: sprite('readout', {r:0.9,g:0.9,b:0.9,a:1}, {r:0.1,g:0.1,b:0.1,a:1}, {additive:1}) },
    webcam: { play: sprite(webcam, {r:1,g:1,b:1,a:1}, {r:1,g:1,b:1,a:1},) },
    shadertoy: { play: sprite(shadertoy, {r:1,g:1,b:1,a:1}, {r:1,g:1,b:1,a:1},) },
    image: { play: sprite(image, {r:1,g:1,b:1,a:1}, {r:1,g:1,b:1,a:0},) },
    buffer: { play: sprite(buffer, {r:1,g:1,b:1,a:1}, {r:1,g:1,b:1,a:0},) },
    text: { play: sprite(image, {r:1,g:1,b:1,a:1}, {r:0,g:0,b:0,a:0},) },
    clouds: { play: sprite('clouds', {r:1,g:1,b:1,a:1}, {r:1,g:1,b:1,a:1}) },
    kal: { play: sprite('kaleidoscope', {r:1,g:1,b:1,a:1}, {r:1,g:1,b:1,a:1}) },
    swirl: { play: sprite('swirl', {r:1,g:1,b:1,a:1}, {r:1,g:1,b:1,a:1}) },
    lines: { play: sprite('lines', {r:0.2,g:0.25,b:0.9,a:1}, {r:0,g:0,b:0,a:1}) },
    blob: { play: sprite('blob', {r:0.8,g:0.8,b:0.8,a:1}, {r:0,g:0,b:0,a:0}) },
    streetlight: { play: sprite('streetlight', {r:1,g:1,b:1,a:1}, {r:0.0,g:0.0,b:0.0,a:1}) },
    grid: { play: sprite('grid', {r:1.0,g:0.2,b:0.1,a:1}, {r:0.0,g:0.0,b:0.0,a:0.0}) },
    glow: { play: sprite('glow', {r:1.0,g:0.8,b:0.6,a:1}, {r:0.5,g:0.4,b:0.3,a:0}, {additive:1,fade:1}) },
    stars: { play: sprite('stars', {r:1.0,g:0.8,b:0.6,a:1}, {r:0.3,g:0.2,b:0.1,a:0}, {additive:1,fade:1}) },
    bits: { play: sprite('bits', {r:1.0,g:1.0,b:1.0,a:1}, {r:0.1,g:0.1,b:0.1,a:1}) },
    xor: { play: sprite('xor', {r:1.0,g:1.0,b:1.0,a:1}, {r:0.1,g:0.1,b:0.1,a:1}, {additive:1}) },
    gradient: { play: sprite('gradient', {r:1.0,g:1.0,b:1.0,a:1}, {r:0.1,g:0.1,b:0.1,a:1}) },
    blank: { play: sprite('blank', {r:0.0,g:0.0,b:0.0,a:0}, {r:0.0,g:0.0,b:0.0,a:6/256}) },
    lights: { play: sprite('lights', {r:1.0,g:1.0,b:1.0,a:1}, {r:0.5,g:0.4,b:0.3,a:0}, {additive:1}) },
    julia: { play: sprite('julia', {r:0.9,g:0.9,b:0.9,a:1}, {r:0.1,g:0.1,b:0.1,a:1}) },
    bars: { play: sprite('bars', {r:1,g:1,b:1,a:1}, {r:0,g:0,b:0,a:1}, {additive:1}) },
    // instruments
    drums: { play: play, baseParams:{dur: 1/2} },
    play: { play: play, baseParams:{dur: 1/2} },
    pitchedperc: { play: pitchedPercussion, baseParams: {dur:1/2,sus:1/3}},
    impulse: { play: impulse },
    sample: { play: sample },
    external: { play: external },
    piano: { play: piano },
    noise: { play: noise },
    pwm: { play: pwm },
    wave: { play: wave },
    fm: { play: fm },

    dwave: { play: dwave },
    dsaw: { play: dwave, baseParams: {wave:'sawtooth', oct:4, envelope:'full', _gainbase:0.06} },
    dsine: { play: dwave, baseParams: {wave:'sine', oct:4, envelope:'pad', _gainbase:0.045} },
    dsquare: { play: dwave, baseParams: {wave:'square', oct:4, envelope:'full', _gainbase:0.054} },
    swell: { play: dwave, baseParams: {wave:'triangle', oct:4, envelope:'pad', _gainbase:0.06, detune:0.02} },
    dbass: { play: dwave, baseParams: {wave:'sawtooth', oct:2, envelope:'full', _gainbase:0.09} },
    dtri: { play: dwave, baseParams: {wave:'triangle', oct:4, envelope:'full', _gainbase:0.06} },
    dpulse: { play: dwave, baseParams: {wave:'pulse', oct:3, envelope:'full', _gainbase:0.06} },

    supersaw: { play: supersaw },

    ambi: { play: ambi },
  }

  return playerTypes
})
