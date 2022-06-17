import _ from 'lodash';

import { Mongo } from 'meteor/mongo';
import {
  stardustCollection,
  appStateChangesChan,
  addRule
} from './stardust.js';

import csp from './js-csp.es5.min.js';

const testAddRule = () => {
  const UserId = new Mongo.Collection(null);
  stardustCollection(UserId, 'userId');

  const changesChan = appStateChangesChan();
  csp.go(function*() {
    while(true) {
      const value = yield csp.take(changesChan);
      const passed =  _.isEqual(_.pick(value, 'fragmentDeltas'), {
        fragmentDeltas: {
          set: {
            page: "login"
          },
          unset: {}
        }
      });
      if (passed) {
        console.log('add-rule: PASSED');
      }
      else {
        console.log('add-rule: FAILED');
      }
    }
  });

  const rule = {
    name: 'login - user & password',
    queries: {
      userId: [UserId, 'findOne']
    },
    mount: [({userId}) => !userId?.userId, ['userId']],
    stateFragments: [
      {page: 'login'}
    ]
  };
  addRule(rule);
};

testAddRule();
