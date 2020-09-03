'use strict'
define((require) => {
  let players = require('player/players')
  let playerTypes = require('player/player-types')

  let parsePlayer = (line) => {
    let parts = line.split(/(\s+)/).map(p => p.trim()).filter(p => p != '')
    let playerId = parts[0].toLowerCase()
    if (playerId) {
      let playerName = parts[1]
      if (!playerName) { throw 'Missing player name' }
      if (playerName) {
        let command  = parts.slice(2).join('').trim()
        if (!command) { throw 'Player "'+playerName+'" Missing pattern/params' }
        let player = playerTypes[playerName.toLowerCase()]
        if (!player) { throw 'Player "'+playerName+'" not found' }
        players.instances[playerId] = player(command)
      } else {
        delete players.instances[playerId]
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

  parsePlayer('p play xo, amp=2')
  assert('function', typeof players.instances.p.getEventsForBeat)
  assert('function', typeof players.instances.p.play)
  assert(2, players.instances.p.getEventsForBeat({count:0})[0].amp)
  delete players.instances.p

  parsePlayer('p play xo,// amp=2')
  assert(undefined, players.instances.p.getEventsForBeat({count:0})[0].amp)
  delete players.instances.p

  parsePlayer('p play 0//, amp=2')
  assert(undefined, players.instances.p.getEventsForBeat({count:0})[0].amp)
  assert('0', players.instances.p.getEventsForBeat({count:1})[0].value)
  delete players.instances.p

  parsePlayer('p play 0, window//, amp=2')
  assert(undefined, players.instances.p.getEventsForBeat({count:0})[0].amp)
  assert(1, players.instances.p.getEventsForBeat({count:0})[0].window)
  delete players.instances.p

  assertThrows('Missing player name', ()=>parsePlayer('p'))
  assertThrows('Missing pattern/params', ()=>parsePlayer('p play'))
  assertThrows('Player "INVALID" not found', ()=>parsePlayer('p INVALID xo'))

  console.log('Parse player tests complete')

  return parsePlayer
})
