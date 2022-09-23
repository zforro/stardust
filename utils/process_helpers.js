import { _ } from 'lodash';
import csp from '../js-csp.es5.min.js';

import { Random } from 'meteor/random';

import { STARDUST } from '../config.js';

import { starLog } from './logging.js';

import {
  getQuery,
  registerQuery,
  unregisterQuery
} from './queries_manager.js';

import {
  registerSub,
  unregisterSub
} from './subs_manager.js';

import {
  flattenKeys,
  sliceFrom
} from './misc.js';

//------------------------------------------------------------------------------

const isLogging = STARDUST.logs.active;

/*
 * Updating Rule
 */

export const updateActiveRules = (varsToUpdateByRule, {
  activeQueries, activeSubs, activeRules, eventsBufferChan
}) => {
  let fragments = {};
  let ctx = {activeQueries, activeSubs, activeRules, eventsBufferChan};

  if (isLogging) {
    starLog('updateActiveRules', `<<<< updating active rules`, {
      varToUpdateByRule: _.cloneDeep(varsToUpdateByRule),
    });
  }

  for (const [ruleName,
              {varNames, reasons}] of Object.entries(varsToUpdateByRule)) {
    const activeRule = activeRules[ruleName];
    const highestRankingVarName = getHighestRankingVarName(activeRule, varNames);
    fragments = mergeFragments(fragments,
      updateActiveRule(activeRule,
        highestRankingVarName, _.extend(ctx, {
          reason: {
            _id: Random.id(),
            category: 'transaction',
            txs: reasons
          }})));
  }
  
  return fragments;
};


export const updateActiveRule = (activeRule, varName, {
  activeQueries, activeSubs, activeRules, eventsBufferChan, reason
}) => {
  const ctx = {activeQueries, activeSubs, activeRules, eventsBufferChan, reason};
  let fragments = {};

  const mountDependsOnVarName = activeRule.sortedVarsUntilMount.includes(
    varName);

  if (isLogging) {
    starLog('updateActiveRule', `<<<<< updating active rule`, {
      activeRule: _.cloneDeep(activeRule),
      ruleName: activeRule.name,
      varName: varName,
      ctx: _.cloneDeep(ctx),
    });
  }

  if (mountDependsOnVarName) {
    const fromVarNameUntilMount = sliceFrom(activeRule.sortedVarsUntilMount,
      varName);
    const mountedBefore = !!activeRule.vars.mount.value;

    for (const _varName of fromVarNameUntilMount) {
      // No fragments will be returned as 'mount' cannot depend on 'fragments'
      // As such, `fragments.${i}` cannot be in fromVarNameUntilMount 
      updateVar(activeRule, _varName, ctx);
    }

    const mountedAfter = activeRule.vars.mount.value;

    if (mountedBefore && mountedAfter) {
      fragments = updateActiveRule(activeRule,
        _.first(activeRule.sortedVarsAfterMount), ctx);
    }
    else if (mountedBefore && !mountedAfter) {
      fragments = unmountActiveRule(activeRule, ctx);
    }
    else if (!mountedBefore && mountedAfter) {
      fragments = updateActiveRule(activeRule,
        _.first(activeRule.sortedVarsAfterMount), ctx);
    }

    return fragments;
  }

  else {
    const fromVarName = sliceFrom(activeRule.sortedVarsAfterMount, varName);
    for (const _varName of fromVarName) {
      fragments = _.mergeWith(fragments, updateVar(activeRule, _varName, ctx),
        (__, srcValue) => _.isArray(srcValue) ? srcValue : undefined);
    }

    return fragments;
  }
};


export const unmountActiveRule = (activeRule, {
  activeQueries, activeSubs, activeRules, reason
}) => {
  const fragments = removeFragments(activeRule);

  for (const varName of activeRule.sortedVarsAfterMount) {
    const activeRuleVar = activeRule.vars[varName];
    const {category} = activeRuleVar;

    if (category === 'queries') {
      if (activeRuleVar.query) {
        unregisterQuery(activeQueries, activeRuleVar.query,
          [activeRule.name, varName]);
        activeRuleVar.query = null;
      }
    }

    else if (category === 'subs') {
      if (activeRuleVar.sub) {
        unregisterSub(activeSubs, activeRuleVar.sub,
          [activeRule.name, varName]);
        activeRuleVar.sub = null;
      }
    }

    else if (category === 'fragments') {
      _.unset(activeRule._cache, varName);
    }

    activeRuleVar.value = null;
    activeRuleVar.valueChangeReason = reason;
  }

  return fragments;
};


