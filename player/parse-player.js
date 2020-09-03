'use strict'
define((require) => {
  let playerTypes = require('player/player-types')

  let parsePlayer = (line) => {
    let parts = line.split(/(\s+)/).map(p => p.trim()).filter(p => p != '')
    let playerId = parts[0].toLowerCase()
    if (playerId) {
      let playerType = parts[1]
      if (!playerType) { throw 'Missing player type' }
      if (playerType) {
        let command  = parts.slice(2).join('').trim()
        if (!command) { throw 'Player "'+playerType+'" Missing pattern/params' }
        let playerFactory = playerTypes[playerType.toLowerCase()]
        if (!playerFactory) { throw 'Player "'+playerType+'" not found' }
        let player = playerFactory(command)
        player.id = playerId
        player.type = playerType
        return player
      }
    }
  }

  // TESTS //

  let assert = (expected, actual) => {
    let x = JSON.stringify(expected, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
    let a = JSON.stringify(actual, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
  }
  let assertThrows = (expected, code) => {
    let got
    try {code()}
    catch (e) { if (e.includes(expected)) {got=true} else {console.trace(`Assertion failed.\n>>Expected throw: ${expected}\n>>Actual: ${e}`)} }
    finally { if (!got) console.trace(`Assertion failed.\n>>Expected throw: ${expected}\n>>Actual: none` ) }
  }
  let p

  p = parsePlayer('p play xo, amp=2')
  assert('p', p.id)
  assert('function', typeof p.getEventsForBeat)
  assert('function', typeof p.play)
  assert(2, p.getEventsForBeat({count:0})[0].amp)
  
  p = parsePlayer('p play xo,// amp=2')
  assert(undefined, p.getEventsForBeat({count:0})[0].amp)

  p = parsePlayer('p play 0//, amp=2')
  assert(undefined, p.getEventsForBeat({count:0})[0].amp)
  assert('0', p.getEventsForBeat({count:1})[0].value)

  p = parsePlayer('p play 0, window//, amp=2')
  assert(undefined, p.getEventsForBeat({count:0})[0].amp)
  assert(1, p.getEventsForBeat({count:0})[0].window)

  assertThrows('Missing player type', ()=>parsePlayer('p'))
  assertThrows('Missing pattern/params', ()=>parsePlayer('p play'))
  assertThrows('Player "INVALID" not found', ()=>parsePlayer('p INVALID xo'))

  console.log('Parse player tests complete')

  return parsePlayer
})
