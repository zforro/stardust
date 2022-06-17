Package.describe({
  name: 'zforro:stardust',
  version: '0.0.1',
  // Brief, one-line summary of the package.
  summary: 'UI state management for Meteor',
  // URL to the Git repository containing the source code for this package.
  git: '',
  // By default, Meteor will default to using README.md for documentation.
  // To avoid submitting documentation, set this field to null.
  documentation: 'README.md'
});

Npm.depends({
  lodash: '4.17.15',
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

