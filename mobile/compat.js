/* APK-only fallbacks for the ES2022 methods used by the game. Keep this file
 * compatible with older JavaScript parsers; the game itself requires ES2020. */
(function () {
  'use strict';

  if (typeof Object.hasOwn !== 'function') {
    var owns = Object.prototype.hasOwnProperty;
    Object.defineProperty(Object, 'hasOwn', {
      configurable: true,
      writable: true,
      value: function hasOwn(object, key) {
        if (object === null || object === undefined) throw new TypeError('Cannot convert null or undefined to object');
        return owns.call(Object(object), key);
      }
    });
  }

  if (typeof Array.prototype.at !== 'function') {
    Object.defineProperty(Array.prototype, 'at', {
      configurable: true,
      writable: true,
      value: function at(index) {
        if (this === null || this === undefined) throw new TypeError('Cannot convert null or undefined to object');
        var object = Object(this);
        // Unary + performs ToNumber, including the required BigInt/Symbol errors.
        var length = +object.length;
        length = length !== length || length <= 0 ? 0 : Math.min(Math.floor(length), 9007199254740991);
        var relativeIndex = +index;
        if (relativeIndex !== relativeIndex) relativeIndex = 0;
        else if (relativeIndex !== 0 && isFinite(relativeIndex)) relativeIndex = relativeIndex < 0 ? Math.ceil(relativeIndex) : Math.floor(relativeIndex);
        var position = relativeIndex >= 0 ? relativeIndex : length + relativeIndex;
        if (position < 0 || position >= length) return undefined;
        return object[position];
      }
    });
    if (typeof Symbol === 'function' && Symbol.unscopables) {
      var unscopables = Array.prototype[Symbol.unscopables];
      if (!unscopables) {
        unscopables = Object.create(null);
        Object.defineProperty(Array.prototype, Symbol.unscopables, { configurable: true, value: unscopables });
      }
      unscopables.at = true;
    }
  }
}());
