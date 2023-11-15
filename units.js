'use strict'
define(function(require) {
  
  let timeScale = {
    's': 1,
    'seconds': 1,
    'ms': 1/1000,
    'millis': 1/1000,
  }

  let timeToBeats = (value, units, e) => {
    let scale = timeScale[units]
    if (scale !== undefined) {
      return value * scale / e.beat.duration
    }
    // Default to beats
    return value
  }

  let timeToTime = (value, units, e) => {
    let scale = timeScale[units]
    if (scale !== undefined) {
      return value * scale
    }
    // Default to beats
    return value * e.beat.duration
  }

  return {
    timeToBeats: timeToBeats,
    timeToTime: timeToTime,
  }
})