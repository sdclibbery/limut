'use strict'
define((require) => {
  let sprite = require('draw/sprite').create
  let shadertoy = require('draw/shadertoy')
  let image = require('draw/image')
  let webcam = require('draw/webcam')
  let dmx = require('draw/dmx')
  let scope = require('draw/scope')
  let scopefft = require('draw/scopefft')
  let buffer = require('draw/buffer')
  let bus = require('play/synth/bus')
  let play = require('play/synth/play')
  let io808 = require('play/synth/io808')
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
  let audiosynth = require('play/synth/audiosynth')
  let parseExpression = require('expression/parse-expression')

  let white = {r:1,g:1,b:1,a:1}
  let black = {r:0,g:0,b:0,a:1}
  let offWhite = {r:0.9,g:0.9,b:0.9,a:1}
  let offBlack = {r:0.1,g:0.1,b:0.1,a:1}
  let transWhite = {r:1,g:1,b:1,a:0}
  let transBlack = {r:0,g:0,b:0,a:0}
  let warm = {r:1.0,g:0.8,b:0.6,a:1}
  let nullPlayer = { play: () => {}, stopped: true }
  let playerTypes = {
    test: { play: (e) => { e.endTime = e._time + e.dur; return {} }, baseParams:{ amp:1, vel:3/4 } },
    // stop
    none: nullPlayer,
    stop: nullPlayer,
    '!': nullPlayer,
      // visual
    scope: { play: sprite(scope), baseParams:{ amp:1, delay:0, rate:1, zoom:1, fore:white, back:transWhite }, type:'visual' },
    scopefft: { play: sprite(scopefft), baseParams:{ amp:1, delay:0, rate:1, zoom:1, fore:white, back:transWhite }, type:'visual' },
    meter: { play: sprite('meter'), baseParams:{ amp:1, delay:0, rate:1, zoom:1, fore:{r:0.9,g:0.0,b:0.9,a:1}, back:offBlack }, type:'visual' },
    readout: { play: sprite('readout'), baseParams:{ amp:1, delay:0, rate:1, zoom:1, fore:offWhite, back:offBlack, additive:1 }, type:'visual' },
    webcam: { play: sprite(webcam), baseParams:{ amp:1, delay:0, rate:1, zoom:1, fore:white, back:white }, type:'visual' },
    shadertoy: { play: sprite(shadertoy), baseParams:{ amp:1, delay:0, rate:1, zoom:1, fore:white, back:white }, type:'visual' },
    image: { play: sprite(image), baseParams:{ amp:1, delay:0, rate:1, zoom:1, fore:white, back:transWhite }, type:'visual' },
    buffer: { play: sprite(buffer), baseParams:{ amp:1, delay:0, rate:1, zoom:1, fore:white, back:transWhite, rez:0.5 }, type:'visual' },
    text: { play: sprite(image), baseParams:{ amp:1, delay:0, rate:1, zoom:1, fore:white, back:transBlack }, type:'visual' },
    clouds: { play: sprite('clouds'), baseParams:{ amp:1, delay:0, rate:1, zoom:1, fore:white, back:white }, type:'visual' },
    kal: { play: sprite('kaleidoscope'), baseParams:{ amp:1, delay:0, rate:1, zoom:1, fore:white, back:white }, type:'visual' },
    swirl: { play: sprite('swirl'), baseParams:{ amp:1, delay:0, rate:1, zoom:1, fore:white, back:white }, type:'visual' },
    lines: { play: sprite('lines'), baseParams:{ amp:1, delay:0, rate:1, zoom:1, fore:{r:0.2,g:0.25,b:0.9,a:1}, back:black }, type:'visual' },
    blob: { play: sprite('blob'), baseParams:{ amp:1, delay:0, rate:1, zoom:1, fore:{r:0.8,g:0.8,b:0.8,a:1}, back:transBlack }, type:'visual' },
    streetlight: { play: sprite('streetlight'), baseParams:{ amp:1, delay:0, rate:1, zoom:1, fore:white, back:black }, type:'visual' },
    grid: { play: sprite('grid'), baseParams:{ amp:1, delay:0, rate:1, zoom:1, fore:{r:1.0,g:0.2,b:0.1,a:1}, back:transBlack }, type:'visual' },
    glow: { play: sprite('glow'), baseParams:{ amp:1, delay:0, rate:1, zoom:1, fore:warm, back:{r:0.5,g:0.4,b:0.3,a:0}, additive:1, fade:1 }, type:'visual' },
    stars: { play: sprite('stars'), baseParams:{ amp:1, delay:0, rate:1, zoom:1, fore:warm, back:{r:0.3,g:0.2,b:0.1,a:0}, additive:1, fade:1 }, type:'visual' },
    bits: { play: sprite('bits'), baseParams:{ amp:1, delay:0, rate:1, zoom:1, fore:white, back:offBlack }, type:'visual' },
    xor: { play: sprite('xor'), baseParams:{ amp:1, delay:0, rate:1, zoom:1, fore:white, back:offBlack, additive:1 }, type:'visual' },
    gradient: { play: sprite('gradient'), baseParams:{ amp:1, delay:0, rate:1, zoom:1, fore:white, back:offBlack }, type:'visual' },
    blank: { play: sprite('blank'), baseParams:{ amp:1, delay:0, rate:1, zoom:1, fore:transBlack, back:{r:0.0,g:0.0,b:0.0,a:6/256} }, type:'visual' },
    lights: { play: sprite('lights'), baseParams:{ amp:1, delay:0, rate:1, zoom:1, fore:white, back:{r:0.5,g:0.4,b:0.3,a:0}, additive:1 }, type:'visual' },
    julia: { play: sprite('julia'), baseParams:{ amp:1, delay:0, rate:1, zoom:1, fore:offWhite, back:offBlack }, type:'visual' },
    bars: { play: sprite('bars'), baseParams:{ amp:1, delay:0, rate:1, zoom:1, fore:white, back:black, additive:1 }, type:'visual' },
    dmx: { play: dmx, baseParams:{ amp:1, delay:0 }, type:'dmx' },
    // audio
    bus: { create: bus, baseParams:{ vel:3/4, amp:parseExpression('this.vel') }, type:'audio' },
    drums: { play: play, baseParams:{ vel:3/4, amp:parseExpression('this.vel'), delay:0, dur:1/2 }, type:'audio' },
    io808: { play: io808, baseParams:{ vel:3/4, amp:parseExpression('this.vel'), delay:0, dur:1/4 }, type:'audio' },
    play: { play: play, baseParams:{ vel:3/4, amp:parseExpression('this.vel'), delay:0, dur:1/2, rate:1 }, type:'audio' },
    pitchedperc: { play: pitchedPerc, baseParams:{ vel:3/4, amp:parseExpression('this.vel'), delay:0, dur:1/2, sus:1/3,
        click:{ value:1, dur:0.2, cutoff:1500, q:5 },
        hit:{ value:1, sample:'^', index:1, rate:1.5, cutoff:250, q:1 },
        body:{ value:1, freq:55, boost:150, curve:3, wave:'sine', cutoff:2, q:10 },
        rattle:{ value:1, rate:1, freq:55, boost:205, curve:8, q:18 }
      }, type:'audio' },
    impulse: { play: impulse, baseParams:{ vel:3/4, amp:parseExpression('this.vel'), delay:0 }, type:'audio' },
    external: { play: external, baseParams:{ vel:3/4, amp:parseExpression('this.vel'), delay:0 }, type:'audio' },
    noise: { play: noise, baseParams:{ vel:3/4, amp:parseExpression('this.vel'), delay:0 }, type:'audio' },
    sample: { play: sample, baseParams:{ vel:3/4, amp:parseExpression('this.vel'), delay:0, oct:4 }, type:'audio' },
    piano: { play: piano, baseParams:{ vel:3/4, amp:parseExpression('this.vel'), delay:0, oct:4 }, type:'audio' },
    pwm: { play: pwm, baseParams:{ vel:3/4, amp:parseExpression('this.vel'), delay:0, oct:4, pwm:0.5 }, type:'audio' },
    wave: { play: wave, baseParams:{ vel:3/4, amp:parseExpression('this.vel'), delay:0, oct:4 }, type:'audio' },
    fm: { play: fm, baseParams:{ vel:3/4, amp:parseExpression('this.vel'), delay:0, oct:4 }, type:'audio' },
    multiwave: { play: multiwave, baseParams:{ vel:3/4, amp:parseExpression('this.vel'), delay:0, oct:4 }, type:'audio' },
    audiosynth: { play: audiosynth, baseParams:{ vel:3/4, amp:parseExpression('this.vel'), delay:0, oct:4 }, type:'audio' },
  }

  let consoleOut = require('console')
  consoleOut.addCommand('list', (args) => {
    let filtered = Object.keys(playerTypes).filter(name => { return args.length === 0 || args.includes(playerTypes[name].type) })
    let groups = [...new Set(filtered.map(name => playerTypes[name].type))].sort()
    groups.forEach((group) => {
      consoleOut('[' + group + '] ' + filtered.filter(name => playerTypes[name].type === group).sort().join(', '))
    })
  })

  return playerTypes
})
