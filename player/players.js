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
        if (players.instances[id].destroy) { players.instances[id].destroy() }
        if (players.instances[id]._fx && players.instances[id]._fx.destroy) { players.instances[id]._fx.destroy() }
        delete players.instances[id]
      }
    }
  }

  players.stopAll = () => {
    for (let id in players.instances) {
      if (id === 'main') { continue } // Preserve main bus so reverb tails keep playing
      if (players.instances[id].destroy) { players.instances[id].destroy() }
      if (players.instances[id]._fx && players.instances[id]._fx.destroy) { players.instances[id]._fx.destroy() }
  }
    players.instances = {
      main: players.instances.main // Preserve main bus so it can be cleaned up when it gets recreated on code update
    }
    players.overrides = {}
  }

  players.getById = (id) => {
    if (!id) { return }
    return players.instances[id.toLowerCase()]
  }

  let isMain = o => o === 'main' // Main bus; we don't apply wildcards to it

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
        matches = Object.keys(players.instances).filter(id => id.match(re) && !isMain(id))
      } else {
        matches = [oid]
      }
      if (invert) {
        matches = Object.keys(players.instances).filter(id => !matches.includes(id) && !isMain(id))
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

    testOverrideWildcard(['p1','p2','r1','main'], {'!p*':{foo:1}}, {r1:{foo:1}})
    testOverrideWildcard(['p1','p2','r1','main'], {'!p1':{foo:1}}, {p2:{foo:1},r1:{foo:1}})
    testOverrideWildcard(['p1','p2','r1','main'], {'m*':{foo:1}}, {})
    testOverrideWildcard(['p1','p2','r1','main'], {'main':{foo:1}}, {main:{foo:1}})

    players.instances = { pp: 5 }
    assert(5, players.getById('pp'))
    assert(5, players.getById('pP'))
    assert(undefined, players.getById('pO'))
    players.instances = {}

    console.log('Players tests complete')
  }
  
  return players
})
