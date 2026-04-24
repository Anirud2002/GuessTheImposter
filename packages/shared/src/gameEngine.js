import { DEFAULT_SETTINGS, ROOM_STATUS, WORD_BANK } from "./constants.js";

const randomId = (prefix) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`;

const pickRandom = (list) => list[Math.floor(Math.random() * list.length)];
const normalizePlayerName = (value) => String(value ?? "").trim().toLowerCase();
const normalizeSecretText = (value) => String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const sanitizePlayerName = (value) => String(value ?? "").trim();

const assertValidPlayerName = (value) => {
  const trimmedName = sanitizePlayerName(value);
  if (!trimmedName) {
    throw new Error("Player name is required");
  }
  if (trimmedName.length > 24) {
    throw new Error("Player name is too long");
  }
  return trimmedName;
};

const getWordsForCategory = (category) => {
  if (category === "random") {
    return Object.entries(WORD_BANK)
      .filter(([key]) => key !== "random")
      .flatMap(([, words]) => words);
  }
  return WORD_BANK[category] ?? [];
};

const getConnectedPlayerIds = (room) =>
  room.players.filter((player) => player.isConnected !== false).map((player) => player.id);

const getEligibleTurnOrder = (room, round) => {
  const connectedIds = new Set(getConnectedPlayerIds(room));
  const submittedPlayerIds = new Set(round.submissions.map((entry) => entry.playerId));
  return round.turnOrder.filter((playerId) => connectedIds.has(playerId) || submittedPlayerIds.has(playerId));
};

const validateSettings = (settings) => {
  if (settings.maxPlayers > 10) {
    throw new Error("maxPlayers cannot exceed 10");
  }
  if (settings.numberOfImposters !== 1) {
    throw new Error("This game supports exactly 1 imposter");
  }
  if (!WORD_BANK[settings.category]) {
    throw new Error("Invalid category");
  }
  if (!["online", "in_person"].includes(settings.gameMode)) {
    throw new Error("Invalid game mode");
  }
};

export const createRoom = ({ hostName, roomCode, settings = {} }) => {
  const sanitizedHostName = assertValidPlayerName(hostName);
  const mergedSettings = { ...DEFAULT_SETTINGS, ...settings, numberOfImposters: 1, maxPlayers: 10 };
  validateSettings(mergedSettings);

  const hostId = randomId("player");
  return {
    roomCode: roomCode ?? Math.random().toString(36).slice(2, 7).toUpperCase(),
    status: ROOM_STATUS.LOBBY,
    hostId,
    players: [
      {
        id: hostId,
        name: sanitizedHostName,
        isConnected: true,
        joinedAt: Date.now()
      }
    ],
    settings: mergedSettings,
    gameSeed: null,
    currentRound: 0,
    rounds: [],
    finalVote: {
      votes: {},
      result: null,
      startedAt: null
    },
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
};

export const joinRoom = (room, playerName) => {
  const sanitizedPlayerName = assertValidPlayerName(playerName);
  if (room.status !== ROOM_STATUS.LOBBY) {
    throw new Error("Cannot join after game starts");
  }
  if (room.players.length >= room.settings.maxPlayers) {
    throw new Error("Room is full");
  }
  const normalizedIncomingName = normalizePlayerName(sanitizedPlayerName);
  const isDuplicateName = room.players.some((player) => normalizePlayerName(player.name) === normalizedIncomingName);
  if (isDuplicateName) {
    throw new Error("That name is already taken");
  }
  const player = {
    id: randomId("player"),
    name: sanitizedPlayerName,
    isConnected: true,
    joinedAt: Date.now()
  };
  room.players.push(player);
  room.updatedAt = Date.now();
  return player;
};

export const updateSettings = (room, actorId, partial) => {
  if (actorId !== room.hostId) {
    throw new Error("Only host can update settings");
  }
  if (room.status !== ROOM_STATUS.LOBBY) {
    throw new Error("Settings can only be changed in lobby");
  }
  const next = {
    ...room.settings,
    ...partial,
    numberOfImposters: 1,
    maxPlayers: 10
  };
  validateSettings(next);
  room.settings = next;
  room.updatedAt = Date.now();
};

export const reorderPlayers = (room, actorId, orderedPlayerIds) => {
  if (actorId !== room.hostId) {
    throw new Error("Only host can reorder players");
  }
  if (room.status !== ROOM_STATUS.LOBBY) {
    throw new Error("Player order can only be changed in lobby");
  }
  if (!Array.isArray(orderedPlayerIds) || orderedPlayerIds.length === 0) {
    throw new Error("Invalid player order");
  }

  const connectedPlayers = room.players.filter((player) => player.isConnected !== false);
  const connectedIds = connectedPlayers.map((player) => player.id);
  const expectedConnectedIdSet = new Set(connectedIds);
  const providedConnectedIdSet = new Set(orderedPlayerIds);

  if (
    orderedPlayerIds.length !== connectedIds.length ||
    providedConnectedIdSet.size !== expectedConnectedIdSet.size ||
    orderedPlayerIds.some((playerId) => !expectedConnectedIdSet.has(playerId))
  ) {
    throw new Error("Invalid player order");
  }

  const connectedOrderIndexMap = new Map(orderedPlayerIds.map((playerId, index) => [playerId, index]));
  const originalOrderIndexMap = new Map(room.players.map((player, index) => [player.id, index]));

  room.players.sort((a, b) => {
    const aIsConnected = connectedOrderIndexMap.has(a.id);
    const bIsConnected = connectedOrderIndexMap.has(b.id);

    if (aIsConnected && bIsConnected) {
      return connectedOrderIndexMap.get(a.id) - connectedOrderIndexMap.get(b.id);
    }
    if (aIsConnected && !bIsConnected) {
      return -1;
    }
    if (!aIsConnected && bIsConnected) {
      return 1;
    }
    return originalOrderIndexMap.get(a.id) - originalOrderIndexMap.get(b.id);
  });

  room.updatedAt = Date.now();
  return room.players;
};

export const startGame = (room, actorId) => {
  if (actorId !== room.hostId) {
    throw new Error("Only host can start game");
  }
  const connectedPlayersCount = getConnectedPlayerIds(room).length;
  if (connectedPlayersCount < 3) {
    throw new Error("At least 3 players are required to start");
  }

  const categoryWords = getWordsForCategory(room.settings.category);
  if (categoryWords.length === 0) {
    throw new Error("No words available for selected category");
  }

  const turnOrder = room.players.map((player) => player.id);
  room.gameSeed = {
    word: pickRandom(categoryWords),
    imposterId: pickRandom(turnOrder)
  };

  room.status = ROOM_STATUS.IN_ROUND;
  room.currentRound = 1;
  room.rounds = [createRound(room, 1)];
  room.updatedAt = Date.now();
};

const createRound = (room, roundNumber) => {
  const order = room.players.map((p) => p.id);
  const fallbackSeedRound = room.rounds[0];
  const word = room.gameSeed?.word ?? fallbackSeedRound?.word;
  const imposter = room.gameSeed?.imposterId ?? fallbackSeedRound?.imposterId;

  if (!word || !imposter) {
    throw new Error("Missing game seed");
  }

  return {
    roundNumber,
    word,
    imposterId: imposter,
    turnOrder: order,
    submissions: [],
    state: "active"
  };
};

export const getCurrentTurnPlayerId = (room) => {
  const round = room.rounds[room.rounds.length - 1];
  if (!round || round.state !== "active") {
    return null;
  }
  const eligibleTurnOrder = getEligibleTurnOrder(room, round);
  return eligibleTurnOrder[round.submissions.length] ?? null;
};

export const submitRoundWord = (room, playerId, text) => {
  if (room.status !== ROOM_STATUS.IN_ROUND) {
    throw new Error("Round submissions are not open");
  }

  const round = room.rounds[room.rounds.length - 1];
  if (!round || round.state !== "active") {
    throw new Error("No active round");
  }

  const normalized = String(text ?? "").trim();
  if (!normalized) {
    throw new Error("Word is required");
  }

  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  if (wordCount > 3) {
    throw new Error("only use three words to describe it");
  }

  if (normalized.length > 32) {
    throw new Error("Word is too long");
  }

  const eligibleTurnOrder = getEligibleTurnOrder(room, round);
  const expectedPlayerId = eligibleTurnOrder[round.submissions.length];
  if (!expectedPlayerId) {
    throw new Error("Round is already complete");
  }
  if (playerId !== expectedPlayerId) {
    throw new Error("It is not your turn");
  }

  round.submissions.push({
    playerId,
    text: normalized,
    submittedAt: Date.now()
  });

  const submittedText = normalizeSecretText(normalized);
  const secretWord = normalizeSecretText(round.word);
  if (submittedText === secretWord) {
    room.status = ROOM_STATUS.ENDED;
    room.finalVote.result = {
      imposterId: round.imposterId,
      topTargets: [],
      tally: {},
      winner: "imposter",
      reason: "secret_word_revealed",
      revealedByPlayerId: playerId
    };
    room.updatedAt = Date.now();
    return {
      roundComplete: true,
      gameEnded: true,
      nextPlayerId: null
    };
  }

  if (round.submissions.length >= eligibleTurnOrder.length) {
    round.state = "complete";
  }

  room.updatedAt = Date.now();
  const nextEligibleTurnOrder = getEligibleTurnOrder(room, round);
  return {
    roundComplete: round.state === "complete",
    gameEnded: false,
    nextPlayerId: round.state === "active" ? nextEligibleTurnOrder[round.submissions.length] : null
  };
};

export const nextRoundOrVoting = (room, actorId) => {
  if (actorId !== room.hostId) {
    throw new Error("Only host can advance rounds");
  }
  if (room.status !== ROOM_STATUS.IN_ROUND) {
    throw new Error("Game is not in round state");
  }

  if (room.currentRound >= room.settings.totalRounds) {
    room.status = ROOM_STATUS.FINAL_VOTING;
    room.finalVote = {
      votes: {},
      result: null,
      startedAt: Date.now()
    };
    room.updatedAt = Date.now();
    return "final_voting";
  }

  room.currentRound += 1;
  room.rounds.push(createRound(room, room.currentRound));
  room.updatedAt = Date.now();
  return "next_round";
};

export const castVote = (room, voterId, targetId) => {
  if (room.status !== ROOM_STATUS.FINAL_VOTING) {
    throw new Error("Voting is not open");
  }
  if (voterId === targetId) {
    throw new Error("Players must vote for someone else");
  }
  const playerIds = new Set(getConnectedPlayerIds(room));
  if (!playerIds.has(voterId) || !playerIds.has(targetId)) {
    throw new Error("Invalid voter or target");
  }
  room.finalVote.votes[voterId] = targetId;
  room.updatedAt = Date.now();
};

export const allVotesSubmitted = (room) => {
  const connectedPlayerIds = getConnectedPlayerIds(room);
  const connectedVoterSet = new Set(connectedPlayerIds);
  const submittedConnectedVotes = Object.keys(room.finalVote.votes).filter((voterId) => connectedVoterSet.has(voterId)).length;
  return submittedConnectedVotes === connectedPlayerIds.length;
};

export const finalizeGame = (room) => {
  if (room.status !== ROOM_STATUS.FINAL_VOTING) {
    throw new Error("Cannot finalize outside voting");
  }
  if (!allVotesSubmitted(room)) {
    throw new Error("All players must vote");
  }

  const connectedPlayerSet = new Set(getConnectedPlayerIds(room));
  const tally = {};
  for (const [voterId, targetId] of Object.entries(room.finalVote.votes)) {
    if (!connectedPlayerSet.has(voterId) || !connectedPlayerSet.has(targetId)) {
      continue;
    }
    tally[targetId] = (tally[targetId] ?? 0) + 1;
  }

  const sorted = Object.entries(tally).sort((a, b) => b[1] - a[1]);
  const topScore = sorted[0][1];
  const topTargets = sorted.filter(([, score]) => score === topScore).map(([target]) => target);
  const lastRound = room.rounds[room.rounds.length - 1];
  const imposterId = lastRound.imposterId;

  const crewmatesWin = topTargets.length === 1 && topTargets[0] === imposterId;

  room.status = ROOM_STATUS.ENDED;
  room.finalVote.result = {
    imposterId,
    topTargets,
    tally,
    winner: crewmatesWin ? "crewmates" : "imposter"
  };
  room.updatedAt = Date.now();

  return room.finalVote.result;
};

export const finalizeGameOnVoteTimeout = (room) => {
  if (room.status !== ROOM_STATUS.FINAL_VOTING) {
    throw new Error("Cannot finalize outside voting");
  }

  const connectedPlayerSet = new Set(getConnectedPlayerIds(room));
  const tally = {};
  for (const [voterId, targetId] of Object.entries(room.finalVote.votes)) {
    if (!connectedPlayerSet.has(voterId) || !connectedPlayerSet.has(targetId)) {
      continue;
    }
    tally[targetId] = (tally[targetId] ?? 0) + 1;
  }

  const sorted = Object.entries(tally).sort((a, b) => b[1] - a[1]);
  const topScore = sorted.length > 0 ? sorted[0][1] : null;
  const topTargets = topScore === null ? [] : sorted.filter(([, score]) => score === topScore).map(([target]) => target);
  const lastRound = room.rounds[room.rounds.length - 1];
  const imposterId = lastRound.imposterId;

  const imposterHasHighestVote = topTargets.includes(imposterId);
  const crewmatesWin = imposterHasHighestVote;

  room.status = ROOM_STATUS.ENDED;
  room.finalVote.result = {
    imposterId,
    topTargets,
    tally,
    winner: crewmatesWin ? "crewmates" : "imposter",
    reason: "vote_timeout"
  };
  room.updatedAt = Date.now();

  return room.finalVote.result;
};

export const endGameIfImposterDisconnected = (room, disconnectedPlayerId) => {
  if (!disconnectedPlayerId) {
    return null;
  }

  if (![ROOM_STATUS.IN_ROUND, ROOM_STATUS.FINAL_VOTING].includes(room.status)) {
    return null;
  }

  const lastRound = room.rounds[room.rounds.length - 1];
  if (!lastRound || lastRound.imposterId !== disconnectedPlayerId) {
    return null;
  }

  room.status = ROOM_STATUS.ENDED;
  room.finalVote.result = {
    imposterId: disconnectedPlayerId,
    topTargets: [],
    tally: {},
    winner: "crewmates",
    reason: "imposter_disconnected"
  };
  room.updatedAt = Date.now();

  return room.finalVote.result;
};

export const playAgainToLobby = (room, actorId) => {
  if (actorId !== room.hostId) {
    throw new Error("Only host can reset the game");
  }
  room.status = ROOM_STATUS.LOBBY;
  room.gameSeed = null;
  room.currentRound = 0;
  room.rounds = [];
  room.finalVote = { votes: {}, result: null, startedAt: null };
  room.updatedAt = Date.now();
};

export const transferHostIfNeeded = (room) => {
  const hostExists = room.players.some((player) => player.id === room.hostId);
  if (hostExists) {
    return room.hostId;
  }
  const nextHost = room.players[0];
  if (nextHost) {
    room.hostId = nextHost.id;
  }
  return room.hostId;
};
