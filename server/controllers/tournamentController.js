// server/controllers/tournamentController.js

const { validateTeamPlayers, validateRoomCode } = require("../utils/validation");
const { rooms, userSockets } = require("../utils/roomManager");

/**
 * Handle team setup updates
 */
function handleTeamSetup(socket, io) {
  socket.on("updateTeamPlayers", (data, callback) => {
    try {
      if (socket.checkRateLimit) {
        const rate = socket.checkRateLimit('playerSelect');
        if (!rate.allowed) {
          if (callback) {
            callback({
              success: false,
              error: `Rate limited. Retry after ${rate.retryAfterMs}ms`,
            });
          }
          return;
        }
      }

      const { roomCode, teamPlayers } = data;
      const codeValidation = validateRoomCode(roomCode);
      if (!codeValidation.valid) {
        console.error(`❌ Invalid room code in updateTeamPlayers:`, codeValidation.error);
        if (callback) callback({ success: false, error: codeValidation.error });
        return;
      }
      const room = rooms.get(codeValidation.code);
      const userInfo = userSockets.get(socket.id);

      console.log(`📥 Received updateTeamPlayers from ${socket.id} in room ${codeValidation.code}`);

      if (!userInfo) {
        console.log(`❌ User ${socket.id} not found in userSockets`);
        if (callback) callback({ success: false, error: "User not in room" });
        return;
      }

      if (userInfo.roomCode !== codeValidation.code) {
        console.log(`⚠️  User ${socket.id} not in room ${codeValidation.code}`);
        if (callback) callback({ success: false, error: "User not in room" });
        return;
      }

      // Validate team players
      const validation = validateTeamPlayers(teamPlayers || []);
      if (!validation.valid) {
        console.error(`❌ Invalid team players:`, validation.error);
        if (callback) callback({ success: false, error: validation.error });
        return;
      }

      const player = room.players.find((p) => p.socketId === socket.id);
      if (player) {
        player.teamPlayers = validation.players;
        player.isReady = validation.players.length === 11;

        console.log(
          `✅ 🏏 Player ${player.name} marked READY with ${validation.players.length} players`
        );

        if (callback) {
          callback({ success: true });
        }

        io.to(codeValidation.code).emit("roomUpdate", room);
      } else {
        console.log(`❌ Player with socket ${socket.id} not found in room ${codeValidation.code}`);
        if (callback) callback({ success: false, error: "Player not found" });
      }
    } catch (error) {
      console.error("❌ Error in updateTeamPlayers:", error);
      if (callback) {
        callback({ success: false, error: error.message });
      }
    }
  });
}

/**
 * Handle tournament team updates
 */
function handleTournamentTeamUpdate(socket, io) {
  socket.on("tournamentTeamUpdate", (data) => {
    try {
      if (socket.checkRateLimit) {
        const rate = socket.checkRateLimit('playerSelect');
        if (!rate.allowed) {
          return;
        }
      }

      const { code, teams } = data;
      const codeValidation = validateRoomCode(code);
      if (!codeValidation.valid) {
        console.error(`❌ Invalid room code in tournamentTeamUpdate:`, codeValidation.error);
        return;
      }
      const room = rooms.get(codeValidation.code);

      if (!room) return;

      const senderPlayer = room.players.find(p => p.socketId === socket.id);
      if (!senderPlayer) {
        console.log(`⚠️  Socket ${socket.id} not found in room ${codeValidation.code}`);
        return;
      }

      // Find the sending player and update their team players
      if (senderPlayer && teams.length > 0) {
        const theirTeam = teams[0];
        if (theirTeam.id === senderPlayer.side) {
          senderPlayer.teamPlayers = theirTeam.players || [];
          senderPlayer.isReady = (theirTeam.players?.length || 0) === 11;
          console.log(`🏏 Updated ${senderPlayer.name}'s team: ${senderPlayer.teamPlayers.length}/11 players, isReady: ${senderPlayer.isReady}`);
        }
      }

      // Broadcast team update to all players in room
      io.to(codeValidation.code).emit("tournamentTeamUpdate", { teams });
    } catch (error) {
      console.error("❌ Error in tournamentTeamUpdate:", error);
    }
  });
}

