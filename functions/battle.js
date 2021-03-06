/**
 * @license
 * Copyright (c) 2017 The Polymer Project Authors. All rights reserved.
 * This code may only be used under the BSD style license found at http://polymer.github.io/LICENSE.txt
 * The complete set of authors may be found at http://polymer.github.io/AUTHORS.txt
 * The complete set of contributors may be found at http://polymer.github.io/CONTRIBUTORS.txt
 * Code distributed by Google as part of the polymer project is also
 * subject to an additional IP rights grant found at http://polymer.github.io/PATENTS.txt
 */

const {
  ensureNoActiveBattle,
  ensureCorrectTeamSize,
  ensureHasPolydexEntry,
  getUserPolymon,
  userErrorNotifier
} = require('./common');

const Battle = require('./data-object/battle.js');
const Tournament = require('./data-object/tournament.js');


function randomModifier() {
  return 1 - Math.floor(Math.random() * 3);
}


/**
 * Stat comparison rules v2
 * This iteration implements a rock/paper/scissors approach to stat comparison.
 * Attack beats Focus
 * Focus beats Counter
 * Counter beats Attack
 * If a user chooses a "winning" stat, the user's chosen stat receives a bonus
 * modifier of +3.
 * Then, the final values are compared, with the greater value deciding the
 * winning player.
 * The loser receives the difference of the final values in damage.
 * In the condition that both players chose Focus, the player with the highest
 * Focus value wins, and receives the difference of the two values in healing.
 *
 * This function computes the delta value for the total damage that user one
 * incurs. If the number is negative, this implies healing.
 */
function compareMoves(moveOne, polymonOne, moveTwo, polymonTwo) {
  const baseValueOne = polymonOne.stats[moveOne.attributeName] + moveOne.randomModifier;
  const baseValueTwo = polymonTwo.stats[moveTwo.attributeName] + moveTwo.randomModifier;

  const bonus = 3;

  let moveValueOne = baseValueOne;
  let moveValueTwo = baseValueTwo;
  let gotBonus = false;

  console.log(`Move one: ${moveOne.attributeName} ${moveValueOne}`);
  console.log(`Move two: ${moveTwo.attributeName} ${moveValueTwo}`);

  switch (moveOne.attributeName) {
    case 'attack':
      switch (moveTwo.attributeName) {
        case 'attack':
          break;
        case 'focus':
          moveValueOne += bonus;
          gotBonus = true;
          break;
        case 'counter':
          moveValueTwo += bonus;
          break;
      }
      break;
    case 'focus':
      switch (moveTwo.attributeName) {
        case 'attack':
          moveValueTwo += bonus;
          break;
        case 'focus':
          // NOTE(cdata): In the Focus -> Focus condition, the greater focus
          // gets to heal.
          console.log('Heal condition!')
          return [
            moveValueOne > moveValueTwo
                ? moveValueOne - moveValueTwo
                : 0,
            false
          ];
        case 'counter':
          moveValueOne += bonus;
          gotBonus = true;
          break;
      }
      break;
    case 'counter':
      switch (moveTwo.attributeName) {
        case 'attack':
          moveValueOne += bonus;
          gotBonus = true;
          break;
        case 'focus':
          moveValueTwo += bonus;
          break;
        case 'counter':
          break;
      }
      break;
  }

  console.log(`Move one ${gotBonus ? 'received' : 'did not receive'} bonus.`);
  console.log(`Move one final value: ${moveValueOne}`);
  console.log(`Move two final value: ${moveValueTwo}`);

  return [
    moveValueOne < moveValueTwo
      ? moveValueTwo - moveValueOne
      : 0,
    gotBonus
  ];
}


/**
 * Looks up the move for the given user, battle and round.
 */
function userMoveForBattleRound(db, userId, battleId, round) {

  console.log(`Looking up User ${userId}'s Move for Battle ${battleId} round ${round}`);

  return db.ref(`/battles/${battleId}/state/${userId}/moves`).once('value')
      .then(snapshot => snapshot.val())
      .then(moves => {
        for (let moveId in moves) {
          if (moves[moveId].index === round) {
            console.log(`Found Move ${moveId}..`);
            return moves[moveId];
          }
        }

        console.log('No Move found!');

        return null;
      });
}


