'use strict';
define(function (require) {
  let system = require('play/system')
  let {evalMainParamEvent,evalSubParamEvent} = require('play/eval-audio-params')
  let freeverb = require('play/effects/freeverb')
  let phaser = require('play/effects/phaser')
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

  let reverb = (room, mix, node, nodes) => {
    if (!room || room < 0.01 || mix < 0.01) { return node }
    let fv = freeverb(room, node, nodes)
    node.connect(fv)
    return fixedMix(mix, node, fv, nodes)
  }

  let quantise = (v, step) =>{
    return Math.round(v*step)/step
  }
  let getParams = (params) => {
    return {
      chorusAmount: quantise(evalMainParamEvent(params, 'chorus', 0), 8),
      chorusMix: quantise(evalSubParamEvent(params, 'chorus', 'mix', 1), 16),
      lfoFreq: quantise(evalMainParamEvent(params, 'phaser', 0) / params.beat.duration, 16),
      echoDelay: quantise(evalMainParamEvent(params, 'echo', 0) * params.beat.duration, 16),
      echoFeedback: quantise(Math.min(evalMainParamEvent(params, 'echofeedback', 0.35), 0.95), 20),
      room: quantise(evalMainParamEvent(params, 'room', 0)*0.7, 16),
      roomMix: quantise(evalSubParamEvent(params, 'room', 'mix', 1/2), 16),
    }
}

  let chains = {}

  let createChain = (chainParams) => {
    let chain = {
      params: chainParams,
      nodes: [],
      oscs: [],
    }
    chain.in = system.audio.createGain()
    chain.nodes.push(chain.in)
    let node = chain.in
    node = fixedMix(chain.params.chorusMix, node, chorus(chain.params.chorusAmount, node, chain.nodes, chain.oscs), chain.nodes)
    node = phaser(chain.params.lfoFreq, node, chain.nodes, chain.oscs)
    node = echo(chain.params.echoDelay, chain.params.echoFeedback, node, chain.nodes)
    node = reverb(chain.params.room, chain.params.roomMix, node, chain.nodes)
    chain.out = node
    return chain
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
