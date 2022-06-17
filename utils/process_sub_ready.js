import { Random } from 'meteor/random';
import { updateActiveRule } from './process_helpers.js';

//------------------------------------------------------------------------------

export const processSubReady = (value, {
  activeQueries, activeSubs, activeRules, eventsBufferChan
}) => {
  if (!value?.ready) new Error('processSubReady ready must be true');

  const {client: [ruleName, varName]} = value;
  const reason = {
    _id: Random.id(),
    category: 'subReady',
    content: value
  };

  const activeRule = activeRules[ruleName];
  const fragments = updateActiveRule(activeRule, varName, {
    activeQueries, activeSubs, activeRules, eventsBufferChan, reason
  });

  return {fragments, reason};
};
