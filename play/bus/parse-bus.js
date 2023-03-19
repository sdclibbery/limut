'use strict'
define((require) => {
  var parseParams = require('player/params')
  var bus = require('play/bus/bus')

  let parseBus = (line, linenum) => {
    if (!line) { return }
    let match = [...line.matchAll(/bus\s+(\w+)\s*,?\s*(.*)/gmi)]
    if (!match[0]) { return }
    let parts = match[0].filter(p => p != '')
    let busId = parts[1].toLowerCase()
    if (busId) {
      if (busId.includes('.')) { throw 'Invalid bus name '+busId }
    }
    let params = parseParams(parts[2] || '', busId)
    return bus(busId, params)
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {
  let assert = (expected, actual, msg) => {
    let x = JSON.stringify(expected, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(3) : v)
    let a = JSON.stringify(actual, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(3) : v)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}${msg?'\n'+msg:''}`) }
  }

  assert(undefined, parseBus(''))
  assert(undefined, parseBus('b'))
  assert(undefined, parseBus('foo'))
  
  assert('b', parseBus('bus b').id)
  assert('b', parseBus('bus b amp').id)
  assert('b', parseBus('bus b, amp').id)
  assert('b4r', parseBus('bus b4r').id)
  assert('b4r', parseBus('bus b4r amp').id)
  assert('b4r', parseBus('bus b4r, amp').id)

  console.log('Parse bus tests complete')
  }

  return parseBus
})