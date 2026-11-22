/* Ludo Arena web client: lobby + up to 3 concurrent games in tabs. Display only: the server decides everything. */
(function () {
  "use strict";

  var MAX_GAMES = 3;
  // [main, light, dark] per seat
  var PAL = [
    ["#e53935", "#ff8a80", "#9f1411"],
    ["#2e9d4a", "#8be3a0", "#17612b"],
    ["#f9c70c", "#fff09a", "#b78a00"],
    ["#1e6fe0", "#8fc0ff", "#0c3f93"]
  ];
  var COLORS = PAL.map(function (p) { return p[0]; });
  var SEAT_NAMES = ["Red", "Green", "Yellow", "Blue"];
  var START = [0, 13, 26, 39];
  var SAFE = [0, 8, 13, 21, 26, 34, 39, 47];
  var PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

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

  // 3D renderer (falls back to the flat canvas when WebGL is not available)
  var b3d = null;
  try { b3d = window.Board3D && Board3D.create($("board3d")); } catch (e) { b3d = null; }
  if (b3d) $("boardwrap").classList.add("has3d"); else $("board3d").style.display = "none";
  var pickTarget = b3d ? $("board3d") : canvas;

  var userId = localStorage.getItem("ludo_user_id");
  if (!userId) {
    userId = "u_" + Math.random().toString(36).slice(2, 12);
    localStorage.setItem("ludo_user_id", userId);
  }
  $("name").value = localStorage.getItem("ludo_name") || "";
  $("who").textContent = "id " + userId.slice(0, 8);

  var wsProto = location.protocol === "https:" ? "wss://" : "ws://";
  var client = new Colyseus.Client(wsProto + location.host);

  var sessions = [];   // one per game
  var active = -1;     // index into sessions, -1 = lobby/new game tab

  // ---------- sound & vibration ----------
  var muted = localStorage.getItem("ludo_muted") === "1";
  var actx = null;
  function audio() {
    if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = null; } }
    if (actx && actx.state === "suspended") actx.resume();
    return actx;
  }
  function tone(freq, dur, type, vol, delay) {
    if (muted) return;
    var a = audio();
    if (!a) return;
    var t0 = a.currentTime + (delay || 0);
    var o = a.createOscillator(), g = a.createGain();
    o.type = type || "sine";
    o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.15, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(a.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  var sfx = {
    roll: function () { for (var i = 0; i < 7; i++) tone(300 + Math.random() * 500, 0.05, "square", 0.05, i * 0.07); },
    step: function () { tone(620, 0.05, "triangle", 0.12); },
    capture: function () { tone(440, 0.12, "sawtooth", 0.14); tone(300, 0.14, "sawtooth", 0.14, 0.1); tone(180, 0.22, "sawtooth", 0.14, 0.2); },
    home: function () { [523, 659, 784, 1047].forEach(function (f, i) { tone(f, 0.16, "triangle", 0.15, i * 0.09); }); },
    turn: function () { tone(880, 0.1, "sine", 0.12); tone(1175, 0.14, "sine", 0.1, 0.1); },
    win: function () { [523, 659, 784, 659, 784, 1047, 1319].forEach(function (f, i) { tone(f, 0.2, "triangle", 0.16, i * 0.11); }); }
  };
  function buzz(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { /* not supported */ } }
  function paintMute() { $("mute").textContent = muted ? "🔇" : "🔊"; }
  $("mute").onclick = function () { muted = !muted; localStorage.setItem("ludo_muted", muted ? "1" : "0"); paintMute(); if (!muted) sfx.step(); };
  paintMute();
  document.addEventListener("pointerdown", function () { if (!muted) audio(); }, { once: true });

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
      return client.joinOrCreate("ludo", { userId: userId, name: playerName(), players: Number($("players").value), waitForHumans: true });
    });
  };
  $("bots").onclick = function () {
    join(function () {
      return client.create("ludo", { userId: userId, name: playerName(), players: Number($("players").value), vsBots: true });
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
        if (t.status === "scheduled" || t.status === "running") btns += '<button data-act="reg" data-id="' + t.id + '" class="btn secondary">Register</button> ';
        if (t.status === "running") btns += '<button data-act="play" data-id="' + t.id + '" data-n="' + t.playersPerGame + '" class="btn">Play</button> ';
        btns += '<button data-act="board" data-id="' + t.id + '" class="btn ghost">Leaderboard</button>';
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
    var s = { room: room, state: null, mySeat: -1, log: [], over: null, closed: false, myTurn: false,
              anim: {}, rollAnimUntil: 0, fx: [], turnStart: 0, turnDeadline: 0, lastSeq: -1, prevPieces: null };
    sessions.push(s);
    room.onStateChange(function (state) {
      var wasMyTurn = s.myTurn;
      s.state = state.toJSON();
      var me = s.state.players.find(function (p) { return p.userId === userId; });
      s.mySeat = me ? me.seat : -1;
      s.myTurn = s.state.currentSeat === s.mySeat && (s.state.phase === "roll" || s.state.phase === "move");
      if (s.myTurn && !wasMyTurn) { sfx.turn(); buzz(40); }
      if (s.state.turnDeadline !== s.turnDeadline) {
        s.turnDeadline = s.state.turnDeadline;
        s.turnStart = Date.now();
      }
      refresh();
    });
    room.onMessage("rolled", function (m) {
      s.rollAnimUntil = Date.now() + 1000;
      if (s === current()) { sfx.roll(); placeDie(s, m.seat); setCube(m.dice, true, s); }
      pushLog(s, SEAT_NAMES[m.seat] + " rolled " + m.dice + (m.passed ? (m.reason === "three-sixes" ? " (three sixes, turn lost)" : " (no move)") : ""));
    });
    room.onMessage("moved", function (m) {
      var text = SEAT_NAMES[m.seat] + " moved piece " + (m.piece + 1);
      if (m.captured && m.captured.length) { text += ", captured " + m.captured.length; if (s === current()) { setTimeout(sfx.capture, 250); buzz([40, 40, 90]); } }
      if (m.reachedHome) { text += ", reached home"; if (s === current()) setTimeout(sfx.home, 300); }
      pushLog(s, text);
    });
    room.onMessage("forfeit", function (m) {
      pushLog(s, SEAT_NAMES[m.seat] + " forfeited (" + (m.reason === "timeout" ? "missed turns" : "left") + ")");
    });
    room.onMessage("bot_takeover", function (m) { pushLog(s, "A bot took over " + SEAT_NAMES[m.seat]); });
    room.onMessage("game_over", function (m) {
      s.over = m;
      var mine = m.placements.find(function (p) { return p.userId === userId; });
      if (s === current() && mine && mine.placement === 1) { sfx.win(); confetti(); buzz([60, 40, 60, 40, 160]); }
      refresh();
    });
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
    if (!sessions.length) return;
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

  var seatCards = {};
  [[0, "row-top"], [1, "row-top"], [3, "row-bottom"], [2, "row-bottom"]].forEach(function (d) {
    var el = document.createElement("div");
    el.className = "seat";
    el.dataset.seat = d[0];
    el.innerHTML = '<div class="av"></div><div class="info"><div class="nm"></div><div class="sub"></div></div><div class="slot"></div>';
    $(d[1]).appendChild(el);
    seatCards[d[0]] = { el: el, av: el.querySelector(".av"), nm: el.querySelector(".nm"), sub: el.querySelector(".sub") };
  });

  // ----- 3D dice: a cube that rolls to the number the server rolled -----
  var CUBE_ROT = { 1: [0, 0], 2: [0, -90], 3: [-90, 0], 4: [90, 0], 5: [0, 90], 6: [0, 180] };
  var cubeEl = $("roll").querySelector(".cube");
  var cubeSpin = 0, dieOwner = null, dieVal = 0;
  (function buildCube() {
    for (var f = 1; f <= 6; f++) {
      var face = document.createElement("div");
      face.className = "face f" + f;
      for (var i = 0; i < 9; i++) {
        var pip = document.createElement("div");
        pip.className = "pip" + (PIPS[f].indexOf(i) >= 0 ? " on" : "");
        face.appendChild(pip);
      }
      cubeEl.appendChild(face);
    }
  })();

  function setCube(v, animate, s) {
    if (!CUBE_ROT[v]) return;
    cubeSpin += animate ? 2 : 0;
    cubeEl.classList.toggle("anim", !!animate);
    var rx = CUBE_ROT[v][0] + 360 * cubeSpin, ry = CUBE_ROT[v][1] + 360 * cubeSpin;
    cubeEl.style.transform = "rotateX(" + rx + "deg) rotateY(" + ry + "deg)";
    dieOwner = s || dieOwner;
    dieVal = v;
  }

  /** The one die sits next to whoever is rolling. */
  function placeDie(s, seat) {
    var slot = document.querySelector('.seat[data-seat="' + seat + '"] .slot');
    var r = $("roll");
    if (slot && r.parentNode !== slot) slot.appendChild(r);
  }

  function updateDie(s) {
    var st = s.state, r = $("roll");
    if (!st) return;
    if (st.phase === "lobby") { r.style.visibility = "hidden"; return; }
    r.style.visibility = "visible";
    if (st.currentSeat >= 0) placeDie(s, st.currentSeat);
    var rolling = Date.now() < s.rollAnimUntil;
    // switching tabs or reconnecting: show the current number straight away
    if (dieOwner !== s || (!rolling && st.dice > 0 && dieVal !== st.dice)) {
      if (st.dice > 0) setCube(st.dice, false, s); else { dieOwner = s; }
    }
    r.classList.toggle("ready", s.myTurn && st.phase === "roll" && !rolling);
    r.classList.toggle("idle", !s.myTurn);
  }

  function renderGame(s) {
    var st = s.state;
    if (!st) { $("status").textContent = "Connecting..."; return; }
    var phase = st.phase;
    var lines;
    if (phase === "lobby") {
      var secs = st.fillDeadline ? Math.max(0, Math.ceil((st.fillDeadline - Date.now()) / 1000)) : 0;
      lines = "Waiting for players (" + st.players.length + "/" + st.playerCount + ")" +
        (st.isPrivate ? " – share the room code" : secs ? " – computer joins in " + secs + "s" : "");
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
    $("roll").disabled = !(s.myTurn && phase === "roll");
    $("start").style.display = phase === "lobby" && !st.isPrivate ? "inline-block" : (phase === "lobby" ? "inline-block" : "none");
    $("roomline").textContent = "Room code: " + s.room.roomId + (st.isPrivate ? " (share it with friends)" : "") +
      (s.mySeat >= 0 ? " – you are " + SEAT_NAMES[s.mySeat] : "");

    [0, 1, 3, 2].forEach(function (seat) {
      var card = seatCards[seat];
      var p = st.players.find(function (q) { return q.seat === seat; });
      card.el.className = "seat" + (seat === 1 || seat === 2 ? " right" : "") + (!p ? " empty" : "") +
        (p && seat === st.currentSeat ? " turn" : "") + (p && ((!p.connected && !p.isBot) || p.forfeited) ? " off" : "");
      if (!p) return;
      card.av.style.background = "radial-gradient(circle at 35% 30%, " + PAL[seat][1] + ", " + PAL[seat][0] + " 55%, " + PAL[seat][2] + ")";
      card.nm.textContent = p.userId === userId ? "You" : p.name;
      var home = p.pieces.filter(function (v) { return v === 56; }).length;
      card.sub.textContent = p.forfeited ? "out" : (p.isBot ? "🤖 " : "🏠 ") + home + "/4";
    });

    var last = s.log.length ? s.log[s.log.length - 1] : "";
    $("log").textContent = last;
    updateDie(s);
  }

  function renderOver(s) {
    var ol = $("ranking");
    ol.textContent = "";
    var medals = ["🥇", "🥈", "🥉", "4️⃣"];
    var mine = s.over.placements.find(function (p) { return p.userId === userId; });
    $("overtitle").textContent = mine && mine.placement === 1 ? "You won! 🎉" : "Game over";
    $("oversub").textContent = mine ? "You finished #" + mine.placement : "";
    s.over.placements.forEach(function (p) {
      var li = document.createElement("li");
      if (p.userId === userId) li.className = "me";
      var m = document.createElement("span"); m.className = "medal"; m.textContent = medals[p.placement - 1] || p.placement;
      var d = document.createElement("span"); d.className = "dotc"; d.style.background = COLORS[p.seat];
      var t = document.createElement("span"); t.textContent = p.name + (p.isBot ? " (bot)" : "") + (p.userId === userId ? " – you" : "");
      li.appendChild(m); li.appendChild(d); li.appendChild(t);
      ol.appendChild(li);
    });
  }

  $("roll").onclick = function () { var s = current(); if (s) { audio(); s.room.send("roll"); } };
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

  /** Board position (in cells) of a piece. `progress` may be fractional while a piece is hopping. */
  function piecePos(seat, progress, idx) {
    if (progress < 0) {
      var o = YARD_ORIGIN[seat], sp = YARD_SPOTS[idx];
      return [o[0] + sp[0] + 0.5, o[1] + sp[1] + 0.5];
    }
    var lo = Math.floor(progress), hi = Math.ceil(progress);
    if (hi !== lo) {
      var a = piecePos(seat, lo, idx), b = piecePos(seat, hi, idx), f = progress - lo;
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    }
    if (progress <= 50) {
      var t = TRACK[(START[seat] + progress) % 52];
      return cellCenter(t[0], t[1]);
    }
    if (progress <= 55) {
      var h = HOME_COL[seat][progress - 51];
      return cellCenter(h[0], h[1]);
    }
    var f2 = FINISH_OFFSET[seat];
    return [7.5 + f2[0] + (idx - 1.5) * 0.16 * (f2[0] === 0 ? 1 : 0), 7.5 + f2[1] + (idx - 1.5) * 0.16 * (f2[1] === 0 ? 1 : 0)];
  }

  function cellFill(c, r, seat, inset) {
    var x = c * CELL, y = r * CELL;
    var g = ctx.createLinearGradient(x, y, x + CELL, y + CELL);
    g.addColorStop(0, PAL[seat][1]);
    g.addColorStop(0.5, PAL[seat][0]);
    g.addColorStop(1, PAL[seat][2]);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, CELL, CELL);
    ctx.strokeStyle = "rgba(0,0,0,.28)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 0.75, y + 0.75, CELL - 1.5, CELL - 1.5);
    if (inset) {
      ctx.strokeStyle = "rgba(255,255,255,.35)";
      ctx.strokeRect(x + 4, y + 4, CELL - 8, CELL - 8);
    }
  }

  function cellWhite(c, r) {
    var x = c * CELL, y = r * CELL;
    var g = ctx.createLinearGradient(x, y, x, y + CELL);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(1, "#ece8f6");
    ctx.fillStyle = g;
    ctx.fillRect(x, y, CELL, CELL);
    ctx.strokeStyle = "#b9b2d4";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 0.75, y + 0.75, CELL - 1.5, CELL - 1.5);
  }

  function star(cx, cy, R, fill) {
    ctx.beginPath();
    for (var i = 0; i < 10; i++) {
      var ang = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? R * 0.42 : R;
      ctx.lineTo(cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr);
    }
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function tri(a, b, c, seat) {
    var g = ctx.createLinearGradient(a[0] * CELL, a[1] * CELL, 7.5 * CELL, 7.5 * CELL);
    g.addColorStop(0, PAL[seat][2]);
    g.addColorStop(1, PAL[seat][1]);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(a[0] * CELL, a[1] * CELL);
    ctx.lineTo(b[0] * CELL, b[1] * CELL);
    ctx.lineTo(c[0] * CELL, c[1] * CELL);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.8)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  function arrow(cx, cy, dir, fill) {
    // dir: angle in radians the arrow points towards
    ctx.save();
    ctx.translate(cx * CELL, cy * CELL);
    ctx.rotate(dir);
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(CELL * 0.26, 0);
    ctx.lineTo(-CELL * 0.16, -CELL * 0.24);
    ctx.lineTo(-CELL * 0.16, CELL * 0.24);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawBoardBase(turnSeat, pulse) {
    ctx.fillStyle = "#f3f0fb";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // yards
    YARD_ORIGIN.forEach(function (o, seat) {
      var x = o[0] * CELL, y = o[1] * CELL, w = 6 * CELL;
      var g = ctx.createLinearGradient(x, y, x + w, y + w);
      g.addColorStop(0, PAL[seat][1]);
      g.addColorStop(0.45, PAL[seat][0]);
      g.addColorStop(1, PAL[seat][2]);
      ctx.fillStyle = g;
      ctx.fillRect(x, y, w, w);
      // white plate
      roundRect(x + CELL, y + CELL, 4 * CELL, 4 * CELL, CELL * 0.6);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(0,0,0,.18)";
      ctx.stroke();
      YARD_SPOTS.forEach(function (sp) {
        var cx = (o[0] + sp[0] + 0.5) * CELL, cy = (o[1] + sp[1] + 0.5) * CELL;
        ctx.beginPath();
        ctx.arc(cx, cy, CELL * 0.48, 0, Math.PI * 2);
        var rg = ctx.createRadialGradient(cx - 4, cy - 4, 2, cx, cy, CELL * 0.48);
        rg.addColorStop(0, PAL[seat][1]);
        rg.addColorStop(1, PAL[seat][0]);
        ctx.fillStyle = rg;
        ctx.globalAlpha = 0.55;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.lineWidth = 2;
        ctx.strokeStyle = "rgba(0,0,0,.2)";
        ctx.stroke();
      });
    });
    // track
    TRACK.forEach(function (t, i) {
      var startSeat = START.indexOf(i);
      if (startSeat >= 0) cellFill(t[0], t[1], startSeat, true);
      else cellWhite(t[0], t[1]);
      if (SAFE.indexOf(i) >= 0) {
        star((t[0] + 0.5) * CELL, (t[1] + 0.53) * CELL, CELL * 0.32, startSeat >= 0 ? "rgba(255,255,255,.95)" : "#a79fcf");
      }
    });
    // home columns
    HOME_COL.forEach(function (cells, seat) {
      cells.forEach(function (c) { cellFill(c[0], c[1], seat, false); });
    });
    // direction arrows at the entrance of each home column
    arrow(0.5, 7.5, 0, "rgba(255,255,255,.9)");
    arrow(7.5, 0.5, Math.PI / 2, "rgba(255,255,255,.9)");
    arrow(14.5, 7.5, Math.PI, "rgba(255,255,255,.9)");
    arrow(7.5, 14.5, -Math.PI / 2, "rgba(255,255,255,.9)");
    // centre
    var c = [7.5, 7.5];
    tri([6, 6], [6, 9], c, 0);
    tri([6, 6], [9, 6], c, 1);
    tri([9, 6], [9, 9], c, 2);
    tri([6, 9], [9, 9], c, 3);
    star(7.5 * CELL, 7.5 * CELL, CELL * 0.5, "rgba(255,255,255,.95)");

    // glow around the yard of the player whose turn it is
    if (turnSeat >= 0) {
      var o2 = YARD_ORIGIN[turnSeat];
      ctx.lineWidth = 6;
      ctx.strokeStyle = "rgba(255,255,255," + (0.45 + 0.4 * pulse) + ")";
      ctx.strokeRect(o2[0] * CELL + 3, o2[1] * CELL + 3, 6 * CELL - 6, 6 * CELL - 6);
    }
  }

  function pawn(x, y, r, seat, lift, bright) {
    var pal = PAL[seat];
    var base = r * 0.95;
    // shadow stays on the ground while the pawn hops
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.78, base * 0.85, base * 0.32, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0," + (0.3 - lift * 0.12) + ")";
    ctx.fill();
    y -= lift * r * 0.9;
    // body
    var g = ctx.createLinearGradient(x - r, y, x + r, y);
    g.addColorStop(0, pal[2]);
    g.addColorStop(0.35, pal[1]);
    g.addColorStop(0.7, pal[0]);
    g.addColorStop(1, pal[2]);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x - base, y + r * 0.82);
    ctx.quadraticCurveTo(x - r * 0.85, y + r * 0.35, x - r * 0.28, y - r * 0.05);
    ctx.lineTo(x + r * 0.28, y - r * 0.05);
    ctx.quadraticCurveTo(x + r * 0.85, y + r * 0.35, x + base, y + r * 0.82);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, r * 0.09);
    ctx.strokeStyle = "rgba(255,255,255,.95)";
    ctx.stroke();
    // head
    var hr = r * 0.46, hy = y - r * 0.28;
    var hg = ctx.createRadialGradient(x - hr * 0.35, hy - hr * 0.4, hr * 0.1, x, hy, hr);
    hg.addColorStop(0, "#fff");
    hg.addColorStop(0.25, pal[1]);
    hg.addColorStop(1, pal[2]);
    ctx.beginPath();
    ctx.arc(x, hy, hr, 0, Math.PI * 2);
    ctx.fillStyle = hg;
    ctx.fill();
    ctx.stroke();
    if (bright) {
      ctx.beginPath();
      ctx.arc(x, hy, hr + 3, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,255,255,.9)";
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }

  var lastFrame = 0, lastStepSound = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    var s = current();
    if (!s || !s.state || document.hidden) return;
    var dt = Math.min(0.05, (now - lastFrame) / 1000 || 0.016);
    lastFrame = now;
    draw(s, dt, now);
    updateDie(s);
    // countdown bar
    var st = s.state, fill = $("timerfill");
    if (s.myTurn && st.turnDeadline && s.turnStart) {
      var total = Math.max(1, st.turnDeadline - s.turnStart), left = Math.max(0, st.turnDeadline - Date.now());
      fill.style.width = Math.min(100, (left / total) * 100) + "%";
    } else {
      fill.style.width = "0";
    }
  }

  function draw(s, dt, now) {
    var st = s.state;
    var pulse = 0.5 + 0.5 * Math.sin(now / 220);
    var turnSeat = st.phase === "roll" || st.phase === "move" ? st.currentSeat : -1;
    if (!b3d) drawBoardBase(turnSeat, pulse);
    if (st.phase === "lobby") {
      if (b3d) b3d.render({ time: now, pulse: pulse, turnSeat: -1, pieces: [], fx: [] });
      return;
    }

    // advance the hopping animation: pieces walk one square at a time towards their real position
    var pieces = [];
    var stepped = false;
    st.players.forEach(function (p) {
      p.pieces.forEach(function (target, idx) {
        var key = p.seat + ":" + idx;
        var a = s.anim[key];
        if (!a) a = s.anim[key] = { shown: target };
        if (target < 0 && a.shown >= 0 && !a.fly) {
          // captured: slide back to the yard in an arc, with a puff where it was taken
          var from = piecePos(p.seat, a.shown, idx);
          a.fly = { from: from, t: 0 };
          s.fx.push({ x: from[0], y: from[1], t: 0, col: PAL[p.seat][0] });
          a.shown = target;
        } else if (target >= 0 && a.shown < 0) {
          a.shown = target;                         // out of the yard: pop in
          a.pop = 0;
        } else if (target < 0 || target < a.shown) {
          a.shown = target;
        } else if (a.shown < target) {
          var before = Math.floor(a.shown);
          a.shown = Math.min(target, a.shown + dt * 10);   // about 10 squares per second
          if (Math.floor(a.shown) !== before) stepped = true;
        }
        if (a.fly) { a.fly.t += dt / 0.55; if (a.fly.t >= 1) a.fly = null; }
        if (a.pop !== undefined) { a.pop += dt / 0.3; if (a.pop >= 1) a.pop = undefined; }
        pieces.push({ seat: p.seat, idx: idx, target: target, shown: a.shown, moving: a.shown < target, fly: a.fly, pop: a.pop });
      });
    });
    if (stepped && now - lastStepSound > 70) { lastStepSound = now; sfx.step(); }

    // pieces on the same square are spread out in a small grid
    var spots = {};
    pieces.forEach(function (pc) {
      pc.pos = piecePos(pc.seat, pc.shown, pc.idx);
      if (pc.fly) {
        var e = 1 - Math.pow(1 - pc.fly.t, 3), home = pc.pos;
        pc.pos = [pc.fly.from[0] + (home[0] - pc.fly.from[0]) * e, pc.fly.from[1] + (home[1] - pc.fly.from[1]) * e];
        pc.flyLift = Math.sin(pc.fly.t * Math.PI) * 1.6;
      }
      var key = pc.shown < 0 ? "y" + pc.seat + pc.idx : pc.pos[0].toFixed(2) + "," + pc.pos[1].toFixed(2);
      (spots[key] = spots[key] || []).push(pc);
    });
    var drawList = [];
    Object.keys(spots).forEach(function (key) {
      var group = spots[key];
      group.forEach(function (pc, i) {
        var stacked = group.length > 1;
        var dx = stacked ? ((i % 2) - 0.5) * 0.48 : 0;
        var dy = stacked ? (Math.floor(i / 2) - (group.length > 2 ? 0.5 : 0)) * 0.42 : 0;
        pc.x = (pc.pos[0] + dx) * CELL;
        pc.y = (pc.pos[1] + dy) * CELL;
        pc.r = CELL * (stacked ? 0.3 : 0.42);
        drawList.push(pc);
      });
    });
    drawList.sort(function (a, b) { return a.y - b.y; });
    if (b3d) {
      var fxIn = [];
      s.fx.forEach(function (f) { f.t = Math.min(1, f.t + dt / 0.6); fxIn.push({ gx: f.x, gy: f.y, t: f.t, col: parseInt(f.col.slice(1), 16) }); });
      s.fx = s.fx.filter(function (f) { return f.t < 1; });
      b3d.render({
        time: now, pulse: pulse, turnSeat: turnSeat, fx: fxIn,
        pieces: drawList.map(function (pc) {
          var legal = s.myTurn && st.phase === "move" && pc.seat === s.mySeat && st.legalMoves.indexOf(pc.idx) >= 0;
          var frac = pc.moving ? pc.shown - Math.floor(pc.shown) : 0;
          var lift = pc.moving ? Math.sin(frac * Math.PI) : (legal ? pulse * 0.25 : 0);
          if (pc.flyLift) lift = pc.flyLift;
          var sc = (pc.r / (CELL * 0.42)) * (pc.pop !== undefined ? 1 + 0.35 * Math.sin(pc.pop * Math.PI) : 1);
          return { seat: pc.seat, idx: pc.idx, gx: pc.x / CELL, gy: pc.y / CELL, lift: lift, scale: sc, legal: legal,
                   yard: pc.shown < 0 && !pc.fly, home: pc.shown >= 56 };
        })
      });
      return;
    }
    drawList.forEach(function (pc) {
      var legal = s.myTurn && st.phase === "move" && pc.seat === s.mySeat && st.legalMoves.indexOf(pc.idx) >= 0;
      if (legal) {
        ctx.beginPath();
        ctx.arc(pc.x, pc.y + pc.r * 0.1, pc.r * (1.25 + pulse * 0.35), 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255," + (0.35 + pulse * 0.3) + ")";
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = "#ffcb2f";
        ctx.stroke();
      }
      var frac = pc.moving ? pc.shown - Math.floor(pc.shown) : 0;
      var lift = pc.moving ? Math.sin(frac * Math.PI) : (legal ? pulse * 0.25 : 0);
      if (pc.flyLift) lift = pc.flyLift;
      var rr = pc.pop !== undefined ? pc.r * (1 + 0.35 * Math.sin(pc.pop * Math.PI)) : pc.r;
      pawn(pc.x, pc.y, rr, pc.seat, lift, legal);
    });
    // capture puffs
    s.fx = s.fx.filter(function (f) { return f.t < 1; });
    s.fx.forEach(function (f) {
      f.t = Math.min(1, f.t + dt / 0.5);
      var u = f.t;
      ctx.beginPath();
      ctx.arc(f.x * CELL, f.y * CELL, CELL * (0.3 + u * 0.9), 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,255,255," + (0.9 * (1 - u)) + ")";
      ctx.lineWidth = 6 * (1 - u) + 1;
      ctx.stroke();
      for (var k = 0; k < 6; k++) {
        var ang = k * Math.PI / 3 + u, d = CELL * (0.2 + u * 0.9);
        ctx.beginPath();
        ctx.arc(f.x * CELL + Math.cos(ang) * d, f.y * CELL + Math.sin(ang) * d, Math.max(0, CELL * 0.1 * (1 - u)), 0, Math.PI * 2);
        ctx.fillStyle = f.col;
        ctx.fill();
      }
    });
  }

  pickTarget.addEventListener("click", function (e) {
    var s = current();
    if (!s || !s.state || !s.myTurn || s.state.phase !== "move") return;
    var gx, gy;
    if (b3d) {
      var g = b3d.pick(e.clientX, e.clientY);
      if (!g) return;
      gx = g[0]; gy = g[1];
    } else {
      var box = canvas.getBoundingClientRect();
      gx = ((e.clientX - box.left) / box.width) * 15;
      gy = ((e.clientY - box.top) / box.height) * 15;
    }
    var me = s.state.players.find(function (p) { return p.seat === s.mySeat; });
    var best = -1, bestD = 0.85;
    s.state.legalMoves.forEach(function (idx) {
      var pos = piecePos(me.seat, me.pieces[idx], idx);
      var d = Math.hypot(pos[0] - gx, pos[1] - gy);
      if (d < bestD) { bestD = d; best = idx; }
    });
    if (best >= 0) s.room.send("move", { piece: best });
  });

  // ---------- confetti ----------
  function confetti() {
    var c = $("confetti"), g = c.getContext("2d");
    c.width = window.innerWidth; c.height = window.innerHeight;
    var cols = ["#ffcb2f", "#e53935", "#2e9d4a", "#1e6fe0", "#fff", "#ff6bd6"];
    var bits = [];
    for (var i = 0; i < 140; i++) {
      bits.push({ x: Math.random() * c.width, y: -20 - Math.random() * c.height * 0.5, vx: (Math.random() - 0.5) * 3,
        vy: 2 + Math.random() * 4, s: 5 + Math.random() * 7, a: Math.random() * 6, va: (Math.random() - 0.5) * 0.4,
        col: cols[Math.floor(Math.random() * cols.length)] });
    }
    var t0 = performance.now();
    (function tick(now) {
      g.clearRect(0, 0, c.width, c.height);
      bits.forEach(function (b) {
        b.x += b.vx; b.y += b.vy; b.a += b.va;
        g.save(); g.translate(b.x, b.y); g.rotate(b.a);
        g.fillStyle = b.col; g.fillRect(-b.s / 2, -b.s / 4, b.s, b.s / 2); g.restore();
      });
      if (now - t0 < 4500) requestAnimationFrame(tick); else g.clearRect(0, 0, c.width, c.height);
    })(t0);
  }

  // ---------- install as an app ----------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () { navigator.serviceWorker.register("/sw.js").catch(function () {}); });
  }

  // Read-only handle used by the browser end-to-end test.
  window.__ludo = { sessions: sessions, piecePos: piecePos, userId: userId, is3d: !!b3d,
    screenPos: function (gx, gy) { return b3d ? b3d.project(gx, gy) : null; } };

  // keep countdowns and the player cards fresh; the board itself is drawn every frame
  setInterval(function () { var s = current(); if (s && s.state) renderGame(s); }, 250);
  refresh();
  requestAnimationFrame(frame);
})();
