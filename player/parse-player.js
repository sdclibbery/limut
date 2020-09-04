'use strict'
define((require) => {
  let playerTypes = require('player/player-types')
  var parseParams = require('player/params')
  var overrideParams = require('player/override-params')
  var players = require('player/players')
  let standardPlayer = require('player/standard')
  var followPlayer = require('player/follow')

  let splitOnAll = (str, ch) => {
    if (!str) { return [] }
    return str.split(ch).map(x => x.trim()).filter(x => x!=ch)
  }

  let splitOnFirst = (str, ch) => {
    if (!str) { return [] }
    let parts = splitOnAll(str, ch)
    return [parts[0], parts.slice(1).join()]
  }

  let parsePlayer = (line) => {
    let parts = line.split(/(\s+)/).map(p => p.trim()).filter(p => p != '')
    let playerId = parts[0].toLowerCase()
    if (playerId) {
      let playerType = parts[1]
      if (!playerType) { throw 'Missing player type' }
      if (playerType) {
        let command  = parts.slice(2).join('').trim()
        if (!command) { throw 'Player "'+playerType+'" Missing pattern/params' }
        let [patternStr, paramsStr] = splitOnFirst(command, ',').map(s => s.trim())
        // All params commented out?
        if (patternStr.endsWith('//')) {
          paramsStr = ''
          patternStr = patternStr.slice(0, -2).trim()
        }
        // Create player
        let playerFactory = playerTypes[playerType.toLowerCase()]
        if (!playerFactory) { throw 'Player "'+playerType+'" not found' }
        let play = (es) => es.filter(e => e.amp === undefined || e.amp > 0).map(e => playerFactory.play(e))
        let player = {
          play: play,
          id: playerId,
          type: playerType,
        }
        let getEventsForBeat
        if (patternStr.startsWith('follow')) {
          // Follow player
          let params = parseParams(paramsStr)
          getEventsForBeat = followPlayer(patternStr.slice(6).trim(), params)
        } else if (playerFactory.stopped) {
          getEventsForBeat = () => []
        } else {
          getEventsForBeat = standardPlayer(patternStr, paramsStr, playerFactory.defaultDur)
        }
        // override event params
        player.getEventsForBeat = (beat) => {
          let events = getEventsForBeat(beat)
          let overrides = players.overrides[player.id] || {}
          return overrideParams(events, overrides)
        }
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
