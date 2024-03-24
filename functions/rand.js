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
    if (state.perParseSeed === undefined) {
        state.perParseSeed = Math.random()
    }
    let seed = args && args.seed
    if (seed === undefined) { seed = state.perParseSeed*999999 }
    return xmur3(b - seed) / 4294967296
  }
  rand.isDirectFunction = true
  addVarFunction('rand', rand)

  // TESTS // - Tests for rand function are in parse-expression

  return rand
})
  