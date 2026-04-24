import { useEffect, useRef, useState } from "react";
import {
  IonApp,
  IonButton,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardSubtitle,
  IonCardTitle,
  IonContent,
  IonInput,
  IonItem,
  IonLoading,
  IonReorder,
  IonReorderGroup,
  IonLabel,
  IonList,
  IonIcon,
  IonGrid,
  IonRow,
  IonCol,
  IonAlert,
  IonPage,
  IonSegment,
  IonSegmentButton,
  IonSelect,
  IonSelectOption,
  IonText,
  IonToast
} from "@ionic/react";
import { copyOutline, helpCircleOutline, arrowBackOutline, checkmark } from "ionicons/icons";
import { io } from "socket.io-client";

const serverUrl =
  import.meta.env.VITE_SERVER_URL ?? `${window.location.protocol}//${window.location.hostname}:4000`;
const socket = io(serverUrl, {
  autoConnect: false,
  transports: ["websocket", "polling"],
  timeout: 8000,
  reconnection: true,
  reconnectionAttempts: 3,
  reconnectionDelay: 800
});
const SOCKET_CONNECT_TIMEOUT_MS = 5000;
const SOCKET_ACK_TIMEOUT_MS = 8000;
const SERVER_IDLE_WARMUP_MS = 1000 * 60 * 15;
const SERVER_WARMUP_TIMEOUT_MS = 30000;
const HOW_TO_PLAY_ROUTE = "/how-to-play";

const getPlayerStorageKey = (roomCode) => `imposter:player:${String(roomCode ?? "").toUpperCase()}`;
const LAST_SERVER_REQUEST_AT_KEY = "imposter:lastServerRequestAt";
const normalizePlayerName = (value) => String(value ?? "").trim().toLowerCase();

const readStoredPlayerIdentity = (roomCode) => {
  if (!roomCode) {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(getPlayerStorageKey(roomCode));
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.playerId === "string") {
      return {
        playerId: parsed.playerId,
        name: typeof parsed.name === "string" ? parsed.name : ""
      };
    }
    return null;
  } catch {
    return null;
  }
};

const storePlayerIdentity = (roomCode, playerId, name) => {
  if (!roomCode || !playerId || !name) {
    return;
  }
  try {
    window.localStorage.setItem(
      getPlayerStorageKey(roomCode),
      JSON.stringify({ playerId, name: String(name).trim() })
    );
  } catch {
    // ignore storage errors
  }
};

const clearStoredPlayerIdentity = (roomCode) => {
  if (!roomCode) {
    return;
  }
  try {
    window.localStorage.removeItem(getPlayerStorageKey(roomCode));
  } catch {
    // ignore storage errors
  }
};

const readLastServerRequestAt = () => {
  try {
    const raw = window.localStorage.getItem(LAST_SERVER_REQUEST_AT_KEY);
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    return 0;
  }
};

const storeLastServerRequestAt = (timestamp) => {
  try {
    window.localStorage.setItem(LAST_SERVER_REQUEST_AT_KEY, String(Number(timestamp) || 0));
  } catch {
    // ignore storage errors
  }
};

const defaultSettings = {
  totalRounds: 3,
  category: "random",
  gameMode: "online",
  votingTimeSeconds: 60,
  maxPlayers: 10,
  numberOfImposters: 1
};

const SETTINGS_SYNC_KEYS = [
  "totalRounds",
  "category",
  "gameMode",
  "votingTimeSeconds",
  "maxPlayers",
  "numberOfImposters"
];

const areSettingsEqual = (left, right) =>
  SETTINGS_SYNC_KEYS.every((key) => String(left?.[key]) === String(right?.[key]));

const emitAck = (event, payload, timeoutMs = SOCKET_ACK_TIMEOUT_MS) =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Server did not respond in time"));
    }, timeoutMs);

    socket.emit(event, payload, (response) => {
      clearTimeout(timeout);
      resolve(response);
    });
  });

const connectSocket = (timeoutMs = SOCKET_CONNECT_TIMEOUT_MS) =>
  new Promise((resolve, reject) => {
    if (socket.connected) {
      resolve();
      return;
    }

    const cleanup = () => {
      clearTimeout(timeout);
      socket.off("connect", onConnect);
      socket.off("connect_error", onConnectError);
    };

    const onConnect = () => {
      cleanup();
      resolve();
    };

    const onConnectError = (error) => {
      cleanup();
      reject(error instanceof Error ? error : new Error("Could not connect to server"));
    };

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Could not connect to server"));
    }, timeoutMs);

    socket.on("connect", onConnect);
    socket.on("connect_error", onConnectError);
    socket.connect();
  });

