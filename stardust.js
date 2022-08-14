import _ from 'lodash';

import { mergeFragmentsIntoAppState } from './utils/app_state.js';
import Immutable from 'immutable';

import { processRule } from './utils/process_rule.js';
import { processTransactions } from './utils/process_transaction.js';
import { processSubReady } from './utils/process_sub_ready.js';
import { registerCollection } from './utils/stardust_collection.js';

import csp from './js-csp.es5.min.js';

//------------------------------------------------------------------------------

export const STARDUST = {
  collections: {},

  ruleChan: csp.chan(),
  txChan: csp.chan(),
  subReadyChan: csp.chan(),

  eventsBufferChan: csp.chan(),
  txBufferingInMs: 10,

  activeRules: {},
  activeQueries: new Map(),
  activeSubs: new Map(),

  appState: undefined,
  verboseRules: false
};


export const onAppStateChange = (callback) => {
  const appStateFragmentsChan = createAppStateFragmentsChan();

  let appStateBefore = Immutable.Map({});

  csp.go(function*() {
    while(true) {
      const {fragments, reason} = yield csp.take(appStateFragmentsChan);
      STARDUST.appState = mergeFragmentsIntoAppState(fragments, appStateBefore);
      appStateBefore = STARDUST.appState;

      callback(STARDUST.appState);
    }
  });
};


export const createAppStateFragmentsChan = () => {
  const out = csp.chan();

  csp.go(function*() {
    while(true) {
      const {value, channel} = yield csp.alts([
        STARDUST.ruleChan,
        STARDUST.txChan,
        STARDUST.subReadyChan
      ]);

      const channelName =
              (channel === STARDUST.ruleChan) ? 'ruleChan'
            : (channel === STARDUST.txChan) ? 'txChan'
            : (channel === STARDUST.subReadyChan) ? 'subReadyChan'
            : 'unknownChan (will lead to error)';
      console.debug(`STARDUST - ROOT CHANNELS |> ${channelName}` +
          " received: ", value);

      const ctx = {
        activeRules: STARDUST.activeRules,
        activeQueries: STARDUST.activeQueries,
        activeSubs: STARDUST.activeSubs,
        eventsBufferChan: STARDUST.eventsBufferChan,
        verboseRules: STARDUST.verboseRules
      };

      const {fragments, reason} =
              (channel === STARDUST.ruleChan) ? processRule(value, ctx)
            : (channel === STARDUST.txChan) ? processTransactions(value, ctx)
            : (channel === STARDUST.subReadyChan) ? processSubReady(value, ctx) 
            : new Error (`initAppStateMachine wrong channel: ${channel}`);

      console.debug(`STARDUST - ROOT CHANNELS |> value from ${channelName}` +
          " generated fragments/reason", fragments, reason);

      if (!_.isEmpty(fragments)) {
        csp.putAsync(out, {fragments, reason});
      }
    }
  });

  return out;
};


export const addRule = (rule) => {
  // TODO check rules consistency.
  csp.putAsync(STARDUST.ruleChan, {op: 'add', rule});
};


export const changeRule = ({rule, ruleName}) => {
  // TODO check rules consistency.
  csp.putAsync(STARDUST.ruleChan, {op: 'change', ruleName, rule});
};


export const removeRule = (ruleName) => {
  // TODO check rules consistency.
  csp.putAsync(STARDUST.ruleChan, {op: 'remove', ruleName}); 
};


const metronomeChan = csp.chan();
csp.go(function*() {
  while(true) {
    yield csp.timeout(STARDUST.txBufferingInMs);

    csp.putAsync(metronomeChan, true);
  }
});


csp.go(function*() {
  let txs = [];
  let subReadys = [];

  while(true) {
    const {value, channel} = yield csp.alts([
      STARDUST.eventsBufferChan,
      metronomeChan
    ]);

    if (channel === STARDUST.eventsBufferChan) {
      if (value.collectionName) {
        txs.push(value);
      }
      else if (value.ready) {
        subReadys.push(value);
      }
    }
    else {
      if (txs.length)  {
        csp.putAsync(STARDUST.txChan, txs);
        txs = [];
      }
      else if (subReadys.length) {
        for (const subReady of subReadys) {
          csp.putAsync(STARDUST.subReadyChan, subReady);
        }
        subReadys = [];
      }
    }
  }
});


export const stardustCollection = (collection, name) => {
  registerCollection(collection, name, STARDUST);
  collection.find({}).observe({
    added(doc) {
      csp.putAsync(STARDUST.eventsBufferChan, {
        collectionName: collection._name,
        op: 'added',
        doc
      });
    },

    changed(newDoc) {
      csp.putAsync(STARDUST.eventsBufferChan, {
        collectionName: collection._name,
        op: 'changed',
        doc: newDoc
      });
    },

    removed(oldDoc) {
      csp.putAsync(STARDUST.eventsBufferChan, {
        collectionName: collection._name,
        op: 'removed',
        doc: oldDoc
      });
    }
  });
};
