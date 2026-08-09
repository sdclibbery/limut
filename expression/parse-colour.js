'use strict';
define(function(require) {

  let hexChar = (char) => (char >= '0' && char <= '9') || (char >= 'a' && char <= 'f')
  let varStartChar = (char) => (char >= '0' && char <= '9') || (char >= 'a' && char <= 'z') || char === '_' || char === '{'

  // Convert a run of hex chars of one of the four valid lengths into a colour map.
  // A channel of all dots means 'absent'; that key is left off so the param's default shows through
  let toColour = (str) => {
    let result = {}
    let width = str.length <= 4 ? 1 : 2
    let hex = width == 1 ? (c) => parseInt(c,16)*0x11/255 : (c) => parseInt(c,16)/255
    let channel = (i) => {
      let c = str.substr(i*width, width)
      return c.charAt(0) === '.' ? undefined : hex(c)
    }
    if (str.length != 3 && str.length != 4 && str.length != 6 && str.length != 8) { return result }
    let r = channel(0), g = channel(1), b = channel(2)
    if (r !== undefined) { result.r = r }
    if (g !== undefined) { result.g = g }
    if (b !== undefined) { result.b = b }
    if (str.length == 3 || str.length == 6) {
      result.a = 1
    } else {
      let a = channel(3)
      if (a !== undefined) { result.a = a }
    }
    return result
  }

  // Each channel must be entirely hex or entirely dots, so the channels stay positionally aligned
  let channelsAligned = (str) => {
    let width = str.length <= 4 ? 1 : 2
    for (let i = 0; i < str.length; i += width) {
      let c = str.substr(i, width)
      if (!(c.split('').every(hexChar) || c.split('').every(ch => ch === '.'))) { return false }
    }
    return true
  }

  let parseColour = (state) => {
    // Scan the run of chars that could be part of the literal, without consuming it yet
    let run = ''
    let char
    while (char = state.str.charAt(state.idx + run.length).toLowerCase()) {
      if (hexChar(char) || char === '.') {
        run += char
        continue
      }
      break
    }
    if (run.indexOf('.') < 0) { // No dots: consume the lot, exactly as before
      state.idx += run.length
      return toColour(run)
    }
    // Dots present, so `.` could be a channel placeholder or the lookup operator. Take the longest
    // interpretation that gives well formed channels and doesn't swallow a lookup's dot
    for (let len of [8,6,4,3]) {
      if (len > run.length) { continue }
      let str = run.substr(0, len)
      if (!channelsAligned(str)) { continue }
      if (str.charAt(len-1) === '.') { // A trailing dot belongs to a following lookup, not to us
        let next = run.charAt(len) || state.str.charAt(state.idx + len)
        if (varStartChar(next)) { continue }
      }
      state.idx += len
      return toColour(str)
    }
    // No valid interpretation: consume only the hex prefix and leave the dot for the operator parser
    let hexLen = run.indexOf('.')
    state.idx += hexLen
    return toColour(run.substr(0, hexLen))
  }

  // TESTS
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

    let assert = (expected, actual) => {
      let x = JSON.stringify(expected)
      let a = JSON.stringify(actual)
      if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
    }
    let state = (txt) => {return {str:txt,idx:0}}

    assert({r:0,g:0.2,b:0.4,a:1}, parseColour(state("036f")))
    assert({r:0,g:0.2,b:0.4,a:1}, parseColour(state("003366ff")))
    assert({r:0,g:0.2,b:0.4,a:0.6}, parseColour(state("0369")))
    assert({r:0,g:0.2,b:0.4,a:0.6}, parseColour(state("00336699")))
    assert({r:0,g:0.2,b:0.4,a:1}, parseColour(state("036")))
    assert({r:0,g:0.2,b:0.4,a:1}, parseColour(state("003366")))

    // Absent channels; the key is left off so the param's existing colour shows through
    assert({g:1,a:1}, parseColour(state(".f.")))
    assert({b:0,a:1}, parseColour(state("..0f")))
    assert({r:1,g:1,a:1}, parseColour(state("ff.")))
    assert({r:0,g:0.2,b:0.4}, parseColour(state("036.")))
    assert({a:1}, parseColour(state("...")))
    assert({}, parseColour(state("....")))
    assert({g:1,a:1}, parseColour(state("..ff..")))
    assert({r:1,a:0.5019607843137255}, parseColour(state("ff....80")))
    assert({r:0,g:0.2,b:0.4}, parseColour(state("003366..")))

    // A dot that is really the lookup operator must be left in the stream, not eaten as a channel
    let st = state("e000.r") // eg `add=#e000.r` takes the red component of the colour
    assert({r:0.9333333333333333,g:0,b:0,a:0}, parseColour(st))
    assert(4, st.idx)
    st = state("f00.mix{1/2}") // Trailing dot followed by an identifier is a lookup, not a channel
    assert({r:1,g:0,b:0,a:1}, parseColour(st))
    assert(3, st.idx)
    st = state(".f..r") // Same, for a sparse colour
    assert({g:1,a:1}, parseColour(st))
    assert(3, st.idx)
    st = state("ff0000.r")
    assert({r:1,g:0,b:0,a:1}, parseColour(st))
    assert(6, st.idx)
    st = state(".f.,") // But a trailing channel dot before a delimiter is kept
    assert({g:1,a:1}, parseColour(st))
    assert(3, st.idx)

    console.log('Parse colour tests complete')
  }

  return parseColour
})