const updateVar = (activeRule, varName, {
  activeQueries, activeSubs, activeRules, eventsBufferChan, reason
}) => {
  let fragments = {};

  const activeRuleVar = activeRule.vars[varName];
  const {category, value, valueChangeReason} = activeRuleVar;
  const ctx = _.mapValues(activeRule.vars, (v) => v.value);

  if (isLogging) {
    starLog('updateVar', `<<<<<< updating var ${varName}`, {
      activeRuleVar: _.cloneDeep(activeRuleVar),
      ruleName: activeRule.name,
      varName: varName,
      ctx: _.cloneDeep(ctx),
    });
  }

  if (category === 'mount') {
    const curMount = value;
    const newMount = !!activeRuleVar.getMount(ctx);

    if (curMount != newMount) {
      activeRuleVar.value = newMount;
      activeRuleVar.valueChangeReason = reason;
    }
  }

  else if (category == 'queries') {
    const curQuery = activeRuleVar.query;
    const newQuery = _.cloneDeep(activeRuleVar.getQuery(ctx));

    if (curQuery && newQuery) {
      if (!_.isEqual(curQuery, newQuery)) {
        unregisterQuery(activeQueries, curQuery, [activeRule.name, varName]);
        const data = registerQuery(activeQueries, newQuery, [
          activeRule.name, varName
        ]);
        activeRuleVar.value = copy(data);
        activeRuleVar.valueChangeReason = reason;
      }
      else if (reason.category === 'transaction') {
        const data = getQuery(activeQueries, curQuery).data;
        activeRuleVar.value = copy(data);
        activeRuleVar.valueChangeReason = reason;
      }
    }
    else if (curQuery && !newQuery) {
      unregisterQuery(activeQueries, curQuery, [activeRule.name, varName]);
      if (!_.isUndefined(value)) {
        // Only update value if result of curQuery wasn't already undefined
        // (possible if a findOne didn't return anything)
        activeRuleVar.value = undefined;
        activeRuleVar.valueChangeReason = reason;
      }
    }
    else if (!curQuery && newQuery) {
      const data = registerQuery(activeQueries, newQuery, [
        activeRule.name, varName
      ]);
      activeRuleVar.value = copy(data);
      activeRuleVar.changeReason = reason;
    }
    else if (!curQuery && !newQuery) {
      // TODO useless?
      if (!_.isUndefined(value)) {
        activeRuleVar.value = undefined;
        activeRuleVar.valueChangeReason = reason;
      }
    }

    activeRuleVar.query = newQuery;
  }

  else if (category == 'params') {
    const curParams = value;
    const newParams = activeRuleVar.getParam(ctx);
    if (!_.isEqual(curParams, newParams)) {
      activeRuleVar.value = newParams;
      activeRuleVar.valueChangeReason = reason;
    }
  }

  else if (category == 'subs') {
    const curSub = activeRuleVar.sub;
    const newSub = activeRuleVar.getSub(ctx);

    if (curSub && newSub) {
      if (!_.isEqual(curSub, newSub)) {
        unregisterSub(activeSubs, curSub, [activeRule.name, varName]);
        const subReady = registerSub(
          activeSubs, newSub, [activeRule.name, varName], () => {
            csp.putAsync(eventsBufferChan, {
              ready: true, client: [activeRule.name, varName]
            });
          });
        activeRuleVar.value = subReady;
        activeRuleVar.valueChangeReason = reason;
      }
      else if (reason.category === 'subReady') {
        activeRuleVar.value = true;
        activeRuleVar.valueChangeReason = reason;
      }
    }
    else if (curSub && !newSub) {
      unregisterSub(activeSubs, curSub, [activeRule.name, varName]);
      activeRuleVar.value = undefined;
      activeRuleVar.valueChangeReason = reason;
    }
    else if (!curSub && newSub) {
      const subReady = registerSub(
        activeSubs, newSub, [activeRule.name, varName], () => {
          csp.putAsync(eventsBufferChan, {
            ready: true, client: [activeRule.name, varName]
          });
        });
      activeRuleVar.value = subReady;
      activeRuleVar.valueChangeReason = reason;
    }

    activeRuleVar.sub = newSub;
  }

  else if (category == 'fragments') {
    const curFragments = value;
    const newFragments = activeRuleVar.getFragments(ctx);

    if (!_.isEqual(curFragments, newFragments)) {
      const flatCurFragments = activeRule._cache[varName] ?? [];
      const flatNewFragments = flattenKeys(newFragments);

      fragments = diffFragments(flatNewFragments, flatCurFragments);

      activeRuleVar.value = newFragments;
      activeRuleVar.valueChangeReason = reason;
      activeRule._cache[varName] = flatNewFragments;
    }
  }

  if (isLogging) {
    starLog('updateVar', `>>>>>> updated var ${varName}`, {
      activeRuleVar: _.cloneDeep(activeRuleVar),
      ruleName: activeRule.name,
      varName: varName,
      fragments,
      ctx: _.cloneDeep(ctx),
    });
  }

  return fragments;
};

