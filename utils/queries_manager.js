import _ from 'lodash';

import { Minimongo } from 'meteor/minimongo';

import {
  flattenKeys
} from './misc.js';

//------------------------------------------------------------------------------

export const registerQuery = (activeQueries, query, client) => {
  // query which is [collection, op, selector, projection] cannot be used
  // as key in the javascript Map because:
  // const m = new Map()
  // const k = {a: 'b'}
  // m.set(k, 42)
  // m.get(k) => 42 // all seems fine however...
  // m.get({a: 'b'}) => undefined // not working if not the same object in memory

  const queryAsString = stringifyQuery(query);

  if (!activeQueries.has(queryAsString)) {
    const data = executeQuery(query);
    activeQueries.set(queryAsString, {
      data,
      clients: [client],
      matcher: new Minimongo.Matcher(query[2]),
      query
    });
    return data;
  }
  else {
    const {clients, data} = activeQueries.get(queryAsString);
    if (!_.find(clients, el => _.isEqual(el ,client))) {
      clients.push(client);
    }
    return data;
  }
};


export const getQuery = (activeQueries, query) => {
  const queryAsString = stringifyQuery(query);

  return activeQueries.get(queryAsString);
};


export const executeQuery = ([collection, method, selector, fields]) => {
  // Defensive cloning as collection.find(selector) mutates the selector
  // (in the current case via ImmutableCollections). Clojure is so right...
  const clonedSelector = _.cloneDeep(selector);

  if (method == 'findOne') {
    return collection.findOne(clonedSelector, {
      fields: fields ?? {}, reactive: false
    });
  }
  else if (method == 'find') {
    const data = new Map();
    collection.find(clonedSelector, {
      fields: fields ?? {}, reactive: false
    }).forEach((doc) => {
      data.set(doc._id, doc);
    });
    return data;
  }
  else {
    throw new Error(`executeQuery: method ${method} unsupported`);
  }
};


export const unregisterQuery = (activeQueries, query, client) => {
  const queryAsString = stringifyQuery(query);

  const activeQuery = activeQueries.get(queryAsString);
  const clientsAfterUnregister = _.differenceWith(
    activeQuery.clients, [client], _.isEqual
  );

  if (clientsAfterUnregister.length) {
    activeQuery.clients = clientsAfterUnregister;
  }
  else {
    activeQueries.delete(queryAsString);
  }
};


const stringifyQuery = (query) => {
  const collectionName = query[0]._name;
  const op = query[1];
  const flatSelector = _.isEmpty(query[2])
        ? query[2]
        : _.fromPairs(_.sortBy(flattenKeys(query[2])));
  const flatProjection = _.isEmpty(query[3])
        ? query[3]
        : _.fromPairs(_.sortBy(flattenKeys(query[3])));

  return [
    collectionName,
    op,
    JSON.stringify(flatSelector),
    JSON.stringify(flatProjection)
  ].join(" | ");
};
