'use strict';

function parts(values) {
  return values
    .flatMap((value) => String(value || '').split('/'))
    .filter((part) => part && part !== '.');
}

function normalize(value) {
  const out = [];
  for (const part of parts([value])) {
    if (part === '..') out.pop();
    else out.push(part);
  }
  return '/' + out.join('/');
}

module.exports = {
  resolve(...values) {
    return normalize(values.join('/'));
  },
  join(...values) {
    return normalize(values.join('/'));
  }
};
