'use strict'
define(function(require) {
  let addVarFunction = require('predefined-vars').addVarFunction

  let xmur3 = (x) => {
    let h = 1779033703
    h = Math.imul(h ^ Math.floor(x), 3432918353)
    h = h << 13 | h >>> 19
    h = Math.imul(h ^ Math.floor((x%1)*4294967296), 3432918353)
    h = h << 13 | h >>> 19
    h = Math.imul(h ^ h >>> 16, 2246822507)
    h = Math.imul(h ^ h >>> 13, 3266489909)
    return (h ^= h >>> 16) >>> 0
  }

  let rand = (args, e,b,state) => {
    let seed = args && args.seed
    if (seed === undefined) {
      if (state.perParseSeed === undefined) {
        state.perParseSeed = Math.random()
      }
      if (e.perEventSeed === undefined) {
        e.perEventSeed = Math.random()
      }
      let perVoiceSeed = e.voice || 0
      seed = (state.perParseSeed + e.perEventSeed + perVoiceSeed)*999999
    }
    let r = xmur3(b - seed) / 4294967296
    let arr = (typeof args === 'object' && args.value) || args
    if (Array.isArray(arr)) { // Aggregator: index chord using random value
      return arr[Math.floor(r*arr.length)]
    }
    return r // Not aggregator: just return random value
  }
  rand.isDirectFunction = true
  rand._isAggregator = true
  addVarFunction('rand', rand)

  // TESTS // - Tests for rand function are in parse-expression

  return rand
})
  