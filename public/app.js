/* Ludo web client: lobby + up to 3 concurrent games in tabs. Display only: the server decides everything. */
(function () {
  "use strict";

  var MAX_GAMES = 3;
  var COLORS = ["#e53935", "#43a047", "#fdd835", "#1e88e5"];
  var SEAT_NAMES = ["Red", "Green", "Yellow", "Blue"];
  var START = [0, 13, 26, 39];
  var SAFE = [0, 8, 13, 21, 26, 34, 39, 47];
  var DICE_FACES = ["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];

  // The 52 shared track squares as [column,row], clockwise from seat 0's start.
  var TRACK = [
    [1,6],[2,6],[3,6],[4,6],[5,6],
    [6,5],[6,4],[6,3],[6,2],[6,1],[6,0],
    [7,0],[8,0],
    [8,1],[8,2],[8,3],[8,4],[8,5],
    [9,6],[10,6],[11,6],[12,6],[13,6],[14,6],
    [14,7],[14,8],
    [13,8],[12,8],[11,8],[10,8],[9,8],
    [8,9],[8,10],[8,11],[8,12],[8,13],[8,14],
    [7,14],[6,14],
    [6,13],[6,12],[6,11],[6,10],[6,9],
    [5,8],[4,8],[3,8],[2,8],[1,8],[0,8],
    [0,7],[0,6]
  ];
  var HOME_COL = [
    [[1,7],[2,7],[3,7],[4,7],[5,7]],
    [[7,1],[7,2],[7,3],[7,4],[7,5]],
    [[13,7],[12,7],[11,7],[10,7],[9,7]],
    [[7,13],[7,12],[7,11],[7,10],[7,9]]
  ];
  var YARD_ORIGIN = [[0,0],[9,0],[9,9],[0,9]];
  var YARD_SPOTS = [[2,2],[4,2],[2,4],[4,4]];
  var FINISH_OFFSET = [[-0.75,0],[0,-0.75],[0.75,0],[0,0.75]];

  var $ = function (id) { return document.getElementById(id); };
  var canvas = $("board");
  var ctx = canvas.getContext("2d");
  var CELL = canvas.width / 15;

  var userId = localStorage.getItem("ludo_user_id");
  if (!userId) {
    userId = "u_" + Math.random().toString(36).slice(2, 12);
    localStorage.setItem("ludo_user_id", userId);
  }
  $("name").value = localStorage.getItem("ludo_name") || "";
  $("who").textContent = "id " + userId.slice(0, 8);

  var wsProto = location.protocol === "https:" ? "wss://" : "ws://";
  var client = new Colyseus.Client(wsProto + location.host);

  var sessions = [];   // one per game: { room, state, mySeat, log, over, closed }
  var active = -1;     // index into sessions, -1 = lobby/new game tab

  // ---------- joining ----------
  function playerName() {
    var n = $("name").value.trim() || "Player";
    localStorage.setItem("ludo_name", n);
    return n;
  }

  function showError(msg) { $("error").textContent = msg || ""; }

  function errorText(err) {
    var code = err && err.code;
    if (code === 4003) return "You are already in " + MAX_GAMES + " games. Finish or leave one first.";
    if (code === 4004) return "You are already waiting in that game. Start it, or create a private room for another game.";
    if (code === 4002) return "That room is full.";
    if (code === 4001) return "Missing player id.";
    if (code === 4005) return "Tournaments are not available on this server right now.";
    if (code === 4006) return "Register for this tournament first (it must also be running).";
    if (code === 4007) return "This tournament uses a different number of players per game.";
    if (err && /not found|invalid/i.test(String(err.message))) return "Room not found. Check the code.";
    return (err && err.message) || "Could not join";
  }

  async function join(makeRoom) {
    showError("");
    if (sessions.filter(function (s) { return !s.closed; }).length >= MAX_GAMES) {
      showError("You can play at most " + MAX_GAMES + " games at once.");
      return;
    }
    try {
      var room = await makeRoom();
      addSession(room);
    } catch (err) {
      showError(errorText(err));
    }
  }

  $("quick").onclick = function () {
    join(function () {
      return client.joinOrCreate("ludo", { userId: userId, name: playerName(), players: Number($("players").value) });
    });
  };
  $("private").onclick = function () {
    join(function () {
      return client.create("ludo", { userId: userId, name: playerName(), players: Number($("players").value), private: true });
    });
  };
  $("join").onclick = function () {
    var code = $("code").value.trim();
    if (!code) { showError("Enter a room code."); return; }
    join(function () { return client.joinById(code, { userId: userId, name: playerName() }); });
  };

  // ---------- tournaments ----------
  var apiBase = localStorage.getItem("ludo_api_url") || "";
  $("apiurl").value = apiBase;

  function esc(v) {
    return String(v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  async function api(path, init) {
    var res = await fetch(apiBase.replace(/\/+$/, "") + "/api" + path, init);
    var body = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(body.message || "HTTP " + res.status);
    return body;
  }

  async function loadTournaments() {
    apiBase = $("apiurl").value.trim();
    localStorage.setItem("ludo_api_url", apiBase);
    var box = $("tlist");
    try {
      var list = await api("/tournaments");
      if (!list.length) { box.textContent = "No tournaments yet."; return; }
      box.innerHTML = list.map(function (t) {
        var btns = "";
        if (t.status === "scheduled" || t.status === "running") btns += '<button data-act="reg" data-id="' + t.id + '" class="secondary">Register</button> ';
        if (t.status === "running") btns += '<button data-act="play" data-id="' + t.id + '" data-n="' + t.playersPerGame + '">Play</button> ';
        btns += '<button data-act="board" data-id="' + t.id + '" class="secondary">Leaderboard</button>';
        return '<div class="t"><b>' + esc(t.name) + "</b> – " + esc(t.status) + ", " + t.playersPerGame +
          " players/game, ends " + esc(new Date(t.endsAt).toLocaleString()) +
          '<div class="row">' + btns + '</div><div id="b-' + t.id + '"></div></div>';
      }).join("");
    } catch (err) {
      box.textContent = "Could not load tournaments: " + err.message;
    }
  }

  async function showBoard(id) {
    var el = document.getElementById("b-" + id);
    var rows = await api("/tournaments/" + id + "/leaderboard");
    el.innerHTML = rows.length
      ? "<table><tr><th>#</th><th>Player</th><th>Pts</th><th>Wins</th><th>Games</th></tr>" +
        rows.map(function (r) {
          return "<tr><td>" + r.rank + "</td><td>" + esc(r.name) + "</td><td>" + r.points + "</td><td>" + r.wins + "</td><td>" + r.gamesPlayed + "</td></tr>";
        }).join("") + "</table>"
      : "No players yet.";
  }

  $("loadt").onclick = loadTournaments;
  $("tlist").onclick = async function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    var id = b.dataset.id;
    showError("");
    try {
      if (b.dataset.act === "board") await showBoard(id);
      else if (b.dataset.act === "reg") {
        await api("/tournaments/" + id + "/entries", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId: userId, name: playerName() }),
        });
        showError("Registered! You can play once the tournament is running.");
        await showBoard(id);
      } else if (b.dataset.act === "play") {
        join(function () {
          return client.joinOrCreate("ludo", { userId: userId, name: playerName(), players: Number(b.dataset.n), tournamentId: id });
        });
      }
    } catch (err) {
      showError(err.message);
    }
  };

  // ---------- sessions ----------
  function addSession(room) {
    var s = { room: room, state: null, mySeat: -1, log: [], over: null, closed: false, myTurn: false };
    sessions.push(s);
    room.onStateChange(function (state) {
      s.state = state.toJSON();
      var me = s.state.players.find(function (p) { return p.userId === userId; });
      s.mySeat = me ? me.seat : -1;
      s.myTurn = s.state.currentSeat === s.mySeat && (s.state.phase === "roll" || s.state.phase === "move");
      refresh();
    });
    room.onMessage("rolled", function (m) {
      pushLog(s, SEAT_NAMES[m.seat] + " rolled " + m.dice + (m.passed ? (m.reason === "three-sixes" ? " (three sixes, turn lost)" : " (no move)") : ""));
    });
    room.onMessage("moved", function (m) {
      var text = SEAT_NAMES[m.seat] + " moved piece " + (m.piece + 1);
      if (m.captured && m.captured.length) text += ", captured " + m.captured.length;
      if (m.reachedHome) text += ", reached home";
      pushLog(s, text);
    });
    room.onMessage("forfeit", function (m) {
      pushLog(s, SEAT_NAMES[m.seat] + " forfeited (" + (m.reason === "timeout" ? "missed turns" : "left") + ")");
    });
    room.onMessage("bot_takeover", function (m) { pushLog(s, "A bot took over " + SEAT_NAMES[m.seat]); });
    room.onMessage("game_over", function (m) { s.over = m; refresh(); });
    room.onLeave(function () { s.closed = true; refresh(); });
    active = sessions.length - 1;
    refresh();
  }

  function pushLog(s, text) {
    s.log.push(text);
    if (s.log.length > 40) s.log.shift();
    refresh();
  }

  function removeSession(s) {
    try { s.room.leave(true); } catch (e) { /* already closed */ }
    var i = sessions.indexOf(s);
    if (i >= 0) sessions.splice(i, 1);
    active = sessions.length ? Math.min(active, sessions.length - 1) : -1;
    refresh();
  }

  // ---------- UI ----------
  function current() { return active >= 0 ? sessions[active] : null; }

  function refresh() {
    renderTabs();
    var s = current();
    $("lobby").style.display = s ? "none" : "block";
    $("game").style.display = s ? "flex" : "none";
    if (s) renderGame(s);
    $("over").style.display = s && s.over ? "flex" : "none";
    if (s && s.over) renderOver(s);
  }

  function renderTabs() {
    var tabs = $("tabs");
    tabs.textContent = "";
    sessions.forEach(function (s, i) {
      var b = document.createElement("div");
      b.className = "tab" + (i === active ? " active" : "");
      var seatName = s.mySeat >= 0 ? " · " + SEAT_NAMES[s.mySeat] : "";
      b.textContent = "Game " + (i + 1) + seatName + (s.over ? " (over)" : "");
      if (s.myTurn && i !== active) {
        var dot = document.createElement("span");
        dot.className = "dot";
        dot.title = "Your turn";
        b.appendChild(dot);
      }
      b.onclick = function () { active = i; refresh(); };
      tabs.appendChild(b);
    });
    if (sessions.length < MAX_GAMES) {
      var add = document.createElement("div");
      add.className = "tab" + (active === -1 ? " active" : "");
      add.textContent = "+ New game";
      add.onclick = function () { active = -1; refresh(); };
      tabs.appendChild(add);
    }
  }

  function renderGame(s) {
    var st = s.state;
    if (!st) { $("status").textContent = "Connecting..."; return; }
    var phase = st.phase;
    var lines;
    if (phase === "lobby") {
      var secs = st.fillDeadline ? Math.max(0, Math.ceil((st.fillDeadline - Date.now()) / 1000)) : 0;
      lines = "Waiting for players (" + st.players.length + "/" + st.playerCount + ")" +
        (st.isPrivate ? "" : secs ? " – bots join in " + secs + "s" : "");
    } else if (phase === "finished") {
      lines = "Game finished";
    } else if (s.myTurn) {
      lines = phase === "roll" ? "Your turn: roll the dice" : "Your turn: tap a glowing piece";
    } else {
      var cur = st.players.find(function (p) { return p.seat === st.currentSeat; });
      lines = "Waiting for " + (cur ? cur.name : SEAT_NAMES[st.currentSeat]) + (cur && cur.isBot ? " (bot)" : "") + "...";
    }
    if (s.myTurn && st.turnDeadline) {
      lines += " – " + Math.max(0, Math.ceil((st.turnDeadline - Date.now()) / 1000)) + "s";
    }
    $("status").textContent = lines;
    $("dice").textContent = st.dice ? DICE_FACES[st.dice] + " " + st.dice : "";
    $("roll").disabled = !(s.myTurn && phase === "roll");
    $("roll").style.display = phase === "lobby" ? "none" : "inline-block";
    $("start").style.display = phase === "lobby" ? "inline-block" : "none";
    $("roomline").textContent = "Room code: " + s.room.roomId + (st.isPrivate ? " (share it with friends)" : "") +
      (s.mySeat >= 0 ? " – you are " + SEAT_NAMES[s.mySeat] : "");

    var list = $("players-list");
    list.textContent = "";
    st.players.slice().sort(function (a, b) { return a.seat - b.seat; }).forEach(function (p) {
      var row = document.createElement("div");
      row.className = "pl" + (p.seat === st.currentSeat ? " turn" : "");
      var chip = document.createElement("span");
      chip.className = "chip";
      chip.style.background = COLORS[p.seat];
      var name = document.createElement("span");
      name.textContent = p.name + (p.userId === userId ? " (you)" : "");
      row.appendChild(chip);
      row.appendChild(name);
      var home = p.pieces.filter(function (v) { return v === 56; }).length;
      var info = document.createElement("span");
      info.className = "tag";
      info.textContent = home + "/4 home";
      row.appendChild(info);
      [[p.isBot, "bot"], [!p.connected && !p.isBot, "offline"], [p.forfeited, "out"]].forEach(function (t) {
        if (!t[0]) return;
        var tag = document.createElement("span");
        tag.className = "tag";
        tag.textContent = t[1];
        row.appendChild(tag);
      });
      list.appendChild(row);
    });

    var log = $("log");
    log.textContent = s.log.slice(-8).reverse().join("\n");
    log.style.whiteSpace = "pre-line";
    draw(s);
  }

  function renderOver(s) {
    var ol = $("ranking");
    ol.textContent = "";
    s.over.placements.forEach(function (p) {
      var li = document.createElement("li");
      li.textContent = SEAT_NAMES[p.seat] + ": " + p.name + (p.isBot ? " (bot)" : "") + (p.userId === userId ? " – you" : "");
      ol.appendChild(li);
    });
  }

  $("roll").onclick = function () { var s = current(); if (s) s.room.send("roll"); };
  $("start").onclick = function () { var s = current(); if (s) s.room.send("start"); };
  $("leave").onclick = function () {
    var s = current();
    if (!s) return;
    if (s.over || s.closed || confirm("Leave this game? You will forfeit it.")) removeSession(s);
  };
  $("closeGame").onclick = function () { var s = current(); if (s) removeSession(s); };
  document.addEventListener("keydown", function (e) {
    var s = current();
    if (e.code === "Space" && s && s.myTurn && s.state.phase === "roll" && e.target === document.body) {
      e.preventDefault();
      s.room.send("roll");
    }
  });

  // ---------- board ----------
  function cellCenter(c, r) { return [c + 0.5, r + 0.5]; }

  function piecePos(seat, progress, idx) {
    if (progress < 0) {
      var o = YARD_ORIGIN[seat], sp = YARD_SPOTS[idx];
      return [o[0] + sp[0] + 0.5, o[1] + sp[1] + 0.5];
    }
    if (progress <= 50) {
      var t = TRACK[(START[seat] + progress) % 52];
      return cellCenter(t[0], t[1]);
    }
    if (progress <= 55) {
      var h = HOME_COL[seat][progress - 51];
      return cellCenter(h[0], h[1]);
    }
    var f = FINISH_OFFSET[seat];
    return [7.5 + f[0] + (idx - 1.5) * 0.16 * (f[0] === 0 ? 1 : 0), 7.5 + f[1] + (idx - 1.5) * 0.16 * (f[1] === 0 ? 1 : 0)];
  }

  function rect(c, r, fill, stroke) {
    ctx.fillStyle = fill;
    ctx.fillRect(c * CELL, r * CELL, CELL, CELL);
    ctx.strokeStyle = stroke || "#bdb7a6";
    ctx.lineWidth = 1;
    ctx.strokeRect(c * CELL + 0.5, r * CELL + 0.5, CELL - 1, CELL - 1);
  }

  function tri(a, b, c, fill) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(a[0] * CELL, a[1] * CELL);
    ctx.lineTo(b[0] * CELL, b[1] * CELL);
    ctx.lineTo(c[0] * CELL, c[1] * CELL);
    ctx.closePath();
    ctx.fill();
  }

  function drawBoardBase() {
    ctx.fillStyle = "#faf8f1";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // yards
    YARD_ORIGIN.forEach(function (o, seat) {
      ctx.fillStyle = COLORS[seat];
      ctx.globalAlpha = 0.9;
      ctx.fillRect(o[0] * CELL, o[1] * CELL, 6 * CELL, 6 * CELL);
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#fff";
      ctx.fillRect((o[0] + 1) * CELL, (o[1] + 1) * CELL, 4 * CELL, 4 * CELL);
      YARD_SPOTS.forEach(function (sp) {
        ctx.beginPath();
        ctx.arc((o[0] + sp[0] + 0.5) * CELL, (o[1] + sp[1] + 0.5) * CELL, CELL * 0.42, 0, Math.PI * 2);
        ctx.fillStyle = COLORS[seat];
        ctx.globalAlpha = 0.25;
        ctx.fill();
        ctx.globalAlpha = 1;
      });
    });
    // track
    TRACK.forEach(function (t, i) {
      var startSeat = START.indexOf(i);
      rect(t[0], t[1], startSeat >= 0 ? COLORS[startSeat] : "#fff");
      if (SAFE.indexOf(i) >= 0 && startSeat < 0) {
        ctx.fillStyle = "#8a8575";
        ctx.font = (CELL * 0.7) + "px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("★", (t[0] + 0.5) * CELL, (t[1] + 0.55) * CELL);
      }
    });
    // home columns
    HOME_COL.forEach(function (cells, seat) {
      cells.forEach(function (c) { rect(c[0], c[1], COLORS[seat]); });
    });
    // centre
    var c = [7.5, 7.5];
    tri([6, 6], [6, 9], c, COLORS[0]);
    tri([6, 6], [9, 6], c, COLORS[1]);
    tri([9, 6], [9, 9], c, COLORS[2]);
    tri([6, 9], [9, 9], c, COLORS[3]);
  }

  function draw(s) {
    drawBoardBase();
    var st = s.state;
    if (!st || st.phase === "lobby") return;

    // group pieces by position so stacked pieces are spread out
    var spots = {};
    st.players.forEach(function (p) {
      p.pieces.forEach(function (prog, idx) {
        var pos = piecePos(p.seat, prog, idx);
        var key = prog < 0 ? "y" + p.seat + idx : pos[0].toFixed(2) + "," + pos[1].toFixed(2);
        (spots[key] = spots[key] || []).push({ seat: p.seat, idx: idx, pos: pos });
      });
    });

    var pulse = 0.5 + 0.5 * Math.sin(Date.now() / 220);
    Object.keys(spots).forEach(function (key) {
      var group = spots[key];
      group.forEach(function (pc, i) {
        // stacked pieces share a square: lay them out in a 2x2 grid inside it
        var stacked = group.length > 1;
        var dx = stacked ? ((i % 2) - 0.5) * 0.46 : 0;
        var dy = stacked ? (Math.floor(i / 2) - (group.length > 2 ? 0.5 : 0)) * 0.46 : 0;
        var x = (pc.pos[0] + dx) * CELL, y = (pc.pos[1] + dy) * CELL;
        var r = CELL * (stacked ? 0.21 : 0.34);
        var legal = s.myTurn && st.phase === "move" && pc.seat === s.mySeat && st.legalMoves.indexOf(pc.idx) >= 0;
        if (legal) {
          ctx.beginPath();
          ctx.arc(x, y, r + 3 + pulse * 4, 0, Math.PI * 2);
          ctx.strokeStyle = "#111";
          ctx.lineWidth = 3;
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = COLORS[pc.seat];
        ctx.fill();
        ctx.strokeStyle = "#222";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = pc.seat === 2 ? "#222" : "#fff";
        ctx.font = "bold " + Math.round(r * 1.1) + "px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(pc.idx + 1), x, y + 1);
      });
    });
  }

  canvas.addEventListener("click", function (e) {
    var s = current();
    if (!s || !s.state || !s.myTurn || s.state.phase !== "move") return;
    var box = canvas.getBoundingClientRect();
    var gx = ((e.clientX - box.left) / box.width) * 15;
    var gy = ((e.clientY - box.top) / box.height) * 15;
    var me = s.state.players.find(function (p) { return p.seat === s.mySeat; });
    var best = -1, bestD = 0.7;
    s.state.legalMoves.forEach(function (idx) {
      var pos = piecePos(me.seat, me.pieces[idx], idx);
      var d = Math.hypot(pos[0] - gx, pos[1] - gy);
      if (d < bestD) { bestD = d; best = idx; }
    });
    if (best >= 0) s.room.send("move", { piece: best });
  });

  // Read-only handle used by the browser end-to-end test.
  window.__ludo = { sessions: sessions, piecePos: piecePos, userId: userId };

  // keep countdowns and the glow animated
  setInterval(function () { var s = current(); if (s && s.state) renderGame(s); }, 250);
  refresh();
})();
