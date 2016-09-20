/**
 * Generates the following "tables" in Firebase:
 *  1. An index-readable map of Firebase keys to Polymon resources.
 *  2. A non-index-readable map of Polymon references to Polymon Firebase keys.
 *
 * Generates the following static files:
 *  1. qr-code-data.json, a file mapping references to Polymon resources.
 */

const path = require('path');

const readJson = require('then-read-json');
const writeJson = require('then-write-json');
const del = require('del');
const SHA256 = require('crypto-js/sha256');
const firebase = require('firebase');

const secret = process.env.POLYMON_SECRET || 'NO_SECRET_SPECIFIED';
const polymonJsonPath = path.resolve(__dirname, '../polymon.json');
const qrCodeDataPath =
    path.resolve(__dirname, '../client/qr-code-data.json');
const app = firebase.initializeApp({
  name: process.env.FIREBASE_APP_NAME,
  apiKey: process.env.FIREBASE_API_KEY,
  databaseURL: process.env.FIREBASE_DATABASE_URL,
  serviceAccount: process.env.FIREBASE_SERVICE_ACCOUNT
});

const initialBounds = {
  northEast: {
    lat: 37.881054,
    lng: -122.298045
  },

  southWest: {
    lat: 37.808696,
    lng: -122.219086
  }
};

const db = app.database();
const polymonsRef = db.ref('/polymons');
const referencesRef = db.ref('/references');
const usersRef = db.ref('/users');

function makeReference(polymon) {
  return SHA256(`${polymon.shortName}${secret}`).toString()
}

function clean() {
  return Promise.all([
    del([qrCodeDataPath]),
    polymonsRef.remove(),
    referencesRef.remove(),
    usersRef.remove()
  ]);
}

function randomSighting() {
  const {northEast, southWest} = initialBounds;
  return {
    lat: Math.random() * (northEast.lat - southWest.lat) + southWest.lat,
    lng: Math.random() * (southWest.lng - northEast.lng) + northEast.lng,
    timestamp: Date.now()
  };
}

clean().then(() => {
  return readJson(polymonJsonPath).then(polymons => {
    let writes = [];
    let qrCodeData = polymons.map(polymon => {
      polymon = Object.assign({
        lastSeen: randomSighting()
      }, polymon);

      let reference = makeReference(polymon);
      let polymonRef = polymonsRef.push(polymon);
      let referenceSet = referencesRef.child(reference).set(polymonRef.key);

      writes.push(polymonRef, referenceSet);

      return {
        reference,
        polymon
      };
    });

    writes.push(writeJson(qrCodeDataPath, qrCodeData))

    return Promise.all(writes);
  });
}).catch(error => {
  console.error(error);
}).then(() => {
  process.exit();
});
