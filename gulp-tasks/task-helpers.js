/**
 * @license
 * Copyright (c) 2017 The Polymer Project Authors. All rights reserved.
 * This code may only be used under the BSD style license found at http://polymer.github.io/LICENSE.txt
 * The complete set of authors may be found at http://polymer.github.io/AUTHORS.txt
 * The complete set of contributors may be found at http://polymer.github.io/CONTRIBUTORS.txt
 * Code distributed by Google as part of the polymer project is also
 * subject to an additional IP rights grant found at http://polymer.github.io/PATENTS.txt
 */

const promisify = require('promisify-node');
const readJson = require('then-read-json');
const fs = promisify('fs');
const argv = require('yargs').argv;
const confirm = require('positive');
const __spawn = require('child_process').spawn;
const __exec = require('child_process').exec;
const buildDestination = './build';
const unlock = require('./unlock-polydex.js');

const spawn = (cmd, args=[]) => {
  let res;

  const promisifed = new Promise((resolve) => {
    res = resolve;
  });

  const child = __spawn(cmd, args);

  child.stdout.on('data', data => {
    console.log(data.toString());
  });

  child.stderr.on('data', data => {
    console.error(data.toString());
  });

  child.on('exit', code => {
    console.log(code);
    res(code.toString());
  });

  return promisifed;
};

const exec = (cmd) => {
  let res;

  const promisifed = new Promise((resolve) => {
    res = resolve;
  });

  const child = __exec(cmd);

  child.on('close', code => res(code));

  return promisifed;
};

const generateFirebaseConfig = async hostingFolder => {
  console.log('generating firebase.json...');

  const firebaseConfig = await readJson('./firebaseConfig.json');

  firebaseConfig.hosting.public = hostingFolder;

  const firebaseJson = JSON.stringify(firebaseConfig, null, 2) + '\n';

  await fs.writeFile('./firebase.json', firebaseJson);

  console.log('firebase.json generated!');
};

const setEnv = async (env='dev') => {
  const environment = argv.env || env;
  const hasEnv = fs.existsSync(`.${environment}.env.json`);
  const hasServiceAcct = fs.existsSync(`.${environment}.service-account.json`);

  if (!hasEnv || !hasServiceAcct) {
    let error = 'You are missing the following file(s):';

    if (!hasEnv) {
      error += `\n\t.${environment}.env.json`;
    }

    if (!hasServiceAcct) {
      error += `\n\t.${environment}.service-account.json`
    }

    throw new Error(error);
  }

  console.log(`Setting environment to ${environment}...`);

  await Promise.all([
    exec(`ln -fs ./.${environment}.env.json ./.active.env.json`),
    exec(`ln -fs ./.${environment}.service-account.json ./.active.service-account.json`),
    exec(`firebase use ${environment}`)
  ]);

  console.log('environment set!');
};

const generateIndex = async (env='dev') => {
  await setEnv(env);
  await require('./generate-index.js').generate();
}

const install = async _ => {
  console.log('installing dependencies...');

  await Promise.all([
    exec('npm install ./functions --prefix ./functions'),
    exec('bower install')
  ]);

  console.log('dependencies installed!');
};

const deployFunctionsDatabase = async (hostingFolder='build') => {
  await install();
  await generateFirebaseConfig(hostingFolder);

  console.log('deploying firebase functions...');
  await exec('firebase deploy --only functions,database');
  console.log('firebase functions deployed.');
};

const deployHosting = async (env='dev', hostingFolder='build') => {
  await Promise.all([
    build(env),
    generateFirebaseConfig(hostingFolder)
  ]);

  console.log('deploying hosting...');
  await exec('node ./scripts/update-firebase-env.js');
  await exec('firebase deploy --only hosting');
  console.log('hosting deployed.');
};

const generateData = async (env='dev') => {
  await setEnv(env);
  await generateFirebaseConfig();

  const confirmed =
      confirm(`Generating data will reset the state of Polymon by deleting a lot of things in your Firebase Project. Are you sure you want to do this? [y/N] `, false);

  await require('./generate-seed-data.js').generate(confirmed);
};

const updatePolymons = async (env='dev') => {
  await setEnv(env);
  await generateFirebaseConfig();

  await require('./update-polymons.js').updatePolymons();
};

const clean = async _ => {
  console.log('cleaning workspace...');

  await Promise.all([
    exec('rm -rf ./build'),
    exec('rm ./client/index.html'),
    exec('rm ./client/polymer.json'),
    exec('rm ./client/sw-precache-config.js'),
    exec('rm -rf ./client/bower_components'),
    exec('rm -rf ./functions/node_modules'),
    exec('rm -rf ./firebase.json')
  ]);

  console.log('workspace cleaned!');
};

const serve = async (hostingFolder='client') => {
  await generateFirebaseConfig(hostingFolder);
  await spawn('firebase', ['serve']);
};

const build = async (env='dev') => {
  await Promise.all([
    generateIndex(env),
    install()
  ]);

  console.log('building polymon...');
  await exec('cp polymer.json client');
  await exec('cp sw-precache-config.js client');
  process.chdir('client');
  await spawn('polymer', ['build']);
  process.chdir('..');
  console.log('polymon built, cleaning up...');
  await exec(`cp -R ./client/build/bundled/ ${buildDestination}`);
  await exec('rm -rf ./client/build');
  console.log('build files cleaned up!');
};

const deployAll = async (env='dev', hostingFolder='build') => {
  await deployFunctionsDatabase(hostingFolder);
  await deployHosting(env, hostingFolder);
};

const quickStart = async _ => {
  await clean();
  await generateData();
  await deployAll();
  await serve();
};

const unlockPolydex = async (uid, env='dev') => {
  await generateFirebaseConfig(env);
  await unlock.unlockPolydex(uid);
};

module.exports = {
  build: build,
  clean: clean,
  deployAll: deployAll,
  deployFunctionsDatabase: deployFunctionsDatabase,
  deployHosting: deployHosting,
  generateData: generateData,
  updatePolymons: updatePolymons,
  install: install,
  quickStart: quickStart,
  serve: serve,
  unlockPolydex: unlockPolydex
}
