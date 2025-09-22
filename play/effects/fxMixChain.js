'use strict';
define(function (require) {
  let system = require('play/system')
  let {evalMainParamEvent,evalSubParamEvent} = require('play/eval-audio-params')
  let {fixedFreeverb} = require('play/effects/freeverb')
  let {fixedReverb} = require('play/effects/reverb')
  let {fixedPhaser} = require('play/effects/phaser')
  let {fixedFlanger} = require('play/effects/flanger')
  let {fixedChorus} = require('play/effects/chorus')
  let {fixedMix} = require('play/effects/mix')
  let players = require('player/players')
  let consoleOut = require('console')
  let {fixedEcho} = require('play/effects/echo')
  let destructor = require('play/destructor')
  let {createPlayerFxChain,getPlayerFxChainKey} = require('play/player-fx')

  let quantise = (v, step) =>{
    return Math.round(v*step)/step
  }
  let getParams = (params) => {
    let output
    if (params.fx !== undefined) { output = params._player.id } // Output to _this_ player to route through the fx chain if there is one
    else { output = evalMainParamEvent(params, 'bus') }
    return {
      chorusAmount: quantise(evalMainParamEvent(params, 'chorus', 0), 8),
      chorusMix: quantise(evalSubParamEvent(params, 'chorus', 'mix', 1), 16),
      phaserRate: quantise(evalMainParamEvent(params, 'phaser', 0, 'cpb') / params.beat.duration, 16),
      phaserMix: quantise(evalSubParamEvent(params, 'phaser', 'mix', 1), 16),
      flangerRate: quantise(evalMainParamEvent(params, 'flanger', 0, 'cpb') / params.beat.duration, 16),
      flangerMix: quantise(evalSubParamEvent(params, 'flanger', 'mix', 1), 16),
      echoDelay: quantise(evalMainParamEvent(params, 'echo', 0, 'b') * params.beat.duration, 16),
      echoFeedback: quantise(Math.min(evalSubParamEvent(params, 'echo', 'feedback', 0.35), 0.95), 20),
      room: quantise(evalMainParamEvent(params, 'room', 0), 16),
      roomHpf: quantise(evalSubParamEvent(params, 'room', 'hpf', 0, 'hz'), 1),
      roomMix: quantise(evalSubParamEvent(params, 'room', 'mix', 1/2), 16),
      reverb: quantise(evalMainParamEvent(params, 'reverb', 0, 'b') * params.beat.duration, 16),
      reverbCurve: quantise(evalSubParamEvent(params, 'reverb', 'curve', 3), 16),
      reverbHpf: quantise(evalSubParamEvent(params, 'reverb', 'hpf', 0, 'hz'), 1),
      reverbMix: quantise(evalSubParamEvent(params, 'reverb', 'mix', 1/3), 16),
      output: output,
    }
  }

  let chains = {}
  let id = 0

  let createChain = (chainParams, params) => {
    let c = {
      params: chainParams,
      id: id++,
    }
    c.destructor = destructor()
    c.in = system.audio.createGain()
    c.destructor.disconnect(c.in)
    let node = c.in
    node = fixedMix(c.destructor, c.params.chorusMix, node, fixedChorus(c.destructor, c.params.chorusAmount, node))
    node = fixedMix(c.destructor, c.params.phaserMix, node, fixedPhaser(c.destructor, c.params.phaserRate, node))
    node = fixedMix(c.destructor, c.params.flangerMix, node, fixedFlanger(c.destructor, c.params.flangerRate, node))
    node = fixedEcho(c.destructor, c.params.echoDelay, c.params.echoFeedback, node)
    node = fixedMix(c.destructor, c.params.roomMix, node, fixedFreeverb(c.destructor, c.params.room, c.params.roomHpf, node))
    node = fixedMix(c.destructor, c.params.reverbMix, node, fixedReverb(c.destructor, c.params.reverb, c.params.reverbCurve, c.params.reverbHpf, node))
    c.out = node
    c.destructor.disconnect(c.out)
    return c
  }

  let disconnectAll = () => {
    Object.values(chains).forEach(c => c.connected = false)
  }

  let destroyChain = (chain) => {
    chain.destructor.destroy()
    delete chains[chain.key]
  }

  let connectChain = (c, params, createdChain) => {
    let outPlayerId = c.params.output // If this player has an fx chain, outPlayerId will be _this_ player!
    if (!outPlayerId) { outPlayerId = 'main' } // Default to main bus if not specified
    let outPlayer = players.getById(outPlayerId)
    if (!outPlayer) { // Do nothing if bus not present
      consoleOut(`🟠 Player ${params._player.id} audio out failed to connect to destination player ${outPlayerId}`)
      return
    }
    if (outPlayer._input !== undefined)  { // Output to bus player
      c.out.disconnect()
      c.out.connect(outPlayer._input)
    } else { // Output to player fx chain
      let newKey = getPlayerFxChainKey(params)
      if (outPlayer._fx === undefined || newKey !== outPlayer._fx.key) { // Create fx chain and connect to it if not present or out of date
        if (outPlayer._fx !== undefined) { outPlayer._fx.destroy() }
        outPlayer._fx = createPlayerFxChain(params)
        setTimeout(()=> { // Pause until last moment before connecting to avoid loud blare with parallel delay feedbacks
          c.out.disconnect()
          c.out.connect(outPlayer._fx.chainInput)
        }, (params._time - system.timeNow()) * 1000 - 1)
      } else if (createdChain) { // If the fxMixChain is new, connect to it
        c.out.disconnect()
        c.out.connect(outPlayer._fx.chainInput)
      }
    }
  }

  let fxMixChain = (params, node) => {
    let chainParams = getParams(params)
    let key = JSON.stringify(chainParams)
    let createdChain = false
    if (!chains[key]) {
      let chain = createChain(chainParams, params)
      chain.key = key
      chains[key] = chain
      createdChain = true
    }
    let chain = chains[key]
    clearTimeout(chain.timeoutID)
    let TTL = 1000*(params.endTime-params._time + chainParams.room*5 + chainParams.reverb + chainParams.echoDelay*chainParams.echoFeedback*10 + 2)
    chain.timeoutID = setTimeout(() => destroyChain(chain), TTL)
    node.connect(chain.in)
    chain.destructor.disconnect(node)
    connectChain(chain, params, createdChain)
  }

  return {
    fxMixChain: fxMixChain,
    disconnectAll: disconnectAll,
  }
})
