'use strict'
define((require) => {
  let playerTypes = require('player/player-types')
  var parseParams = require('player/params')
  var {applyOverrides,applyOverridesInPlace} = require('player/override-params')
  var players = require('player/players')
  let standardPlayer = require('player/standard')
  var followPlayer = require('player/follow')
  var expandChords = require('player/expand-chords')
  let {preEvalParam,evalParamFrame} = require('player/eval-param')
  let {mainParam} = require('player/sub-param')

  let splitOnAll = (str, ch) => {
    if (!str) { return [] }
    return str.split(ch).map(x => x.trim()).filter(x => x!=ch)
  }

  let splitOnFirst = (str, ch) => {
    if (!str) { return [] }
    let parts = splitOnAll(str, ch)
    return [parts[0], parts.slice(1).join()]
  }

  let evalToEvent = (event, beat) => {
    for (let k in event) {
      event[k] = preEvalParam(event[k], event, beat.count)
    }
  }

  let swingPushAt = (count, swingPercent) => {
    let swingPeriod = 1/4
    let swingBeatFraction = (count % (swingPeriod*2)) / (swingPeriod*2)
    let maxSwingPush = (swingPercent - 50) / 50
    let lerp
    if (swingBeatFraction < 1/2) {
      lerp = swingBeatFraction*2
    } else {
      lerp = (1-swingBeatFraction)*2
    }
    return lerp*maxSwingPush/4
  }

  let applySwing = (event, beat) => {
    let swingPercent = evalParamFrame(event.swing || 50, event, event.count)
    if (swingPercent === 50) { return }
    let swingBeatPushAtStart = swingPushAt(event.count, swingPercent)
    let swingBeatPushAtEnd = swingPushAt(event.count+event.dur, swingPercent)
    event._time += swingBeatPushAtStart * beat.duration
    event.count += swingBeatPushAtStart
    event.dur += swingBeatPushAtEnd - swingBeatPushAtStart
  }

  let applyDelay = (event, beat) => {
    let dp = evalParamFrame(event.delay, event, event.count)
    let d = mainParam(dp, 0)
    event._time += d*beat.duration
    event.count += d
    applyOverridesInPlace(event, dp)
  }

  let expandStutter = (es) => {
    let result = []
    es.forEach(event => {
      let sp = evalParamFrame(event.stutter, event, event.count)
      let s = Math.max(Math.floor(mainParam(sp, 1)), 1)
      if (s == 1) {
        result.push(event)
        return
      }
      let dur = event.dur / s
      for (let i = 0; i < s; i++) {
        let e = Object.assign({}, event)
        e.dur = dur
        e.count += i*dur
        e._time += i*dur*event.beat.duration
        result.push(e)
      }
    })
    return result
  }

  let parsePlayer = (line, linenum) => {
    let parts = line.split(/(\s+)/).map(p => p.trim()).filter(p => p != '')
    let playerId = parts[0].toLowerCase()
    if (playerId) {
      if (playerId.includes('.')) { throw 'Invalid player name '+playerId }
      let playerType = parts[1]
      if (!playerType) { throw 'Missing player type' }
      if (playerType) {
        let command = line.replace(parts[0],'').replace(parts[1],'').trim()
        if (!command) { throw 'Player "'+playerType+'" Missing pattern/params' }
        let [patternStr, paramsStr] = splitOnFirst(command, ',').map(s => s.trim())
        // Create player
        let playerFactory = playerTypes[playerType.toLowerCase()]
        if (!playerFactory) { throw 'Player "'+playerType+'" not found' }
        let play = (es, beat) => {
          player.events ||= []
          player.events = player.events.filter(e => e.countToTime(beat.count) < e.endTime)
          return es
            .filter(e => e.amp === undefined || typeof e.amp === 'function' || e.amp > 0)
            .map(e => {
              playerFactory.play(e)
              e.countToTime = (count) => e.beat.time + (count-e.beat.count)*e.beat.duration
              e.pulse = (ev,b) => {
                let t = e.countToTime(b)
                if (t<e._time || t>e.endTime) { return 0 }
                let l = e.endTime - e._time
                let x = (t - e._time) / l
                let v = x < 1/5 ? x*5 : 1-(x*6/5-1/5)
                return Math.pow(v, 1/2)
              }
              player.events.push(e)
            })
        }
        let player = {
          play: play,
          id: playerId,
          type: playerType,
          dependsOn: [],
        }
        player.currentEvent = (b) => {
          let es = player.events
          if (!es) { return [] }
          es = es.filter(e => {
            let t = e.countToTime(b)
            let endTime = e._time + e.dur*e.beat.duration
            return (t > e._time-0.0001) && (t < endTime)
          })
          return es
        }
        let getEventsForBeat
        if (patternStr.startsWith('follow')) {
          // Follow player
          let params = parseParams(paramsStr, player.dependsOn, playerId)
          getEventsForBeat = followPlayer(patternStr.slice(6).trim(), params)
        } else if (playerFactory.stopped) {
          getEventsForBeat = () => []
        } else {
          getEventsForBeat = standardPlayer(patternStr, paramsStr, playerFactory.defaultDur, player)
        }
        let baseParams = playerFactory.baseParams
        player.getEventsForBeatBase = (beat) => {
          let events = getEventsForBeat(beat)
          if (baseParams) {
            events.forEach(e => {
              for (let k in baseParams) {
                if (e[k] === undefined) {
                  e[k] = baseParams[k]
                }
              }
            })
          }
          events.forEach(e => e.linenum = linenum)
          let overrides = players.overrides[player.id] || {}
          let es = events.map(e => applyOverrides(e, overrides))
          es.forEach(e => evalToEvent(e, beat)) // Optimisation: evaluate down to a primitive for values that don't change over the course of the event
          return es
        }
        player.getEventsForBeat = (beat) => {
          let es = player.getEventsForBeatBase(beat)
          es = expandChords(es)
          es.forEach(e => applyDelay(e, beat))
          es = expandStutter(es)
          es.forEach(e => applySwing(e, beat))
          return es
        }
        return player
      }
    }
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {
  let vars = require('vars')

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
  let p,e,es,p1,p2
  playerTypes.test = { play: (e) => {
    e.endTime = e._time + e.dur
    return {}
  } }
  let {evalParamFrame} = require('player/eval-param')
  let ev = (i,c,d) => {return{idx:i,count:c,dur:d}}

  p = parsePlayer('p play xo, amp=2')
  assert('p', p.id)
  assert('function', typeof p.getEventsForBeat)
  assert('function', typeof p.play)
  assert(2, p.getEventsForBeat({count:0})[0].amp)

  e = parsePlayer('p play x, delay=0').getEventsForBeat({time:0, count:0, duration:1})[0]
  assert(0, e._time)
  assert(0, e.count)
  assert(1/2, e.dur)

  e = parsePlayer('p play x, delay=1/2').getEventsForBeat({time:0, count:0, duration:1})[0]
  assert(1/2, e._time)
  assert(1/2, e.count)

  e = parsePlayer('p play x, delay=1/2').getEventsForBeat({time:0, count:0, duration:1/2})[0]
  assert(1/4, e._time)
  assert(1/2, e.count)

  es = parsePlayer('p play -, dur=1/4').getEventsForBeat({time:0, count:0, duration:1})
  assert([0,1/4,1/2,3/4], es.map(e => e._time))
  assert([0,1/4,1/2,3/4], es.map(e => e.count))
  assert([1/4,1/4,1/4,1/4], es.map(e => e.dur))

  es = parsePlayer('p play -, dur=1/4, swing=75').getEventsForBeat({time:0, count:0, duration:1})
  assert([0,3/8,1/2,7/8], es.map(e => e._time))
  assert([0,3/8,1/2,7/8], es.map(e => e.count))
  assert([3/8,1/8,3/8,1/8], es.map(e => e.dur))

  es = parsePlayer('p play -, dur=1, swing=75').getEventsForBeat({time:0, count:0, duration:1})
  assert([0], es.map(e => e._time))
  assert([0], es.map(e => e.count))
  assert([1], es.map(e => e.dur))

  es = parsePlayer('p play -, dur=1/4, swing=60').getEventsForBeat({time:0, count:0, duration:1})
  assert([0,0.3,1/2,0.8], es.map(e => e._time))

  es = parsePlayer('p play -, dur=1/4, delay=1/4, swing=75').getEventsForBeat({time:0, count:0, duration:1})
  assert([3/8,1/2,7/8,1], es.map(e => e._time))

  es = parsePlayer('p play -, dur=1/4, swing=75').getEventsForBeat({time:10, count:10, duration:1})
  assert([10,10.375,10.5,10.875], es.map(e => e._time))

  es = parsePlayer('p play [--], dur=1/2, swing=66').getEventsForBeat({time:0, count:0, duration:1})
  assert([0,0.33,0.5,0.83], es.map(e => e._time))

  es = parsePlayer('p play [----], dur=1/2, swing=66').getEventsForBeat({time:0, count:0, duration:1})
  assert([0,0.165,0.33,0.415,0.5,0.665,0.83,0.915], es.map(e => e._time))

  p = parsePlayer('p test x(op), dur=1/2')
  p.play(p.getEventsForBeat({time:0, count:0, duration:1}))
  assert('x', p.currentEvent(0)[0].value)
  assert('o', p.currentEvent(1/2)[0].value)
  assert('p', p.currentEvent(1/2)[1].value)
  assert(0, p.currentEvent(0)[0].pulse(0,0))
  assert(0.775, p.currentEvent(0)[0].pulse(0,1/4))

  p = parsePlayer('p test 0, amp=2')
  p.play(p.getEventsForBeat({time:0, count:0, duration:1}))
  assert(2, p.currentEvent(0)[0].amp)
  
  p = parsePlayer('p test 0 , amp = 2 ')
  p.play(p.getEventsForBeat({time:0, count:0, duration:1}))
  assert(2, p.currentEvent(0)[0].amp)
  
  p = parsePlayer("p test 0, foo='a b  c'")
  p.play(p.getEventsForBeat({time:0, count:0, duration:1}))
  assert('a b  c', p.currentEvent(0)[0].foo)
  
  assertThrows('Missing player type', ()=>parsePlayer('p'))
  assertThrows('Missing pattern/params', ()=>parsePlayer('p play'))
  assertThrows('Player "INVALID" not found', ()=>parsePlayer('p INVALID xo'))
  assertThrows('Invalid player name', ()=>parsePlayer('p.p play 0'))

  p = parsePlayer('p grid 0, fore=[{r:[(1,2)]t,g:3}]t')
  assert({r:1,g:3}, p.getEventsForBeat({count:0})[0].fore)
  assert({r:2,g:3}, p.getEventsForBeat({count:0})[1].fore)

  p = parsePlayer('p test 00, amp=[1,(2,3)]')
  assert(1,  evalParamFrame(p.getEventsForBeat({count:0})[0].amp,ev(0,0),0))
  assert(undefined, p.getEventsForBeat({count:0})[1])
  assert(2, evalParamFrame(p.getEventsForBeat({count:1})[0].amp,ev(0,0),0))
  assert(3, evalParamFrame(p.getEventsForBeat({count:1})[1].amp,ev(0,0),0))

  p = parsePlayer('p play 0, amp=[1,(2,3)]l1')
  assert(1, evalParamFrame(p.getEventsForBeat({count:0})[0].amp,ev(0,0),0))
  assert(1, evalParamFrame(p.getEventsForBeat({count:0})[1].amp,ev(0,0),0))
  assert(1.5, evalParamFrame(p.getEventsForBeat({count:1/2})[0].amp,ev(0,0),0))
  assert(2, evalParamFrame(p.getEventsForBeat({count:1/2})[1].amp,ev(0,0),0))
  assert(2, evalParamFrame(p.getEventsForBeat({count:1})[0].amp,ev(0,0),0))
  assert(3, evalParamFrame(p.getEventsForBeat({count:1})[1].amp,ev(0,0),0))

  p1 = parsePlayer('p1 kal 0, foo=[1:2]l1')
  players.instances.p1 = p1
  p2 = parsePlayer('p2 kal 0, bar=p1.foo')
  p1.play(p1.getEventsForBeat({count:10,duration:1,time:10}),{count:10})
  assert(1, evalParamFrame(p2.getEventsForBeat({count:10})[0].bar,ev(10,10),10))
  p1.play(p1.getEventsForBeat({count:11,duration:1,time:11}),{count:11})
  assert(2, evalParamFrame(p2.getEventsForBeat({count:11})[0].bar,ev(11,11),11))
  delete players.instances.p1

  p1 = parsePlayer('p1 kal 0, foo=[1:2]l1')
  players.instances.p1 = p1
  p2 = parsePlayer('p2 kal 0, bar=p1.foo{per:2}')
  p1.play(p1.getEventsForBeat({count:10,duration:1,time:10}),{count:10})
  assert(1, evalParamFrame(p2.getEventsForBeat({count:10})[0].bar,ev(10,10),10))
  p1.play(p1.getEventsForBeat({count:11,duration:1,time:11}),{count:11})
  assert(2, evalParamFrame(p2.getEventsForBeat({count:11})[0].bar,ev(11,11),11))
  delete players.instances.p1

  p = parsePlayer('p kal 0, bar=this.foo, foo=[1,2]t1{per:1}')
  e = p.getEventsForBeat({count:0})[0]; assert(1, evalParamFrame(e.bar,e,0))
  e = p.getEventsForBeat({count:1})[0]; assert(1, evalParamFrame(e.bar,e,1))
  e = p.getEventsForBeat({count:2})[0]; assert(1, evalParamFrame(e.bar,e,2))

  p = parsePlayer('p kal 0, bar=this.foo{per:1}, foo=[1,2]t1')
  e = p.getEventsForBeat({count:0})[0]; assert(1, evalParamFrame(e.bar,e,0))
  e = p.getEventsForBeat({count:1})[0]; assert(2, evalParamFrame(e.bar,e,1))
  e = p.getEventsForBeat({count:2})[0]; assert(1, evalParamFrame(e.bar,e,2))

  p = parsePlayer('p kal 0, bar=[0:1]r{per:4,seed:[10]}@e')
  e = p.getEventsForBeat({count:0})[0]; assert(0.244, evalParamFrame(e.bar,e,0))
  e = p.getEventsForBeat({count:1})[0]; assert(0.329, evalParamFrame(e.bar,e,1))
  e = p.getEventsForBeat({count:2})[0]; assert(0.796, evalParamFrame(e.bar,e,2))
  e = p.getEventsForBeat({count:3})[0]; assert(0.029, evalParamFrame(e.bar,e,3))

  p = parsePlayer('p kal 0, bar=[0:1]r{per:4,seed:this.foo}@e, foo=[10]')
  e = p.getEventsForBeat({count:0})[0]; assert(0.244, evalParamFrame(e.bar,e,0))
  e = p.getEventsForBeat({count:1})[0]; assert(0.329, evalParamFrame(e.bar,e,1))
  e = p.getEventsForBeat({count:2})[0]; assert(0.796, evalParamFrame(e.bar,e,2))
  e = p.getEventsForBeat({count:3})[0]; assert(0.029, evalParamFrame(e.bar,e,3))

  vars.foo = () => 10
  p = parsePlayer('p kal 0, bar=[0:1]r{per:4,seed:foo}@e')
  e = p.getEventsForBeat({count:0})[0]; assert(0.244, evalParamFrame(e.bar,e,0))
  e = p.getEventsForBeat({count:1})[0]; assert(0.329, evalParamFrame(e.bar,e,1))
  e = p.getEventsForBeat({count:2})[0]; assert(0.796, evalParamFrame(e.bar,e,2))
  e = p.getEventsForBeat({count:3})[0]; assert(0.029, evalParamFrame(e.bar,e,3))
  delete vars.foo

  vars.foo = () => [2,3,4,5]
  p = parsePlayer('p kal 0, bar=foo[[1,3]t1]')
  assert(3, evalParamFrame(p.getEventsForBeat({count:0})[0].bar,ev(0,0),0))
  assert(5, evalParamFrame(p.getEventsForBeat({count:1})[0].bar,ev(1,1),1))
  assert(3, evalParamFrame(p.getEventsForBeat({count:2})[0].bar,ev(2,2),2))
  delete vars.foo

  p = parsePlayer('p kal 0, x={x:this.f}, f=(2,3)')
  es = p.getEventsForBeat({count:0})
  assert(2, es.length)
  assert({x:2}, evalParamFrame(es[0].x,es[0],0))
  assert({x:3}, evalParamFrame(es[1].x,es[1],0))

  p = parsePlayer('p kal 0, x={x:this.f}+1, f=(2,3)')
  es = p.getEventsForBeat({count:0})
  assert(2, es.length)
  assert({x:3}, evalParamFrame(es[0].x,es[0],0))
  assert({x:4}, evalParamFrame(es[1].x,es[1],0))

  e = parsePlayer('p play x, delay={1,add:2}').getEventsForBeat({time:0, count:0, duration:1})[0]
  assert(1, e._time)
  assert(2, e.add)

  let assertEvent = (t, c, d, e) => {
    assert(t, e._time, 'Incorrect _time')
    assert(c, e.count, 'Incorrect count')
    assert(d, e.dur, 'Incorrect dur')
  }

  es = parsePlayer('p test 0, stutter=2').getEventsForBeat({time:0, count:0, duration:1})
  assert(2, es.length)
  assertEvent(0,0,1/2, es[0])
  assertEvent(1/2,1/2,1/2, es[1])

  es = parsePlayer('p test 0, dur=3, stutter=2').getEventsForBeat({time:0, count:0, duration:2})
  assert(2, es.length)
  assertEvent(0,0,3/2, es[0])
  assertEvent(3,3/2,3/2, es[1])

  es = parsePlayer('p test 0, stutter=(2,3)').getEventsForBeat({time:0, count:0, duration:1})
  assert(5, es.length)
  assertEvent(0,0,1/2, es[0])
  assertEvent(1/2,1/2,1/2, es[1])
  assertEvent(0,0,1/3, es[2])
  assertEvent(1/3,1/3,1/3, es[3])
  assertEvent(2/3,2/3,1/3, es[4])

  es = parsePlayer('p test 0, stutter=2, delay=1').getEventsForBeat({time:0, count:0, duration:1})
  assert(2, es.length)
  assertEvent(1,1,1/2, es[0])
  assertEvent(3/2,3/2,1/2, es[1])

  p = parsePlayer('p test 0, stutter=[1,2]t1@e')
  es = p.getEventsForBeat({time:0, count:0, duration:1})
  assert(1, es.length)
  assertEvent(0,0,1, es[0])
  es = p.getEventsForBeat({time:1, count:1, duration:1})
  assert(2, es.length)
  assertEvent(1,1,1/2, es[0])
  assertEvent(3/2,3/2,1/2, es[1])

  p = parsePlayer('p test 0, stutter=[1,2]t1@f')
  es = p.getEventsForBeat({time:0, count:0, duration:1})
  assert(1, es.length)
  assertEvent(0,0,1, es[0])
  es = p.getEventsForBeat({time:1, count:1, duration:1})
  assert(2, es.length)
  assertEvent(1,1,1/2, es[0])
  assertEvent(3/2,3/2,1/2, es[1])

  es = parsePlayer('p test 0, stutter=[1,10]e').getEventsForBeat({time:0, count:0, duration:1})
  assert(1, es.length)
  assertEvent(0,0,1, es[0])

  es = parsePlayer('p play -, dur=1, stutter=4, swing=75').getEventsForBeat({time:0, count:0, duration:1})
  assert([0,3/8,1/2,7/8], es.map(e => e._time))
  assert([0,3/8,1/2,7/8], es.map(e => e.count))
  assert([3/8,1/8,3/8,1/8], es.map(e => e.dur))

  p = parsePlayer('p test 0, delay=({0,stutter:[1,2]})')
  es = p.getEventsForBeat({time:0, count:0, duration:1})
  assert(1, es.length)
  assertEvent(0,0,1, es[0])
  es = p.getEventsForBeat({time:1, count:1, duration:1})
  assert(2, es.length)
  assertEvent(1,1,1/2, es[0])
  assertEvent(3/2,3/2,1/2, es[1])

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
  assertHas({value:'c',add:1,voice:0}, es[4]) // Voice here (and below) should really be 4 (and 5), but that's a lot more complicated
  assertHas({value:'c',add:2,voice:1}, es[5])

  console.log('Parse player tests complete')
  }
  
  return parsePlayer
})
