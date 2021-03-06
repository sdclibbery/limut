'use strict'
define(function(require) {
  let parseExpression = require('player/parse-expression')
  let vars = require('vars')

  vars['rnd'] = parseExpression('[]r')

  vars['drop4_4'] = parseExpression('[1,0]t[4,4]')
  vars['drop6_2'] = parseExpression('[1,0]t[6,2]')
  vars['drop7_1'] = parseExpression('[1,0]t[7,1]')
  vars['drop8_8'] = parseExpression('[1,0]t[8,8]')
  vars['drop12_4'] = parseExpression('[1,0]t[12,4]')
  vars['drop14_2'] = parseExpression('[1,0]t[14,2]')
  vars['drop15_1'] = parseExpression('[1,0]t[15,1]')
  vars['drop16_16'] = parseExpression('[1,0]t[16,16]')
  vars['drop24_8'] = parseExpression('[1,0]t[24,8]')
  vars['drop28_4'] = parseExpression('[1,0]t[28,4]')
  vars['drop30_2'] = parseExpression('[1,0]t[30,2]')
  vars['drop31_1'] = parseExpression('[1,0]t[31,1]')
  vars['drop32_32'] = parseExpression('[1,0]t[32,32]')
  vars['drop56_8'] = parseExpression('[1,0]t[56,8]')
  vars['drop60_4'] = parseExpression('[1,0]t[60,4]')
  vars['drop62_2'] = parseExpression('[1,0]t[62,2]')
  vars['drop63_1'] = parseExpression('[1,0]t[63,1]')

  vars['fullscreen'] = parseExpression('{x:0,y:0,w:2,h:2}')
  vars['tile_full'] = parseExpression('{x:0,y:0,w:2,h:2}')
  vars['tile_tl'] = parseExpression('{x:-1/2,y:1/2,w:1,h:1}')
  vars['tile_tr'] = parseExpression('{x:1/2,y:1/2,w:1,h:1}')
  vars['tile_bl'] = parseExpression('{x:-1/2,y:-1/2,w:1,h:1}')
  vars['tile_br'] = parseExpression('{x:1/2,y:-1/2,w:1,h:1}')
  vars['tile_t'] = parseExpression('{x:0,y:1/2,w:2,h:1}')
  vars['tile_b'] = parseExpression('{x:0,y:-1/2,w:2,h:1}')
  vars['tile_l'] = parseExpression('{x:-1/2,y:0,w:1,h:2}')
  vars['tile_r'] = parseExpression('{x:1/2,y:0,w:1,h:2}')
  vars['tile_m'] = parseExpression('{x:0,y:0,w:1,h:1}')
  vars['tile_h1'] = parseExpression('{x:0,y:3/4,w:2,h:1/2}')
  vars['tile_h2'] = parseExpression('{x:0,y:1/4,w:2,h:1/2}')
  vars['tile_h3'] = parseExpression('{x:0,y:-1/4,w:2,h:1/2}')
  vars['tile_h4'] = parseExpression('{x:0,y:-3/4,w:2,h:1/2}')
  vars['tile_v1'] = parseExpression('{x:-3/4,y:0,w:1/2,h:2}')
  vars['tile_v2'] = parseExpression('{x:-1/4,y:0,w:1/2,h:2}')
  vars['tile_v3'] = parseExpression('{x:1/4,y:0,w:1/2,h:2}')
  vars['tile_v4'] = parseExpression('{x:3/4,y:0,w:1/2,h:2}')
  vars['tile_random'] = parseExpression('{x:[-7/8:7/8]r,y:[-7/8:7/8]r,w:1/2,h:1/2}')
  vars['tile_rand'] = parseExpression('{x:[-7/8:7/8]r,y:[-7/8:7/8]r,w:1/2,h:1/2}')
  vars['sparkle'] = parseExpression('{x:[-5/6:5/6]r@e,y:[-5/6:5/6]r@e,w:1/3,h:1/3}')
  vars['fireworks'] = parseExpression('{x:[-5/6:5/6]r@e,y:[-5/6:5/6]r@e,w:0.5+rnd@e,h:0.5+rnd@e}')
  vars['droplet'] = parseExpression('{w:1/4,h:1/4,x:[-15/16:15/16]r,y:[0.8:1.2]r-[0:2]e}')
  vars['spark'] = parseExpression('{w:1/8,h:1/8, x:[0,[-1.01:1]r]e, y:[0,[-1.01:1]r]e}')
  vars['gravity'] = parseExpression('{y:[0:-3/2]e*[0:3/2]e}')
  vars['firefly'] = parseExpression('{x:[-1/4:1/4]n@f*[-1:1]r@e, y:[-1/4:1/4]n@f*[-1:1]r@e}')

  vars['transparent'] = parseExpression('{r:0,g:0,b:0,a:0}')
  vars['black'] = parseExpression('{r:0,g:0,b:0,a:1}')
  vars['darkgray'] = parseExpression('{r:0.2,g:0.2,b:0.2,a:1}')
  vars['gray'] = parseExpression('{r:0.4,g:0.4,b:0.4,a:1}')
  vars['lightgray'] = parseExpression('{r:0.8,g:0.8,b:0.8,a:1}')
  vars['white'] = parseExpression('{r:1,g:1,b:1,a:1}')
  vars['red'] = parseExpression('{r:1,g:0,b:0,a:1}')
  vars['orange'] = parseExpression('{r:1,g:0.3,b:0,a:1}')
  vars['yellow'] = parseExpression('{r:1,g:0.9,b:0,a:1}')
  vars['green'] = parseExpression('{r:0,g:0.8,b:0,a:1}')
  vars['blue'] = parseExpression('{r:0,g:0.6,b:1,a:1}')
  vars['indigo'] = parseExpression('{r:0,g:0,b:0.8,a:1}')
  vars['violet'] = parseExpression('{r:0.4,g:0,b:0.8,a:1}')
  vars['purple'] = parseExpression('{r:0.6,g:0,b:0.8,a:1}')
  vars['neonpink'] = parseExpression('{r:1,g:0,b:1,a:1}')
  vars['neongreen'] = parseExpression('{r:0,g:0.7,b:1,a:1}')
  vars['rainbow'] = parseExpression('{r:[0.8,0,0]l6@f,g:[0,0.7,0]l6@f,b:[0,0,1]l6@f,a:1}')
  vars['rainbow_slow'] = parseExpression('{r:[0.8,0,0]l12@f,g:[0,0.7,0]l12@f,b:[0,0,1]l12@f,a:1}')
  vars['rainbow_fast'] = parseExpression('{r:[0.8,0,0]l2@f,g:[0,0.7,0]l2@f,b:[0,0,1]l2@f,a:1}')
  vars['random'] = parseExpression('{r:[0:0.8]n4,g:[0:0.7]n4,b:[0.1:0.9]n4,a:1}')
  vars['oil'] = parseExpression('1')
  vars['hue'] = parseExpression('2')

  vars['full'] = 'full'
  vars['simple'] = 'simple'
  vars['pad'] = 'pad'

  vars['wow'] = parseExpression('[-0.3:0.3]n2')
})
