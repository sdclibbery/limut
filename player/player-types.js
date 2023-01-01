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
  let external = require('play/synth/external')
  let wave = require('play/synth/wave')
  let multiwave = require('play/synth/multiwave')
  let pitchedPerc = require('play/synth/pitchedperc')
  let impulse = require('play/synth/impulse')

  let white = {r:1,g:1,b:1,a:1}
  let black = {r:0,g:0,b:0,a:1}
  let offWhite = {r:0.9,g:0.9,b:0.9,a:1}
  let offBlack = {r:0.1,g:0.1,b:0.1,a:1}
  let transWhite = {r:1,g:1,b:1,a:0}
  let transBlack = {r:0,g:0,b:0,a:0}
  let warm = {r:1.0,g:0.8,b:0.6,a:1}
  let nullPlayer = { play: () => {}, stopped: true }
  let playerTypes = {
    // stop
    none: nullPlayer,
    stop: nullPlayer,
    '!': nullPlayer,
    // visualisations
    scope: { play: sprite(scope), baseParams:{ amp:1, rate:1, zoom:1, fore:white, back:transWhite } },
    meter: { play: sprite('meter'), baseParams:{ amp:1, rate:1, zoom:1, fore:{r:0.9,g:0.0,b:0.9,a:1}, back:offBlack } },
    readout: { play: sprite('readout'), baseParams:{ amp:1, rate:1, zoom:1, fore:offWhite, back:offBlack, additive:1 } },
    webcam: { play: sprite(webcam), baseParams:{ amp:1, rate:1, zoom:1, fore:white, back:white } },
    shadertoy: { play: sprite(shadertoy), baseParams:{ amp:1, rate:1, zoom:1, fore:white, back:white } },
    image: { play: sprite(image), baseParams:{ amp:1, rate:1, zoom:1, fore:white, back:transWhite } },
    buffer: { play: sprite(buffer), baseParams:{ amp:1, rate:1, zoom:1, fore:white, back:transWhite, rez:0.5 } },
    text: { play: sprite(image), baseParams:{ amp:1, rate:1, zoom:1, fore:white, back:transBlack } },
    clouds: { play: sprite('clouds'), baseParams:{ amp:1, rate:1, zoom:1, fore:white, back:white } },
    kal: { play: sprite('kaleidoscope'), baseParams:{ amp:1, rate:1, zoom:1, fore:white, back:white } },
    swirl: { play: sprite('swirl'), baseParams:{ amp:1, rate:1, zoom:1, fore:white, back:white } },
    lines: { play: sprite('lines'), baseParams:{ amp:1, rate:1, zoom:1, fore:{r:0.2,g:0.25,b:0.9,a:1}, back:black } },
    blob: { play: sprite('blob'), baseParams:{ amp:1, rate:1, zoom:1, fore:{r:0.8,g:0.8,b:0.8,a:1}, back:transBlack } },
    streetlight: { play: sprite('streetlight'), baseParams:{ amp:1, rate:1, zoom:1, fore:white, back:black } },
    grid: { play: sprite('grid'), baseParams:{ amp:1, rate:1, zoom:1, fore:{r:1.0,g:0.2,b:0.1,a:1}, back:transBlack } },
    glow: { play: sprite('glow'), baseParams:{ amp:1, rate:1, zoom:1, fore:warm, back:{r:0.5,g:0.4,b:0.3,a:0}, additive:1, fade:1 } },
    stars: { play: sprite('stars'), baseParams:{ amp:1, rate:1, zoom:1, fore:warm, back:{r:0.3,g:0.2,b:0.1,a:0}, additive:1, fade:1 } },
    bits: { play: sprite('bits'), baseParams:{ amp:1, rate:1, zoom:1, fore:white, back:offBlack } },
    xor: { play: sprite('xor'), baseParams:{ amp:1, rate:1, zoom:1, fore:white, back:offBlack, additive:1 } },
    gradient: { play: sprite('gradient'), baseParams:{ amp:1, rate:1, zoom:1, fore:white, back:offBlack } },
    blank: { play: sprite('blank'), baseParams:{ amp:1, rate:1, zoom:1, fore:transBlack, back:{r:0.0,g:0.0,b:0.0,a:6/256} } },
    lights: { play: sprite('lights'), baseParams:{ amp:1, rate:1, zoom:1, fore:white, back:{r:0.5,g:0.4,b:0.3,a:0}, additive:1 } },
    julia: { play: sprite('julia'), baseParams:{ amp:1, rate:1, zoom:1, fore:offWhite, back:offBlack } },
    bars: { play: sprite('bars'), baseParams:{ amp:1, rate:1, zoom:1, fore:white, back:black, additive:1 } },
    // instruments
    drums: { play: play, baseParams:{ amp:1, dur:1/2 } },
    play: { play: play, baseParams:{ amp:1, dur:1/2, rate:1 } },
    pitchedperc: { play: pitchedPerc, baseParams:{ amp:1, dur:1/2, sus:1/3,
        click:{ value:1, dur:0.2, cutoff:1500, q:5 },
        hit:{ value:1, sample:'^', index:1, rate:1.5, cutoff:250, q:1 },
        body:{ value:1, freq:55, boost:150, curve:3, wave:'sine', cutoff:2, q:10 },
        rattle:{ value:1, rate:1, freq:55, boost:205, curve:8, q:18 }
      } },
    impulse: { play: impulse, baseParams:{ amp:1 } },
    external: { play: external, baseParams:{ amp:1 } },
    noise: { play: noise, baseParams:{ amp:1 } },
    sample: { play: sample, baseParams:{ amp:1, oct:4 } },
    piano: { play: piano, baseParams:{ amp:1, oct:4 } },
    pwm: { play: pwm, baseParams:{ amp:1, oct:4, pwm:0.5 } },
    wave: { play: wave, baseParams:{ amp:1, oct:4 } },
    fm: { play: fm, baseParams:{ amp:1, oct:4 } },
    multiwave: { play: multiwave, baseParams:{ amp:1, oct:4 } },
  }

  return playerTypes
})
