import Fastify from "fastify";
import { Server } from "socket.io";
import {
  ROOM_STATUS,
  createRoom,
  joinRoom,
  updateSettings,
  reorderPlayers,
  startGame,
  nextRoundOrVoting,
  submitRoundWord,
  castVote,
  allVotesSubmitted,
  finalizeGame,
  finalizeGameOnVoteTimeout,
  endGameIfImposterDisconnected,
  playAgainToLobby,
  transferHostIfNeeded
} from "@imposter/shared";
import { deleteRoom, getRoom, listRooms, saveRoom } from "./roomStore.js";

const app = Fastify({ logger: true });
const port = Number(process.env.PORT ?? 4000);
const ROOM_IDLE_TTL_MS = Number(process.env.ROOM_IDLE_TTL_MS ?? 1000 * 60 * 60 * 2);
const ROOM_SWEEP_INTERVAL_MS = Number(process.env.ROOM_SWEEP_INTERVAL_MS ?? 1000 * 60);
const VOTE_TIMEOUT_SWEEP_MS = Number(process.env.VOTE_TIMEOUT_SWEEP_MS ?? 1000);
const DISCONNECT_GRACE_MS = Number(process.env.DISCONNECT_GRACE_MS ?? 1000 * 30);

const pendingDisconnectRemovals = new Map();

const disconnectKey = (roomCode, playerId) => `${roomCode}:${playerId}`;
const normalizePlayerName = (value) => String(value ?? "").trim().toLowerCase();
const EXPECTED_GAME_ERRORS = [
  /room not found/i,
  /cannot join after game starts/i,
  /room is full/i,
  /only host can/i,
  /settings can only be changed/i,
  /at least 3 players/i,
  /game is not in round state/i,
  /round submissions are not open/i,
  /no active round/i,
  /word is required/i,
  /word is too long/i,
  /it is not your turn/i,
  /round is already complete/i,
  /voting is not open/i,
  /players must vote for someone else/i,
  /invalid voter or target/i,
  /cannot finalize outside voting/i,
  /all players must vote/i,
  /invalid category/i,
  /invalid game mode/i,
  /maxplayers cannot exceed/i,
  /supports exactly 1 imposter/i,
  /only host can reorder players/i,
  /player order can only be changed in lobby/i,
  /invalid player order/i
];

const isUnexpectedServerError = (error) => {
  const message = String(error?.message ?? "");
  return !EXPECTED_GAME_ERRORS.some((pattern) => pattern.test(message));
};

const clearPendingRemoval = (roomCode, playerId) => {
  const key = disconnectKey(roomCode, playerId);
  const timer = pendingDisconnectRemovals.get(key);
  if (timer) {
    clearTimeout(timer);
    pendingDisconnectRemovals.delete(key);
  }
};

app.get("/health", async () => ({ ok: true }));

