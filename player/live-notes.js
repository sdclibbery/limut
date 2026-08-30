'use strict';
define(function(require) {
  // Shared by the keyboard, gamepad and midi players, whose events are "live": their length is not
  // known when they start, so their envelope holds a placeholder endTime and only arms the teardown
  // of its audio nodes when _noteOff fires (play/envelopes.js). A voice that is never released
  // therefore renders for ever, so every path that can strand one - the note off from the device,
  // the device going away, the player being destroyed - releases through here.

  // Fire the note off callback for every live event that matches, so sustain envelopes move to their
  // release phase. With no match, releases everything the player is playing.
  let releaseNotes = (player, match) => {
    let events = player.events
    if (!events) { return }
    for (let k in events) {
      let e = events[k]
      // Skip voices already releasing, else re-triggering _noteOff jumps the gain back up (click) and races the original destroy timeout
      if (!!e._noteOff && !e._stopping && (match === undefined || match(e))) {
        e._noteOff()
        e._stopping = true
      }
    }
  }

  // Nothing left sounding, so the player's device listener can go
  let allStopped = (player) => !player.events || player.events.filter(e => !e._stopping).length === 0

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

  let assert = (expected, actual, msg) => {
    if (expected !== actual) { console.trace(`Assertion failed.\n>>Expected: ${expected}\n>>Actual: ${actual}${msg?'\n'+msg:''}`) }
  }
  let ev = (note) => { let e = {note: note, released: 0}; e._noteOff = () => e.released++; return e }

  let a = ev(1), b = ev(2), c = ev(1)
  let player = {events: [a, b, c]}
  releaseNotes(player, e => e.note === 1)
  assert(1, a.released, 'matching event released')
  assert(0, b.released, 'non matching event left alone')
  assert(1, c.released)
  assert(true, a._stopping)
  assert(undefined, b._stopping)
  releaseNotes(player, e => e.note === 1) // Already releasing
  assert(1, a.released, 'a releasing voice is not released twice')
  assert(false, allStopped(player), 'b is still sounding')
  releaseNotes(player)
  assert(1, b.released, 'no match releases everything')
  assert(true, allStopped(player))

  let noEnvelope = {} // An event with no note off callback (an envelope of known length) is left alone
  player = {events: [noEnvelope]}
  releaseNotes(player)
  assert(undefined, noEnvelope._stopping)
  assert(false, allStopped(player))

  assert(true, allStopped({}), 'a player that never played anything has nothing sounding')
  assert(true, allStopped({events: []}))

  console.log('Live notes tests complete')
  }

  return {
    releaseNotes: releaseNotes,
    allStopped: allStopped,
  }
})
