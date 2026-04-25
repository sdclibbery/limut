'use strict'
define(function (require) {

var metronome = {}

var beatDuration = 60 / 110
var lastBeatAt = 0
var count = 0
var nextBeatAt = beatDuration
let beatReadouts
let time = 0
let lastFiredCount = -Infinity

metronome.beatTime = (now) => {
  return count + (now - lastBeatAt) / (nextBeatAt - lastBeatAt)
}

metronome.nextBeatAt = function () {
  return nextBeatAt
}

metronome.bpm = function (bpm) {
  if (bpm) {
    beatDuration = 60/bpm
    if (window.bpmChanged) { window.bpmChanged(60/beatDuration) }
  }
  return 60/beatDuration
}

metronome.beatDuration = function (d) {
  if (d) { beatDuration = d; }
  return beatDuration
}

metronome.advance = () => 0.1*beatDuration

metronome.lastBeat = () => metronome._lastBeat

metronome.update = function (now) {
  time = now
  if (now > nextBeatAt - metronome.advance()) { // Process just BEFORE the next beat to make sure that events composed ON the beat can be scheduled accurately
    count += 1
    let suppress = count <= lastFiredCount // collaboration sync moved count back; don't re-fire an already-fired beat
    if (!suppress) {
      lastFiredCount = count
      metronome._lastBeat = {
        now: now,
        beatTime: metronome.beatTime(now),
        time: nextBeatAt,
        duration: beatDuration,
        count: count,
      }
    }
    lastBeatAt = nextBeatAt
    let numBeats = Math.ceil((now-nextBeatAt+metronome.advance())/beatDuration) // Skip multiple beats; this might happen after losing focus
    if (numBeats > 1) { console.log(`Skipping ${numBeats-1} beats`) }
    nextBeatAt += numBeats*beatDuration
    if (suppress) { return }
    return metronome._lastBeat
  }
}

metronome.timeNow = () => time

metronome.sync = (serverBeatTime, serverBpm) => {
  if (serverBpm) {
    beatDuration = 60/serverBpm
    if (window.bpmChanged) { window.bpmChanged(60/beatDuration) }
  }
  count = Math.floor(serverBeatTime)
  let fraction = serverBeatTime - count
  lastBeatAt = time - fraction * beatDuration
  nextBeatAt = lastBeatAt + beatDuration
}

metronome.setBeatReadouts = (v) => beatReadouts = v
metronome.getBeatReadouts = () => beatReadouts

// For debugging/testing
metronome.setCount = (c) => { count = c; lastFiredCount = c - 1 }
metronome.setTime = (t) => time=t

// TESTS //
if ((new URLSearchParams(window.location.search)).get('test') !== null) {
  let oldBpm = metronome.bpm()

  // A sync arriving just after a beat has fired, with serverBeatTime slightly
  // below the count we just fired, must not cause that count to fire a second
  // time. Otherwise the client emits duplicate events for the same beat.
  metronome.bpm(60) // beatDuration = 1s, so beat numbers map directly to seconds
  metronome.setCount(0) // resets lastFiredCount tracker
  metronome.setTime(5.0)
  metronome.sync(5.0, 60) // count=5, lastBeatAt=5, nextBeatAt=6

  let firstBeat = metronome.update(6.0)
  if (!firstBeat || firstBeat.count !== 6) {
    console.trace(`Expected first update to fire beat 6, got: ${JSON.stringify(firstBeat)}`)
  }

  metronome.sync(5.99, 60) // server is fractionally behind / network delay

  let secondBeat = metronome.update(6.02)
  if (secondBeat && secondBeat.count === firstBeat.count) {
    console.trace(`Sync caused beat ${secondBeat.count} to fire twice`)
  }

  // After a suppressed re-fire, the next genuinely new beat must still fire.
  let thirdBeat = metronome.update(7.02)
  if (!thirdBeat || thirdBeat.count !== 7) {
    console.trace(`Expected next genuine beat to fire as count 7, got: ${JSON.stringify(thirdBeat)}`)
  }

  // Catch-up: when the client is behind the server, sync forward should still allow
  // the next beat to fire normally with the synced count + 1.
  metronome.setCount(0)
  metronome.setTime(10.0)
  metronome.sync(10.0, 60) // count=10
  metronome.sync(20.0, 60) // jump forward: count=20
  let catchUpBeat = metronome.update(21.0)
  if (!catchUpBeat || catchUpBeat.count !== 21) {
    console.trace(`Expected catch-up beat to fire as count 21, got: ${JSON.stringify(catchUpBeat)}`)
  }

  metronome.bpm(oldBpm)
  metronome.setCount(0)
  metronome.setTime(0)

  console.log('Metronome tests complete')
}

return metronome
})
