import _ from 'lodash';

//--------------------------------------------------------------------------------------------------

export const flattenKeys = (obj) => _flattenKeys(obj);


const _flattenKeys = (obj, key='') => {
  let res = [];
  if (_.isPlainObject(obj)) {
    for (const [k, v] of Object.entries(obj)) {
      res = res.concat(_flattenKeys(v, key ? `${key}.${k}` : k));
    }
  } else if (key === '' && !obj) {
    return [];
  } else {
    return [[key, obj]];
  }
  return res;
};


export const sliceFrom = (array, predicate, inclusive=true) => {
  const [__, rest] = splitAround(array, predicate, !inclusive);

  return rest;
};


const splitAround = (array, predicate, inclusive=true) => {
  const pred = _.isFunction(predicate)
        ? predicate
        : x => _.isEqual(x, predicate);

  const idx = _.findIndex(array, pred);
  if (idx === -1) {
    return [[], array];
  }
  else {
    return [array.slice(0, idx+(+inclusive)), array.slice(idx+(+inclusive))];
  }
};


export const deepMerge = (a, b) => {
  // _.mergeWith(a, b, (oV, sV) => _.isArray(oV) ? oV.concat(sV) : undefined)
  // does not give intended result for cases like follows:
  // _.mergeWith({}, {a: {b: [1]}}, customizer) => {a: {b: [1, 1]}}
  // This is because of inplace mutation.

  const flattenedA = flattenKeys(a);
  const flattenedB = flattenKeys(b);

  const res = {};

  for (const [k, v] of flattenedA) {
    _.set(res, k, v);
  }

  for (const [k, v] of flattenedB) {
    if (_.isArray(v)) {
      _.set(res, k, _.get(res, k, []).concat(v));
    } else {
      _.set(res, k, v);
    }
  }

  return res;
};
