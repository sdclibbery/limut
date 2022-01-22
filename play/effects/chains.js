'use strict';
define(function (require) {
  let system = require('play/system')
  let {evalMainParamEvent,evalSubParamEvent} = require('play/eval-audio-params')
  let freeverb = require('play/effects/freeverb')
  let phaser = require('play/effects/phaser')
  let flanger = require('play/effects/flanger')
  let chorus = require('play/effects/chorus')
  let {fixedMix} = require('play/effects/mix')

  let echo = (echoDelay, echoFeedback, node, nodes) => {
    if (!echoDelay || echoDelay < 0.0001) { return node }
    let echo = system.audio.createDelay(echoDelay)
    nodes.push(echo)
    echo.delayTime.value = echoDelay
    let echoGain = system.audio.createGain()
    nodes.push(echoGain)
    echoGain.gain.value = echoFeedback
    echo.connect(echoGain)
    echoGain.connect(echo)
    node.connect(echo)
    let mix = system.audio.createGain()
    nodes.push(mix)
    node.connect(mix)
    echoGain.connect(mix)
    return mix
  }

  let reverb = (room, node, nodes) => {
    if (!room || room < 0.01) { return node }
    let fv = freeverb(room, node, nodes)
    node.connect(fv)
    return fv
  }

  let quantise = (v, step) =>{
    return Math.round(v*step)/step
  }
  let getParams = (params) => {
    return {
      chorusAmount: quantise(evalMainParamEvent(params, 'chorus', 0), 8),
      chorusMix: quantise(evalSubParamEvent(params, 'chorus', 'mix', 1), 16),
      phaserRate: quantise(evalMainParamEvent(params, 'phaser', 0) / params.beat.duration, 16),
      phaserMix: quantise(evalSubParamEvent(params, 'phaser', 'mix', 1), 16),
      flangerRate: quantise(evalMainParamEvent(params, 'flanger', 0) / params.beat.duration, 16),
      flangerMix: quantise(evalSubParamEvent(params, 'flanger', 'mix', 1), 16),
      echoDelay: quantise(evalMainParamEvent(params, 'echo', 0) * params.beat.duration, 16),
      echoFeedback: quantise(Math.min(evalSubParamEvent(params, 'echo', 'feedback', 0.35), 0.95), 20),
      room: quantise(evalMainParamEvent(params, 'room', 0)*0.7, 16),
      roomMix: quantise(evalSubParamEvent(params, 'room', 'mix', 1/2), 16),
    }
}

  let chains = {}

  let createChain = (chainParams) => {
    let c = {
      params: chainParams,
      nodes: [],
      oscs: [],
    }
    c.in = system.audio.createGain()
    c.nodes.push(c.in)
    let node = c.in
    node = fixedMix(c.params.chorusMix, node, chorus(c.params.chorusAmount, node, c.nodes, c.oscs), c.nodes)
    node = fixedMix(c.params.phaserMix, node, phaser(c.params.phaserRate, node, c.nodes, c.oscs), c.nodes)
    node = fixedMix(c.params.flangerMix, node, flanger(c.params.flangerRate, node, c.nodes, c.oscs), c.nodes)
    node = echo(c.params.echoDelay, c.params.echoFeedback, node, c.nodes)
    node = fixedMix(c.params.roomMix, node, reverb(c.params.room, node, c.nodes), c.nodes)
    c.out = node
    return c
  }

  let destroyChain = (chain) => {
    delete chains[chain.key]
    chain.oscs.map(n => n.stop())
    chain.nodes.map(n => n.disconnect())
  }

  return (params, node) => {
    let chainParams = getParams(params)
    let key = JSON.stringify(chainParams)
    if (!chains[key]) {
      let chain = createChain(chainParams)
      chain.key = key
      chains[key] = chain
    }
    let chain = chains[key]
    clearTimeout(chain.timeoutID)
    let TTL = 1000*(params.endTime-params._time + chainParams.room*5 + chainParams.echoDelay*chainParams.echoFeedback*10 + 2)
    chain.timeoutID = setTimeout(() => destroyChain(chain), TTL)
    node.connect(chain.in)
    chain.nodes.push(node)
    return chain.out
  }
})
