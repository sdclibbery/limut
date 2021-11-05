'use strict'
define((require) => {
  let parseExpression = require('player/parse-expression')
  let sprite = require('draw/sprite')
  let shadertoy = require('draw/shadertoy')
  let image = require('draw/image')
  let webcam = require('draw/webcam')
  let scope = require('draw/scope')
  let play = require('play/synth/play')
  let sample = require('play/synth/sample')
  let bell = require('play/synth/bell')
  let glock = require('play/synth/glock')
  let piano = require('play/synth/piano')
  let ethereal = require('play/synth/ethereal')
  let noise = require('play/synth/noise')
  let prophet = require('play/synth/prophet')
  let fmbass = require('play/synth/fmbass')
  let fm = require('play/synth/fm')
  let glass = require('play/synth/glass')
  let supersaw = require('play/synth/supersaw')
  let external = require('play/synth/external')
  let xylo = require('play/synth/xylo')
  let wave = require('play/synth/wave')
  let dwave = require('play/synth/dwave')
  let ambi = require('play/synth/ambi')

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
    text: { play: sprite(image, {r:1,g:1,b:1,a:1}, {r:0,g:0,b:0,a:0},) },
    webcam: { play: sprite(webcam, {r:1,g:1,b:1,a:1}, {r:1,g:1,b:1,a:0},) },
    scope: { play: sprite(scope, {r:1,g:1,b:1,a:1}, {r:1,g:1,b:1,a:0},) },
    lights: { play: sprite('lights', {r:1.0,g:1.0,b:1.0,a:1}, {r:0.5,g:0.4,b:0.3,a:0}, {additive:1}) },
    julia: { play: sprite('julia', {r:0.9,g:0.9,b:0.9,a:1}, {r:0.1,g:0.1,b:0.1,a:1}) },
    bars: { play: sprite('bars', {r:1,g:1,b:1,a:1}, {r:0,g:0,b:0,a:1}, {additive:1}) },
    // instruments
    drums: { play: play, defaultDur: 1/2 },
    play: { play: play, defaultDur: 1/2 },
    sample: { play: sample },
    dwave: { play: dwave },
    dsaw: { play: dwave, baseParams: {wave:'sawtooth', oct:4, envelope:'full', _gainbase:0.06} },
    dsine: { play: dwave, baseParams: {wave:'sine', oct:4, envelope:'pad', _gainbase:0.045} },
    dsquare: { play: dwave, baseParams: {wave:'square', oct:4, envelope:'full', _gainbase:0.054} },
    swell: { play: dwave, baseParams: {wave:'triangle', oct:4, envelope:'pad', _gainbase:0.06, detune:0.02} },
    dbass: { play: dwave, baseParams: {wave:'sawtooth', oct:2, envelope:'full', _gainbase:0.09} },
    dtri: { play: dwave, baseParams: {wave:'triangle', oct:4, envelope:'full', _gainbase:0.06} },
    dpulse: { play: dwave, baseParams: {wave:'pulse', oct:3, envelope:'full', _gainbase:0.06} },
    wave: { play: wave },
    ping: { play: wave, baseParams: {wave:'sine', oct:5, envelope:'simple', _gainbase:0.04} },
    pulse: { play: wave, baseParams: {wave:'pulse', oct:3, envelope:'full', _gainbase:0.06} },
    saw: { play: wave, baseParams: {wave:'sawtooth', oct:4, envelope:'full', _gainbase:0.06} },
    sine: { play: wave, baseParams: {wave:'sine', oct:4, envelope:'full', _gainbase:0.05} },
    square: { play: wave, baseParams: {wave:'square', oct:4, envelope:'full', _gainbase:0.054} },
    tri: { play: wave, baseParams: {wave:'triangle', oct:4, envelope:'full', _gainbase:0.06} },
    bell: { play: bell },
    glock: { play: glock },
    piano: { play: piano },
    ethereal: { play: ethereal },
    noise: { play: noise },
    prophet: { play: prophet },
    fmbass: { play: fmbass },
    fm: { play: fm },
    glass: { play: glass },
    supersaw: { play: supersaw },
    external: { play: external },
    xylo: { play: xylo },
    ambi: { play: ambi },
  }

  return playerTypes
})
