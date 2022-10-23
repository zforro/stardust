import { Meteor } from 'meteor/meteor';
import csp from './js-csp.es5.min.js';


export const STARDUST = {
  collections: {},

  ruleChan: csp.chan(),
  txChan: csp.chan(),
  subReadyChan: csp.chan(),

  eventsBufferChan: csp.chan(),
  txBufferingInMs: 8,

  activeRules: {},
  activeQueries: new Map(),
  activeSubs: new Map(),

  appState: undefined,
  verboseRules: false,
  logs: {
    active: Meteor.isDevelopment,
    bufferSize: 10000
  } 
};
