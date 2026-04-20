import test from "node:test";
import assert from "node:assert/strict";

import {
  ROOM_STATUS,
  WORD_BANK,
  createRoom,
  joinRoom,
  startGame,
  nextRoundOrVoting,
  submitRoundWord,
  getCurrentTurnPlayerId,
  castVote,
  finalizeGame,
  finalizeGameOnVoteTimeout,
  endGameIfImposterDisconnected,
  reorderPlayers
} from "../src/index.js";

test("imposter wins on tie vote", () => {
  const room = createRoom({ hostName: "Host", roomCode: "ABCDE" });
  const p2 = joinRoom(room, "P2");
  const p3 = joinRoom(room, "P3");
  const p4 = joinRoom(room, "P4");

  startGame(room, room.hostId);
  while (room.status === ROOM_STATUS.IN_ROUND) {
    nextRoundOrVoting(room, room.hostId);
  }

  const imposterId = room.rounds[room.rounds.length - 1].imposterId;
  const allPlayers = room.players.map((p) => p.id);
  const nonImposters = allPlayers.filter((id) => id !== imposterId);
  const [voterA, voterB, voterC] = nonImposters;
  const decoyTarget = voterA;

  castVote(room, voterA, imposterId);
  castVote(room, voterB, imposterId);
  castVote(room, voterC, decoyTarget);
  castVote(room, imposterId, decoyTarget);

  const result = finalizeGame(room);

  assert.equal(result.winner, "imposter");
});

test("all players must vote before finalizing", () => {
  const room = createRoom({ hostName: "Host" });
  const p2 = joinRoom(room, "P2");
  const p3 = joinRoom(room, "P3");

  startGame(room, room.hostId);
  while (room.status === ROOM_STATUS.IN_ROUND) {
    nextRoundOrVoting(room, room.hostId);
  }

  castVote(room, room.hostId, p2.id);
  castVote(room, p2.id, p3.id);

  assert.throws(() => finalizeGame(room), /All players must vote/);
});

test("entering final voting stamps start timestamp", () => {
  const room = createRoom({ hostName: "Host" });
  joinRoom(room, "P2");
  joinRoom(room, "P3");

  startGame(room, room.hostId);
  while (room.status === ROOM_STATUS.IN_ROUND) {
    nextRoundOrVoting(room, room.hostId);
  }

  assert.equal(room.status, ROOM_STATUS.FINAL_VOTING);
  assert.equal(typeof room.finalVote.startedAt, "number");
  assert.ok(room.finalVote.startedAt > 0);
});

test("round words must follow turn order", () => {
  const room = createRoom({ hostName: "Host" });
  const p2 = joinRoom(room, "P2");
  const p3 = joinRoom(room, "P3");

  startGame(room, room.hostId);

  assert.equal(getCurrentTurnPlayerId(room), room.hostId);
  assert.throws(() => submitRoundWord(room, p2.id, "Apple"), /not your turn/i);

  submitRoundWord(room, room.hostId, "Tree");
  assert.equal(getCurrentTurnPlayerId(room), p2.id);

  submitRoundWord(room, p2.id, "Leaf");
  assert.equal(getCurrentTurnPlayerId(room), p3.id);

  const result = submitRoundWord(room, p3.id, "Green");
  assert.equal(result.roundComplete, true);
});

test("disconnecting current-turn player moves turn to next connected player", () => {
  const room = createRoom({ hostName: "Andy" });
  const dex = joinRoom(room, "Dex");
  const chims = joinRoom(room, "Chims");

  startGame(room, room.hostId);

  submitRoundWord(room, room.hostId, "Alpha");
  assert.equal(getCurrentTurnPlayerId(room), dex.id);

  const dexPlayer = room.players.find((player) => player.id === dex.id);
  dexPlayer.isConnected = false;

  assert.equal(getCurrentTurnPlayerId(room), chims.id);

  const result = submitRoundWord(room, chims.id, "Bravo");
  assert.equal(result.roundComplete, true);
});

test("player cannot submit more than three words", () => {
  const room = createRoom({ hostName: "Host" });
  joinRoom(room, "P2");
  joinRoom(room, "P3");

  startGame(room, room.hostId);

  assert.throws(
    () => submitRoundWord(room, room.hostId, "one two three four"),
    /only use three words to describe it/i
  );
});

test("player names must be unique within a room", () => {
  const room = createRoom({ hostName: "Host" });
  joinRoom(room, "Chims");

  assert.throws(() => joinRoom(room, "  chims  "), /name is already taken/i);
});

test("cannot join a room using the host name", () => {
  const room = createRoom({ hostName: "Captain" });

  assert.throws(() => joinRoom(room, "captain"), /name is already taken/i);
});

test("final voting only requires connected players", () => {
  const room = createRoom({ hostName: "Host" });
  const p2 = joinRoom(room, "P2");
  const p3 = joinRoom(room, "P3");

  startGame(room, room.hostId);
  while (room.status === ROOM_STATUS.IN_ROUND) {
    nextRoundOrVoting(room, room.hostId);
  }

  const disconnected = room.players.find((player) => player.id === p3.id);
  disconnected.isConnected = false;

  castVote(room, room.hostId, p2.id);
  castVote(room, p2.id, room.hostId);

  const result = finalizeGame(room);
  assert.ok(result);
});

