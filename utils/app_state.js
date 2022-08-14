import _ from 'lodash';

import {
  Map,
  List,
  setIn,
  updateIn,
  removeIn,
  hasIn
} from 'immutable';

// -----------------------------------------------------------------------------

export const mergeFragmentsIntoAppState = (fragmentDeltas, appStateBefore) => {
  const sortedFragments = sortFragments(fragmentDeltas);
  return List(sortedFragments).reduce(reduceFragments, appStateBefore);
};


const sortFragments = ({set, unset}) => {
  return _.concat(
    _(unset)
      .mapValues(x => undefined)
      .entries()
      .sortBy()
      .reverse()
      .value(),
    _(set)
      .entries()
      .sortBy()
      .value(),
  );
};


const reduceFragments = (res, [k, v]) => {
  const _k = k.split('.');

  if (!_.isUndefined(v)) {
    const [untilLastKeys, lastKey] = [_k.slice(0, -1), _k[_k.length-1]];
    if (hasIn(res, untilLastKeys)) {
      return setIn(res, _k, v);
    }
    else {
      return updateIn(res, untilLastKeys, () => Map({[lastKey]: v}));
    }
  }
  else {
    try {
      return removeIn(res, _k);
    }
    catch (err) {
      return res;
    }
  }
};
