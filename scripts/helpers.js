/*!
 * Copyright 2016 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

var path = require('path');
var uniq = require('array-uniq');
var globby = require('globby');
var execSync = require('child_process').execSync;
var extend = require('extend');

require('shelljs/global');

/**
 * google-cloud-node root directory.. useful in case we need to cd
 */
var ROOT_DIR = path.join(__dirname, '..');

module.exports.ROOT_DIR = ROOT_DIR;

/**
 * Helper class to make install dependencies + running tests easier to read
 * and less error prone.
 *
 * @class Module
 * @param {string} name - The module name (e.g. common, bigquery, etc.)
 */
function Module(name) {
  if (!(this instanceof Module)) {
    return new Module(name);
  }

  this.name = name;
  this.directory = path.join(ROOT_DIR, 'packages', name);

  var pkgJson = require(path.join(this.directory, 'package.json'));

  this.packageName = pkgJson.name;
  this.dependencies = Object.keys(pkgJson.devDependencies || {});
}

/**
 * Umbrella module name.
 *
 * @static
 */
Module.UMBRELLA = 'google-cloud';

/**
 * Retrieves a list of modules that are ahead of origin/master. We do this by
 * creating a temporary remote branch that points official master branch.
 * We then do a git diff against the two to get a list of files. From there we
 * only care about either JS or JSON files being changed.
 *
 * @static
 * @return {Module[]} modules - The updated modules.
 */
Module.getUpdated = function() {
  cd(ROOT_DIR);

  run([
    'git remote add temp',
    'https://github.com/GoogleCloudPlatform/google-cloud-node.git'
  ]);

  run('git fetch -q temp');

  var output = run('git diff HEAD temp/master --name-only', {
    stdio: null // prevents piping to the console
  });

  var files = output.trim().split('\n');
  var modules = files.filter(function(file) {
    return /^packages\/.+\.js/.test(file);
  }).map(function(file) {
    return file.split('/')[1];
  });

  return uniq(modules).map(Module);
};

/**
 * Builds docs for all modules
 *
 * @static
 */
Module.buildDocs = function() {
  run('npm run docs', { cwd: ROOT_DIR });
};

/**
 * Returns a list containing ALL the modules.
 *
 * @static
 * @return {Module[]} modules - All of em'!
 */
Module.getAll = function() {
  cd(ROOT_DIR);

  return globby
    .sync('*', { cwd: 'packages' })
    .map(Module);
};

/**
 * Returns a list of modules that are dependent on one or more of the modules
 * specified.
 *
 * @static
 * @param {Module[]} modules - The dependency modules.
 * @return {Module[]} modules - The dependent modules.
 */
Module.getDependents = function(modules) {
  return Module.getAll().filter(function(mod) {
    return mod.hasDeps(modules);
  });
};

/**
 * Installs dependencies for all the modules!
 *
 * @static
 */
Module.installAll = function() {
  run('npm run postinstall', { cwd: ROOT_DIR });
};

/**
 * Generates an lcov coverage report for the specified modules.
 *
 * @static
 */
Module.runCoveralls = function() {
  run('npm run coveralls', { cwd: ROOT_DIR });
};

/**
 * Installs this modules dependencies via `npm install`
 */
Module.prototype.install = function() {
  run('npm install', { cwd: this.directory });
};

/**
 * Creates/uses symlink for a module (depending on if module was provided)
 * via `npm link`
 *
 * @param {Module=} mod - The module to use with `npm link ${mod.packageName}`
 */
Module.prototype.link = function(mod) {
  run(['npm link', mod && mod.packageName || ''], {
    cwd: this.directory
  });
};

/**
 * Runs unit tests for this module via `npm run test`
 */
Module.prototype.runUnitTests = function() {
  run('npm run test', { cwd: this.directory });
};

/**
 * Runs snippet tests for this module.
 */
Module.prototype.runSnippetTests = function() {
  process.env.TEST_MODULE = this.name;
  run('npm run snippet-test', { cwd: ROOT_DIR });
  delete process.env.TEST_MODULE;
};

/**
 * Runs system tests for this module via `npm run system-test`
 */
Module.prototype.runSystemTests = function() {
  run('npm run system-test', { cwd: this.directory });
};

/**
 * Checks to see if this module has one or more of the supplied modules
 * as a dev dependency.
 *
 * @param {Module[]} modules - The modules to check for.
 * @return {boolean}
 */
Module.prototype.hasDeps = function(modules) {
  var packageName;

  for (var i = 0; i < modules.length; i++) {
    packageName = modules[i].packageName;

    if (this.dependencies.indexOf(packageName) > -1) {
      return true;
    }
  }

  return false;
};

module.exports.Module = Module;

/**
 * Exec's command via child_process.execSync.
 * By default all output will be piped to the console unless `stdio`
 * is overridden.
 *
 * @param {string|string[]} command - The command to run.
 * @param {object=} options - Options to pass to `execSync`.
 * @return {string|null} -
 */
