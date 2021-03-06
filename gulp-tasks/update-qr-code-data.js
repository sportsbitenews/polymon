/**
 * @license
 * Copyright (c) 2017 The Polymer Project Authors. All rights reserved.
 * This code may only be used under the BSD style license found at http://polymer.github.io/LICENSE.txt
 * The complete set of authors may be found at http://polymer.github.io/AUTHORS.txt
 * The complete set of contributors may be found at http://polymer.github.io/CONTRIBUTORS.txt
 * Code distributed by Google as part of the polymer project is also
 * subject to an additional IP rights grant found at http://polymer.github.io/PATENTS.txt
 */

const common = require('./_common');
const del = require('del');
const readJson = require('then-read-json');
const writeJson = require('then-write-json');

function polymonIdByName(name, env) {
  return env.firebaseApp.database().ref(`/polymons`).once('value')
      .then(snapshot => snapshot.val())
      .then(polymons => {
        for (let id in polymons) {
          if (polymons[id].name === name) {
            return id;
          }
        }

        throw new Error(`Polymon not found with name ${name}`);
      });
}

function referenceForPolymonId(polymonId, env) {
  return env.firebaseApp.database().ref(`/references`).once('value')
      .then(snapshot => snapshot.val())
      .then(references => {
        for (let secret in references) {
          if (references[secret] === polymonId) {
            return secret;
          }
        }

        throw new Error(`Reference not found for ${polymonId}`);
      });
}

common.getPolymonEnv().then(polymonEnv => {
  return readJson(common.qrCodeDataPath).then(qrCodeData => {
    return Promise.all(qrCodeData.polymons.map(datum => {
      const oldReference = datum.reference;

      return polymonIdByName(datum.polymon.name, polymonEnv)
          .then(polymonId => referenceForPolymonId(polymonId, polymonEnv))
          .then(reference => Object.assign({}, datum, { reference }));
    }));
  }).then(polymons => {

    return del([common.qrCodeDataPath]).then(() =>
        writeJson(common.qrCodeDataPath, {
          projectId: polymonEnv.config.firebase.projectId,
          polymons
        }));
    // console.log(polymonEnv.config.firebase.projectId);
    // return writeJson(common.qrCodeDataPath)
  }).catch(e => console.error(e))
    .then(() => console.log('Done!'));
});
