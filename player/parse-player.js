'use strict'
define((require) => {
  let playerTypes = require('player/player-types')
  var player = require('player/player')
  let eatWhitespace = require('expression/eat-whitespace')

  let parseIdentifier = (state) => {
    let result = ''
    let char
    while (char = state.str.charAt(state.idx)) {
      if (char === '' || char === ',') { break }
      if (char.match(/\w/)) {
        result += char
        state.idx += 1
        continue
      }
      if (char.match(/\s/)) { // Valid end on whitespace
        state.idx += 1
        break
      }
      result += char
      throw `Invalid player id or type "${result}"` // Any other char is invalid
    }
    return result
  }

  let parsePatternStr = (state) => {
    let result = ''
    let char
    while (char = state.str.charAt(state.idx)) {
      if (char === '' || char === ',') { // Valid end of pattern
        state.idx += 1
        break
      }
      result += char
      state.idx += 1
    }
    return result
  }

  let parsePlayer = (line, linenum) => {
    let state = {
      str: line.trim(),
      idx: 0,
    }
    let playerId = parseIdentifier(state)
    if (!playerId) { throw 'Missing player id' }
    eatWhitespace(state)
    let playerType = parseIdentifier(state)
    if (!playerType) { throw 'Missing player type' }
    eatWhitespace(state)
    let patternStr = parsePatternStr(state)
    eatWhitespace(state)
    let paramsStr = state.str.slice(state.idx) // The rest of the string is the params
    return player(playerId, playerType, patternStr, paramsStr, linenum)
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

  let assert = (expected, actual, msg) => {
    let x = JSON.stringify(expected, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(3) : v)
    let a = JSON.stringify(actual, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(3) : v)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}${msg?'\n'+msg:''}`) }
  }
  let assertHas = (expected, actual) => {
    for (let k in expected) {
      assert(expected[k], actual[k], `for ${k}`)
    }
  }
  let assertThrows = (expected, code) => {
    let got
    try {code()}
    catch (e) { if (e.includes(expected)) {got=true} else {console.trace(`Assertion failed.\n>>Expected throw: ${expected}\n>>Actual: ${e}`)} }
    finally { if (!got) console.trace(`Assertion failed.\n>>Expected throw: ${expected}\n>>Actual: none` ) }
  }
  let p,es

  assertThrows('Missing player id', ()=>parsePlayer(''))
  assertThrows('Missing player type', ()=>parsePlayer('p'))
  assertThrows('Player type "INVALID" not found', ()=>parsePlayer('p INVALID xo'))
  assertThrows('Invalid player id or type "p."', ()=>parsePlayer('p.p play 0'))
  assertThrows('Missing player type', ()=>parsePlayer('p, play 0'))
  assertThrows('Invalid player id or type "pl."', ()=>parsePlayer('p pl.ay 0'))

  p = parsePlayer('p test xo, amp=2')
  assert('p', p.id)
  assert('function', typeof p.getEventsForBeat)
  assert('function', typeof p.play)
  assert(2, p.getEventsForBeat({count:0})[0].amp)

  p = parsePlayer('p test')
  assert(0, p.getEventsForBeat({count:0})[0].value)

  p = parsePlayer('p test, amp=2')
  assert(2, p.getEventsForBeat({count:0})[0].amp)

  p = parsePlayer('p test 0, amp=2')
  p.play(p.getEventsForBeat({time:0, count:0, duration:1}))
  assert(2, p.currentEvent(0)[0].amp)
  
  p = parsePlayer('p test 0 , amp = 2 ')
  p.play(p.getEventsForBeat({time:0, count:0, duration:1}))
  assert(2, p.currentEvent(0)[0].amp)
  
  p = parsePlayer("p test 0, foo='a b  c'")
  p.play(p.getEventsForBeat({time:0, count:0, duration:1}))
  assert('a b  c', p.currentEvent(0)[0].foo)
  
  p = parsePlayer('p test a, add=(1,2)')
  es = p.getEventsForBeat({time:0, count:0, duration:1})
  assertHas({add:1,voice:0}, es[0])
  assertHas({add:2,voice:1}, es[1])

  p = parsePlayer('p test [aa], add=(1,2)')
  es = p.getEventsForBeat({time:0, count:0, duration:1})
  assertHas({add:1,voice:0}, es[0])
  assertHas({add:2,voice:1}, es[1])
  assertHas({add:1,voice:0}, es[2])
  assertHas({add:2,voice:1}, es[3])

  p = parsePlayer('p test (ab), add=(1,2)')
  es = p.getEventsForBeat({time:0, count:0, duration:1})
  assertHas({value:'a',add:1,voice:0}, es[0])
  assertHas({value:'a',add:2,voice:1}, es[1])
  assertHas({value:'b',add:1,voice:2}, es[2])
  assertHas({value:'b',add:2,voice:3}, es[3])

  p = parsePlayer('p test (a(bc))')
  es = p.getEventsForBeat({time:0, count:0, duration:1})
  assertHas({value:'a',voice:0}, es[0])
  assertHas({value:'b',voice:1}, es[1])
  assertHas({value:'c',voice:2}, es[2])

  p = parsePlayer('p test (a[bc]), add=(1,2)')
  es = p.getEventsForBeat({time:0, count:0, duration:1})
  assertHas({value:'a',add:1,voice:0}, es[0])
  assertHas({value:'a',add:2,voice:1}, es[1])
  assertHas({value:'b',add:1,voice:2}, es[2])
  assertHas({value:'b',add:2,voice:3}, es[3])
  assertHas({value:'c',add:1,voice:0}, es[4]) // Voice here (and below) should really be 2 (and 3), but that's a lot more complicated
  assertHas({value:'c',add:2,voice:1}, es[5])

  console.log('Parse player tests complete')
  }
  
  return parsePlayer
})
