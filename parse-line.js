'use strict'
define((require) => {
  let players = require('player/players')
  let playerTypes = require('player/player-types')
  var parsePlayer = require('player/parse-player')
  var parseParams = require('player/params')
  let parseExpression = require('expression/parse-expression')
  let {combineOverrides,applyOverrides,isOverride} = require('player/override-params')
  let vars = require('vars')
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
    return [parts[0], parts.slice(1).join(ch)]
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
      let [k,v] = splitOnFirst(line, '=')
      k = k.toLowerCase()
      if (k.match(/^[a-z][a-z0-9_\.]*$/) && !!v) {
        if (mainVars.exists(k)) {
          mainVars.set(k, parseExpression(v, undefined, k)) // For main vars the dot is part of the var name, eg "beat.readouts"
        } else {
          v = parseExpression(v, undefined, k)
          let [ns,nsk] = splitOnFirst(k, '.') // For other vars, a dot implies a namespace
          if (nsk) {
            if (vars.get(ns) === undefined) { vars.set(ns, {}) } // Create empty object for namespace if needed
            let namespace = vars.get(ns)
            if (typeof namespace !== 'object' && typeof namespace !== 'function') { throw `Invalid namespace '${ns}' type '${typeof namespace}' when trying to set namespace field '${nsk}'` }
            namespace[nsk] = v
          } else {
            vars.set(k, v)
          }
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
        create: playerTypes[baseType].create,
      }
      let baseBaseParams = playerTypes[baseType].baseParams || {}
      playerTypes[presetName].baseParams = applyOverrides(baseBaseParams, parseParams(params))
      return
    }
    // Define a player
    let player = parsePlayer(line, linenum)
    if (player) {
      let oldPlayer = players.instances[player.id]
      if (oldPlayer) {
        player.keepState = oldPlayer.keepState // Copy the state that should be maintained on code update
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
    let r = new RegExp(/^\s*preset\s+[_a-zA-Z]\w*\s+[_a-zA-Z]\w*/, 'i')
    return r.test(str)
  }

  let startsWithPlayer = (str) => {
    let r = new RegExp(/^\s*[_a-zA-Z]\w*\s+[_a-zA-Z]\w*/, 'i')
    return r.test(str)
  }

  let isLineStart = (str) => {
    if (startsWithInclude(str)) { return true }
    if (startsWithSet(str)) { return true }
    if (startsWithPreset(str)) { return true }
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
  let {evalParamFrame} = require('player/eval-param')
  let ev = (i,c,d) => {return{idx:i, count:c, dur:d, _time:c, endTime:c+d, countToTime:x=>x}}
  let v

  assert(true, isLineStart('foo bar'))
  assert(false, isLineStart('set '))
  assert(false, isLineStart('set\t'))
  assert(true, isLineStart('set p'))
  assert(true, isLineStart(' set p '))
  assert(true, isLineStart('set\tp'))
  assert(true, isLineStart('set p1'))
  assert(true, isLineStart('set !p'))
  assert(true, isLineStart('set *'))
  assert(true, isLineStart('set ( p , a* ) '))
  assert(true, isLineStart('SET P'))
  assert(false, isLineStart('sett '))
  assert(true, isLineStart('p ping'))
  assert(true, isLineStart('_p _ping'))
  assert(true, isLineStart('p_ ping_'))
  assert(true, isLineStart('_p2 _ping2'))
  assert(true, isLineStart('p2_ ping2_'))
  assert(true, isLineStart('p ping '))
  assert(true, isLineStart('p ping,'))
  assert(true, isLineStart('p ping ,'))
  assert(true, isLineStart('p ping !0'))
  assert(true, isLineStart('p ping !0,'))
  assert(true, isLineStart('p ping !0 ,'))
  assert(true, isLineStart(' p ping !0 ,'))
  assert(true, isLineStart('p\t\tping\t\t!0'))
  assert(false, isLineStart('p 2p'))
  assert(false, isLineStart('2p p'))
  assert(true, isLineStart('preset p b'))
  assert(true, isLineStart(' PRESET P b'))
  assert(true, isLineStart('preset p b '))
  assert(true, isLineStart('preset\tp b'))
  assert(true, isLineStart('preset p1 b1'))
  assert(true, isLineStart('presett p')) // Treated as a line start for a player
  assert(false, isLineStart('preset 2p b'))
  assert(false, isLineStart('include'))
  assert(false, isLineStart('includetest'))
  assert(true, isLineStart('include blah'))
  assert(true, isLineStart('iNCLUDe blah'))

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

  parseLine(' set !p* amp = 2 ')
  assert(2, players.overrides['!p*'].amp)
  delete players.overrides['!p*']

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

  parseLine('r1 test 1')
  parseLine('r2 test follow r1')
  assert(1, players.instances.r2.getEventsForBeat({count:0})[0].value)
  delete players.instances.r1
  delete players.instances.r2

  parseLine('preset myro test, amp=4')
  parseLine('r1 test 0, amp=2')
  parseLine('r2 myro follow r1, amp+=1')
  assert(5, players.instances.r2.getEventsForBeat({count:0})[0].amp) // follow player's preset should win over the player being followed
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

  parseLine('r readout, add=({}->1){}')
  assert(1, evalParamFrame(players.instances.r.getEventsForBeat({count:0})[0].add, ev(),0))
  delete players.instances.r

  parseLine('set foo={value}->value*2')
  parseLine('r readout, add=foo{3}')
  assert(6, evalParamFrame(players.instances.r.getEventsForBeat({count:0})[0].add, ev(),0))
  delete players.instances.r
  delete vars.foo

  parseLine('set foo=1<2'); assert(1, evalParamFrame(vars.foo, ev(),0))
  parseLine('set foo=3<2'); assert(0, evalParamFrame(vars.foo, ev(),0))
  parseLine('set foo=1<=2'); assert(1, evalParamFrame(vars.foo, ev(),0))
  parseLine('set foo=3<=2'); assert(0, evalParamFrame(vars.foo, ev(),0))
  parseLine('set foo=1==2'); assert(0, evalParamFrame(vars.foo, ev(),0))
  parseLine('set foo=2==2'); assert(1, evalParamFrame(vars.foo, ev(),0))
  parseLine('set foo=3==2'); assert(0, evalParamFrame(vars.foo, ev(),0))
  parseLine('set foo=1!=2'); assert(1, evalParamFrame(vars.foo, ev(),0))
  parseLine('set foo=2!=2'); assert(0, evalParamFrame(vars.foo, ev(),0))
  parseLine('set foo=3!=2'); assert(1, evalParamFrame(vars.foo, ev(),0))
  delete vars.foo

  parseLine('set foo={}')
  parseLine('set foo.bar=7')
  assert(7, evalParamFrame(vars.foo.bar, ev(),0))
  delete vars.foo

  parseLine('set foo=0')
  assertThrows("Invalid namespace", () => parseLine('set foo.bar=7'))
  delete vars.foo

  parseLine('set foo={}=>5')
  parseLine('set foo.bar=7')
  assert(7, evalParamFrame(vars.foo.bar, ev(),0))
  delete vars.foo

  parseLine('set foo.bar=7')
  assert(7, evalParamFrame(vars.foo.bar, ev(),0))
  delete vars.foo

  parseLine('preset myp play, fx=2')
  parseLine('lp myp 0, fx+=3')
  assert(5, players.instances.lp.getEventsForBeat({count:0})[0].fx)
  assert('2+3', players.instances.lp.getEventsForBeat({count:0})[0]._fxString)
  delete players.instances.lp
  delete playerTypes.myp

  parseLine('preset myp play, fx=2')
  parseLine('lp myp 0, fx=3')
  assert(3, players.instances.lp.getEventsForBeat({count:0})[0].fx)
  assert('3', players.instances.lp.getEventsForBeat({count:0})[0]._fxString)
  delete players.instances.lp
  delete playerTypes.myp

  let included
  parseLine("include 'preset/test.limut'", 0, (l) => included=l, true)
    .then(() => { assert('includetest preset none', included) })

  console.log('Parse line tests complete')
  }

  return {
    parseLine:parseLine,
    isLineStart:isLineStart,
  }
})
