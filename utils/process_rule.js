import _ from 'lodash';

import { Random } from 'meteor/random';

import { STARDUST } from '../config.js';

import { starLog } from './logging.js';

import {
  updateActiveRule,
  unregisterAllQueriesFromRule,
  unregisterAllSubsFromRule,
  removeFragments,
  mergeFragments,
} from './process_helpers.js';

//------------------------------------------------------------------------------

const isLogging = STARDUST.logs.active;


export const processRule = (value, ctx) => {

  console.debug("STARDUST - PROCESS RULE |> processing ", value);
  const {op} = value;

  if (isLogging) {
    starLog('processRule', `<< processing ${op} rule`, {
      value,
    });
  }

  return (op === 'add')    ? processAddedRule(value, ctx)
       : (op === 'change') ? processChangedRule(value, ctx)
       : (op === 'remove') ? processRemovedRule(value, ctx)
       : new Error(`processRule illegal value ${value}`);
};


const processAddedRule = (added, {
  activeQueries, activeSubs, activeRules, eventsBufferChan, verboseRules
}) => {
  const activeRule = activateRule(added.rule, activeRules, verboseRules);
  const reason = {
    _id: Random.id(),
    category: 'rule',
    op: 'added',
    content: {ruleName: activeRule.name}
  };

  if (isLogging) {
    starLog('processAddedRule', `<<< processing added rule`, {
      activeRule: _.cloneDeep(activeRule),
    });
  }

  const fragments = updateActiveRule(activeRule,
    _.first(activeRule.sortedVarsUntilMount),
    {activeQueries, activeSubs, activeRules, eventsBufferChan, reason});

  console.debug("STARDUST - PROCESS RULE - ADDED |> ",
    {activeRule, fragments, reason});

  return {fragments, reason};
};


const processChangedRule = (changed, {
  activeQueries, activeSubs, activeRules
}) => {
  const {ruleName, rule} = changed;
  const reason = {
    _id: Random.id(),
    category: 'rule',
    op: 'changed',
    content: {ruleName}
  };

  if (isLogging) {
    starLog('processChangedRule', `<<< processing changed rule`, {
      changedRule: _.cloneDeep(changed),
    });
  }

  const fragmentsFromRemoval = processRemovedRule({ruleName}, {
    activeQueries, activeSubs, activeRules, reason
  });
  const fragmentsFromAddition = processAddedRule({rule}, {
    activeQueries, activeSubs, activeRules, reason
  });
  const fragments = mergeFragments(fragmentsFromRemoval,
    fragmentsFromAddition);

  console.debug("STARDUST - PROCESS RULE - CHANGED |> ",
    {fragments, reason});

  return {fragments, reason};
};


const processRemovedRule = (removed, {
  activeQueries, activeSubs, activeRules
}) => {
  const activeRule = activeRules[removed.ruleName];
  const reason = {
    _id: Random.id(),
    category: 'rule',
    op: 'removed',
    content: {ruleName: removed.ruleName}
  };

  if (isLogging) {
    starLog('processRemovedRule', `<<< processing removed rule`, {
      removedRule: _.cloneDeep(activeRule),
    });
  }

  unregisterAllQueriesFromRule(activeRule, activeQueries);
  unregisterAllSubsFromRule(activeRule, activeSubs);

  const message = {
    fragments: removeFragments(activeRule),
    reason
  };

  _.unset(activeRules, removed.ruleName);

  console.debug("STARDUST - PROCESS RULE - REMOVED |> ", message);

  return message;
};

//------------------------------------------------------------------------------