//------------------------------------------------------------------------------

/*
 * Manipulating Fragments
 */

export const mergeFragments = (fragments, additionalFragments) => {
  return _.mergeWith(fragments, additionalFragments,
    (__, srcValue) => _.isArray(srcValue) ? srcValue : undefined);
};


export const removeFragments = (activeRule) => {
  const activeRuleFragmentKeys = _(activeRule.vars)
        .pickBy({category: 'fragments'})
        .keys()
        .value();
  const allFlatFragments = _(activeRule._cache)
        .pick(activeRuleFragmentKeys)
        .values()
        .value();

  let fragments = {set: {}, unset: {}};
  for (const flatFragment of allFlatFragments) {
    const newFragments = diffFragments([], flatFragment);
    fragments = mergeFragments(fragments, newFragments);
  }

  return fragments;
};


const diffFragments = (flatNewFragment, flatCurFragment) => {
  const subFragments = {};
  const keysToRemove = {};

  for (const [k ,v] of flatNewFragment) {
    if (_.isUndefined(v)) {
      keysToRemove[k] = 1;
    }
    else {
      subFragments[k] = v;
    }
  }

  const keysToAdd = _.keys(subFragments);
  for (const [k, v] of flatCurFragment) {
    if (_.isUndefined(subFragments[k])) {
      keysToRemove[k] = 1;
    }
  }
  
  return {
    set: subFragments,
    unset: keysToRemove
  };
};

//------------------------------------------------------------------------------

/*
 * Unregistering Queries/Subs
 */

export const unregisterAllQueriesFromRule = (activeRule, activeQueries) => {
  const queries = _(activeRule.vars)
        .map((v, varName) => ({query: v.query, varName}))
        .filter(v => v.query)
        .value();

  for (const {query, varName} of queries) {
    unregisterQuery(activeQueries, query, [activeRule.name, varName]);
  }
};


export const unregisterAllSubsFromRule = (activeRule, activeSubs) => {
  const subs = _(activeRule.vars)
        .map((v, varName) => ({sub: v.sub, varName}))
        .filter(v => v.sub)
        .value();

  for (const {sub, varName} of subs) {
    unregisterSub(activeSubs, sub, [activeRule.name, varName]);
  }
};

//------------------------------------------------------------------------------

/*
 * Helpers
 */

const getHighestRankingVarName = (activeRule, varNames)  => {
  const allSortedVars = activeRule.sortedVarsUntilMount.concat(
    activeRule.sortedVarsAfterMount);

  return _(varNames)
    .sortBy((varName) => _.indexOf(allSortedVars, varName))
    .first();
};


const copy = (data) => {
  if (data instanceof Map) {
    return Array.from(data.values());
  }
  else {
    return data;
  }
};