/**
 * Looks up a Battle by ID and checks that it has not finished yet. If it does
 * not exist, or it has already finished, throws an error.
 */
function ensureBattleNotFinished(db, battleId) {
  if (battleId == null) {
    return Promise.reject(
        `Attempt to ensure unfinished battle, but no Battle ID specified!`);
  }

  return db.ref(`/battles/${battleId}`)
      .once('value')
      .then(snapshot => {
        if (!snapshot.exists()) {
          throw new Error(`Battle ${battleId} does not exist.`);
        } else {
          const finishedAt = snapshot.val().finishedAt;

          if (finishedAt != null) {
            throw new Error(
                `Battle ${battleId} already finished at ${finishedAt}.`);
          }
        }
      });
}


/**
 * Looks up a Battle by ID and checks that it has not started yet. If it does
 * not exist, or it has already started, throws an error.
 */
function ensureBattleNotStarted(db, battleId) {
  if (battleId == null) {
    return Promise.reject(
        `Attempt to ensure unstarted battle, but no Battle ID specified!`);
  }

  return db.ref(`/battles/${battleId}`)
      .once('value')
      .then(snapshot => {
        if (!snapshot.exists()) {
          throw new Error(`Battle ${battleId} does not exist.`);
        } else {
          const startedAt = snapshot.val().startedAt;

          if (startedAt != null) {
            throw new Error(
                `Battle ${battleId} already started at ${startedAt}.`);
          }
        }
      });
}


/**
 * Checks a user's active battle. If none exists, or if the current one does not
 * match the provided Battle ID, throws an error.
 */
function ensureHasActiveBattle(db, userId, battleId) {
  if (battleId == null) {
    return Promise.reject(
        `Attempt to ensure active battle, but no Battle ID specified!`);
  }

  return db.ref(`/users/${userId}/player/activeBattleId`)
      .once('value')
      .then(snapshot => snapshot.val())
      .then(activeBattleId => {
        if (battleId !== activeBattleId) {
          throw new Error(
              `User ${userId} is not a part of Battle ${battleId}.`);
        }
      });
}


/**
 *
 */
function ensureNotWaiting(db, userId, battleId) {
  return db.ref(`/battles/${battleId}/status/players/${userId}/waiting`)
      .once('value')
      .then(snapshot => {
        if (!snapshot.exists()) {
          throw new Error(`User ${userId} has not joined Battle ${battleId}.`);
        }

        if (snapshot.val() === true) {
          throw new Error(
              `User ${userId} is waiting for opponent's next move in Battle ${battleId}.`);
        }
      });
}


function assignBattleMaxRounds(db, battleId) {
  return ensureBattleNotStarted(db, battleId)
      .then(() => Promise.all([
        db.ref(`/battles/${battleId}/initiatingUserId`).once('value'),
        db.ref(`/battles/${battleId}/defendingUserId`).once('value'),
      ]))
      .then(snapshots => snapshots.map(snapshot => snapshot.val()))
      .then(userIds => Promise.all([
        db.ref(`/users/${userIds[0]}/team`).once('value'),
        db.ref(`/users/${userIds[1]}/team`).once('value')
      ]))
      .then(snapshots => snapshots.map(snapshot => snapshot.val()))
      .then(teams =>
          Math.min(Object.keys(teams[0]).length, Object.keys(teams[1]).length))
      .then(maxRounds => {
        console.log(`Setting Battle ${battleId} Max Rounds to ${maxRounds}..`);
        return Promise.all([
          db.ref(`/battles/${battleId}/currentRound`).set(0),
          db.ref(`/battles/${battleId}/maxRounds`).set(maxRounds - 1)
        ]);
      });
}


