Package.describe({
  name: 'zforro:stardust',
  version: '0.0.6',
  summary: 'UI state management for Meteor',
  git: 'https://github.com/zforro/stardust.git',
  documentation: 'README.md'
});

Npm.depends({
  lodash: '4.17.15',
  immutable: '4.1.0'
});

Package.onUse(function(api) {
  api.versionsFrom('2.7');
  api.use('meteor-base');
  api.use('ecmascript');
  api.mainModule('stardust.js', 'client');
});

Package.onTest(function(api) {
  api.use('ecmascript');
  api.use('zforro:stardust');
  api.mainModule('stardust-tests.js', 'client');
});

