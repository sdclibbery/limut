'use strict'
define((require) => {
  let playerTypes = require('player/player-types')
  let metronome = require('metronome')
  var parseParams = require('player/params')
  var players = require('player/players')
  let standardPlayer = require('player/standard')
  let continuousPlayer = require('player/continuous')
  var followPlayer = require('player/follow')
  var expandChords = require('player/expand-chords')
  let {evalParamFrame,evalParamToObjectOrPrimitive} = require('player/eval-param')
  let {mainParam,subParam} = require('player/sub-param')
  let {applyOverrides,applyOverridesInPlace} = require('player/override-params')

  let swingPushAt = (count, swingPercent, swingPeriod) => {
    let swingBeatFraction = (count % (swingPeriod*2)) / (swingPeriod*2)
    let maxSwingPush = (swingPercent - 50) / 50
    let lerp
    if (swingBeatFraction < 1/2) {
      lerp = swingBeatFraction*2
    } else {
      lerp = (1-swingBeatFraction)*2
    }
    return lerp*maxSwingPush*swingPeriod
  }

  let applySwing = (event, beat) => {
    let swingParam = evalParamFrame(event.swing, event, event.count)
    let swingPercent = mainParam(swingParam, 50)
    if (swingPercent === 50) { return }
    let swingPeriod = subParam(swingParam, 'period', 1/4)
    let swingBeatPushAtStart = swingPushAt(event.count, swingPercent, swingPeriod)
    let swingBeatPushAtEnd = swingPushAt(event.count+event.dur, swingPercent, swingPeriod)
    event._time += swingBeatPushAtStart * beat.duration
    event.count += swingBeatPushAtStart
    event.dur += swingBeatPushAtEnd - swingBeatPushAtStart
  }

  let applyDelay = (event, beat) => {
    let dp = evalParamToObjectOrPrimitive(event.delay, event, event.count)
    let d = evalParamFrame(mainParam(dp, 0), event, event.count)
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

  let player = (playerId, playerType, patternStr, paramsStr, linenum) => {
    if (!patternStr) { patternStr = '0' } // Default to '0' if missing pattern string
    if (!paramsStr) { paramsStr = '' } // Default if missing params string
    // Create player
    let playerFactory = playerTypes[playerType.toLowerCase()]
    if (!playerFactory) { throw 'Player type "'+playerType+'" not found' }
    // Continuous player, no events
    if (playerFactory.create) {
      let player = continuousPlayer(playerFactory, paramsStr, playerId, playerFactory.baseParams)
      player.type = playerType
      player.keepState = {}
      return player
    }
    let oldPlayer = players.getById(playerId)
    if (oldPlayer && oldPlayer.destroy) { oldPlayer.destroy() } // If new player is not continuous, make sure old one still gets destroyed
    // Normal player
    let player = {
      id: playerId,
      type: playerType,
      keepState: {},
    }
    player.play = (es) => {
      player.events ||= []
      let timeNow = metronome.timeNow()
      player.events = player.events.filter(e => {
        if (e.endTime === undefined) { return timeNow < e._time + 10 } // Filter out events with no endTime but only if they've been hanging around for ages
        return timeNow < e.endTime // Filter out events that are complete
      })
      return es
        .filter(e => e.amp === undefined || typeof e.amp === 'function' || e.amp > 0)
        .map(e => {
          e._player = player
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
    player.getEventsForBeatBase
    if (patternStr.startsWith('follow')) {
      // Follow player
      let params = parseParams(paramsStr, playerId)
      player.getEventsForBeatBase = followPlayer(patternStr.slice(6).trim(), params, player, playerFactory.baseParams)
    } else if (playerFactory.stopped) {
      player.getEventsForBeatBase = () => []
    } else {
      player.getEventsForBeatBase = standardPlayer(patternStr, paramsStr, player, playerFactory.baseParams)
    }
    player.linenum = linenum
    player.getEventsForBeatRaw = (beat) => {
      if (player.lastRawEventCount === beat.count) {
        return player.lastRawEvents // Return previously calculated events (this may happen for a follow player for example)
      }
      let events = player.getEventsForBeatBase(beat)
      player.lastRawEvents = events
      player.lastRawEventCount = beat.count
      return events
    }
    player.getEventsForBeat = (beat) => {
      let events = player.getEventsForBeatRaw(beat)
      events = events.map(event => {
        let eventToPlay = Object.assign({}, event)
        eventToPlay.beat = beat
        if (eventToPlay.sound === undefined) {
          eventToPlay.sound = event.value
        }
        eventToPlay._time = beat.time + event._time*beat.duration
        return eventToPlay
      })
      events.forEach(e => e.linenum = player.linenum)
      let overrides = players.overrides[player.id] || {}
      events = events.map(e => applyOverrides(e, overrides))
      events = expandChords(events)
      events.forEach(e => applyDelay(e, beat))
      events = expandStutter(events)
      events.forEach(e => applySwing(e, beat))
      events.forEach(e => e.player = player.id)
      return events
    }
    return player
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {
  let vars = require('vars').all()

  let assert = (expected, actual, msg) => {
    let x = JSON.stringify(expected, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(3) : v)
    let a = JSON.stringify(actual, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(3) : v)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}${msg?'\n'+msg:''}`) }
  }
  let assertNotEqual = (expected, actual) => {
    if (actual === expected) { console.trace(`Assertion failed.\n>>Expected ${expected}\n to be different than actual: ${actual}`) }
  }
  let assertHas = (expected, actual) => {
    for (let k in expected) {
      assert(expected[k], actual[k], `for ${k}`)
    }
  }
  let assertNotSame = (vs) => {
    for (let i=0; i<vs.length; i++) {
      for (let j=i+1; j<vs.length; j++) {
        if (vs[i] === vs[j]) {
          console.trace(`Assertion failed.\n>>Expected values to all be different ${vs}}`)
          return
        }
      }
    }
  }
  let p,e,es,p1,p2
  let {evalParamFrame} = require('player/eval-param')
  let ev = (i,c,d) => {return{idx:i,count:c,dur:d}}

  p = player('p', 'play', 'xo', 'amp=2', 0)
  assert('p', p.id)
  assert('function', typeof p.getEventsForBeat)
  assert('function', typeof p.play)
  assert(2, p.getEventsForBeat({count:0})[0].amp)

  p = player('p', 'play', '', '', 0)
  assert('p', p.id)
  assert('function', typeof p.getEventsForBeat)
  assert('function', typeof p.play)
  assert(0, p.getEventsForBeat({count:0})[0].value)

  p = player('p', 'play', '', 'amp=2', 0)
  assert('p', p.id)
  assert('function', typeof p.getEventsForBeat)
  assert('function', typeof p.play)
  assert(2, p.getEventsForBeat({count:0})[0].amp)

  e = player('p', 'play', 'x', 'delay=0').getEventsForBeat({time:0, count:0, duration:1})[0]
  assert(0, e._time)
  assert(0, e.count)
  assert(1/2, e.dur)

  e = player('p', 'play', 'x', 'delay=1/2').getEventsForBeat({time:0, count:0, duration:1})[0]
  assert(1/2, e._time)
  assert(1/2, e.count)

  e = player('p', 'play', 'x', 'delay=1/2').getEventsForBeat({time:0, count:0, duration:1/2})[0]
  assert(1/4, e._time)
  assert(1/2, e.count)

  es = player('p', 'play', '-', 'dur=1/4').getEventsForBeat({time:0, count:0, duration:1})
  assert([0,1/4,1/2,3/4], es.map(e => e._time))
  assert([0,1/4,1/2,3/4], es.map(e => e.count))
  assert([1/4,1/4,1/4,1/4], es.map(e => e.dur))

  es = player('p', 'play', '-', 'dur=1/4, swing=75').getEventsForBeat({time:0, count:0, duration:1})
  assert([0,3/8,1/2,7/8], es.map(e => e._time))
  assert([0,3/8,1/2,7/8], es.map(e => e.count))
  assert([3/8,1/8,3/8,1/8], es.map(e => e.dur))

  es = player('p', 'play', '-', 'dur=1, swing=75').getEventsForBeat({time:0, count:0, duration:1})
  assert([0], es.map(e => e._time))
  assert([0], es.map(e => e.count))
  assert([1], es.map(e => e.dur))

  es = player('p', 'play', '-', 'dur=1/4, swing=60').getEventsForBeat({time:0, count:0, duration:1})
  assert([0,0.3,1/2,0.8], es.map(e => e._time))

  es = player('p', 'play', '-', 'dur=1/4, delay=1/4, swing=75').getEventsForBeat({time:0, count:0, duration:1})
  assert([3/8,1/2,7/8,1], es.map(e => e._time))

  es = player('p', 'play', '-', 'dur=1/4, swing=75').getEventsForBeat({time:10, count:10, duration:1})
  assert([10,10.375,10.5,10.875], es.map(e => e._time))

  es = player('p', 'play', '[--]', 'dur=1/2, swing=66').getEventsForBeat({time:0, count:0, duration:1})
  assert([0,0.33,0.5,0.83], es.map(e => e._time))

  es = player('p', 'play', '[----]', 'dur=1/2, swing=66').getEventsForBeat({time:0, count:0, duration:1})
  assert([0,0.165,0.33,0.415,0.5,0.665,0.83,0.915], es.map(e => e._time))

  es = player('p', 'play', '-', 'dur=1/4, swing={75,period:1/4}').getEventsForBeat({time:0, count:0, duration:1})
  assert([0,3/8,1/2,7/8], es.map(e => e._time))
  assert([0,3/8,1/2,7/8], es.map(e => e.count))
  assert([3/8,1/8,3/8,1/8], es.map(e => e.dur))

  es = player('p', 'play', '-', 'dur=1/2, swing={75,period:1/2}').getEventsForBeat({time:0, count:0, duration:1})
  assert([0,3/4], es.map(e => e._time))
  assert([0,3/4], es.map(e => e.count))
  assert([3/4,1/4], es.map(e => e.dur))

  es = player('p', 'play', '-', 'dur=1/4, swing={75,period:1/2}').getEventsForBeat({time:0, count:0, duration:1})
  assert([0,3/8,3/4,7/8], es.map(e => e._time))
  assert([0,3/8,3/4,7/8], es.map(e => e.count))
  assert([3/8,3/8,1/8,1/8], es.map(e => e.dur))

  p = player('p', 'test', 'x(op)', 'dur=1/2')
  p.play(p.getEventsForBeat({time:0, count:0, duration:1}))
  assert('x', p.currentEvent(0)[0].value)
  assert('o', p.currentEvent(1/2)[0].value)
  assert('p', p.currentEvent(1/2)[1].value)
  assert(0, p.currentEvent(0)[0].pulse(0,0))
  assert(0.775, p.currentEvent(0)[0].pulse(0,1/4))

  p = player('p', 'test', '0', 'amp=2')
  p.play(p.getEventsForBeat({time:0, count:0, duration:1}))
  assert(2, p.currentEvent(0)[0].amp)
  
  p = player('p', 'test', '0' , ' amp = 2 ')
  p.play(p.getEventsForBeat({time:0, count:0, duration:1}))
  assert(2, p.currentEvent(0)[0].amp)
  
  p = player('p', 'test', '0', "foo='a b  c'")
  p.play(p.getEventsForBeat({time:0, count:0, duration:1}))
  assert('a b  c', p.currentEvent(0)[0].foo)
  
  p = player('p', 'grid', '0', 'fore=[{r:[(1,2)]t,g:3}]t')
  es = p.getEventsForBeat({count:0})
  assert({r:1,g:3}, evalParamFrame(es[0].fore,ev(0,0),0))
  assert({r:2,g:3}, evalParamFrame(es[1].fore,ev(0,0),0))

  p = player('p', 'test', '00', 'amp=[1,(2,3)]')
  es = p.getEventsForBeat({count:0})
  assert(1, es.length)
  assert(1,  evalParamFrame(es[0].amp,ev(0,0),0))
  es = p.getEventsForBeat({count:1})
  assert(2, es.length)
  assert(2, evalParamFrame(es[0].amp,ev(1,1),1))
  assert(3, evalParamFrame(es[1].amp,ev(1,1),1))

  p = player('p', 'play', '0', 'amp=[1,(2,3)]l2')
  es = p.getEventsForBeat({count:0})
  assert(1, evalParamFrame(es[0].amp,ev(0,0),0))
  assert(1, evalParamFrame(es[1].amp,ev(0,0),0))
  es = p.getEventsForBeat({count:1})
  assert(1.5, evalParamFrame(es[0].amp,ev(1,1),1))
  assert(2, evalParamFrame(es[1].amp,ev(1,1),1))
  es = p.getEventsForBeat({count:2})
  assert(2, evalParamFrame(es[0].amp,ev(2,2),2))
  assert(3, evalParamFrame(es[1].amp,ev(2,2),2))

  p1 = player('p1', 'kal', '0', 'foo=[1:2]l1')
  players.instances.p1 = p1
  p2 = player('p2', 'kal', '0', 'bar=p1.foo')
  p1.play(p1.getEventsForBeat({count:10,duration:1,time:10}),{count:10})
  assert(1, evalParamFrame(p2.getEventsForBeat({count:10})[0].bar,ev(10,10),10))
  p1.play(p1.getEventsForBeat({count:11,duration:1,time:11}),{count:11})
  assert(2, evalParamFrame(p2.getEventsForBeat({count:11})[0].bar,ev(11,11),11))
  delete players.instances.p1

  p1 = player('p1', 'kal', '0', 'foo=[1:2]l1')
  players.instances.p1 = p1
  p2 = player('p2', 'kal', '0', 'bar=p1.foo{per:2}')
  p1.play(p1.getEventsForBeat({count:10,duration:1,time:10}),{count:10})
  assert(1, evalParamFrame(p2.getEventsForBeat({count:10})[0].bar,ev(10,10),10))
  p1.play(p1.getEventsForBeat({count:11,duration:1,time:11}),{count:11})
  assert(2, evalParamFrame(p2.getEventsForBeat({count:11})[0].bar,ev(11,11),11))
  delete players.instances.p1

  p = player('p', 'kal', '0', 'bar=this.foo, foo=[1,2]t1{per:1}')
  e = p.getEventsForBeat({count:0})[0]; assert(1, evalParamFrame(e.bar,e,0))
  e = p.getEventsForBeat({count:1})[0]; assert(1, evalParamFrame(e.bar,e,1))
  e = p.getEventsForBeat({count:2})[0]; assert(1, evalParamFrame(e.bar,e,2))

  p = player('p', 'kal', '0', 'bar=this.foo{per:1}, foo=[1,2]t1')
  e = p.getEventsForBeat({count:0})[0]; assert(1, evalParamFrame(e.bar,e,0))
  e = p.getEventsForBeat({count:1})[0]; assert(2, evalParamFrame(e.bar,e,1))
  e = p.getEventsForBeat({count:2})[0]; assert(1, evalParamFrame(e.bar,e,2))

  p = player('p', 'kal', '0', 'bar=[0:1]r{per:4,seed:[10]}@e')
  e = p.getEventsForBeat({count:0})[0]; assert(0.244, evalParamFrame(e.bar,e,0))
  e = p.getEventsForBeat({count:1})[0]; assert(0.329, evalParamFrame(e.bar,e,1))
  e = p.getEventsForBeat({count:2})[0]; assert(0.796, evalParamFrame(e.bar,e,2))
  e = p.getEventsForBeat({count:3})[0]; assert(0.029, evalParamFrame(e.bar,e,3))

  p = player('p', 'kal', '0', 'bar=[0:1]r{per:4,seed:this.foo}@e, foo=[10]')
  e = p.getEventsForBeat({count:0})[0]; assert(0.244, evalParamFrame(e.bar,e,0))
  e = p.getEventsForBeat({count:1})[0]; assert(0.329, evalParamFrame(e.bar,e,1))
  e = p.getEventsForBeat({count:2})[0]; assert(0.796, evalParamFrame(e.bar,e,2))
  e = p.getEventsForBeat({count:3})[0]; assert(0.029, evalParamFrame(e.bar,e,3))

  vars.foo = () => 10
  p = player('p', 'kal', '0', 'bar=[0:1]r{per:4,seed:foo}@e')
  e = p.getEventsForBeat({count:0})[0]; assert(0.244, evalParamFrame(e.bar,e,0))
  e = p.getEventsForBeat({count:1})[0]; assert(0.329, evalParamFrame(e.bar,e,1))
  e = p.getEventsForBeat({count:2})[0]; assert(0.796, evalParamFrame(e.bar,e,2))
  e = p.getEventsForBeat({count:3})[0]; assert(0.029, evalParamFrame(e.bar,e,3))
  delete vars.foo

  vars.foo = () => [2,3,4,5]
  p = player('p', 'kal', '0', 'bar=foo.[1,3]t1')
  assert(3, evalParamFrame(p.getEventsForBeat({count:0})[0].bar,ev(0,0),0))
  assert(5, evalParamFrame(p.getEventsForBeat({count:1})[0].bar,ev(1,1),1))
  assert(3, evalParamFrame(p.getEventsForBeat({count:2})[0].bar,ev(2,2),2))
  delete vars.foo

  p = player('p', 'kal', '0', 'x={x:this.f}, f=(2,3)')
  es = p.getEventsForBeat({count:0})
  assert(2, es.length)
  assert({x:2}, evalParamFrame(es[0].x,es[0],0))
  assert({x:3}, evalParamFrame(es[1].x,es[1],0))

  p = player('p', 'kal', '0', 'x={x:this.f}+1, f=(2,3)')
  es = p.getEventsForBeat({count:0})
  assert(2, es.length)
  assert({x:3}, evalParamFrame(es[0].x,es[0],0))
  assert({x:4}, evalParamFrame(es[1].x,es[1],0))

  e = player('p', 'play', 'x', 'delay={1,add:2}').getEventsForBeat({time:0, count:0, duration:1})[0]
  assert(1, e._time)
  assert(2, e.add)

  e = player('p', 'play', 'x', 'delay={1,add:[0,2]t1/4@f}').getEventsForBeat({time:0, count:0, duration:1})[0]
  assert(1, e._time)
  assert(2, evalParamFrame(e.add,e,1.3))

  e = player('p', 'play', 'x', 'delay={1,add:5}').getEventsForBeat({time:0, count:0, duration:1})[0]
  assert(1, e._time)
  assert(5, evalParamFrame(e.add,e,1))

  e = player('p', 'play', 'x', 'delay=1|{2,add:5}').getEventsForBeat({time:0, count:0, duration:1})
  assert(1, e[0]._time)
  assert(undefined, e[0].add)
  assert(2, e[1]._time)
  assert(5, e[1].add)

  e = player('p', 'play', 'x', 'delay={[1]}').getEventsForBeat({time:0, count:0, duration:1})[0]
  assert(1, e._time)
  
  let assertEvent = (t, c, d, e) => {
    assert(t, e._time, 'Incorrect _time')
    assert(c, e.count, 'Incorrect count')
    assert(d, e.dur, 'Incorrect dur')
  }

  es = player('p', 'test', '0', 'stutter=2').getEventsForBeat({time:0, count:0, duration:1})
  assert(2, es.length)
  assertEvent(0,0,1/2, es[0])
  assertEvent(1/2,1/2,1/2, es[1])

  es = player('p', 'test', '0', 'dur=3, stutter=2').getEventsForBeat({time:0, count:0, duration:2})
  assert(2, es.length)
  assertEvent(0,0,3/2, es[0])
  assertEvent(3,3/2,3/2, es[1])

  es = player('p', 'test', '0', 'stutter=(2,3)').getEventsForBeat({time:0, count:0, duration:1})
  assert(5, es.length)
  assertEvent(0,0,1/2, es[0])
  assertEvent(1/2,1/2,1/2, es[1])
  assertEvent(0,0,1/3, es[2])
  assertEvent(1/3,1/3,1/3, es[3])
  assertEvent(2/3,2/3,1/3, es[4])

  es = player('p', 'test', '0', 'stutter=2, delay=1').getEventsForBeat({time:0, count:0, duration:1})
  assert(2, es.length)
  assertEvent(1,1,1/2, es[0])
  assertEvent(3/2,3/2,1/2, es[1])

  p = player('p', 'test', '0', 'stutter=[1,2]t1@e')
  es = p.getEventsForBeat({time:0, count:0, duration:1})
  assert(1, es.length)
  assertEvent(0,0,1, es[0])
  es = p.getEventsForBeat({time:1, count:1, duration:1})
  assert(2, es.length)
  assertEvent(1,1,1/2, es[0])
  assertEvent(3/2,3/2,1/2, es[1])

  p = player('p', 'test', '0', 'stutter=[1,2]t1@f')
  es = p.getEventsForBeat({time:0, count:0, duration:1})
  assert(1, es.length)
  assertEvent(0,0,1, es[0])
  es = p.getEventsForBeat({time:1, count:1, duration:1})
  assert(2, es.length)
  assertEvent(1,1,1/2, es[0])
  assertEvent(3/2,3/2,1/2, es[1])

  es = player('p', 'test', '0', 'stutter=[1,10]e').getEventsForBeat({time:0, count:0, duration:1})
  assert(1, es.length)
  assertEvent(0,0,1, es[0])

  es = player('p', 'play', '-', 'dur=1, stutter=4, swing=75').getEventsForBeat({time:0, count:0, duration:1})
  assert([0,3/8,1/2,7/8], es.map(e => e._time))
  assert([0,3/8,1/2,7/8], es.map(e => e.count))
  assert([3/8,1/8,3/8,1/8], es.map(e => e.dur))

  p = player('p', 'test', '0', 'delay=({0,stutter:[1,2]})')
  es = p.getEventsForBeat({time:0, count:0, duration:1})
  assert(1, es.length)
  assertEvent(0,0,1, es[0])
  es = p.getEventsForBeat({time:1, count:1, duration:1})
  assert(2, es.length)
  assertEvent(1,1,1/2, es[0])
  assertEvent(3/2,3/2,1/2, es[1])

  p = player('p', 'test', 'a', 'add=(1,2)')
  es = p.getEventsForBeat({time:0, count:0, duration:1})
  assertHas({add:1,voice:0}, es[0])
  assertHas({add:2,voice:1}, es[1])

  p = player('p', 'test', '[aa]', 'add=(1,2)')
  es = p.getEventsForBeat({time:0, count:0, duration:1})
  assertHas({add:1,voice:0}, es[0])
  assertHas({add:2,voice:1}, es[1])
  assertHas({add:1,voice:0}, es[2])
  assertHas({add:2,voice:1}, es[3])

  p = player('p', 'test', '(ab)', 'add=(1,2)')
  es = p.getEventsForBeat({time:0, count:0, duration:1})
  assertHas({value:'a',add:1,voice:0}, es[0])
  assertHas({value:'a',add:2,voice:1}, es[1])
  assertHas({value:'b',add:1,voice:2}, es[2])
  assertHas({value:'b',add:2,voice:3}, es[3])

  p = player('p', 'test', '(a(bc))')
  es = p.getEventsForBeat({time:0, count:0, duration:1})
  assertHas({value:'a',voice:0}, es[0])
  assertHas({value:'b',voice:1}, es[1])
  assertHas({value:'c',voice:2}, es[2])

  p = player('p', 'test', '(a[bc])', 'add=(1,2)')
  es = p.getEventsForBeat({time:0, count:0, duration:1})
  assertHas({value:'a',add:1,voice:0}, es[0])
  assertHas({value:'a',add:2,voice:1}, es[1])
  assertHas({value:'b',add:1,voice:2}, es[2])
  assertHas({value:'b',add:2,voice:3}, es[3])
  assertHas({value:'c',add:1,voice:0}, es[4]) // Voice here (and below) should really be 4 (and 5), but that's a lot more complicated
  assertHas({value:'c',add:2,voice:1}, es[5])

  p = player('p', 'test', '0', 'x=(this.f){per:2}, f=[0:1]l4@f')
  es = p.getEventsForBeat({count:0})
  assertHas({x:0,f:0}, evalParamFrame(es[0],es[0],0))
  es = p.getEventsForBeat({count:1})
  assertHas({x:1/4,f:1/4}, evalParamFrame(es[0],es[0],1))
  es = p.getEventsForBeat({count:2})
  assertHas({x:0,f:1/2}, evalParamFrame(es[0],es[0],2))

  p1 = player('p1', 'kal', '0', 'foo=[0:1]l4@f')
  players.instances.p1 = p1
  p2 = player('p2', 'kal', '0', 'bar=(p1.foo){per:2}')
  p1.play(p1.getEventsForBeat({count:0,duration:1,time:0}),{count:0})
  assert(0, evalParamFrame(p2.getEventsForBeat({count:0})[0].bar,ev(0,0),0))
  p1.play(p1.getEventsForBeat({count:1,duration:1,time:1}),{count:1})
  assert(1/4, evalParamFrame(p2.getEventsForBeat({count:1})[0].bar,ev(1,1),1))
  p1.play(p1.getEventsForBeat({count:2,duration:1,time:11}),{count:2})
  assert(0, evalParamFrame(p2.getEventsForBeat({count:2})[0].bar,ev(2,2),2))
  delete players.instances.p1

  playerTypes.foo = {play:()=>[], baseParams:{bar:3,amp:1}}
  p = player('p', 'foo', '0')
  assert(3, evalParamFrame(p.getEventsForBeat({count:0})[0].bar,ev(0,0),0))
  p = player('p', 'foo', '0', 'bar=5')
  assert(5, evalParamFrame(p.getEventsForBeat({count:0})[0].bar,ev(0,0),0))
  p = player('p', 'foo', '0', 'bar+=5')
  assert(8, evalParamFrame(p.getEventsForBeat({count:0})[0].bar,ev(0,0),0))
  delete playerTypes.foo

  p = player('p', 'test', '0', 'amp=[0,1,0]e', 0)
  assert(1, evalParamFrame(p.getEventsForBeat({count:0})[0].amp, {_time:0,endTime:1,countToTime:(c)=>c},1/2))

  p = player('p', 'test', '(000)', 'add=[-7:7]r')
  assertNotSame(p.getEventsForBeat({count:0}).map(e => evalParamFrame(e.add,ev(0,0),0)))

  p = player('p', 'test', '0', 'foo=(0,0,0), add=[-7:7]r')
  assertNotSame(p.getEventsForBeat({count:0}).map(e => evalParamFrame(e.add,ev(0,0),0)))

  p = player('p', 'test', '12', '')
  assert(1, p.getEventsForBeat({count:0})[0].value)
  assert(1, p.getEventsForBeat({count:0})[0].value) // Same when call again for same beat

  p = player('p', 'test', '0', 'x=this.time')
  p.play(p.getEventsForBeat({time:1, count:1, duration:1}))
  assert(-1, evalParamFrame(p.currentEvent(1)[0].x,ev(1,1,1),0))
  assert(0, evalParamFrame(p.currentEvent(1)[0].x,ev(1,1,1),1))
  assert(1/2, evalParamFrame(p.currentEvent(1)[0].x,ev(1,1,1),1.5))
  assert(1, evalParamFrame(p.currentEvent(1)[0].x,ev(1,1,1),2))
  assert(2, evalParamFrame(p.currentEvent(1)[0].x,ev(1,1,1),3))
  p.play(p.getEventsForBeat({time:2, count:2, duration:1}))
  assert(0, evalParamFrame(p.currentEvent(2)[0].x,ev(2,2,1),2))

  p = player('p', 'test', '0', 'x=time')
  p.play(p.getEventsForBeat({time:1, count:1, duration:1}))
  assert(0, evalParamFrame(p.currentEvent(1)[0].x,ev(1,1,1),0))
  assert(1, evalParamFrame(p.currentEvent(1)[0].x,ev(1,1,1),1))
  assert(3/2, evalParamFrame(p.currentEvent(1)[0].x,ev(1,1,1),1.5))
  assert(2, evalParamFrame(p.currentEvent(1)[0].x,ev(1,1,1),2))
  assert(3, evalParamFrame(p.currentEvent(1)[0].x,ev(1,1,1),3))
  p.play(p.getEventsForBeat({time:2, count:2, duration:1}))
  assert(2, evalParamFrame(p.currentEvent(2)[0].x,ev(2,2,1),2))

  p = player('p', 'test', '0', 'x=time{per:1}')
  p.play(p.getEventsForBeat({time:1, count:1, duration:1}))
  assert(0, evalParamFrame(p.currentEvent(1)[0].x,ev(1,1,1),0))
  assert(0, evalParamFrame(p.currentEvent(1)[0].x,ev(1,1,1),1))
  assert(0, evalParamFrame(p.currentEvent(1)[0].x,ev(1,1,1),2))

  p = player('p', 'test', '0', 'x=this.time{per:1/2}')
  p.play(p.getEventsForBeat({time:1, count:1, duration:1}))
  assert(0, evalParamFrame(p.currentEvent(1)[0].x,ev(1,1,1),1))
  assert(0.25, evalParamFrame(p.currentEvent(1)[0].x,ev(1,1,1),1.25))
  assert(0, evalParamFrame(p.currentEvent(1)[0].x,ev(1,1,1),1.5))

  p = player('p', 'test', '0', 'x=(this.time){}')
  p.play(p.getEventsForBeat({time:1, count:1, duration:1}))
  assert(0, evalParamFrame(p.currentEvent(1)[0].x,ev(1,1,1),1))
  assert(1/2, evalParamFrame(p.currentEvent(1)[0].x,ev(1,1,1),1.5))
  assert(1, evalParamFrame(p.currentEvent(1)[0].x,ev(1,1,1),2))

  p = player('p', 'test', '0', 'x=(this.time){per:1/2}')
  p.play(p.getEventsForBeat({time:1, count:1, duration:1}))
  assert(0, evalParamFrame(p.currentEvent(1)[0].x,p.currentEvent(1)[0],1))
  assert(0.25, evalParamFrame(p.currentEvent(1)[0].x,p.currentEvent(1)[0],1.25))
  assert(0, evalParamFrame(p.currentEvent(1)[0].x,p.currentEvent(1)[0],1.5))

  p = player('p', 'test', '0', 'x=this.(time,foo), foo=3')
  p.play(p.getEventsForBeat({time:1, count:1, duration:1}))
  assert(0, evalParamFrame(p.currentEvent(1)[0].x,p.currentEvent(1)[0],1))
  assert(3, evalParamFrame(p.currentEvent(1)[1].x,p.currentEvent(1)[1],1))
  assert(1, evalParamFrame(p.currentEvent(1)[0].x,p.currentEvent(1)[0],2))
  assert(3, evalParamFrame(p.currentEvent(1)[1].x,p.currentEvent(1)[1],2))

  p = player('p', 'test', '0', 'x=this.[time]t1')
  p.play(p.getEventsForBeat({time:1, count:1, duration:1}))
  assert(0, evalParamFrame(p.currentEvent(1)[0].x,ev(1,1,1),1))
  assert(1, evalParamFrame(p.currentEvent(1)[0].x,ev(1,1,1),2))

  p = player('p', 'test', '0', 'add={foo:2,bar:3}.(this.foo), foo=bar')
  p.play(p.getEventsForBeat({time:1, count:1, duration:1}))
  assert(3, evalParamFrame(p.currentEvent(1)[0].add,p.currentEvent(1)[0],1))

  p = player('p', 'test', '0', 'x=(3,4).time{step:1}')
  p.play(p.getEventsForBeat({time:1, count:1, duration:1}))
  assert(1, p.currentEvent(1.1).length)
  assert(4, evalParamFrame(p.currentEvent(1.1)[0].x, p.currentEvent(1.1)[0], 1.1))
  assert(3, evalParamFrame(p.currentEvent(1.1)[0].x, p.currentEvent(1.1)[0], 2.1))

  p = player('p', 'test', '0', 'add=rand, loc={ y:(-1/3,1/3) }')
  p.play(p.getEventsForBeat({time:0, count:0, duration:1}))
  es = p.currentEvent(0)
  assertNotEqual(evalParamFrame(es[0].add, es[0], 0), evalParamFrame(es[1].add, es[1], 0))

  p1 = player('p1', 'test', '0', 'foo=(1,2)')
  players.instances.p1 = p1
  p2 = player('p2', 'test', '0', 'bar=p1.foo')
  p1.play(p1.getEventsForBeat({count:0,duration:1,time:0}),{count:0})
  assert(1, evalParamFrame(p2.getEventsForBeat({count:0})[0].bar,ev(0,0),0))
  assert(2, evalParamFrame(p2.getEventsForBeat({count:0})[1].bar,ev(0,0),0))
  delete players.instances.p1

  p1 = player('p1', 'test', '0', 'foo={bar:(1,2)}')
  players.instances.p1 = p1
  p2 = player('p2', 'test', '0', 'bar=p1.foo.bar')
  p1.play(p1.getEventsForBeat({count:0,duration:1,time:0}),{count:0})
  assert(1, evalParamFrame(p2.getEventsForBeat({count:0})[0].bar,ev(0,0),0))
  assert(2, evalParamFrame(p2.getEventsForBeat({count:0})[1].bar,ev(0,0),0))
  delete players.instances.p1

  p = player('p', 'test', '0', 'x=(1,2).time')
  p.play(p.getEventsForBeat({time:0, count:0, duration:2}))
  assert(1, p.currentEvent(0).length)
  assert(1, evalParamFrame(p.currentEvent(0)[0].x, p.currentEvent(0)[0], 0))
  assert(2, evalParamFrame(p.currentEvent(0)[0].x, p.currentEvent(0)[0], 1))

  p = player('p', 'test', '0', 'x=(1,2).(time*1)')
  p.play(p.getEventsForBeat({time:0, count:0, duration:2}))
  assert(1, p.currentEvent(0).length)
  assert(1, evalParamFrame(p.currentEvent(0)[0].x, p.currentEvent(0)[0], 0))
  assert(2, evalParamFrame(p.currentEvent(0)[0].x, p.currentEvent(0)[0], 1))

  console.log('Player tests complete')
  }
  
  return player
})