function userTakesDamage(db, battleId, userId, damage) {
  let playerHealthPath = `/battles/${battleId}/status/players/${userId}/health`;

  return db.ref(playerHealthPath).once('value')
      .then(snapshot => snapshot.val())
      .then(health => {
        let newHealth = health - damage;
        return db.ref(playerHealthPath).set(health - damage)
            .then(() => newHealth);
      });
}


/**
 * Initiates a new battle, with the provided user set as the initiating user.
 */
function initiateBattle(db, userId) {
  return ensureNoActiveBattle(db, userId)
      .then(() => ensureCorrectTeamSize(db, userId))
      .then(() => db.ref('/battles').push({
        createdAt: Date.now(),
        initiatingUserId: userId,
        state: {
          [userId]: {
            heartbeat: Date.now()
          }
        },
        status: {
          engaged: false
        }
      }))
      .then(snapshot => snapshot.key)
      .then(battleId => {

        console.log(`Initiating User ID: ${userId}`);
        console.log(`Battle ID: ${battleId}`);

        return Promise.all([
          db.ref(`/battles/${battleId}/status/players/${userId}`).set({
            ready: true,
            waiting: true,
            health: 15
          }),
          db.ref(`/users/${userId}/player/activeBattleId`).set(battleId)
        ]);
      });
}


/**
 * Joins an existing battle, with the provided user set as the defending user.
 */
function joinBattle(db, userId, battleId) {
  return ensureNoActiveBattle(db, userId)
      .then(() => ensureCorrectTeamSize(db, userId))
      .then(() => ensureBattleNotStarted(db, battleId))
      .then(() => ensureBattleNotFinished(db, battleId))
      .then(() => {
        console.log(`Defending User ID: ${userId}`);
        console.log(`Battle ID: ${battleId}`);

        return Promise.all([
          db.ref(`/users/${userId}/player/activeBattleId`).set(battleId),
          db.ref(`/battles/${battleId}/defendingUserId`).set(userId),
          db.ref(`/battles/${battleId}/status/players/${userId}`).set({
            ready: true,
            waiting: false,
            health: 15
          }),
          recordHeartbeat(db, userId, battleId)
        ]);
      })
      .then(() => assignBattleMaxRounds(db, battleId))
      .then(() => db.ref(`/battles/${battleId}/initiatingUserId`).once('value'))
      .then(snapshot => snapshot.val())
      .then(initiatingUserId => Promise.all([
        // NOTE(cdata): This will cause the battle to be considered started.
        db.ref(`/battles/${battleId}/startedAt`).set(Date.now()),
        db.ref(`/battles/${battleId}/status/engaged`).set(true),
        db.ref(`/battles/${battleId}/status/players/${initiatingUserId}/waiting`)
            .set(false)
      ]));
}


/**
 * Registers a move by the provided user, for a specified battle. If a
 * corresponding move is available for the opposing user of the same battle,
 * computes the outcome of a round and updates the battle with the new round
 * information.
 */
function performMove(db, userId, battleId, polydexId, attributeName) {
  // TODO(cdata): assert that the latest move has already been processed.
  // Otherwise the battle system might get confused by thrashy UI.

  // TODO(cdata): assert shape of the move here? Maybe not necessary because
  // the database rules will validate it when we try to set it.

  // TODO(cdata): assert that the chosen Polymon hasn't already been chosen
  // in a previous round of battle.

  // TODO(cdata): assert that the chosen Polymon is in the user's team.


  return ensureHasActiveBattle(db, userId, battleId)
      .then(() => ensureNotWaiting(db, userId, battleId))
      .then(() => ensureBattleNotFinished(db, battleId))
      .then(() => ensureHasPolydexEntry(db, userId, polydexId))
      .then(() => db.ref(`/battles/${battleId}`))
      .then(battleRef => battleRef.once('value')
          .then(snapshot => snapshot.val())
          .then(battle => Promise.all([
            battleRef.child(`state/${userId}/moves`).push({
              index: battle.currentRound,
              polydexId: polydexId,
              attributeName: attributeName
            }),
            battleRef.child(`status/players/${userId}/waiting`).set(true)
          ])))
      .then(() => resolveCurrentRound(db, battleId));
}


