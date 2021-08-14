'use strict'
define((require) => {
  let playerTypes = require('player/player-types')
  var parseParams = require('player/params')
  var overrideParams = require('player/override-params').overrideParams
  var players = require('player/players')
  let standardPlayer = require('player/standard')
  var followPlayer = require('player/follow')
  var expandTuples = require('player/expand-tuples')

  let splitOnAll = (str, ch) => {
    if (!str) { return [] }
    return str.split(ch).map(x => x.trim()).filter(x => x!=ch)
  }

  let splitOnFirst = (str, ch) => {
    if (!str) { return [] }
    let parts = splitOnAll(str, ch)
    return [parts[0], parts.slice(1).join()]
  }

  let parsePlayer = (line, linenum) => {
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
        let play = (es, beat) => {
          player.events ||= []
          player.events = player.events.filter(e => e.countToTime(beat.count) <= e.endTime)
          return es
            .filter(e => e.amp === undefined || typeof e.amp === 'function' || e.amp > 0)
            .map(e => {
              playerFactory.play(e)
              let pulse = (ev,b) => {
                let t = e.countToTime(b)
                if (t<e._time || t>e.endTime) { return 0 }
                let l = e.endTime - e._time
                let x = (t - e._time) / l
                let v = x < 1/5 ? x*5 : 1-(x*6/5-1/5)
                return Math.pow(v, 1/2)
              }
              if (player.lastCount !== e.beat.count) {
                player.lastCount = e.beat.count
              }
              e.countToTime = (count) => e.beat.time + (count-e.beat.count)*e.beat.duration
              e.pulse = pulse
              player.events.push(e)
            })
        }
        let player = {
          play: play,
          id: playerId,
          type: playerType,
        }
        player.currentEvent = (ev,b) => {
          let es = player.events
          if (!es) { return {pulse:()=>0} }
          es = es.filter(e => {
            let t = e.countToTime(b)
            return (t > e._time-0.0001) && (t < e.endTime)
          })
          return es.length>0 ? es[0] : {pulse:()=>0}
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
          events.forEach(e => e.linenum = linenum)
          let overrides = players.overrides[player.id] || {}
          let es = events.map(e => overrideParams(e, overrides))
          es = expandTuples(es)
          return es
        }
        return player
      }
    }
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

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
  playerTypes.test = { play: (e) => {
    e.endTime = e._time + e.dur
    return {}
  } }

  p = parsePlayer('p play xo, amp=2')
  assert('p', p.id)
  assert('function', typeof p.getEventsForBeat)
  assert('function', typeof p.play)
  assert(2, p.getEventsForBeat({count:0})[0].amp)

  p = parsePlayer('p test xo, dur=1/2')
  p.play(p.getEventsForBeat({time:0, count:0, duration:1}))
  assert('x', p.currentEvent(0,0).value)
  assert('o', p.currentEvent(0,1/2).value)
  assert(0, p.currentEvent(0,0).pulse(0,0))
  assert(0.77, p.currentEvent(0,0).pulse(0,1/4))

  p = parsePlayer('p test 0, amp=2')
  p.play(p.getEventsForBeat({time:0, count:0, duration:1}))
  assert(2, p.currentEvent(0,0).amp)
  
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

  p = parsePlayer('p grid 0, fore=[{r:[(1,2)]t,g:3}]t')
  assert({r:1,g:3}, p.getEventsForBeat({count:0})[0].fore)
  assert({r:2,g:3}, p.getEventsForBeat({count:0})[1].fore)

  console.log('Parse player tests complete')
  }
  
  return parsePlayer
})
