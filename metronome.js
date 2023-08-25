'use strict'
define(function (require) {

var metronome = {}

var beatDuration = 60 / 110
var lastBeatAt = 0
var count = 0
var nextBeatAt = 0
let beatReadouts
let time = 0

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

metronome._lastBeat
metronome.lastBeat = () => metronome._lastBeat

metronome.update = function (now) {
  time = now
  if (now > nextBeatAt - metronome.advance()) { // Process just BEFORE the next beat to make sure that events composed ON the beat can be scheduled accurately
    count += 1
    metronome._lastBeat = {
      now: now,
      beatTime: metronome.beatTime(now),
      time: nextBeatAt,
      duration: beatDuration,
      count: count,
    }
    lastBeatAt = nextBeatAt
    let numBeats = Math.ceil((now-nextBeatAt+metronome.advance())/beatDuration) // Skip multiple beats; this might happen after losing focus
    if (numBeats > 1) { console.log(`Skipping ${numBeats-1} beats`) }
    nextBeatAt += numBeats*beatDuration
    return metronome._lastBeat
  }
}

metronome.timeNow = () => time

metronome.setBeatReadouts = (v) => beatReadouts = v
metronome.getBeatReadouts = () => beatReadouts

// For debugging/testing
metronome.setCount = (c) => count=c
metronome.setTime = (t) => time=t

return metronome
})