function resolveCurrentRound(db, battleId) {
  // TODO(cdata): refactor this whole function; it's getting really difficult to
  // read...

  return db.ref(`/battles/${battleId}`).once('value')
      .then(snapshot => snapshot.val())
      .then(battle => Promise.all([
        battle,
        // Step 1: Look up the moves each user chose for the current round.
        userMoveForBattleRound(
            db, battle.initiatingUserId, battleId, battle.currentRound),
        userMoveForBattleRound(
            db, battle.defendingUserId, battleId, battle.currentRound)
      ]))
      .then(results => {
        const [battle, initiatingUserMove, defendingUserMove] = results;

        if (initiatingUserMove == null || defendingUserMove == null) {
          // NOTE(cdata): This implies that we do not yet have moves for the
          // current round from both users.
          console.log('Cannot proceed until both moves are registered.')
          return null;
        }

        const currentRound = battle.currentRound;
        const lastRound = battle.maxRounds;
        const {initiatingUserId, defendingUserId} = battle;

        console.log(`Resolving round ${currentRound} of ${lastRound}..`);

        // Step 2: Calculate a random modifier for each user.
        initiatingUserMove.randomModifier = randomModifier();
        defendingUserMove.randomModifier = randomModifier();

        return Promise.all([
          // Step 3: Look up the chosen Polymon for each user.
          getUserPolymon(
              db, initiatingUserId, initiatingUserMove.polydexId),
          getUserPolymon(
              db, defendingUserId, defendingUserMove.polydexId)
        ]).then(polymons => {
          const [initiatingUserPolymon, defendingUserPolymon] = polymons;

          console.log('Comparing user moves..');

          // Step 4: Compute the damage for each user based on the chosen move.
          const [initiatingUserDamageDelta, initiatingUserGotBonus] =
              compareMoves(
                  initiatingUserMove, initiatingUserPolymon,
                  defendingUserMove,  defendingUserPolymon);
          const [defendingUserDamageDelta, defendingUserGotBonus] =
              compareMoves(
                  defendingUserMove,  defendingUserPolymon,
                  initiatingUserMove, initiatingUserPolymon);

          initiatingUserMove.damageDelta = initiatingUserDamageDelta;
          initiatingUserMove.gotBonus = initiatingUserGotBonus;

          defendingUserMove.damageDelta = defendingUserDamageDelta;
          defendingUserMove.gotBonus = defendingUserGotBonus;

          console.log(`User ${initiatingUserId} damage delta: ${initiatingUserMove.damageDelta}`);
          console.log(`User ${defendingUserId} damage delta: ${defendingUserMove.damageDelta}`);

          return db.ref(`/battles/${battleId}/status/rounds`).push({
            index: currentRound,
            [battle.initiatingUserId]: initiatingUserMove,
            [battle.defendingUserId]: defendingUserMove
          }).then(() => Promise.all([
            db.ref(`/battles/${battleId}/status/players/${initiatingUserId}/waiting`)
                .set(false),
            db.ref(`/battles/${battleId}/status/players/${defendingUserId}/waiting`)
                .set(false)
          ])).then(() => Promise.all([
            userTakesDamage(db, battleId, initiatingUserId, initiatingUserDamageDelta),
            userTakesDamage(db, battleId, defendingUserId, defendingUserDamageDelta)
          ]));
        })
        // Step 5: Check if we just completed the last round, or if someone's
        // health dropped below 1.
        .then(healths => {
          let [initiatingUserHealth, defendingUserHealth] = healths;

          if (currentRound === lastRound ||
              initiatingUserHealth <= 0 ||
              defendingUserHealth <= 0) {
            return finishBattle(db, battleId);
          }

          return db.ref(`/battles/${battleId}/currentRound`)
              .set(currentRound + 1);
        });
      });
}


/**
 * Aggregates damage recorded for both players to decide who won.
 */
