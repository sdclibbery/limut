'use strict'
define(function(require) {

  if (!Array.prototype.flat) {
    // From https://github.com/jonathantneal/array-flat-polyfill
    console.log('!Polyfilling flat')
    Object.defineProperty(Array.prototype, 'flat', {
      configurable: true,
      value: function flat () {
        var depth = isNaN(arguments[0]) ? 1 : Number(arguments[0]);
  
        return depth ? Array.prototype.reduce.call(this, function (acc, cur) {
          if (Array.isArray(cur)) {
            acc.push.apply(acc, flat.call(cur, depth - 1));
          } else {
            acc.push(cur);
          }
  
          return acc;
        }, []) : Array.prototype.slice.call(this);
      },
      writable: true
    });
  }

  if (!Array.prototype.flatMap) {
    // From https://github.com/jonathantneal/array-flat-polyfill
    console.log('!Polyfilling flatMap')
    Object.defineProperty(Array.prototype, 'flatMap', {
      configurable: true,
      value: function flatMap (callback) {
        return Array.prototype.map.apply(this, arguments).flat();
      },
      writable: true
    });
  }

  if (!Object.fromEntries) {
    // From https://gitlab.com/moongoal/js-polyfill-object.fromentries/-/blob/master/index.js
    console.log('!Polyfilling fromEntries')
    Object.defineProperty(Object, 'fromEntries', {
      value(entries) {
        if (!entries || !entries[Symbol.iterator]) { throw new Error('Object.fromEntries() requires a single iterable argument'); }
  
        const o = {};
  
        Object.keys(entries).forEach((key) => {
          const [k, v] = entries[key];
  
          o[k] = v;
        });
  
        return o;
      },
    });
  }
  
})