function run(command, options) {
  var response;

  options = extend({
    stdio: [0, 1, 2]
  }, options);

  if (Array.isArray(command)) {
    command = command.join(' ');
  }

  echo(command);

  try {
    response = execSync(command, options);
  } catch (e) {
    console.error(e.message);
    exit(1);
  }

  if (response instanceof Buffer) {
    return response.toString();
  }
}

module.exports.run = run;

/**
 * Used to make committing to git easier/etc..
 *
 * @param {string=} cwd - Directory to commit/add/push from.
 */
function Git(cwd) {
  this.cwd = cwd || ROOT_DIR;
}

// We'll use this for cloning/submoduling/pushing purposes on CI
Git.REPO = 'https://${GH_OAUTH_TOKEN}@github.com/${GH_OWNER}/${GH_PROJECT_NAME}';

/**
 * Creates a submodule in the root directory in quiet mode.
 *
 * @param {string} branch - The branch to use.
 * @param {string=} alias - Name of the folder that contains submodule.
 * @return {Git}
 */
Git.prototype.submodule = function(branch, alias) {
  alias = alias || branch;

  run(['git submodule add -q -b', branch, Git.REPO, alias], {
    cwd: this.cwd
  });

  return new Git(path.join(this.cwd, alias));
};

/**
 * Check to see if git has any files it can commit.
 *
 * @return {boolean}
 */
Git.prototype.hasUpdates = function() {
  var output = run('git status --porcelain', {
    cwd: this.cwd,
    stdio: null
  });

  return !!output && output.trim().length > 0;
};

/**
 * Sets git user
 *
 * @param {string} name - User name
 * @param {string} email - User email
 */
Git.prototype.setUser = function(name, email) {
  run(['git config user.name', name], {
    cwd: this.cwd
  });

  run(['git config user.email', email], {
    cwd: this.cwd
  });
};

/**
 * Adds all files passed in via git add
 *
 * @param {...string} file - File to add
 */
Git.prototype.add = function() {
  var files = [].slice.call(arguments);
  var command = ['git add'].concat(files);

  run(command, {
    cwd: this.cwd
  });
};

/**
 * Commits to git via commit message.
 *
 * @param {string} message - The commit message.
 */
Git.prototype.commit = function(message) {
  run(['git commit -m', '"' + message + '"', '[ci skip]'], {
    cwd: this.cwd
  });
};

/**
 * Runs git status and pushes changes in quiet mode.
 *
 * @param {string} branch - The branch to push to.
 */
Git.prototype.push = function(branch) {
  run('git status', {
    cwd: this.cwd
  });

  run(['git push -q', Git.REPO, branch], {
    cwd: this.cwd
  });
};

module.exports.git = new Git();

/**
 * The name of the branch currently being tested.
 *
 * @alias ci.BRANCH
 */
var BRANCH = process.env.TRAVIS_BRANCH || process.env.APPVEYOR_REPO_BRANCH;

/**
 * Checks to see if this is a pull request or not.
 *
 * @alias ci.IS_PR
 */
var IS_PR = (function() {
  if (process.env.TRAVIS_PULL_REQUEST) {
    return process.env.TRAVIS_PULL_REQUEST !== 'false';
  }
  return !!process.env.APPVEYOR_PULL_REQUEST_NUMBER;
}());

/**
 * Returns the tag name (assuming this is a release)
 *
 * @alias ci.getTagName
 * @return {string|null}
 */
function getTagName() {
  return process.env.TRAVIS_TAG || process.env.APPVEYOR_REPO_TAG_NAME;
}

/**
 * Let's us know whether or not this is a release.
 *
 * @alias ci.isReleaseBuild
 * @return {string|null}
 */
function isReleaseBuild() {
  return !!getTagName();
}

/**
 * Returns name/version of release.
 *
 * @alias ci.getRelease
 * @return {object|null}
 */
function getRelease() {
  var tag = getTagName();

  if (!tag) {
    return null;
  }

  var parts = tag.split('-');

  return {
    version: parts.pop(),
    name: parts.pop() || Module.UMBRELLA
  };
}

/**
 * Checks to see if this is a push to master.
 *
 * @alias ci.isPushToMaster
 * @return {boolean}
 */
function isPushToMaster() {
  return BRANCH === 'master' && !IS_PR;
}

/**
 * Checks to see if this the CI's first pass (Travis only)
 *
 * @alias ci.isFirstPass
 * @return {boolean}
 */
function isFirstPass() {
  return /\.1$/.test(process.env.TRAVIS_JOB_NUMBER);
}

module.exports.ci = {
  BRANCH: BRANCH,
  IS_PR: IS_PR,
  getTagName: getTagName,
  isReleaseBuild: isReleaseBuild,
  getRelease: getRelease,
  isPushToMaster: isPushToMaster,
  isFirstPass: isFirstPass
};