function finishBattle(db, battleId) {
  return db.ref(`/battles/${battleId}`).once('value')
      .then(snapshot => snapshot.val())
      .then(battle => {
        const { initiatingUserId, defendingUserId } = battle;

        console.log(`Finishing Battle ${battleId}`);

        // TODO(cdata): Now we can just check the player's health, which is
        // being aggregated over time by the `resolveCurrentRound` function.

        const [ initiatingUserDamage, defendingUserDamage ] =
            Object.keys(battle.status.rounds)
            .map(roundId => battle.status.rounds[roundId])
            .reduce((damages, round) => {
              damages[0] += round[initiatingUserId].damageDelta;
              damages[1] += round[defendingUserId].damageDelta;
              return damages;
            }, [0, 0]);

        let winningId;

        console.log(`Initiating User Damage: ${initiatingUserDamage}`);
        console.log(`Defending User Damage: ${defendingUserDamage}`);

        if (initiatingUserDamage > defendingUserDamage) {
          console.log(`Defending User ${defendingUserId} wins!`);
          winningId = defendingUserId;
        } else if (defendingUserDamage > initiatingUserDamage) {
          console.log(`Initiating User ${initiatingUserId} wins!`);
          winningId = initiatingUserId;
        } else {
          // NOTE(cdata): This is the draw condition.
          console.log('The battle ends in a draw!');
          winningId = 0;
        }

        return Promise.all([
          db.ref(`/battles/${battleId}/finishedAt`).set(Date.now()),
          db.ref(`/battles/${battleId}/status/winningUserId`).set(winningId)
        ]).then(() => Promise.all([
          db.ref(`/users/${initiatingUserId}/player/activeBattleId`).remove(),
          db.ref(`/users/${defendingUserId}/player/activeBattleId`).remove()
        ]));
      });
}


/**
 * Updates the heartbeat for a specified user in a specified battle.
 */
function recordHeartbeat(db, userId, battleId) {

  console.log(`Recording heartbeat for User ${userId} in Battle ${battleId}..`);

  return ensureHasActiveBattle(db, userId, battleId)
      .then(() => ensureBattleNotFinished(db, battleId))
      .then(() => db.ref(`/battles/${battleId}/state/${userId}/heartbeat`))
      .then(ref => ref.set(Date.now()));
}


async function withdrawFromBattle(db, userId, battleId) {

  console.log(`User ${userId} attempting withdrawal from Battle ${battleId}`);

  const battle = new Battle(db, battleId);
  const isPartOfATournament = await battle.isPartOfATournament();

  if (isPartOfATournament) {
    const tournamentId = await battle.getTournamentId();
    const tournament = new Tournament(db, tournamentId);

    return tournament.withdrawPlayer(userId);
  } else {
    return battle.withdrawParticipatingUser(userId, { cancelBattle: true });
  }
}


exports.processBattleQueue = (functions, admin) => functions.database
    .ref('/users/{userId}/battleQueue/{messageId}')
    .onWrite(event => {
      const message = event.data.val();
      const userId = event.params.userId;
      //const db = functions.app.database();
      const db = admin.database();
      //const db = event.data.ref.root;

      if (message == null) {
        console.log('No Battle message, ignoring...');
        return null;
      }

      console.log(`Battle Request Created At: ${message.createdAt}`);
      console.log(`Battle Request Action: ${message.action}`);

      let action;

      switch (message.action) {
        case 'initiate':
          action = initiateBattle(db, userId);
          break;
        case 'join':
          action = joinBattle(db, userId, message.battleId);
          break;
        case 'move':
          action = performMove(
              db,
              userId,
              message.battleId,
              message.polydexId,
              message.attributeName);
          break;
        case 'ping':
          action = recordHeartbeat(db, userId, message.battleId);
          break;
        case 'withdraw':
          action = withdrawFromBattle(db, userId, message.battleId);
          break;
        default:
          action = Promise.resolve();
          break;
      }

      return action
          .catch(userErrorNotifier(db, userId))
          .then(() => event.data.ref.remove());
    });