test("vote timeout gives imposter win when imposter does not have highest vote", () => {
  const room = createRoom({ hostName: "Host" });
  const p2 = joinRoom(room, "P2");
  const p3 = joinRoom(room, "P3");

  startGame(room, room.hostId);
  while (room.status === ROOM_STATUS.IN_ROUND) {
    nextRoundOrVoting(room, room.hostId);
  }

  const imposterId = room.rounds[room.rounds.length - 1].imposterId;
  const nonImposters = room.players.filter((player) => player.id !== imposterId);
  const [target, voter] = nonImposters;

  castVote(room, voter.id, target.id);
  const result = finalizeGameOnVoteTimeout(room);

  assert.equal(result.winner, "imposter");
  assert.equal(result.reason, "vote_timeout");
});

test("vote timeout gives crewmates win when imposter has highest vote", () => {
  const room = createRoom({ hostName: "Host" });
  const p2 = joinRoom(room, "P2");
  const p3 = joinRoom(room, "P3");

  startGame(room, room.hostId);
  while (room.status === ROOM_STATUS.IN_ROUND) {
    nextRoundOrVoting(room, room.hostId);
  }

  const imposterId = room.rounds[room.rounds.length - 1].imposterId;
  const voter = room.players.find((player) => player.id !== imposterId);

  castVote(room, voter.id, imposterId);
  const result = finalizeGameOnVoteTimeout(room);

  assert.equal(result.winner, "crewmates");
  assert.equal(result.reason, "vote_timeout");
});

test("game ends immediately when imposter disconnects", () => {
  const room = createRoom({ hostName: "Host" });
  const p2 = joinRoom(room, "P2");
  const p3 = joinRoom(room, "P3");

  startGame(room, room.hostId);

  const activeRound = room.rounds[room.rounds.length - 1];
  const result = endGameIfImposterDisconnected(room, activeRound.imposterId);

  assert.ok(result);
  assert.equal(room.status, ROOM_STATUS.ENDED);
  assert.equal(result.winner, "crewmates");
  assert.equal(result.reason, "imposter_disconnected");
  assert.equal(result.imposterId, activeRound.imposterId);
});

test("random category picks a word from all categories", () => {
  const room = createRoom({ hostName: "Host", settings: { category: "random" } });
  joinRoom(room, "P2");
  joinRoom(room, "P3");

  startGame(room, room.hostId);

  const chosenWord = room.rounds[0].word;
  const allNonRandomWords = Object.entries(WORD_BANK)
    .filter(([key]) => key !== "random")
    .flatMap(([, words]) => words);

  assert.ok(allNonRandomWords.includes(chosenWord));
});

test("host can reorder players in lobby", () => {
  const room = createRoom({ hostName: "Host" });
  const p2 = joinRoom(room, "P2");
  const p3 = joinRoom(room, "P3");

  reorderPlayers(room, room.hostId, [p3.id, room.hostId, p2.id]);

  assert.deepEqual(
    room.players.map((player) => player.id),
    [p3.id, room.hostId, p2.id]
  );
});

test("non-host cannot reorder players", () => {
  const room = createRoom({ hostName: "Host" });
  const p2 = joinRoom(room, "P2");
  const p3 = joinRoom(room, "P3");

  assert.throws(() => reorderPlayers(room, p2.id, [p3.id, room.hostId, p2.id]), /only host can reorder players/i);
});

test("reordered lobby order is used for round turn order", () => {
  const room = createRoom({ hostName: "Host" });
  const p2 = joinRoom(room, "P2");
  const p3 = joinRoom(room, "P3");

  reorderPlayers(room, room.hostId, [p2.id, p3.id, room.hostId]);
  startGame(room, room.hostId);

  assert.deepEqual(room.rounds[0].turnOrder, [p2.id, p3.id, room.hostId]);
  assert.equal(getCurrentTurnPlayerId(room), p2.id);
});

test("word and imposter remain the same across rounds in one game", () => {
  const room = createRoom({ hostName: "Host", settings: { totalRounds: 3 } });
  joinRoom(room, "P2");
  joinRoom(room, "P3");

  startGame(room, room.hostId);

  const firstRoundWord = room.rounds[0].word;
  const firstRoundImposterId = room.rounds[0].imposterId;

  nextRoundOrVoting(room, room.hostId);
  nextRoundOrVoting(room, room.hostId);

  assert.equal(room.rounds.length, 3);
  assert.ok(room.rounds.every((round) => round.word === firstRoundWord));
  assert.ok(room.rounds.every((round) => round.imposterId === firstRoundImposterId));
});

test("cannot start game with fewer than 3 connected players", () => {
  const room = createRoom({ hostName: "Host" });
  const p2 = joinRoom(room, "P2");
  joinRoom(room, "P3");

  const disconnectedPlayer = room.players.find((player) => player.id === p2.id);
  disconnectedPlayer.isConnected = false;

  assert.throws(() => startGame(room, room.hostId), /at least 3 players are required to start/i);
});
