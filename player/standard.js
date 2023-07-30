'use strict';
define(function(require) {
  var parseParams = require('player/params');
  let {applyOverrides,applyOverridesInPlace,collapseOverrides} = require('player/override-params')
  let {evalParamFrame} = require('player/eval-param')
  let root = require('pattern/root.js')
  var players = require('player/players')
  var expandChords = require('player/expand-chords')
  let {mainParam} = require('player/sub-param')

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

  return (patternStr, paramsStr, player, baseParams) => {
    let params = parseParams(paramsStr, player.id)
    params = applyOverrides(baseParams, params)
    params = collapseOverrides(params)
    return (beat) => {
      let ks = player.keepState
      if (ks._pattern === undefined || ks._patternStr !== patternStr) { // Reparse pattern only when source has changed
        ks._pattern = root(patternStr, params)
        ks._patternStr = patternStr
      }
      ks._pattern.params = params // Always update the params
      let eventsForBeat = ks._pattern(beat.count)
      let events = eventsForBeat.map(event => {
        let eventToPlay = Object.assign({}, event, {sound: event.value, beat: beat})
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
      return events
    }
  }
});
