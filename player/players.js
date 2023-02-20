'use strict'
define(function(require) {
  let {combineOverrides} = require('player/override-params')

  let players = {
    instances: {},
    overrides: {},
  }

  players.gc_reset = () => {
    for (let id in players.instances) {
      players.instances[id].marked = false
    }
  }
  players.gc_mark = (id) => {
    players.instances[id].marked = true
  }
  players.gc_sweep = () => {
    for (let id in players.instances) {
      if (!players.instances[id].marked) {
        delete players.instances[id]
      }
    }
  }

  players.expandOverrides = () => {
    let newOverrides = {}
    for (let k in players.overrides) {
      let invert = false
      let oid = k
      if (k[0] === '!') {
        invert = true
        oid = k.substring(1)
      }
      let matches
      if (oid.includes('*')) {
        let re = new RegExp('^'+oid.replaceAll('*','.*')+'$')
        matches = Object.keys(players.instances).filter(id => id.match(re))
      } else {
        matches = [oid]
      }
      if (invert) {
        matches = Object.keys(players.instances).filter(id => !matches.includes(id))
      }
      matches.forEach(m => {
        newOverrides[m] = combineOverrides(newOverrides[m] || {}, players.overrides[k])
      })
    }
    players.overrides = newOverrides
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {
    let assert = (expected, actual) => {
      let x = JSON.stringify(expected, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
      let a = JSON.stringify(actual, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
      if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
    }

    let testOverrideWildcard = (instances, before, after) => {
      players.instances = {}
      instances.forEach(i => players.instances[i] = {})
      players.overrides = before
      players.expandOverrides()
      assert(after, players.overrides)
      players.instances = {}
      players.overrides = {}
    }

    testOverrideWildcard(['p1'], {'p*':{foo:1}}, {p1:{foo:1}})
    testOverrideWildcard(['p1','q1'], {'p*':{foo:1},q1:{bar:1}}, {p1:{foo:1},q1:{bar:1}})
    testOverrideWildcard(['p1','q1'], {'*':{foo:1}}, {p1:{foo:1},q1:{foo:1}})
    testOverrideWildcard(['p1','qp1'], {'p*':{foo:1}}, {p1:{foo:1}})
    testOverrideWildcard(['p1','p2'], {'p*':{foo:1}}, {p1:{foo:1},p2:{foo:1}})
    testOverrideWildcard(['p','qp'], {'*p':{foo:1}}, {p:{foo:1},qp:{foo:1}})
    testOverrideWildcard(['p','q'], {'*':{foo:1}}, {p:{foo:1},q:{foo:1}})
    testOverrideWildcard(['p1a','p2a','q1b'], {'p*a':{foo:1}}, {p1a:{foo:1},p2a:{foo:1}})
    testOverrideWildcard(['p1a','p2a','q1b'], {'*1*':{foo:1}}, {p1a:{foo:1},q1b:{foo:1}})

    testOverrideWildcard(['p1'], {p1:{bar:1},'*':{foo:1}}, {p1:{bar:1,foo:1}})
    testOverrideWildcard(['p1'], {'*':{foo:1},p1:{bar:1}}, {p1:{foo:1,bar:1}})

    testOverrideWildcard(['p1'], {'!p1':{foo:1}}, {})
    testOverrideWildcard(['p1'], {'!q1':{foo:1}}, {p1:{foo:1}})
    testOverrideWildcard(['p1','p2'], {'!q':{foo:1}}, {p1:{foo:1},p2:{foo:1}})
    testOverrideWildcard(['p1','p2'], {'!p1':{foo:1}}, {p2:{foo:1}})
    testOverrideWildcard(['p1','p2','q1'], {'!p*':{foo:1}}, {q1:{foo:1}})
    testOverrideWildcard(['p1','p2','q1'], {'!*1':{foo:1}}, {p2:{foo:1}})

    console.log('Players tests complete')
  }
  
  return players
})