export default function App() {
  const isHowToPlayInitialRoute = window.location.pathname.toLowerCase() === HOW_TO_PLAY_ROUTE;
  const initialPathCode = isHowToPlayInitialRoute ? "" : window.location.pathname.replace(/^\/+/, "").split("/")[0] ?? "";
  const [name, setName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [homeMode, setHomeMode] = useState(initialPathCode ? "join" : "create");
  const [showHowToPlay, setShowHowToPlay] = useState(isHowToPlayInitialRoute);
  const [settings, setSettings] = useState(defaultSettings);
  const [room, setRoom] = useState(null);
  const [playerId, setPlayerId] = useState(null);
  const [error, setError] = useState("");
  const [toastMessage, setToastMessage] = useState("");
  const [warningToastMessage, setWarningToastMessage] = useState("");
  const [errorToastMessage, setErrorToastMessage] = useState("");
  const [isWarmingServer, setIsWarmingServer] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const [isJoiningRoom, setIsJoiningRoom] = useState(false);
  const [isCardRevealed, setIsCardRevealed] = useState(false);
  const [roundWord, setRoundWord] = useState("");
  const [isSubmittingWord, setIsSubmittingWord] = useState(false);
  const [selectedVoteTarget, setSelectedVoteTarget] = useState("");
  const [isCastingVote, setIsCastingVote] = useState(false);
  const [isReorderingPlayers, setIsReorderingPlayers] = useState(false);
  const [votingTimeLeft, setVotingTimeLeft] = useState(null);
  const [isPlayAgainLoading, setIsPlayAgainLoading] = useState(false);
  const [showRestartConfirm, setShowRestartConfirm] = useState(false);
  const [restartPromptText, setRestartPromptText] = useState("");
  const [isRestartingGame, setIsRestartingGame] = useState(false);
  const previousRoundRef = useRef({ status: null, currentRound: 0 });
  const roomRef = useRef(null);
  const roomCodeRef = useRef("");
  const lastServerRequestAtRef = useRef(readLastServerRequestAt());
  const warmupPromiseRef = useRef(null);
  const selectInterfaceOptions = { cssClass: "imposter-select-alert" };
  const threeWordWarningText = "Use up to 3 words to describe it.";

  const toFriendlyError = (message, fallback = "Something went wrong") => {
    const text = String(message ?? fallback);
    if (/room not found/i.test(text)) {
      return "Room not found.";
    }
    if (/cannot join after game starts/i.test(text)) {
      return "Room already in a match.";
    }
    if (/room is full/i.test(text)) {
      return "Room is full.";
    }
    if (/player name is required/i.test(text)) {
      return "Name is required.";
    }
    if (/player name is too long/i.test(text)) {
      return "Name must be 24 characters or fewer.";
    }
    return text;
  };

  const showError = (message, fallback) => {
    const friendly = toFriendlyError(message, fallback);
    setError(friendly);
    setErrorToastMessage(friendly);
  };

  const showWarningToast = (message) => {
    setWarningToastMessage(String(message ?? ""));
  };

  const isThreeWordLimitMessage = (message) => /only use three words to describe it/i.test(String(message ?? ""));

  const clearError = () => {
    setError("");
  };

  useEffect(() => {
    roomRef.current = room;
    roomCodeRef.current = roomCode;
  }, [room, roomCode]);

  const resetToHomeWithError = (message) => {
    const activeRoomCode = roomRef.current?.roomCode ?? roomCodeRef.current;
    clearStoredPlayerIdentity(activeRoomCode);
    setRoom(null);
    setPlayerId(null);
    setRoomCode("");
    setShowHowToPlay(false);
    setIsCardRevealed(false);
    setRoundWord("");
    setSelectedVoteTarget("");
    setShowRestartConfirm(false);
    setWarningToastMessage("");
    setError("");
    setErrorToastMessage(String(message ?? "Something went wrong. Please create or join a room again."));
    if (window.location.pathname !== "/") {
      window.history.replaceState({}, "", "/");
    }
  };

  const ensureServerAwake = async (force = false) => {
    const now = Date.now();
    const shouldWarm =
      force || !lastServerRequestAtRef.current || now - lastServerRequestAtRef.current >= SERVER_IDLE_WARMUP_MS;

    if (!shouldWarm) {
      return true;
    }

    if (warmupPromiseRef.current) {
      return warmupPromiseRef.current;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SERVER_WARMUP_TIMEOUT_MS);
    setIsWarmingServer(true);

    const warmupPromise = (async () => {
      try {
        const response = await fetch(`${serverUrl}/health`, {
          method: "GET",
          cache: "no-store",
          signal: controller.signal
        });

        if (response.ok) {
          const successfulPingAt = Date.now();
          lastServerRequestAtRef.current = successfulPingAt;
          storeLastServerRequestAt(successfulPingAt);
          return true;
        }
        return false;
      } catch {
        return false;
      } finally {
        clearTimeout(timeout);
        setIsWarmingServer(false);
        warmupPromiseRef.current = null;
      }
    })();

    warmupPromiseRef.current = warmupPromise;
    return warmupPromise;
  };

  const emitAckWithWarmup = async (event, payload, timeoutMs = SOCKET_ACK_TIMEOUT_MS) => {
    await ensureServerAwake();
    const response = await emitAck(event, payload, timeoutMs);
    const requestAt = Date.now();
    lastServerRequestAtRef.current = requestAt;
    storeLastServerRequestAt(requestAt);
    return response;
  };

  useEffect(() => {
    ensureServerAwake();
  }, []);

  useEffect(() => {
    // Keep one stable set of socket listeners for the app lifetime.
    const handleRoomUpdated = (nextRoom) => setRoom(nextRoom);
    const handleServerError = ({ message }) => {
      resetToHomeWithError(message);
    };
    const handleHostDisconnected = ({ message }) => {
      resetToHomeWithError(message || "host disconnected");
    };
    const handlePlayerDisconnected = ({ playerName }) => {
      if (!playerName) {
        return;
      }
      setErrorToastMessage(`${playerName} disconnected`);
    };
    const handleConnectError = () => {
      showError("Could not connect to game server. Check backend URL/server status.");
    };

    socket.on("room:updated", handleRoomUpdated);
    socket.on("room:serverError", handleServerError);
    socket.on("room:hostDisconnected", handleHostDisconnected);
    socket.on("room:playerDisconnected", handlePlayerDisconnected);
    socket.on("connect_error", handleConnectError);

    return () => {
      socket.off("room:updated", handleRoomUpdated);
      socket.off("room:serverError", handleServerError);
      socket.off("room:hostDisconnected", handleHostDisconnected);
      socket.off("room:playerDisconnected", handlePlayerDisconnected);
      socket.off("connect_error", handleConnectError);
    };
  }, []);

  useEffect(() => {
    const pathCode = window.location.pathname.replace(/^\/+/, "").split("/")[0] ?? "";
    if (window.location.pathname.toLowerCase() === HOW_TO_PLAY_ROUTE) {
      setShowHowToPlay(true);
      return;
    }

    setShowHowToPlay(false);
    if (pathCode && !roomCode) {
      setRoomCode(pathCode.toUpperCase());
      setHomeMode("join");
    }
  }, [roomCode]);

  useEffect(() => {
    const onPopState = () => {
      if (window.location.pathname.toLowerCase() === HOW_TO_PLAY_ROUTE) {
        setShowHowToPlay(true);
      } else {
        setShowHowToPlay(false);
      }
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (!room?.roomCode) {
      return;
    }
    const targetPath = room.status === "in_round" ? `/${room.roomCode}/game` : `/${room.roomCode}`;
    if (window.location.pathname !== targetPath) {
      window.history.replaceState({}, "", targetPath);
    }
  }, [room]);

  useEffect(() => {
    if (!room?.settings) {
      return;
    }

    setSettings((prev) => {
      const isHostInLobby = room.status === "lobby" && room.hostId === playerId;
      if (isHostInLobby && !areSettingsEqual(prev, room.settings)) {
        return prev;
      }
      return { ...prev, ...room.settings };
    });
  }, [room, playerId]);

  useEffect(() => {
    if (!room || !playerId) {
      return;
    }
    if (room.status !== "lobby" || room.hostId !== playerId) {
      return;
    }
    if (areSettingsEqual(settings, room.settings)) {
      return;
    }

    const syncTimer = setTimeout(async () => {
      setIsSavingSettings(true);
      const response = await emitAckWithWarmup("settings:update", {
        roomCode: room.roomCode,
        actorId: playerId,
        settings
      });
      setIsSavingSettings(false);

      if (!response?.ok) {
        showError(response?.error, "Could not save settings");
      }
    }, 250);

    return () => clearTimeout(syncTimer);
  }, [room, playerId, settings]);

  useEffect(() => {
    if (!room) {
      return;
    }

    const previous = previousRoundRef.current;
    const isInPersonMode = room.settings?.gameMode === "in_person";
    const roundStarted =
      room.status === "in_round" && (previous.status !== "in_round" || previous.currentRound !== room.currentRound);

    if (roundStarted) {
      setToastMessage(isInPersonMode ? "Game started" : `Round ${room.currentRound} started`);
    }

    if (previous.status !== "final_voting" && room.status === "final_voting") {
      setToastMessage("Time to vote");
    }

    previousRoundRef.current = {
      status: room.status,
      currentRound: room.currentRound
    };
  }, [room]);

  const onCreate = async () => {
    setIsCreatingRoom(true);
    clearError();
    try {
      await ensureServerAwake();
      await connectSocket();
      const hostName = name.trim();
      const response = await emitAck("room:create", {
        hostName,
        settings
      });
      const requestAt = Date.now();
      lastServerRequestAtRef.current = requestAt;
      storeLastServerRequestAt(requestAt);
      if (!response?.ok) {
        showError(response?.error, "Could not create room");
        return;
      }
      setRoom(response.room);
      setPlayerId(response.playerId);
      setRoomCode(response.room.roomCode);
      storePlayerIdentity(response.room.roomCode, response.playerId, hostName);
      clearError();
    } catch (requestError) {
      showError(requestError?.message, "Could not create room");
    } finally {
      setIsCreatingRoom(false);
    }
  };

  const onJoin = async () => {
    setIsJoiningRoom(true);
    clearError();
    try {
      await ensureServerAwake();
      await connectSocket();
      const playerName = name.trim();
      const normalizedRoomCode = roomCode.toUpperCase();
      const storedIdentity = readStoredPlayerIdentity(normalizedRoomCode);
      const canReuseSeat =
        Boolean(storedIdentity?.playerId) &&
        normalizePlayerName(storedIdentity?.name) === normalizePlayerName(playerName);
      const response = await emitAck("room:join", {
        roomCode: normalizedRoomCode,
        playerName,
        playerId: canReuseSeat ? storedIdentity.playerId : null
      });
      const requestAt = Date.now();
      lastServerRequestAtRef.current = requestAt;
      storeLastServerRequestAt(requestAt);
      if (!response?.ok) {
        showError(response?.error, "Could not join room");
        return;
      }
      setRoom(response.room);
      setPlayerId(response.playerId);
      setRoomCode(response.room.roomCode);
      storePlayerIdentity(response.room.roomCode, response.playerId, playerName);
      clearError();
    } catch (requestError) {
      showError(requestError?.message, "Could not join room");
    } finally {
      setIsJoiningRoom(false);
    }
  };

  const startGame = async () => {
    if (!room || playerId !== room.hostId) {
      return;
    }

    if (!areSettingsEqual(settings, room.settings)) {
      setIsSavingSettings(true);
      const settingsResponse = await emitAckWithWarmup("settings:update", {
        roomCode: room.roomCode,
        actorId: playerId,
        settings
      });
      setIsSavingSettings(false);

      if (!settingsResponse?.ok) {
        showError(settingsResponse?.error, "Could not save settings before starting");
        return;
      }
    }

    const response = await emitAckWithWarmup("game:start", {
      roomCode: room.roomCode,
      actorId: playerId
    });
    if (!response?.ok) {
      showError(response?.error, "Could not start game");
      return;
    }

    clearError();
  };

  const copyRoomLink = async () => {
    const code = room?.roomCode ?? roomCode;
    if (!code) {
      showError("Create or enter a room code before copying a link");
      return;
    }

    const shareUrl = `${window.location.origin}/${code.toUpperCase()}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setToastMessage("Room link copied to clipboard");
      clearError();
    } catch {
      showError("Could not copy link. You can copy it manually from the browser address bar.");
    }
  };

  const openHowToPlay = () => {
    setShowHowToPlay(true);
    clearError();
    if (window.location.pathname.toLowerCase() !== HOW_TO_PLAY_ROUTE) {
      window.history.pushState({}, "", HOW_TO_PLAY_ROUTE);
    }
  };

  const reorderLobbyPlayers = async (event) => {
    if (!event?.detail) {
      return;
    }

    const { from, to } = event.detail;
    event.detail.complete();

    if (!room || !isHost || !isInStaging || from === to) {
      return;
    }

    const reorderedPlayers = [...connectedPlayers];
    const [movedPlayer] = reorderedPlayers.splice(from, 1);
    reorderedPlayers.splice(to, 0, movedPlayer);

    setIsReorderingPlayers(true);
    const response = await emitAckWithWarmup("room:reorderPlayers", {
      roomCode: room.roomCode,
      actorId: playerId,
      orderedPlayerIds: reorderedPlayers.map((player) => player.id)
    });
    setIsReorderingPlayers(false);

    if (!response?.ok) {
      showError(response?.error, "Could not reorder players");
      return;
    }

    clearError();
    setToastMessage("Player order updated");
  };

  const closeHowToPlay = () => {
    setShowHowToPlay(false);
    if (window.location.pathname.toLowerCase() === HOW_TO_PLAY_ROUTE) {
      window.history.replaceState({}, "", "/");
    }
  };

  const isHost = Boolean(room && playerId === room.hostId);
  const isInStaging = Boolean(room && room.status === "lobby");
  const isInRound = Boolean(room && room.status === "in_round");
  const isFinalVoting = Boolean(room && room.status === "final_voting");
  const isEnded = Boolean(room && room.status === "ended");
  const isInPersonMode = (room?.settings?.gameMode ?? settings.gameMode) === "in_person";
  const connectedPlayers = room?.players.filter((p) => p.isConnected !== false) ?? [];
  const canStartFromLobby = isHost && isInStaging && connectedPlayers.length >= 3 && !isSavingSettings;

  const activeRound = isInRound ? room.rounds[room.rounds.length - 1] : null;
  const submittedPlayerIds = new Set(activeRound?.submissions.map((entry) => entry.playerId) ?? []);
  const connectedPlayerIds = new Set(connectedPlayers.map((player) => player.id));
  const eligibleTurnOrder =
    activeRound?.turnOrder.filter((id) => connectedPlayerIds.has(id) || submittedPlayerIds.has(id)) ?? [];
  const currentTurnPlayerId = activeRound ? eligibleTurnOrder[activeRound.submissions.length] ?? null : null;
  const isMyTurn = Boolean(isInRound && currentTurnPlayerId === playerId);
  const hasSubmittedThisRound = Boolean(activeRound?.submissions.some((entry) => entry.playerId === playerId));
  const submissionsByRound =
    room?.rounds.map((round) => ({
      roundNumber: round.roundNumber,
      submissions: round.submissions
    })) ?? [];
  const connectedPlayerIdSet = new Set(connectedPlayers.map((player) => player.id));
  const formatLobbyPlayerLabel = (player) => {
    const suffixes = [];
    if (player.id === room?.hostId) {
      suffixes.push("Host");
    }
    if (player.id === playerId) {
      suffixes.push("You");
    }
    return suffixes.length > 0 ? `${player.name} (${suffixes.join(", ")})` : player.name;
  };
  const connectedVotesSubmitted = Object.keys(room?.finalVote?.votes ?? {}).filter((voterId) =>
    connectedPlayerIdSet.has(voterId)
  ).length;
  const currentWordCount = roundWord.trim() ? roundWord.trim().split(/\s+/).filter(Boolean).length : 0;
  const findPlayerName = (id) => room?.players.find((p) => p.id === id)?.name ?? "Unknown";
  const myVoteTargetId = room?.finalVote?.votes?.[playerId] ?? null;
  const votingCandidates = room?.players.filter((p) => p.id !== playerId) ?? [];
  const gameResult = room?.finalVote?.result ?? null;
  const winnerSide = gameResult?.winner === "crewmates" ? "🛡️ Crewmates" : "🕵️ Imposter";
  const winnerClass = gameResult?.winner === "crewmates" ? "winner-crewmates" : "winner-imposter";
  const endedByImposterDisconnect = gameResult?.reason === "imposter_disconnected";
  const endedByWordReveal = gameResult?.reason === "secret_word_revealed";
  const wordRevealedByImposter = endedByWordReveal && gameResult?.revealedByPlayerId === gameResult?.imposterId;
  const topVotedNames = (gameResult?.topTargets ?? []).map((id) => findPlayerName(id)).join(", ") || "None";
  const revealedSecretWord = room?.gameSeed?.word ?? room?.rounds?.[0]?.word ?? "Unknown";
  const resultTagline = endedByImposterDisconnect
    ? `${findPlayerName(gameResult?.imposterId)} disconnected and was the imposter.`
    : endedByWordReveal
      ? wordRevealedByImposter
        ? `${findPlayerName(gameResult?.imposterId)} was the imposter and cracked the secret word. Deception executed flawlessly.`
        : `${findPlayerName(gameResult?.revealedByPlayerId)} accidentally revealed the secret word. The imposter seized the moment.`
    : gameResult?.winner === "crewmates"
  ? "Truth prevailed."
      : "Deception wins.";

  const submitRoundWord = async () => {
    if (!room || !playerId || !roundWord.trim()) {
      return;
    }

    const normalized = roundWord.trim();
    const wordCount = normalized.split(/\s+/).filter(Boolean).length;
    if (wordCount > 3) {
      clearError();
      showWarningToast(threeWordWarningText);
      return;
    }

    setIsSubmittingWord(true);
    const response = await emitAckWithWarmup("round:submitWord", {
      roomCode: room.roomCode,
      playerId,
      text: normalized
    });
    setIsSubmittingWord(false);

    if (!response?.ok) {
      if (isThreeWordLimitMessage(response?.error)) {
        clearError();
        showWarningToast(threeWordWarningText);
        return;
      }
      showError(response?.error, "Could not submit word");
      return;
    }

    setRoundWord("");
    clearError();
  };

  const castMyVote = async () => {
    if (!room || !playerId || !selectedVoteTarget) {
      return;
    }

    setIsCastingVote(true);
    const response = await emitAckWithWarmup("vote:cast", {
      roomCode: room.roomCode,
      voterId: playerId,
      targetId: selectedVoteTarget
    });
    setIsCastingVote(false);

    if (!response?.ok) {
      showError(response?.error, "Could not cast vote");
      return;
    }

    clearError();
    setToastMessage("Vote submitted");
  };

  const playAgain = async () => {
    if (!room || !isHost) {
      return;
    }

    setIsPlayAgainLoading(true);
    const response = await emitAckWithWarmup("game:playAgain", {
      roomCode: room.roomCode,
      actorId: playerId
    });
    setIsPlayAgainLoading(false);

    if (!response?.ok) {
      showError(response?.error, "Could not reset game");
      return;
    }

    setSelectedVoteTarget("");
    clearError();
  };

  const restartGame = async () => {
    if (!room || !isHost) {
      return;
    }

    setIsRestartingGame(true);
    const response = await emitAckWithWarmup("game:restart", {
      roomCode: room.roomCode,
      actorId: playerId
    });
    setIsRestartingGame(false);

    if (!response?.ok) {
      showError(response?.error, "Could not restart game");
      return;
    }

    setIsCardRevealed(false);
    clearError();
  };

  const promptRestart = (message) => {
    setRestartPromptText(message);
    setShowRestartConfirm(true);
  };

  useEffect(() => {
    setRoundWord("");
    setIsCardRevealed(false);
  }, [room?.currentRound, room?.status, activeRound?.word]);

  useEffect(() => {
    if (!isFinalVoting) {
      setSelectedVoteTarget("");
    }
  }, [isFinalVoting]);

  const updateNumericSetting = (key, value) => {
    const parsed = Number(value);
    if (Number.isNaN(parsed)) {
      return;
    }
    setSettings((prev) => ({ ...prev, [key]: parsed }));
  };

  const formatCountdown = (seconds) => {
    const safeSeconds = Math.max(0, Number(seconds ?? 0));
    const mins = Math.floor(safeSeconds / 60);
    const secs = safeSeconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  useEffect(() => {
    if (!isFinalVoting || !room) {
      setVotingTimeLeft(null);
      return;
    }

    const configuredDuration = Math.max(0, Number(room.settings?.votingTimeSeconds ?? settings.votingTimeSeconds ?? 60));
    const voteStartedAt = typeof room.finalVote?.startedAt === "number" ? room.finalVote.startedAt : Date.now();

    const updateRemaining = () => {
      const elapsedSeconds = Math.floor((Date.now() - voteStartedAt) / 1000);
      setVotingTimeLeft(Math.max(0, configuredDuration - elapsedSeconds));
    };

    updateRemaining();
    const interval = setInterval(updateRemaining, 250);
    return () => clearInterval(interval);
  }, [isFinalVoting, room, settings.votingTimeSeconds]);

  const isCountdownCritical = isFinalVoting && votingTimeLeft !== null && votingTimeLeft <= 10;

  return (
    <IonApp>
      <IonPage>
        <IonContent className="ion-padding">
          <div className="app-logo-wrap">
            <h1 className="app-logo-title">ThatIsSus</h1>
          </div>
          <div className={`app-shell ${room && isInStaging ? "staging-shell" : ""}`}>
          {!room ? (
            showHowToPlay ? (
              <>
                <div className="home-top-actions">
                  <IonButton fill="clear" size="small" onClick={closeHowToPlay}>
                    <IonIcon icon={arrowBackOutline} slot="start" />
                    Back to Home
                  </IonButton>
                </div>

                <IonCard className="how-to-play-card">
                  <IonCardHeader>
                    <IonCardTitle>How to Play 🎭</IonCardTitle>
                    <IonCardSubtitle>Quick guide for ThatIsSus</IonCardSubtitle>
                  </IonCardHeader>
                  <IonCardContent>
                    <ul className="how-to-play-list">
                      <li>👥 Gather at least <strong>3 players</strong>. Names must be unique in the room and up to 24 characters.</li>
                      <li>🔗 Host creates a room and shares the room link/code.</li>
                      <li>🕵️ One hidden <strong>Imposter</strong> is assigned for the full match; everyone else gets the same secret word.</li>
                      <li>📝 On your turn, submit a clue in <strong>up to 3 words</strong> (max 32 chars).</li>
                      <li>⚠️ If anyone submits the <strong>exact secret word</strong>, the game ends instantly and the imposter wins.</li>
                      <li>🗣️ After all rounds, discuss and vote for exactly one player (not yourself).</li>
                      <li>⏱️ Voting is timed. If timer expires and imposter is not top-voted, imposter wins.</li>
                      <li>🏆 Crewmates win by catching the imposter. If the imposter disconnects mid-game, crewmates win immediately.</li>
                      <li>🚨 If the host disconnects, the room closes and everyone returns to home.</li>
                    </ul>
                  </IonCardContent>
                </IonCard>
              </>
            ) : (
              <>
                <div className="home-top-actions">
                  <IonButton fill="clear" size="small" onClick={openHowToPlay}>
                    <IonIcon icon={helpCircleOutline} slot="start" />
                    How to Play
                  </IonButton>
                </div>

                <IonCard>
                  <IonCardHeader>
                    <IonCardTitle>Gather Your Crew</IonCardTitle>
                    <IonCardSubtitle>Enter your name, then create a room or join one.</IonCardSubtitle>
                  </IonCardHeader>
                  <IonCardContent>
                    <IonItem>
                      <IonLabel position="stacked">Name</IonLabel>
                      <IonInput value={name} onIonInput={(e) => setName(e.detail.value ?? "")} />
                    </IonItem>
                  </IonCardContent>
                </IonCard>

                <IonCard>
                  <IonCardContent>
                    <IonSegment value={homeMode} onIonChange={(e) => setHomeMode(e.detail.value)} className="home-mode-toggle">
                      <IonSegmentButton value="create">
                        <IonLabel>Create Room</IonLabel>
                      </IonSegmentButton>
                      <IonSegmentButton value="join">
                        <IonLabel>Join a Room</IonLabel>
                      </IonSegmentButton>
                    </IonSegment>
                  </IonCardContent>
                </IonCard>

                {homeMode === "create" ? (
                  <IonCard>
                    <IonCardHeader>
                      <IonCardTitle>Create Room</IonCardTitle>
                      <IonCardSubtitle>Generate a room code and invite friends</IonCardSubtitle>
                    </IonCardHeader>
                    <IonCardContent>
                      <div className="button-row">
                        <IonButton expand="block" onClick={onCreate} disabled={!name.trim() || isCreatingRoom}>
                          Create Room
                        </IonButton>
                      </div>
                    </IonCardContent>
                  </IonCard>
                ) : (
                  <IonCard>
                    <IonCardHeader>
                      <IonCardTitle>Join Room</IonCardTitle>
                      <IonCardSubtitle>Open from shared URL or enter room code manually</IonCardSubtitle>
                    </IonCardHeader>
                  <IonCardContent>
                    <IonItem>
                      <IonLabel position="stacked">Room Code</IonLabel>
                      <IonInput value={roomCode} onIonInput={(e) => setRoomCode((e.detail.value ?? "").toUpperCase())} />
                    </IonItem>

                    <div className="button-row">
                      <IonButton
                        expand="block"
                        fill="outline"
                        onClick={onJoin}
                        disabled={!name.trim() || !roomCode.trim() || isJoiningRoom}
                      >
                        Join Room
                      </IonButton>
                    </div>
                  </IonCardContent>
                  </IonCard>
                )}
              </>
            )
          ) : isInRound ? (
            <>
              <IonCard>
                <IonCardHeader>
                  <IonCardTitle>Chamber of Secrets</IonCardTitle>
                  <IonCardSubtitle>
                    Round {room.currentRound} / {room.settings.totalRounds}
                  </IonCardSubtitle>
                </IonCardHeader>
                <IonCardContent>
                  <IonCard className={`flip-card ${isCardRevealed ? "revealed" : ""}`} button onClick={() => setIsCardRevealed((prev) => !prev)}>
                    <div className="flip-card-inner">
                      <div className="flip-card-face flip-card-front">
                        <p className="flip-card-title">Touch to reveal</p>
                        <p className="flip-card-hint">Tap/click again to hide for privacy.</p>
                      </div>
                      <div className="flip-card-face flip-card-back">
                        {activeRound?.imposterId === playerId ? (
                          <p className="flip-card-reveal imposter">IMPOSTER</p>
                        ) : (
                          <p className="flip-card-reveal word">
                            <strong>{activeRound?.word ?? "-"}</strong>
                          </p>
                        )}
                      </div>
                    </div>
                  </IonCard>

                  <IonText>
                    <p>
                      Current turn: {currentTurnPlayerId ? findPlayerName(currentTurnPlayerId) : "Round complete"}
                    </p>
                  </IonText>

                  {isHost ? (
                    <div className="host-round-actions">
                      <IonButton
                        fill="outline"
                        onClick={() =>
                          promptRestart(
                            isInPersonMode
                              ? "Restart and return everyone to staging with a new word?"
                              : "Restart this online match and return everyone to staging?"
                          )
                        }
                        disabled={isRestartingGame}
                      >
                        {isInPersonMode ? "Play Again (New Word)" : "Restart Match"}
                      </IonButton>
                    </div>
                  ) : null}

                  {isInPersonMode ? (
                    <IonCard className="chat-card">
                      <IonCardHeader>
                        <IonCardSubtitle>In-person mode</IonCardSubtitle>
                      </IonCardHeader>
                      <IonCardContent>
                        <IonText color="medium">
                          <p>Use this device to reveal cards in person, then play discussion/voting offline.</p>
                        </IonText>
                        {!isHost ? (
                          <IonText color="medium">
                            <p>Host can start a fresh round anytime.</p>
                          </IonText>
                        ) : null}
                      </IonCardContent>
                    </IonCard>
                  ) : (
                    <IonCard className="chat-card">
                      <IonCardHeader>
                        <IonCardSubtitle>Guessed Words (All Rounds)</IonCardSubtitle>
                      </IonCardHeader>
                      <IonCardContent>
                        {submissionsByRound.map((round) => (
                          <div className="round-block" key={`round-${round.roundNumber}`}>
                            <p className="round-separator">------------ Round {round.roundNumber} -----------</p>
                            <IonList>
                              {round.submissions.map((entry, idx) => (
                                <IonItem key={`${entry.playerId}-${idx}-${round.roundNumber}`}>
                                  <IonLabel>
                                    <strong>{findPlayerName(entry.playerId)}</strong>
                                    <div>{entry.text}</div>
                                  </IonLabel>
                                </IonItem>
                              ))}
                              {round.submissions.length === 0 ? (
                                <IonItem>
                                  <IonLabel color="medium">No guesses yet.</IonLabel>
                                </IonItem>
                              ) : null}
                            </IonList>
                          </div>
                        ))}

                        {activeRound?.state === "complete" ? (
                          <IonText color="medium">
                            <p>Round complete. Preparing the next phase...</p>
                          </IonText>
                        ) : hasSubmittedThisRound ? (
                          <IonText color="medium">
                            <p>You already submitted this round. Waiting for other players.</p>
                          </IonText>
                        ) : isMyTurn ? (
                          <div className="word-entry-panel">
                            <div className="word-entry-head">
                              <p className="word-entry-title">Craft your clue</p>
                              <p className={`word-entry-count ${currentWordCount >= 3 ? "max" : ""}`}>{Math.min(currentWordCount, 3)}/3 words</p>
                            </div>

                            <IonItem className="word-entry-item">
                              <IonLabel position="stacked">Your word</IonLabel>
                              <IonInput
                                value={roundWord}
                                maxlength={32}
                                placeholder="Type your clue"
                                onIonInput={(e) => setRoundWord(e.detail.value ?? "")}
                              />
                            </IonItem>

                            <IonText color="medium">
                              <p className="word-entry-hint">Keep it short, clever, and under 3 words.</p>
                            </IonText>

                            <IonButton
                              className="word-submit-btn"
                              expand="block"
                              onClick={submitRoundWord}
                              disabled={!roundWord.trim() || isSubmittingWord}
                            >
                              Submit Word
                            </IonButton>
                          </div>
                        ) : (
                          <div className="guessing-indicator">
                            <span>{currentTurnPlayerId ? findPlayerName(currentTurnPlayerId) : "A player"} is guessing</span>
                            <span className="dot one">.</span>
                            <span className="dot two">.</span>
                            <span className="dot three">.</span>
                          </div>
                        )}

                      </IonCardContent>
                    </IonCard>
                  )}
                </IonCardContent>
              </IonCard>
            </>
          ) : isFinalVoting ? (
            <>
              <IonCard>
                <IonCardHeader>
                  <IonCardTitle>Time to Vote</IonCardTitle>
                  <IonCardSubtitle>Pick exactly one player (not yourself)</IonCardSubtitle>
                </IonCardHeader>
                <IonCardContent>
                  <div className={`vote-countdown ${isCountdownCritical ? "critical" : ""}`}>
                    <p className="vote-countdown-label">Voting closes in</p>
                    <p className="vote-countdown-time">{formatCountdown(votingTimeLeft ?? 0)}</p>
                  </div>

                  <IonList>
                    {votingCandidates.map((candidate) => (
                      <IonItem key={candidate.id} button onClick={() => setSelectedVoteTarget(candidate.id)}>
                        <IonLabel>
                          {candidate.name}
                          {selectedVoteTarget === candidate.id ? (
                            <IonIcon className="vote-selected-check" icon={checkmark} />
                          ) : null}
                        </IonLabel>
                      </IonItem>
                    ))}
                  </IonList>

                  {myVoteTargetId ? (
                    <IonText color="medium">
                      <p>You already voted for {findPlayerName(myVoteTargetId)}. Waiting for everyone else...</p>
                    </IonText>
                  ) : (
                    <IonButton expand="block" onClick={castMyVote} disabled={!selectedVoteTarget || isCastingVote}>
                      Submit Vote
                    </IonButton>
                  )}

                  <IonText color="medium">
                    <p>
                      Votes submitted: {connectedVotesSubmitted}/{connectedPlayers.length}
                    </p>
                  </IonText>
                </IonCardContent>
              </IonCard>
            </>
          ) : isEnded ? (
            <>
              <IonCard className={`result-card ${winnerClass}`}>
                <IonCardHeader>
                  <IonCardSubtitle>Final Reveal</IonCardSubtitle>
                  <IonCardTitle>Game Result</IonCardTitle>
                </IonCardHeader>
                <IonCardContent>
                  <div className="result-hero">
                    <p className="result-overline">Winner</p>
                    <h2>{winnerSide}</h2>
                    <p className="result-tagline">{resultTagline}</p>
                  </div>

                  <div className="result-summary-row">
                    <span className="label">Imposter was</span>
                    <strong>{findPlayerName(gameResult?.imposterId)}</strong>
                  </div>
                  {!endedByImposterDisconnect && !endedByWordReveal ? (
                    <div className="result-summary-row">
                      <span className="label">Top voted</span>
                      <strong>{topVotedNames}</strong>
                    </div>
                  ) : null}

                  {isHost ? (
                    <IonButton expand="block" className="play-again-btn" onClick={playAgain} disabled={isPlayAgainLoading}>
                      Play Again
                    </IonButton>
                  ) : (
                    <IonText color="medium">
                      <p>Waiting for host to restart the game...</p>
                    </IonText>
                  )}
                </IonCardContent>
              </IonCard>

              <div className="secret-word-reveal" aria-live="polite">
                <p className="secret-word-label">Secret word was</p>
                <p className="secret-word-value">{revealedSecretWord}</p>
              </div>
            </>
          ) : (
            <>
              <IonGrid className="staging-grid" fixed>
                <IonRow>
                  <IonCol size="12" sizeLg="8">
                    <IonCard>
                  <IonCardHeader>
                    <IonCardTitle>{isFinalVoting ? "Voting Time" : `Staging Area · Room ${room.roomCode}`}</IonCardTitle>
                    <IonCardSubtitle>
                      {isFinalVoting ? "All rounds completed. Voting is now open." : isHost ? "Host controls" : "Waiting for host"}
                    </IonCardSubtitle>
                  </IonCardHeader>
                  <IonCardContent>
                    <div className="share-link-panel">
                      <IonText color="medium">
                        <p className="share-label">Share this room</p>
                      </IonText>
                      <p className="share-preview">{window.location.origin}/{room.roomCode}</p>
                      <IonButton className="share-link-btn" expand="block" fill="outline" onClick={copyRoomLink}>
                        <IonIcon icon={copyOutline} slot="start" />
                        Copy invite link
                      </IonButton>
                    </div>

                    {isInStaging && isHost ? (
                      <>
                        <IonItem>
                          <IonLabel>Category</IonLabel>
                          <IonSelect
                            value={settings.category}
                            interface="alert"
                            interfaceOptions={selectInterfaceOptions}
                            onIonChange={(e) => setSettings((prev) => ({ ...prev, category: e.detail.value }))}
                          >
                            <IonSelectOption value="random">Random (All Categories)</IonSelectOption>
                            <IonSelectOption value="general">General</IonSelectOption>
                            <IonSelectOption value="movies">Movies</IonSelectOption>
                            <IonSelectOption value="animals">Animals</IonSelectOption>
                            <IonSelectOption value="travel">Travel</IonSelectOption>
                            <IonSelectOption value="food">Food</IonSelectOption>
                            <IonSelectOption value="sports">Sports</IonSelectOption>
                            <IonSelectOption value="gaming">Gaming</IonSelectOption>
                            <IonSelectOption value="internet">Internet & Social</IonSelectOption>
                            <IonSelectOption value="music">Music</IonSelectOption>
                            <IonSelectOption value="tech">Tech</IonSelectOption>
                            <IonSelectOption value="pop_culture">Pop Culture</IonSelectOption>
                          </IonSelect>
                        </IonItem>

                        <IonItem>
                          <IonLabel>Game Mode</IonLabel>
                          <IonSelect
                            value={settings.gameMode}
                            interface="alert"
                            interfaceOptions={selectInterfaceOptions}
                            onIonChange={(e) => setSettings((prev) => ({ ...prev, gameMode: e.detail.value }))}
                          >
                            <IonSelectOption value="online">Online</IonSelectOption>
                            <IonSelectOption value="in_person">In-person</IonSelectOption>
                          </IonSelect>
                        </IonItem>

                        <IonItem>
                          <IonLabel position="stacked">Total Rounds</IonLabel>
                          <IonInput
                            type="number"
                            min="1"
                            max="10"
                            value={settings.totalRounds}
                            onIonInput={(e) => updateNumericSetting("totalRounds", e.detail.value)}
                          />
                        </IonItem>

                        <IonItem>
                          <IonLabel position="stacked">Voting Time (seconds)</IonLabel>
                          <IonInput
                            type="number"
                            min="15"
                            value={settings.votingTimeSeconds}
                            onIonInput={(e) => updateNumericSetting("votingTimeSeconds", e.detail.value)}
                          />
                        </IonItem>

                        <div className="button-row">
                          <IonButton expand="block" onClick={startGame} disabled={!canStartFromLobby}>
                            Start Game
                          </IonButton>
                        </div>
                        {connectedPlayers.length < 3 ? (
                          <IonText color="medium">
                            <p>Need at least 3 players to start.</p>
                          </IonText>
                        ) : null}
                      </>
                    ) : null}

                    {!isInStaging ? (
                      <IonText>
                        <p>
                          Game round: {room.currentRound}/{room.settings.totalRounds}.
                        </p>
                      </IonText>
                    ) : null}
                  </IonCardContent>
                    </IonCard>
                  </IonCol>

                  <IonCol size="12" sizeLg="4">
                    <IonCard>
                      <IonCardHeader>
                        <IonCardTitle>Players Joined</IonCardTitle>
                        <IonCardSubtitle>{connectedPlayers.length}/10 players</IonCardSubtitle>
                      </IonCardHeader>
                      <IonCardContent>
                        {isInStaging && isHost ? (
                          <>
                            <IonText color="medium">
                              <p className="reorder-hint">Drag to set speaking order</p>
                            </IonText>
                            <IonReorderGroup
                              className="players-list"
                              disabled={isReorderingPlayers}
                              onIonItemReorder={reorderLobbyPlayers}
                            >
                              {connectedPlayers.map((p, index) => (
                                <IonItem key={p.id}>
                                  <IonLabel>
                                    {index + 1}. {formatLobbyPlayerLabel(p)}
                                  </IonLabel>
                                  <IonReorder slot="end" />
                                </IonItem>
                              ))}
                            </IonReorderGroup>
                          </>
                        ) : (
                          <IonList className="players-list">
                            {connectedPlayers.map((p, index) => (
                              <IonItem key={p.id}>
                                <IonLabel>
                                  {index + 1}. {formatLobbyPlayerLabel(p)}
                                </IonLabel>
                              </IonItem>
                            ))}
                          </IonList>
                        )}
                      </IonCardContent>
                    </IonCard>
                  </IonCol>
                </IonRow>
              </IonGrid>
            </>
          )}
          </div>

          <IonToast
            cssClass="neutral-toast"
            isOpen={Boolean(toastMessage)}
            message={toastMessage}
            duration={1600}
            onDidDismiss={() => setToastMessage("")}
          />
          <IonLoading
            isOpen={isWarmingServer}
            cssClass="warmup-overlay"
            message="Waking up server…"
            spinner="crescent"
            backdropDismiss={false}
          />
          <IonToast
            cssClass="neutral-toast"
            isOpen={Boolean(warningToastMessage)}
            message={warningToastMessage}
            duration={2200}
            onDidDismiss={() => setWarningToastMessage("")}
          />
          <IonToast
            isOpen={Boolean(errorToastMessage)}
            message={errorToastMessage}
            color="danger"
            duration={2200}
            onDidDismiss={() => setErrorToastMessage("")}
          />
          <IonAlert
            isOpen={showRestartConfirm}
            cssClass="imposter-restart-alert"
            header="Restart game?"
            message={restartPromptText}
            onDidDismiss={() => setShowRestartConfirm(false)}
            buttons={[
              {
                text: "Cancel",
                role: "cancel"
              },
              {
                text: "Restart",
                role: "destructive",
                handler: () => restartGame()
              }
            ]}
          />
        </IonContent>
      </IonPage>
    </IonApp>
  );
}
