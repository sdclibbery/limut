'use strict'
define(function (require) {
  let {subParam} = require('player/sub-param')

  let hsv2rgb = (ar,h,s,v) => {
    let f = (n,k=(n+h*6)%6) => v - v*s*Math.max( Math.min(k,4-k,1), 0)
    ar[0] = f(5)
    ar[1] = f(3)
    ar[2] = f(1)
  }

  function lab2rgb(ar,l,c,h){
    h += 0.1
    let la = c * Math.cos((h*360 * Math.PI) / 180)
    let lb = c * Math.sin((h*360 * Math.PI) / 180)

    let y = (l*100 + 16) / 116,
        x = la / 5 + y,
        z = y - lb / 2,
        r, g, b
  
    x = 0.95047 * ((x * x * x > 0.008856) ? x * x * x : (x - 16/116) / 7.787)
    y = 1.00000 * ((y * y * y > 0.008856) ? y * y * y : (y - 16/116) / 7.787)
    z = 1.08883 * ((z * z * z > 0.008856) ? z * z * z : (z - 16/116) / 7.787)
  
    r = x *  3.2406 + y * -1.5372 + z * -0.4986
    g = x * -0.9689 + y *  1.8758 + z *  0.0415
    b = x *  0.0557 + y * -0.2040 + z *  1.0570
  
    r = (r > 0.0031308) ? (1.055 * Math.pow(r, 1/2.4) - 0.055) : 12.92 * r
    g = (g > 0.0031308) ? (1.055 * Math.pow(g, 1/2.4) - 0.055) : 12.92 * g
    b = (b > 0.0031308) ? (1.055 * Math.pow(b, 1/2.4) - 0.055) : 12.92 * b
  
    ar[0] = r
    ar[1] = g
    ar[2] = b
  }

  let cachedObjects = {}
  let cached = (n) => {
    if (cachedObjects[n] === undefined) { cachedObjects[n] = [] }
    return cachedObjects[n]
  }
  let colourToArray = (v, d, name) => {
    let ar = cached(name)
    let labh = subParam(v, 'labh', undefined)
    let h = subParam(v, 'h', undefined)
    let r = subParam(v, 'r', d.r)
    let g = subParam(v, 'g', d.g)
    let b = subParam(v, 'b', d.b)
    if (labh !== undefined) {
      lab2rgb(ar, subParam(v, 'l', 1/2), subParam(v, 'c', 1), labh)
      if (v.r !== undefined) { ar[0] = r }
      if (v.g !== undefined) { ar[1] = g }
      if (v.b !== undefined) { ar[2] = b }
    } else if (h !== undefined) {
      hsv2rgb(ar, h, subParam(v, 's', 1), subParam(v, 'v', 1))
      if (v.r !== undefined) { ar[0] = r }
      if (v.g !== undefined) { ar[1] = g }
      if (v.b !== undefined) { ar[2] = b }
    } else {
      ar[0] = r
      ar[1] = g
      ar[2] = b
    }
    ar[3] = subParam(v, 'a', d.a)
    return ar
  }

  let colour = (v, d, name) => { // Convert a colour number or object to an RGBA array
    if (typeof v === 'number') {
      let ar = cached(name)
      ar[0] = ar[1] = ar[2] = ar[3] = v
      return ar
    }
    return colourToArray(v, d, name)
  }

  let colourRgb = (v, d, name) => { // Convert a colour number or object to an RGB array
    if (typeof v !== 'object') { return v }
    return colourToArray(v, d, name)
  }

  let isColour = (v) => {
    if (typeof v !== 'object') { return false }
    return (v.r !== undefined || v.g !== undefined || v.b !== undefined || v.a !== undefined ||
            v.h !== undefined || v.s !== undefined || v.v !== undefined ||
            v.l !== undefined || v.c !== undefined || v.labh !== undefined)
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {
    let assert = (expected, actual) => {
      let x = JSON.stringify(expected)
      let a = JSON.stringify(actual)
      if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
    }
    let white = () => { return {r:1,g:1,b:1,a:1} }
    let red = () => { return {r:1,g:0,b:0,a:1} }
    let black = () => { return {r:0,g:0,b:0,a:1} }

    assert([0,0,0,0], colour(0, red(), 'blah'))
    assert([1,1,1,1], colour(1, red(), 'blah'))
    assert([1,1,1,1], colour({}, white(), 'blah'))
    assert([1,0,0,1], colour({}, red(), 'blah'))
    assert([1,0,0,1], colour(red(), white(), 'blah'))
    assert([1,1,1,1], colour(white(), red(), 'blah'))
    assert([1,1,1,0], colour({a:0}, white(), 'blah'))
    assert([0,1,1,1], colour({r:0}, white(), 'blah'))
    assert([0,1,1,0], colour({r:0,a:0}, white(), 'blah'))
    assert([1,0,0,1], colour({h:0}, white(), 'blah'))
    assert([0,1,0,1], colour({h:1/3}, white(), 'blah'))
    assert([0,1/2,0,1], colour({h:1/3,v:1/2}, white(), 'blah'))
    assert([1/2,1,1/2,1], colour({h:1/3,s:1/2}, white(), 'blah'))
    assert([0,1,0,1/2], colour({h:1/3,a:1/2}, white(), 'blah'))
    assert([0,1,1/2,1], colour({h:1/3,b:1/2}, white(), 'blah'))
    assert([0.9582161268492856,-0.16725554410511348,0.07878618934675646,1], colour({labh:0}, white(), 'blah'))

    assert(0, colourRgb(0, red(), 'blah'))
    assert([0,1,0,1], colourRgb({g:1}, black(), 'blah'))

    console.log('colour tests complete')
  }
  
  return {
    isColour: isColour,
    colour: colour,
    colourRgb: colourRgb,
  }
})