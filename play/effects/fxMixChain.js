'use strict';
define(function (require) {
  let system = require('play/system')
  let {evalMainParamEvent,evalSubParamEvent} = require('play/eval-audio-params')
  let {fixedFreeverb} = require('play/effects/freeverb')
  let phaser = require('play/effects/phaser')
  let flanger = require('play/effects/flanger')
  let {fixedChorus} = require('play/effects/chorus')
  let {fixedMix} = require('play/effects/mix')
  let players = require('player/players')
  let consoleOut = require('console')
  let {fixedEcho} = require('play/effects/echo')
  let destructor = require('play/destructor')

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
      room: quantise(evalMainParamEvent(params, 'room', 0), 16),
      roomMix: quantise(evalSubParamEvent(params, 'room', 'mix', 1/2), 16),
      bus: evalMainParamEvent(params, 'bus'),
    }
}

  let chains = {}

  let createChain = (chainParams) => {
    let c = {
      params: chainParams,
      nodes: [],
      oscs: [],
    }
    c.destructor = destructor()
    c.in = system.audio.createGain()
    c.nodes.push(c.in)
    let node = c.in
    node = fixedMix(c.params.chorusMix, node, fixedChorus(c.destructor, c.params.chorusAmount, node), c.nodes)
    node = fixedMix(c.params.phaserMix, node, phaser(c.params.phaserRate, node, c.nodes, c.oscs), c.nodes)
    node = fixedMix(c.params.flangerMix, node, flanger(c.params.flangerRate, node, c.nodes, c.oscs), c.nodes)
    node = fixedEcho(c.destructor, c.params.echoDelay, c.params.echoFeedback, node)
    node = fixedMix(c.params.roomMix, node, fixedFreeverb(c.destructor, c.params.room, node, c.nodes), c.nodes)
    c.out = node
    return c
  }

  let connectChain = (c, playerId) => {
    let busId = c.params.bus
    if (!busId) { busId = 'main' } // Default to main bus if not specified
    let bus = players.getById(busId)
    if (!bus || !bus._input) { // Do nothing if bus not present
      consoleOut(`Player ${playerId} failed to connect to destination bus ${busId}`)
      c.connected = false
      return
    }
    if (c.connected) { return }
    c.out.connect(bus._input)
    c.connected = true
  }

  let disconnectAll = () => {
    Object.values(chains).forEach(c => c.connected = false)
  }

  let destroyChain = (chain) => {
    chain.oscs.map(n => n.stop())
    chain.nodes.map(n => n.disconnect())
    chain.destructor.destroy()
    delete chains[chain.key]
  }

  let fxMixChain = (params, node) => {
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
    connectChain(chain, params._player.id)
  }

  return {
    fxMixChain: fxMixChain,
    disconnectAll: disconnectAll,
  }
})