const start = async () => {
  await app.listen({ port, host: "0.0.0.0" });

  const io = new Server(app.server, {
    transports: ["websocket", "polling"],
    cors: {
      origin: true,
      methods: ["GET", "POST"],
      credentials: false
    }
  });

  io.on("connection", (socket) => {
    const broadcastServerFailure = (roomCode) => {
      if (!roomCode) {
        return;
      }

      const room = getRoom(roomCode);
      if (!room) {
        return;
      }

      io.to(roomCode).emit("room:serverError", {
        message: "Something went wrong. Returning everyone to home."
      });
      deleteRoom(roomCode);
    };

    socket.on("room:create", ({ hostName, settings }, ack) => {
      try {
        const room = createRoom({ hostName, settings });
        saveRoom(room);

        socket.join(room.roomCode);
        socket.data.playerId = room.hostId;
        socket.data.roomCode = room.roomCode;
        clearPendingRemoval(room.roomCode, room.hostId);

        ack?.({ ok: true, room, playerId: room.hostId });
        io.to(room.roomCode).emit("room:updated", room);
      } catch (error) {
        ack?.({ ok: false, error: error.message });
      }
    });

    socket.on("room:join", ({ roomCode, playerName, playerId: requestedPlayerId }, ack) => {
      try {
        const room = getRoom(roomCode);
        if (!room) {
          throw new Error("Room not found");
        }

        const requestedName = normalizePlayerName(playerName);

        let player = null;
        if (requestedPlayerId) {
          player =
            room.players.find(
              (entry) => entry.id === requestedPlayerId && normalizePlayerName(entry.name) === requestedName
            ) ?? null;
        }

        if (player) {
          if (player.isConnected !== false) {
            throw new Error("That name is already taken");
          }
          player.isConnected = true;
          room.updatedAt = Date.now();
        } else {
          player = joinRoom(room, playerName);
        }

        saveRoom(room);

        socket.join(room.roomCode);
        socket.data.playerId = player.id;
        socket.data.roomCode = room.roomCode;
        clearPendingRemoval(room.roomCode, player.id);

        ack?.({ ok: true, room, playerId: player.id });
        io.to(room.roomCode).emit("room:updated", room);
      } catch (error) {
        ack?.({ ok: false, error: error.message });
      }
    });

    socket.on("room:get", ({ roomCode }, ack) => {
      const room = getRoom(roomCode);
      ack?.({ ok: Boolean(room), room: room ?? null });
    });

    socket.on("room:reorderPlayers", ({ roomCode, actorId, orderedPlayerIds }, ack) => {
      try {
        const room = getRoom(roomCode);
        if (!room) {
          throw new Error("Room not found");
        }

        reorderPlayers(room, actorId, orderedPlayerIds);
        saveRoom(room);
        ack?.({ ok: true, room });
        io.to(room.roomCode).emit("room:updated", room);
      } catch (error) {
        ack?.({ ok: false, error: error.message });
        if (isUnexpectedServerError(error)) {
          broadcastServerFailure(roomCode);
        }
      }
    });

    socket.on("settings:update", ({ roomCode, actorId, settings }, ack) => {
      try {
        const room = getRoom(roomCode);
        if (!room) {
          throw new Error("Room not found");
        }
        updateSettings(room, actorId, settings);
        saveRoom(room);
        ack?.({ ok: true, room });
        io.to(room.roomCode).emit("room:updated", room);
      } catch (error) {
        ack?.({ ok: false, error: error.message });
        if (isUnexpectedServerError(error)) {
          broadcastServerFailure(roomCode);
        }
      }
    });

    socket.on("game:start", ({ roomCode, actorId }, ack) => {
      try {
        const room = getRoom(roomCode);
        if (!room) {
          throw new Error("Room not found");
        }
        startGame(room, actorId);
        saveRoom(room);
        ack?.({ ok: true, room });
        io.to(room.roomCode).emit("room:updated", room);
      } catch (error) {
        ack?.({ ok: false, error: error.message });
        if (isUnexpectedServerError(error)) {
          broadcastServerFailure(roomCode);
        }
      }
    });

    socket.on("round:advance", ({ roomCode, actorId }, ack) => {
      try {
        const room = getRoom(roomCode);
        if (!room) {
          throw new Error("Room not found");
        }
        const transition = nextRoundOrVoting(room, actorId);
        saveRoom(room);
        ack?.({ ok: true, room, transition });
        io.to(room.roomCode).emit("room:updated", room);
      } catch (error) {
        ack?.({ ok: false, error: error.message });
        if (isUnexpectedServerError(error)) {
          broadcastServerFailure(roomCode);
        }
      }
    });

    socket.on("round:submitWord", ({ roomCode, playerId, text }, ack) => {
      try {
        const room = getRoom(roomCode);
        if (!room) {
          throw new Error("Room not found");
        }
        const result = submitRoundWord(room, playerId, text);
        let transition = null;
        if (result.roundComplete) {
          transition = nextRoundOrVoting(room, room.hostId);
        }
        saveRoom(room);
        ack?.({ ok: true, room, result, transition });
        io.to(room.roomCode).emit("room:updated", room);
      } catch (error) {
        ack?.({ ok: false, error: error.message });
        if (isUnexpectedServerError(error)) {
          broadcastServerFailure(roomCode);
        }
      }
    });

    socket.on("vote:cast", ({ roomCode, voterId, targetId }, ack) => {
      try {
        const room = getRoom(roomCode);
        if (!room) {
          throw new Error("Room not found");
        }
        castVote(room, voterId, targetId);
        let result = null;
        if (allVotesSubmitted(room)) {
          result = finalizeGame(room);
        }
        saveRoom(room);
        ack?.({ ok: true, room, result });
        io.to(room.roomCode).emit("room:updated", room);
      } catch (error) {
        ack?.({ ok: false, error: error.message });
        if (isUnexpectedServerError(error)) {
          broadcastServerFailure(roomCode);
        }
      }
    });

    socket.on("game:finalize", ({ roomCode }, ack) => {
      try {
        const room = getRoom(roomCode);
        if (!room) {
          throw new Error("Room not found");
        }
        const result = finalizeGame(room);
        saveRoom(room);
        ack?.({ ok: true, room, result });
        io.to(room.roomCode).emit("room:updated", room);
      } catch (error) {
        ack?.({ ok: false, error: error.message });
        if (isUnexpectedServerError(error)) {
          broadcastServerFailure(roomCode);
        }
      }
    });

    socket.on("game:playAgain", ({ roomCode, actorId }, ack) => {
      try {
        const room = getRoom(roomCode);
        if (!room) {
          throw new Error("Room not found");
        }
        playAgainToLobby(room, actorId);
        saveRoom(room);
        ack?.({ ok: true, room });
        io.to(room.roomCode).emit("room:updated", room);
      } catch (error) {
        ack?.({ ok: false, error: error.message });
        if (isUnexpectedServerError(error)) {
          broadcastServerFailure(roomCode);
        }
      }
    });

    socket.on("game:restart", ({ roomCode, actorId }, ack) => {
      try {
        const room = getRoom(roomCode);
        if (!room) {
          throw new Error("Room not found");
        }
        playAgainToLobby(room, actorId);
        saveRoom(room);
        ack?.({ ok: true, room });
        io.to(room.roomCode).emit("room:updated", room);
      } catch (error) {
        ack?.({ ok: false, error: error.message });
        if (isUnexpectedServerError(error)) {
          broadcastServerFailure(roomCode);
        }
      }
    });

    socket.on("disconnect", () => {
      const roomCode = socket.data.roomCode;
      const playerId = socket.data.playerId;
      if (!roomCode || !playerId) {
        return;
      }

      const currentRoom = getRoom(roomCode);
      const disconnectedPlayer = currentRoom?.players.find((player) => player.id === playerId);
      let endedByImposterDisconnect = false;
      if (disconnectedPlayer) {
        disconnectedPlayer.isConnected = false;
        const endedResult = endGameIfImposterDisconnected(currentRoom, playerId);
        endedByImposterDisconnect = Boolean(endedResult);

        if (endedByImposterDisconnect && currentRoom.hostId === playerId) {
          const nextConnectedPlayer = currentRoom.players.find(
            (player) => player.id !== playerId && player.isConnected !== false
          );
          if (nextConnectedPlayer) {
            currentRoom.hostId = nextConnectedPlayer.id;
          }
        }

        currentRoom.updatedAt = Date.now();
        saveRoom(currentRoom);

        io.to(roomCode).emit("room:updated", currentRoom);
        io.to(roomCode).emit("room:playerDisconnected", {
          playerId,
          playerName: disconnectedPlayer.name
        });
      }

      if (endedByImposterDisconnect) {
        return;
      }

      const key = disconnectKey(roomCode, playerId);
      clearPendingRemoval(roomCode, playerId);

      const timeout = setTimeout(() => {
        pendingDisconnectRemovals.delete(key);

        const room = getRoom(roomCode);
        if (!room) {
          return;
        }

        room.players = room.players.filter((player) => player.id !== playerId);

        if (room.players.length === 0) {
          deleteRoom(roomCode);
          return;
        }

        transferHostIfNeeded(room);
        room.updatedAt = Date.now();
        saveRoom(room);
        io.to(roomCode).emit("room:updated", room);
      }, DISCONNECT_GRACE_MS);

      pendingDisconnectRemovals.set(key, timeout);
    });
  });

  setInterval(() => {
    const now = Date.now();
    for (const room of listRooms()) {
      if (now - room.updatedAt > ROOM_IDLE_TTL_MS) {
        app.log.info({ roomCode: room.roomCode }, "Deleting idle room");
        deleteRoom(room.roomCode);
      }
    }
  }, ROOM_SWEEP_INTERVAL_MS);

  setInterval(() => {
    const now = Date.now();
    for (const room of listRooms()) {
      if (room.status !== ROOM_STATUS.FINAL_VOTING) {
        continue;
      }

      const startedAt = Number(room.finalVote?.startedAt ?? 0);
      if (!startedAt) {
        continue;
      }

      const votingDurationMs = Math.max(0, Number(room.settings?.votingTimeSeconds ?? 60)) * 1000;
      if (now - startedAt < votingDurationMs) {
        continue;
      }

      try {
        finalizeGameOnVoteTimeout(room);
        saveRoom(room);
        io.to(room.roomCode).emit("room:updated", room);
      } catch (error) {
        app.log.error({ error, roomCode: room.roomCode }, "Failed to finalize timed-out vote");
      }
    }
  }, VOTE_TIMEOUT_SWEEP_MS);
};

start().catch((error) => {
  app.log.error(error);
  process.exit(1);
});