const activateRule = (rule, activeRules, verboseRules) => {
  const name = rule.name ?? Random.id();
  const vrbs = verboseRules;

  const expandedRule = _({
    name,
    queries: _.mapValues(rule.queries, (q) => expandExpr(q, vrbs)),
    params: _.mapValues(rule.params, (p) => expandExpr(p, vrbs)),
    mount: expandExpr(rule.mount, vrbs),
    subs: _.mapValues(rule.subs, (s) => expandExpr(s, vrbs)),
    appStateFragments: _.map(rule.appStateFragments, (f) => expandExpr(f, vrbs))
  }).omitBy(_.isUndefined).value();

  const activeRule = {
    name,

    vars: _({
      mount: {
        category: 'mount',
        getMount: expandedRule.mount[0],
        dependsOn: expandedRule.mount[1],
        value: null,
        valueChangeReason: null
      },
      ..._.mapValues(expandedRule.queries, (v) => ({
        category: 'queries',
        getQuery: v[0],
        dependsOn: v[1],
        query: null,
        value: null,
        valueChangeReason: null
      })),
      ..._.mapValues(expandedRule.params, (v) => ({
        category: 'params',
        getParam: v[0],
        dependsOn: v[1],
        value: null,
        valueChangeReason: null
      })),
      ..._.mapValues(expandedRule.subs, (v) => ({
        category: 'subs',
        getSub: v[0],
        dependsOn: v[1],
        sub: null,
        value: null,
        valueChangeReason: null
      })),
      ..._(expandedRule.appStateFragments)
        .mapKeys((__, i) => `fragments.${i}`)
        .mapValues((v) => ({
          category: 'fragments',
          getFragments: v[0],
          dependsOn: v[1],
          value: null,
          valueChangeReason: null
        }))
        .value()
    }).omitBy(_.isUndefined).value(),

    _cache: {}
  };

  const {sortedVarsUntilMount, sortedVarsAfterMount} = computeEvalOrder(
    activeRule.vars);
  activeRule.sortedVarsUntilMount = sortedVarsUntilMount;
  activeRule.sortedVarsAfterMount = sortedVarsAfterMount;

  activeRules[name] = activeRule;
  return activeRule;
};


const expandExpr = (expr, verboseRules) => {
  if (_.isFunction(expr)) {
    if (verboseRules) {
      return [expr, []];
    }
    else {
      const args = extractFnArgFromSource(expr.toString());
      return [expr, args];
    }
  }
  else if ((expr?.length == 2) && _.isArray(expr[1])) {
    return [expr[0], expr[1]];
  }
  else {
    return [() => expr, []];
  }
  // return _.isFunction(expr)                       ? [expr, []]
  //   : ((expr?.length == 2) && _.isArray(expr[1])) ? [expr[0], expr[1]]
  //   :                                               [() => expr, []];
};


const extractFnArgFromSource = (fnSource) => {
  const arrowFunctionRegexp = /\(\{(.+)\}\)\s+=>/;
  const originalFunctionRegexp = /function\(\{(.+)\}\)/;
  const matched = fnSource.match(arrowFunctionRegexp) ||
        fnSource.match(originalFunctionRegexp);
  if (matched) {
    return matched[1]
      .split(',')
      .map((v) => v.trim());
  }
  else {
    return [];
  }
};


const computeEvalOrder = (activeRuleVars) => {
  const sortedVarsUntilMount = computeEvalOrderUp(['mount'], activeRuleVars);
  const sortedAllVars = computeEvalOrderUp(_.keys(activeRuleVars),
    activeRuleVars);

  // We want 'mount' to be in the earliest possible position for performance.
  // However, computeEvalOrderUp(allVars) may return an evaluation order where
  // 'mount' is not in such a position. This is because the dependency of all 
  // rule vars on 'mount' is implicit by design. As such, when
  // computeEvalOrderUp collapses independent branches of a tree, the order of 
  // those branches is not guaranteed.

  const sortedVarsAfterMount = _.difference(sortedAllVars,
    sortedVarsUntilMount);

  return {sortedVarsUntilMount, sortedVarsAfterMount};
};


const computeEvalOrderUp = (mountDeps, context) => {
  const depsSubstitutionSteps = _substituteDeps(mountDeps, context);

  const res = [];

  for (const steps of _.reverse(depsSubstitutionSteps)) {
    for (const step of steps) {
      if (!res.includes(step)) {
        res.push(step);
      }
    }
  }

  return res;
};


const _substituteDeps = (deps, context) => {
  const steps = [deps];
  let currentDeps = deps;
  let nextDeps = [];

  while (true) {
    for (const dep of currentDeps) {
      const depDependsOn = context[dep].dependsOn;
      if (depDependsOn.length) {
        for (const _dep of depDependsOn) {
          if (!nextDeps.includes(_dep)) {
            nextDeps.push(...depDependsOn);
          }
        }
      }
    }
    
    if (nextDeps.length) {
      steps.push(nextDeps);
      currentDeps = nextDeps;
      nextDeps = [];
    }
    else {
      return steps;
    }
  }
};
