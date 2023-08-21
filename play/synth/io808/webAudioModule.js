'use strict';
define(function (require) {

  // taken from http://raganwald.com/2015/06/26/decorators-in-es7.html
  function mixin(behaviour, sharedBehaviour = {}) {
    const instanceKeys = Reflect.ownKeys(behaviour);
    const sharedKeys = Reflect.ownKeys(sharedBehaviour);
    const typeTag = Symbol("isa");

    function _mixin(clazz) {
      for (let property of instanceKeys)
        Object.defineProperty(clazz.prototype, property, {
          value: behaviour[property],
          writable: true
        });
      Object.defineProperty(clazz.prototype, typeTag, { value: true });
      return clazz;
    }
    for (let property of sharedKeys)
      Object.defineProperty(_mixin, property, {
        value: sharedBehaviour[property],
        enumerable: sharedBehaviour.propertyIsEnumerable(property)
      });
    Object.defineProperty(_mixin, Symbol.hasInstance, {
      value: i => !!i[typeTag]
    });
    return _mixin;
  }

  // webaudio module decorator to add the necessary `connect` function consistently between modules
  return mixin({
    connect(node) {
      if (node.hasOwnProperty("input")) {
        this.output.connect(node.input);
      } else {
        this.output.connect(node);
      }
    },

    disconnect() {
      this.output.disconnect();
    }
  });
})