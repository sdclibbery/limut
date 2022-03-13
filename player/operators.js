'use strict';
define(function(require) {

  let ignoreUndefined = (op, l,r) => {
    if (l === undefined) { return r }
    if (r === undefined) { return l }
    return op(l,r)
  }

  let operators = {
    '+': (l,r)=>ignoreUndefined((l,r)=>l+r, l,r),
    '-': (l,r)=>ignoreUndefined((l,r)=>l-r, l,r),
    '*': (l,r)=>ignoreUndefined((l,r)=>l*r, l,r),
    '/': (l,r)=>ignoreUndefined((l,r)=>l/r, l,r),
    '%': (l,r)=>ignoreUndefined((l,r)=>l%r, l,r),
    '^': (l,r)=>ignoreUndefined((l,r)=>(Math.pow(l,r) || 0), l,r),
  }
  let precedence = {'^':1,'%':2,'/':2,'*':2,'-':3,'+':3,}

  return {
    operators: operators,
    precedence: precedence,
  }
})