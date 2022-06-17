import { Meteor } from 'meteor/meteor';

import _ from 'lodash';

//------------------------------------------------------------------------------

export const registerSub = (activeSubs, sub, client, callback) => {
  let subReady;

  if (!activeSubs.has(sub)) {
    activeSubs.set(sub, {
      handle: Meteor.subscribe(sub.pubName, sub.args, callback),
      clients: [client]
    });
    subReady = false;
  }
  else {
    const runningSub = activeSubs.get(sub);
    runningSub.clients.push(client);
    subReady = true;
  }
  return subReady;
};


export const unregisterSub = (activeSubs, sub, client) => {
  if (activeSubs.has(sub)) {
    const runningSub = activeSubs.get(sub);
    const clientsAfterUnregister = _.filter(runningSub.clients, (x) => {
      return !_.isEqual(x, client);
    });
    if (clientsAfterUnregister.length) {
      runningSub.clients = clientsAfterUnregister;
    } else {
      runningSub.handle.stop();
      activeSubs.delete(sub);
    }
  }
};
