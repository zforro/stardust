import _ from 'lodash';

import { Random } from 'meteor/random';

import {
  updateActiveRules,
} from './process_helpers.js';

import {
  executeQuery
} from './queries_manager.js';

import {
  deepMerge
} from './misc.js';

//------------------------------------------------------------------------------

export const processTransactions = (txs, ctx) => {
  console.debug("STARDUST - PROCESS TX |> processing ", txs);

  let varsToUpdateByRule = {};

  for (const tx of txs) {
    varsToUpdateByRule = deepMerge(varsToUpdateByRule,
          (tx.op === 'added')   ? processAddedTransaction(tx, ctx)
        : (tx.op === 'changed') ? processChangedTransaction(tx, ctx)
        : (tx.op === 'removed') ? processRemovedTransaction(tx, ctx)
        : new Error(`processTransaction illegal txs ${txs}`));
  };

  return {
    fragments: updateActiveRules(varsToUpdateByRule, ctx),
    reason: {
      _id: Random.id(),
      category: 'transaction',
      txs: _(varsToUpdateByRule)
        .flatMap('reasons')
        .uniqWith(_.isEqual)
        .value()
    }
  };
};


export const processTransaction2 = (txs, ctx) => {
  console.debug("STARDUST - PROCESS TX |> processing ", txs);
  return (txs.op === 'added')   ? processAddedTransaction(txs, ctx)
    : (txs.op === 'changed') ? processChangedTransaction(txs, ctx)
    : (txs.op === 'removed') ? processRemovedTransaction(txs, ctx)
    : new Error(`processTransaction illegal txs ${txs}`);
};


const processAddedTransaction = (tx, {
  activeQueries, activeSubs, activeRules, eventsBufferChan
}) => {
  const {collectionName, doc} = tx;

  const varsToUpdateByRule = {};
  for (const [queryAsString, content] of Array.from(activeQueries.entries())) {
    const [collection, op, selector, fields] = content.query;
    if (collection._name === collectionName && 
        queryMatchesDoc(content.matcher, doc)) {

      const activeQuery = activeQueries.get(queryAsString);
      const {data} = activeQuery;

      const newDoc = applyFieldRestrictions(doc, fields);

      if (op === 'find') {
        data.set(doc._id, newDoc);
        registerForUpdate(varsToUpdateByRule, content.clients, tx);
      }
      else if (op === 'findOne' && !data) {
        // && !data is important as we don't want to change the result of the
        // findOne if new data entered the result set.
        activeQuery.data = newDoc;
        registerForUpdate(varsToUpdateByRule, content.clients, tx);
      }
    }
  }

  return varsToUpdateByRule;
};


const processChangedTransaction = (tx, {
  activeQueries, activeSubs, activeRules, eventsBufferChan
}) => {
  const {collectionName, doc} = tx;

  const varsToUpdateByRule = {};
  for (const [queryAsString, content] of Array.from(activeQueries.entries())) {
    const [collection, op, selector, fields] = content.query;

    if (collection._name === collectionName) {
      const activeQuery = activeQueries.get(queryAsString);
      const {data} = activeQuery;

      const docBefore = (op === 'find') ? data.get(doc._id) : data;
      const matched = queryMatchesDoc(content.matcher, doc);

      if (!matched && !docBefore) {
        // doc was not part of the result set before. Don't add it either.
        continue;
      }

      else if (!matched && docBefore) {
        if (op === 'find') {
          // doc was part of the result set. Not anymore. Remove.
          data.delete(doc._id);
          registerForUpdate(varsToUpdateByRule, content.clients, tx);
        }
        else if (op === 'findOne' && _.isEqual(doc._id, docBefore._id)) {
          // findOne currently returns a document that doesn't match the query.
          // Re-perform the findOne to update its result. The fact that the
          // current document is not in the result set anymore doesn't mean that
          // there isn't another one that is.
          activeQuery.data = executeQuery(content.query);
          registerForUpdate(varsToUpdateByRule, content.clients, tx);
        }
      }

      else if (matched && !docBefore) {
        // doc is now part of the result set. Wasn't before. Add it.
        const docAfter =  applyFieldRestrictions(doc, fields);
        if (op === 'find') {
          data.set(doc._id, docAfter);
        }
        else {
          activeQuery.data = docAfter;
        }
        registerForUpdate(varsToUpdateByRule, content.clients, tx);
      }

      else if (matched && docBefore) {
        // doc has changed but is still part of the result set. Replace.
        const docAfter = applyFieldRestrictions(doc, fields);
        if (op === 'find') {
          data.set(doc._id, docAfter);
          registerForUpdate(varsToUpdateByRule, content.clients, tx);
        }
        else if (op === 'findOne' && _.isEqual(doc._id, docBefore._id)) {
          activeQuery.data = docAfter;
          registerForUpdate(varsToUpdateByRule, content.clients, tx);
        }
      }
    }
  }

  return varsToUpdateByRule;
};


const processRemovedTransaction = (tx, {
  activeQueries, activeSubs, activeRules, eventsBufferChan
}) => {
  const {collectionName, doc} = tx;

  const varsToUpdateByRule = {};
  for (const [queryAsString, content] of Array.from(activeQueries.entries())) {
    const [collection, op, selector, fields] = content.query;

    if (collection._name == collectionName) {
      const activeQuery = activeQueries.get(queryAsString);
      const {data} = activeQuery;

      if (op === 'find' && data.has(doc._id)) {
        data.delete(doc._id);
        registerForUpdate(varsToUpdateByRule, content.clients, tx);
      }
      else if (_.isEqual(doc._id, data?._id)) {
        activeQuery.data = executeQuery(content.query);
        registerForUpdate(varsToUpdateByRule, content.clients, tx);
      }
    }
  }

  return varsToUpdateByRule;
};


//------------------------------------------------------------------------------


const queryMatchesDoc = (matcher, doc) => {
  return matcher.documentMatches(doc);
};


const applyFieldRestrictions = (doc, fields) => {
  if (!fields) {
    return doc;
  }
  else if (_.every(fields, v => !!v)) {
    return _.pick(doc, ['_id'].concat(_.keys(fields)));
  }
  else if (_.every(fields, v => !v)) {
    return _.omit(doc, _.keys(_.omit(fields, '_id')));
  }
  else {
    throw new Error(
      'applyFieldRestrictions: mix of inclusion and exclusion styles: ' +
        fields
    );
  }
};


const registerForUpdate = (varNamesByRuleName, clients, tx) => {
  for (const [ruleName, varName] of clients) {
    if (varNamesByRuleName[ruleName]) {
      varNamesByRuleName[ruleName].varNames.push(varName);
      varNamesByRuleName[ruleName].reasons.push(tx);
    }
    else {
      varNamesByRuleName[ruleName] = {varNames: [varName], reasons: [tx]};
    }
  }
};
