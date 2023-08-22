'use strict';
define(function (require) {
  let system = require('play/system')
  let {mainParam} = require('player/sub-param')
  let {evalMainParamFrame,evalMainParamEvent} = require('play/eval-audio-params')


  let chokes = {}
  let chokeRelease = 0.01
  let chokeVca = (choke, time) => {
    choke.vca.gain.cancelScheduledValues(0)
    choke.vca.gain.setValueAtTime(1, 0)
    choke.vca.gain.setValueAtTime(1, time)
    choke.vca.gain.linearRampToValueAtTime(0, time + chokeRelease)
    choke.endTime = time
  }
  let addChokeEvent = (group, vca, startTime, endTime) => {
    if (!chokes[group]) { chokes[group] = [] }
    let chokeGroup = chokes[group]
    let idx
    let newChoke = {vca:vca, startTime:startTime, endTime:endTime}
    for (idx = 0; idx < chokeGroup.length; idx++) {
      let choke = chokeGroup[idx]
      if (startTime > choke.startTime && startTime < choke.endTime) { // New event should choke existing event
        chokeVca(choke, startTime)
      }
      if (choke.startTime > startTime && choke.startTime < endTime) { // New event should be choked by existing event
        chokeVca(newChoke, choke.startTime)
      }
      if (choke.startTime > startTime) { // New event will slot in here
        break
      }
    }
    chokeGroup.splice(idx, 0, newChoke)
  }
  let choke = (params, node) => {
    let group = evalMainParamEvent(params, 'choke')
    if (!group) { return node }
    let vca = system.audio.createGain()
    addChokeEvent(group, vca, params._time, params.endTime)
    node.connect(vca)
    params._destructor.disconnect(vca)
    return vca
  }

  let perFrameAmp = (params, node) => {
    node = choke(params, node)
    if (typeof mainParam(params.amp) !== 'function') { return node } // No per frame control required
    let vca = system.audio.createGain()
    evalMainParamFrame(vca.gain, params, 'amp', 1)
    node.connect(vca)
    params._destructor.disconnect(vca)
    return vca
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {
    let assert = (expected, actual, msg) => {
      let x = JSON.stringify(expected, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(3) : v)
      let a = JSON.stringify(actual, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(3) : v)
      if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}${msg?'\n'+msg:''}`) }
    }
    let stubVca = {
      gain: {
        cancelScheduledValues: () => {},
        setValueAtTime: () => {},
        setValueAtTime: () => {},
        linearRampToValueAtTime: () => {},
      }
    }

    // New events added in order
    chokes = {}
    addChokeEvent('group', stubVca, 0,1)
    assert([0], chokes.group.map(c => c.startTime))
    addChokeEvent('group', stubVca, 5,6)
    assert([0,5], chokes.group.map(c => c.startTime))
    addChokeEvent('group', stubVca, 2,3)
    assert([0,2,5], chokes.group.map(c => c.startTime))

    // Choke off an event
    chokes = {}
    addChokeEvent('group', stubVca, 0,2)
    addChokeEvent('group', stubVca, 1,2)
    assert([0,1], chokes.group.map(c => c.startTime))
    assert([1,2], chokes.group.map(c => c.endTime))
    // Choke off same event earlier
    addChokeEvent('group', stubVca, 0.5,1)
    assert([0,0.5,1], chokes.group.map(c => c.startTime))
    assert([0.5,1,2], chokes.group.map(c => c.endTime))
    
    // New event gets choked immediately by existing events
    chokes = {}
    addChokeEvent('group', stubVca, 1,2)
    addChokeEvent('group', stubVca, 0,2)
    assert([0,1], chokes.group.map(c => c.startTime))
    assert([1,2], chokes.group.map(c => c.endTime))

    chokes = {} // Reset
    console.log('Per frame amp tests complete')
  }
    
  return perFrameAmp
})
