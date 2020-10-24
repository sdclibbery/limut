'use strict'
define(function (require) {

var metronome = {}

var beatDuration = 60 / 110
var lastBeatAt = 0
var count = 0
var nextBeatAt = 0

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

metronome.advance = () => 0.1

metronome.update = function (now) {
  if (now > nextBeatAt - metronome.advance()*beatDuration) { // Process just BEFORE the next beat to make sure that events composed ON the beat can be scheduled accurately
    var beat = {
      now: now,
      beatTime: metronome.beatTime(now),
      time: nextBeatAt,
      duration: beatDuration,
      count: count+1,
    }
    lastBeatAt = nextBeatAt
    nextBeatAt += beatDuration
    count += 1
    return beat
  }
}

return metronome
})
