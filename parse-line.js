'use strict'
define((require) => {
  let players = require('player/players')
  var parsePlayer = require('player/parse-player')
  var parseParams = require('player/params')
  let parseExpression = require('player/parse-expression')
  let overrideParams = require('player/override-params').overrideParams
  let vars = require('vars')
  let mainVars = require('main-vars')

  let identifier = (state) => {
    let char
    let result = ''
    while (char = state.str.charAt(state.idx).toLowerCase()) {
      if ((char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') || char === '_') {
        result += char
        state.idx += 1
        continue
      }
      break
    }
    return result
  }
  let eatWhitespace = (state) => {
    let char
    while (char = state.str.charAt(state.idx)) {
      if (char === ' ' || char === '\t' || char === '\n' || char === '\r') { state.idx += 1; continue }
      break
    }
  }
  let parsePlayerIds = (state) => {
    let result = []
    let char
    while (char = state.str.charAt(state.idx)) {
      eatWhitespace(state)
      if (char == '[' || char == ',') {
        state.idx += 1
        eatWhitespace(state)
        let v = identifier(state)
        if (v !== undefined) { result.push(v) }
        eatWhitespace(state)
      } else if (char == ']') {
        state.idx += 1
        break
      } else {
        return undefined
      }
    }
    return result
  }

  let parseLine = (line, linenum) => {
    line = line.trim()
    if (!line) { return }
    if (line.startsWith('//')) { return }
    // Setting global vars
    let [k,v] = line.split('=').map(p => p.trim()).filter(p => p != '')
    k = k.toLowerCase()
    if (k.match(/^[a-z][a-z0-9_\.]*$/) && !!v) {
      if (mainVars.exists(k)) {
        mainVars.set(k, parseExpression(v))
      } else {
        v = parseExpression(v)
        vars[k] = v
      }
      return
    }
    // Set (override) params for a player
    if (line.startsWith('set ')) {
      let state = { str: line.slice(4).trim(), idx: 0 }
      let playerIds
      if (state.str[0] == '[') {
        playerIds = parsePlayerIds(state).map(id=>id.trim())
      } else {
        playerIds = [identifier(state)]
      }
      let params = parseParams(state.str.slice(state.idx).trim())
      playerIds.forEach(playerId => {
        players.overrides[playerId] = overrideParams(players.overrides[playerId] || {}, params)
      })
      return
    }
    // Define a player
    let player = parsePlayer(line, linenum)
    if (player) {
      players.instances[player.id] = player
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

  parseLine('')

  parseLine('foo=1+1')
  assert(2, vars.foo)
  delete vars.foo

  parseLine('//foo=1+1')
  assert(undefined, vars.foo)

  parseLine('// foo=1+1')
  assert(undefined, vars.foo)

  parseLine('  //foo=1+1  ')
  assert(undefined, vars.foo)

  parseLine('foo=1//+1')
  assert(1, vars.foo)
  delete vars.foo

  parseLine('foo=1 // +1')
  assert(1, vars.foo)
  delete vars.foo

  parseLine("foo='http://a.com/Bc.mp3'")
  assert('http://a.com/Bc.mp3', vars.foo)
  delete vars.foo

  parseLine("foo='http://a.com/Bc.mp3'// BLAH")
  assert('http://a.com/Bc.mp3', vars.foo)
  delete vars.foo

  parseLine(' \tfoo = 1 + 2 ')
  assert(3, vars.foo)
  delete vars.foo

  parseLine('p play xo, amp=2')
  assert('function', typeof players.instances.p.getEventsForBeat)
  assert('function', typeof players.instances.p.play)
  assert(2, players.instances.p.getEventsForBeat({count:0})[0].amp)
  delete players.instances.p

  parseLine('p play xo,// amp=2')
  assert(undefined, players.instances.p.getEventsForBeat({count:0})[0].amp)
  delete players.instances.p

  parseLine('p play 0//, amp=2')
  assert(undefined, players.instances.p.getEventsForBeat({count:0})[0].amp)
  assert('0', players.instances.p.getEventsForBeat({count:1})[0].value)
  delete players.instances.p

  parseLine('p play 0, window//, amp=2')
  assert(undefined, players.instances.p.getEventsForBeat({count:0})[0].amp)
  assert(1, players.instances.p.getEventsForBeat({count:0})[0].window)
  delete players.instances.p

  parseLine('set p amp=2')
  assert(2, players.overrides.p.amp)
  delete players.overrides.p

  parseLine('set p amp=2')
  parseLine('set p amp=3')
  assert(3, players.overrides.p.amp)
  delete players.overrides.p

  parseLine('set p amp=2')
  parseLine('set p lpf=300')
  assert(2, players.overrides.p.amp)
  assert(300, players.overrides.p.lpf)
  delete players.overrides.p

  parseLine('set p add=2')
  parseLine('set p add=3')
  assert(5, players.overrides.p.add)
  delete players.overrides.p

  parseLine(' set [ p , q ] amp = 2 ')
  assert(2, players.overrides.p.amp)
  assert(2, players.overrides.q.amp)
  delete players.overrides.p
  delete players.overrides.q

  console.log('Parse line tests complete')

  return parseLine
})
