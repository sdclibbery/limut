'use strict';
define(function(require) {

  let operators = {
    '+': (l,r)=>l+r,
    '-': (l,r)=>l-r,
    '*': (l,r)=>l*r,
    '/': (l,r)=>l/r,
    '%': (l,r)=>l%r,
    '^': (l,r)=>(Math.pow(l,r) || 0),
  }
  let precedence = {'^':1,'%':2,'/':2,'*':2,'-':3,'+':3,}

  return {
    operators: operators,
    precedence: precedence,
  }
})