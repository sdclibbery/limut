'use strict'
define((require) => {
  let {evalParamFrame,evalParamFrameIgnoreThisVars} = require('player/eval-param')

  let chordIndex = (v, i) => {
    if (Array.isArray(v)) {
      return v[i % v.length]
    } else {
      return v
    }
  }

  let multiplyEvents = (event) => {
    for (let k in event) {
      if (k === 'beat' || k === 'play') { continue } // beat should never have chords, play is for node graphs and should not be evalled any more than needed as it creates AudioNodes
      let v = event[k]
      if (v && v.__alreadyExpanded) { continue }
      let evaled = evalParamFrameIgnoreThisVars(v, event, event.count)
      if (Array.isArray(evaled)) { // If param k is going to eval to a chord at the start of the event, expand it out
        let es = []
        for (let i=0; i<evaled.length; i++) {
          let e = Object.assign({}, event)
          if (Array.isArray(v)) { // Was a literal chord even before being evalled
            e[k] = v.flat()[i] // chord in a chord
            if (e[k] === undefined) { continue }
          } else if (typeof v == 'function' || (typeof v == 'object' && !(v instanceof AudioNode))) {
            e[k] = (e,b,evalRecurse) => chordIndex(evalRecurse(v, e,b),i) // Get correct value out of a function that returns a chord
            e[k].interval = v.interval
            e[k].__alreadyExpanded = true
          } else {
            e[k] = v // primitive so use same value across all chord indices
          }
          es.push(...multiplyEvents(e)) // And recurse to expand out any other chord params
        }
        return es
      }
    }
    return [event]
  }

  let expandChords = (es) => {
    let voice = 0
    let lastTime = -1
    return es.flatMap(e => {
      if (e._time !== lastTime) { // Group pattern events by start time. Not really correct, but doing it properly requires adding a lot of complexity to pattern parsing to specify chord groups
        voice = 0
        lastTime = e._time
      }
      let exp = multiplyEvents(e)
      exp.forEach(e => {
        e.voice = voice++
      })
      return exp
    })
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

    let assert = (expected, actual, msg) => {
      let x = JSON.stringify(expected, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
      let a = JSON.stringify(actual, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
      if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}${msg?'\n'+msg:''}`) }
    }
    let assertHas = (expected, actual) => {
      for (let k in expected) {
        assert(expected[k], actual[k], `for ${k}`)
      }
    }
    let p
    let e = {}
    let b = 0

    assert([], expandChords([]))
    assert([{x:1,y:2,voice:0}], expandChords([{x:1,y:2}]))
    assert([{x:1,_time:0,voice:0},{x:2,_time:1,voice:0}], expandChords([{x:1,_time:0},{x:2,_time:1}]))

    assert([{x:1,voice:0},{x:2,voice:1}], expandChords([{x:[1,2]}]))
    assert([{x:1,y:3,voice:0},{x:1,y:4,voice:1},{x:2,y:3,voice:2},{x:2,y:4,voice:3}], expandChords([{x:[1,2],y:[3,4]}]))
    assert([{x:1,voice:0},{x:2,voice:1},{x:3,voice:2}], expandChords([{x:[1,[2,3]]}]))
    assert([{x:1,y:3,w:5,voice:0},{x:1,y:4,w:5,voice:1},{x:2,y:3,w:5,voice:2},{x:2,y:4,w:5,voice:3}], expandChords([{x:[1,2],y:[3,4],w:5}]))

    assert([{x:1,beat:[2,3],voice:0}], expandChords([{x:1,beat:[2,3]}]))
    assert([{x:1,voice:0},{x:2,voice:1}], expandChords([{x:[1,2]}]))

    p = expandChords([{x:()=>[1,2]}])
    assert(1, evalParamFrame(p[0].x,e,b))
    assert(0, evalParamFrame(p[0].voice,e,b))
    assert(2, evalParamFrame(p[1].x,e,b))
    assert(1, evalParamFrame(p[1].voice,e,b))

    p = expandChords([{x:{r:[1,2]}}])
    assert({r:1}, evalParamFrame(p[0].x,e,b))
    assert({r:2}, evalParamFrame(p[1].x,e,b))

    p = expandChords([{x:{r:()=>[1,2]}}])
    assert({r:1}, evalParamFrame(p[0].x,e,b))
    assert({r:2}, evalParamFrame(p[1].x,e,b))

    p = expandChords([{x:{r:()=>[1,2],g:3}}])
    assert({r:1,g:3}, evalParamFrame(p[0].x,e,b))
    assert({r:2,g:3}, evalParamFrame(p[1].x,e,b))

    p = expandChords([{x:()=>{return({r:1})}}])
    assert({r:1}, evalParamFrame(p[0].x,e,b))

    p = expandChords([{x:()=>{return({r:()=>[1,2],g:3})}}])
    assert({r:1,g:3}, evalParamFrame(p[0].x,e,b))
    assert({r:2,g:3}, evalParamFrame(p[1].x,e,b))

    p = expandChords([{x:()=>{return({r:()=>[1,2],g:[3,4]})}}])
    assert({r:1,g:3}, evalParamFrame(p[0].x,e,b))
    assert({r:1,g:4}, evalParamFrame(p[1].x,e,b))
    assert({r:2,g:3}, evalParamFrame(p[2].x,e,b))
    assert({r:2,g:4}, evalParamFrame(p[3].x,e,b))

    let pff = () => [3,4] // per frame func
    pff.interval = 'frame'
    p = expandChords([{x:[{r:1,g:pff},{r:2,g:pff}]}])
    assert({r:1,g:3}, evalParamFrame(p[0].x,e,b))
    assert({r:1,g:4}, evalParamFrame(p[1].x,e,b))
    assert({r:2,g:3}, evalParamFrame(p[2].x,e,b))
    assert({r:2,g:4}, evalParamFrame(p[3].x,e,b))
    assert(undefined, p[4])

    let tvf = (e) => e.f // this var func
    tvf.interval = 'frame'
    tvf._thisVar = true
    p = expandChords([{x:tvf,f:1}])
    assert(1, p.length)
    assert(1, evalParamFrame(p[0].x,p[0],b))
    assert(1, evalParamFrame(p[0].f,p[0],b))

    p = expandChords([{x:tvf,f:[3,4]}])
    assert(2, p.length)
    assert(3, evalParamFrame(p[0].x,p[0],b))
    assert(3, evalParamFrame(p[0].f,p[0],b))
    assert(4, evalParamFrame(p[1].x,p[1],b))
    assert(4, evalParamFrame(p[1].f,p[1],b))

    p = expandChords([{x:[{r:1,g:tvf},{r:2,g:tvf}],f:[3,4]}])
    assert(4, p.length)
    assert({r:1,g:3}, evalParamFrame(p[0].x,p[0],b))
    assert(3, evalParamFrame(p[0].f,p[0],b))
    assert({r:1,g:4}, evalParamFrame(p[1].x,p[1],b))
    assert(4, evalParamFrame(p[1].f,p[1],b))
    assert({r:2,g:3}, evalParamFrame(p[2].x,p[2],b))
    assert(3, evalParamFrame(p[2].f,p[2],b))
    assert({r:2,g:4}, evalParamFrame(p[3].x,p[3],b))
    assert(4, evalParamFrame(p[3].f,p[3],b))

    p = expandChords([{value:'a'},{ value:'b'}])
    assert(2, p.length)
    assertHas({voice:0,value:'a'}, evalParamFrame(p[0],b))
    assertHas({voice:1,value:'b'}, evalParamFrame(p[1],b))

    p = expandChords([
      {value:['a','b'],_time:0},
      {value:['c','d'],_time:0},
      {value:['e','f'],_time:1/2},
    ])
    assert(6, p.length)
    assertHas({voice:0,value:'a'}, evalParamFrame(p[0],b))
    assertHas({voice:1,value:'b'}, evalParamFrame(p[1],b))
    assertHas({voice:2,value:'c'}, evalParamFrame(p[2],b))
    assertHas({voice:3,value:'d'}, evalParamFrame(p[3],b))
    assertHas({voice:0,value:'e'}, evalParamFrame(p[4],b))
    assertHas({voice:1,value:'f'}, evalParamFrame(p[5],b))

  console.log('Expand chords tests complete')
  }

  return expandChords
})