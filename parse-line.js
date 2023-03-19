'use strict'
define((require) => {
  let players = require('player/players')
  let playerTypes = require('player/player-types')
  var parsePlayer = require('player/parse-player')
  let buses = require('play/bus/buses')
  var parseBus = require('play/bus/parse-bus')
  var parseParams = require('player/params')
  let parseExpression = require('expression/parse-expression')
  let {combineOverrides,applyOverrides,isOverride} = require('player/override-params')
  let setVar = require('vars').set
  let mainVars = require('main-vars')
  let getInclude = require('includes')

  let identifierWithWildcards = (state) => {
    let char
    let result = ''
    while (char = state.str.charAt(state.idx).toLowerCase()) {
      if ((char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') || char === '_' || char == '*' || char == '!') {
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
      if (char == '(' || char == ',') {
        state.idx += 1
        eatWhitespace(state)
        let v = identifierWithWildcards(state)
        if (v !== undefined) { result.push(v) }
        eatWhitespace(state)
      } else if (char == ')') {
        state.idx += 1
        break
      } else {
        return undefined
      }
    }
    return result
  }

  let splitOnAll = (str, ch) => {
    if (!str) { return [] }
    return str.split(ch).map(x => x.trim()).filter(x => x!=ch)
  }
  let splitOnFirst = (str, ch) => {
    if (!str) { return [] }
    let parts = splitOnAll(str, ch)
    return [parts[0], parts.slice(1).join()]
  }

  let parseLine = async (line, linenum, parseCode, suppressLogs) => {
    line = line.trim()
    if (!line) { return }
    if (startsWithInclude(line)) {
      // Include external limut source file
      let url = line.trim().slice(7).trim().replace(/^'/, '').replace(/'$/, '')
      let code = await getInclude(url, suppressLogs)
      await parseCode(code)
      return
    }
    if (startsWithSet(line)) {
      line = line.slice(4).trim()
      // Set global vars and settings
      let [k,v] = line.split('=').map(p => p.trim()).filter(p => p != '')
      k = k.toLowerCase()
      if (k.match(/^[a-z][a-z0-9_\.]*$/) && !!v) {
        if (mainVars.exists(k)) {
          mainVars.set(k, parseExpression(v, undefined, k))
        } else {
          v = parseExpression(v, undefined, k)
          setVar(k, v)
        }
        return
      }
      // Set (override) params for a player
      let state = { str: line, idx: 0 }
      let playerIds
      if (state.str[0] == '(') {
        playerIds = parsePlayerIds(state).map(id=>id.trim())
      } else {
        playerIds = [identifierWithWildcards(state)]
      }
      let params = parseParams(state.str.slice(state.idx).trim(), undefined, playerIds.join(','))
      for (let k in params) { if (k.includes('.')) { throw 'Invalid param name '+k } }
      playerIds.forEach(playerId => {
        players.overrides[playerId] = combineOverrides(players.overrides[playerId] || {}, params)
      })
      return
    }
    if (startsWithPreset(line)) {
      line = line.slice(7).trim()
      // Create a named synth preset based on a preexisting synth
      let [preset, params] = splitOnFirst(line, ',')
      let parts = preset.split(/(\s+)/).map(p => p.trim()).filter(p => p != '')
      let presetName = parts[0].toLowerCase()
      let baseType = parts[1].toLowerCase()
      if (!baseType) { throw `Missing base type for preset ${presetName}` }
      if (playerTypes[baseType] === undefined) { throw `Invalid base type ${baseType} for preset ${presetName}` }
      playerTypes[presetName] = {
        play: playerTypes[baseType].play,
      }
      let baseBaseParams = playerTypes[baseType].baseParams || {}
      playerTypes[presetName].baseParams = applyOverrides(baseBaseParams, parseParams(params))
      return
    }
    // Define a bus
    if (startsWithBus(line)) {
      let bus = parseBus(line, linenum)
      if (bus) {
        buses.instances[bus.id] = bus
        buses.gc_mark(bus.id)
      }
      return
    }
    // Define a player
    let player = parsePlayer(line, linenum)
    if (player) {
      let oldPlayer = players.instances[player.id] || {}
      for (let k in oldPlayer) {
        if (player[k] === undefined) {
          player[k] = oldPlayer[k]
        }
      }
      players.instances[player.id] = player
      players.gc_mark(player.id)
    }
    return
  }

  let startsWithInclude = (str) => {
    let r = new RegExp(/^\s*include\s+/, 'i')
    return r.test(str)
  }

  let startsWithSet = (str) => {
    let r = new RegExp(/^\s*set\s+[\(\*\w\!]+/, 'i')
    return r.test(str)
  }

  let startsWithPreset = (str) => {
    let r = new RegExp(/^\s*preset\s+\w+\s+\w+/, 'i')
    return r.test(str)
  }

  let startsWithBus = (str) => {
    let r = new RegExp(/^\s*bus\s+\w+\s*,?(\s+|$)/, 'i')
    return r.test(str)
  }

  let startsWithPlayer = (str) => {
    let r = new RegExp(/^\s*\w+\s+\w+\s+[^\s,]+/, 'i')
    return r.test(str)
  }

  let isLineStart = (str) => {
    if (startsWithInclude(str)) { return true }
    if (startsWithSet(str)) { return true }
    if (startsWithPreset(str)) { return true }
    if (startsWithBus(str)) { return true }
    if (startsWithPlayer(str)) { return true }
    return false
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

  let assert = (expected, actual) => {
    let x = JSON.stringify(expected, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
    let a = JSON.stringify(actual, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
  }
  let assertThrows = async (expected, code) => {
    let got
    try {await code()}
    catch (e) { if (e.includes(expected)) {got=true} else {console.trace(`Assertion failed.\n>>Expected throw: ${expected}\n>>Actual: ${e}`)} }
    finally { if (!got) console.trace(`Assertion failed.\n>>Expected throw: ${expected}\n>>Actual: none` ) }
  }
  let vars = require('vars').all()

  assert(false, isLineStart('foo bar'))
  assert(false, isLineStart('set '))
  assert(false, isLineStart('set\t'))
  assert(true, isLineStart('set p'))
  assert(true, isLineStart('set p '))
  assert(true, isLineStart('set\tp'))
  assert(true, isLineStart('set p1'))
  assert(true, isLineStart('set !p'))
  assert(true, isLineStart('set *'))
  assert(true, isLineStart('set ( p , a* ) '))
  assert(true, isLineStart('SET P'))
  assert(false, isLineStart('sett '))
  assert(false, isLineStart('p ping'))
  assert(false, isLineStart('p ping '))
  assert(false, isLineStart('p ping ,'))
  assert(true, isLineStart('p ping !0'))
  assert(true, isLineStart('p ping !0,'))
  assert(true, isLineStart('p ping !0 ,'))
  assert(true, isLineStart('p\t\tping\t\t!0'))
  assert(true, isLineStart('preset p b'))
  assert(true, isLineStart(' PRESET P b'))
  assert(true, isLineStart('preset p b '))
  assert(true, isLineStart('preset\tp b'))
  assert(true, isLineStart('preset p1 b1'))
  assert(false, isLineStart('presett p'))
  assert(false, isLineStart('include'))
  assert(false, isLineStart('includetest'))
  assert(true, isLineStart('include blah'))
  assert(true, isLineStart('iNCLUDe blah'))
  assert(true, isLineStart('bus b'))
  assert(true, isLineStart(' bus b '))
  assert(true, isLineStart('bus b amp=1, lpf=200'))
  assert(true, isLineStart('bus b, amp=1, lpf=200'))
  assert(true, isLineStart('BUS B'))
  assert(false, isLineStart('bus b+'))
  assert(false, isLineStart('bus, b,'))
  assert(false, isLineStart('buss b'))

  parseLine('')
  parseLine('')

  parseLine('SET FOO=1+1')
  assert(2, vars.foo)
  delete vars.foo

  parseLine('set foo=1+1')
  assert(2, vars.foo)
  delete vars.foo

  parseLine("set foo='http://a.com/Bc.mp3'")
  assert('http://a.com/Bc.mp3', vars.foo)
  delete vars.foo

  parseLine(' \tset foo = 1 + 2 ')
  assert(3, vars.foo)
  delete vars.foo

  parseLine('p play xo, amp=2')
  assert('function', typeof players.instances.p.getEventsForBeat)
  assert('function', typeof players.instances.p.play)
  assert(2, players.instances.p.getEventsForBeat({count:0})[0].amp)
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

  parseLine('set p* add=2')
  assert(2, players.overrides['p*'].add)
  delete players.overrides['p*']

  parseLine('set * add=2')
  assert(2, players.overrides['*'].add)
  delete players.overrides['*']

  parseLine(' set ( p , q ) amp = 2 ')
  assert(2, players.overrides.p.amp)
  assert(2, players.overrides.q.amp)
  delete players.overrides.p
  delete players.overrides.q

  parseLine(' set ( p1 , q* ) amp = 2 ')
  assert(2, players.overrides.p1.amp)
  assert(2, players.overrides['q*'].amp)
  delete players.overrides.p1
  delete players.overrides['q*']

  parseLine(' set !p amp = 2 ')
  assert(2, players.overrides['!p'].amp)
  delete players.overrides['!p']

  parseLine(' set ( p1 , !p ) amp = 2 ')
  assert(2, players.overrides.p1.amp)
  assert(2, players.overrides['!p'].amp)
  delete players.overrides.p1
  delete players.overrides['!p']

  parseLine('set p add+=2')
  assert(true, isOverride(players.overrides.p.add))
  assert({add:5}, applyOverrides({add:3}, players.overrides.p))
  delete players.overrides.p

  parseLine('set p add+=2')
  parseLine('set p add+=3')
  assert({add:9}, applyOverrides({add:4}, players.overrides.p))
  delete players.overrides.p

  parseLine('set p add=2')
  assert({add:2}, applyOverrides({add:4}, players.overrides.p))
  delete players.overrides.p

  assertThrows('Invalid base', async () => parseLine('preset a b'))

  parseLine('preset foo readout')
  assert(playerTypes.readout.play, playerTypes.foo.play)
  delete playerTypes.foo

  parseLine('preset foo readout, add=2')
  assert(2, playerTypes.foo.baseParams.add)
  delete playerTypes.foo

  parseLine('preset foo readout, a=2, b=3')
  assert(2, playerTypes.foo.baseParams.a)
  assert(3, playerTypes.foo.baseParams.b)
  delete playerTypes.foo

  parseLine('preset myro readout, add=4')
  parseLine('r1 readout 0, add=2')
  parseLine('r2 myro follow r1, add+=1')
  assert(5, players.instances.r2.getEventsForBeat({count:0})[0].add) // follow player's preset should win over the player being followed
  delete players.instances.r1
  delete players.instances.r2
  delete playerTypes.myro

  parseLine('preset myp play')
  parseLine('lp myp 0')
  assert(1/2, players.instances.lp.getEventsForBeat({count:0})[0].dur)
  delete players.instances.lp
  delete playerTypes.myp

  parseLine('preset myro readout, add=4')
  parseLine('preset myro2 myro')
  parseLine('r myro2 0, add+=1')
  assert(5, players.instances.r.getEventsForBeat({count:0})[0].add)
  delete players.instances.r
  delete playerTypes.myro2
  delete playerTypes.myro

  parseLine('preset myro readout, add=4')
  parseLine('preset myro2 myro, add=2')
  parseLine('r myro2 0, add+=1')
  assert(3, players.instances.r.getEventsForBeat({count:0})[0].add)
  delete players.instances.r
  delete playerTypes.myro2
  delete playerTypes.myro

  parseLine('preset myro readout, add=4')
  parseLine('preset myro2 myro, add+=2')
  parseLine('r myro2 0, add+=1')
  assert(7, players.instances.r.getEventsForBeat({count:0})[0].add)
  delete players.instances.r
  delete playerTypes.myro2
  delete playerTypes.myro

  let included
  parseLine("include 'preset/test.limut'", 0, (l) => included=l, true)
    .then(() => { assert('includetest preset none', included) })

  parseLine('bus b')
  assert('b', buses.instances.b.id)
  delete buses.instances.b

  console.log('Parse line tests complete')
  }

  return {
    parseLine:parseLine,
    isLineStart:isLineStart,
  }
})
