'use strict'
define(function(require) {
  let {beatDuration} = require('metronome')

  let convert = (value, given, target) => {
    if (!given || ! target) { return value } // No units given so just assume it must be the default units already
    if (target === 'b') {
      if (given === 'b') { return value }
      if (given === 'cpb') { return 1/value }
      if (given === 's') { return value/beatDuration() }
      if (given === 'hz') { return 1/(value*beatDuration()) }
    }
    if (target === 'cpb') {
      if (given === 'b') { return 1/value }
      if (given === 'cpb') { return value }
      if (given === 's') { return beatDuration()/value }
      if (given === 'hz') { return value*beatDuration() }
    }
    if (target === 's') {
      if (given === 'b') { return value*beatDuration() }
      if (given === 'cpb') { return beatDuration()/value }
      if (given === 's') { return value }
      if (given === 'hz') { return 1/value }
    }
    if (target === 'hz') {
      if (given === 'b') { return 1/(value*beatDuration()) }
      if (given === 'cpb') { return value/beatDuration() }
      if (given === 's') { return 1/value }
      if (given === 'hz') { return value }
    }
    console.log(`Unknown units: ${given} ${target}`)
    return value // unknown, just return the value
  }

  let units = (v, targetUnits) => {
    if (v === null || v === undefined) { return v }
    if (typeof v !== 'object') { return v }
    let units = v._units
    return convert(v.value, units, targetUnits)
  }

  // TESTS
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

    let assert = (expected, actual) => {
      let x = JSON.stringify(expected, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(3) : v)
      let a = JSON.stringify(actual, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(3) : v)
      if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
    }
  
    assert(null, units(null))
    assert(undefined, units(undefined))
    assert(undefined, units({}))
    assert(undefined, units({_units:'s'}))
  
    assert(1, units(1))
    assert(1, units(1, 's'))
    assert(1, units({value:1}))
    assert(1, units({value:1,_units:'s'}))
    assert(1, units({value:1,_units:'s'}, 's'))
    
    let origBeatDuration = beatDuration()
    beatDuration(1/2)
    assert(3, units({value:3,_units:'b'}, 'b', 1/2))
    assert(1/3, units({value:3,_units:'cpb'}, 'b', 1/2))
    assert(6, units({value:3,_units:'s'}, 'b', 1/2))
    assert(2/3, units({value:3,_units:'hz'}, 'b', 1/2))
    
    assert(1/3, units({value:3,_units:'b'}, 'cpb', 1/2))
    assert(3, units({value:3,_units:'cpb'}, 'cpb', 1/2))
    assert(1/6, units({value:3,_units:'s'}, 'cpb', 1/2))
    assert(3/2, units({value:3,_units:'hz'}, 'cpb', 1/2))
    
    assert(3/2, units({value:3,_units:'b'}, 's', 1/2))
    assert(1/6, units({value:3,_units:'cpb'}, 's', 1/2))
    assert(3, units({value:3,_units:'s'}, 's', 1/2))
    assert(1/3, units({value:3,_units:'hz'}, 's', 1/2))
    
    assert(2/3, units({value:3,_units:'b'}, 'hz', 1/2))
    assert(6, units({value:3,_units:'cpb'}, 'hz', 1/2))
    assert(1/3, units({value:3,_units:'s'}, 'hz', 1/2))
    assert(3, units({value:3,_units:'hz'}, 'hz', 1/2))
    beatDuration(origBeatDuration)

    console.log('Units tests complete')
    }
    
    return {
    units: units,
    convertUnits: convert,
  }
})