/**
 * Handle fixture generation
 */
function handleGenerateFixtures(socket, io) {
  socket.on("generateTournamentFixtures", (data, callback) => {
    try {
      const { code } = data;
      const codeValidation = validateRoomCode(code);
      if (!codeValidation.valid) {
        console.error(`❌ Invalid room code in generateTournamentFixtures:`, codeValidation.error);
        if (callback) callback({ success: false, error: codeValidation.error });
        return;
      }
      const room = rooms.get(codeValidation.code);

      if (!room || room.host !== socket.id) {
        console.log(`❌ Only host can generate fixtures`);
        if (callback) callback({ success: false, error: "Only host can generate fixtures" });
        return;
      }

      // Validate that all players have selected exactly 11 players
      console.log(`🏆 Validating teams for tournament in room ${code}`);
      const incompletePlayers = room.players.filter(p => {
        const playerCount = (p.teamPlayers && p.teamPlayers.length) || 0;
        console.log(`  Player ${p.name}: ${playerCount}/11 players`);
        return playerCount !== 11;
      });

      if (incompletePlayers.length > 0) {
        const incompleteNames = incompletePlayers.map(p => `${p.name} (${(p.teamPlayers && p.teamPlayers.length) || 0}/11)`).join(", ");
        const errorMsg = `Not all players have selected 11 players. Incomplete: ${incompleteNames}`;
        console.log(`❌ ${errorMsg}`);
        if (callback) callback({ success: false, error: errorMsg });
        io.to(codeValidation.code).emit("tournamentStartError", { error: errorMsg });
        return;
      }

      console.log(`✅ All players have 11 players selected, generating fixtures...`);

      // Generate round-robin fixtures for all teams
      const fixtures = [];
      let fixtureId = 1;

      for (let i = 0; i < room.players.length; i++) {
        for (let j = i + 1; j < room.players.length; j++) {
          fixtures.push({
            id: fixtureId,
            t1: room.players[i].side,
            t2: room.players[j].side,
            winner: null,
            played: false,
            stage: "league"
          });
          fixtureId++;
        }
      }

      console.log(`🏆 Generated ${fixtures.length} fixtures for room ${codeValidation.code}`);

      if (callback) {
        callback({ success: true, fixtureCount: fixtures.length });
      }

      io.to(codeValidation.code).emit("tournamentFixturesGenerated", { fixtures });
    } catch (error) {
      console.error("❌ Error in generateTournamentFixtures:", error);
      if (callback) {
        callback({ success: false, error: error.message });
      }
    }
  });
}

/**
 * Handle tournament results update
 */
function handleTournamentResultsUpdate(socket, io) {
  socket.on("tournamentResultsUpdate", (data) => {
    try {
      const { code, fixtures, tournTeams, phase } = data;
      const codeValidation = validateRoomCode(code);
      if (!codeValidation.valid) {
        console.error(`❌ Invalid room code in tournamentResultsUpdate:`, codeValidation.error);
        return;
      }
      const room = rooms.get(codeValidation.code);

      // Only host can broadcast tournament results
      if (!room || room.host !== socket.id) {
        console.log(`❌ Non-host tried to update tournament results. Host: ${room?.host}, Requester: ${socket.id}`);
        return;
      }

      // Broadcast updated tournament data to ALL players in room
      io.to(codeValidation.code).emit("tournamentResultsUpdate", {
        fixtures,
        tournTeams,
        phase,
        timestamp: Date.now(),
      });

      console.log(`📊 Tournament results updated and broadcast to room ${codeValidation.code}`);
      console.log(`   Fixtures: ${fixtures?.length || 0}, Teams: ${tournTeams?.length || 0}, Phase: ${phase}`);
    } catch (error) {
      console.error("❌ Error in tournamentResultsUpdate:", error);
    }
  });
}

/**
 * Initialize all tournament-related socket handlers
 */
function initializeTournamentHandlers(socket, io) {
  handleTeamSetup(socket, io);
  handleTournamentTeamUpdate(socket, io);
  handleGenerateFixtures(socket, io);
  handleTournamentResultsUpdate(socket, io);
}

module.exports = {
  initializeTournamentHandlers,
};
