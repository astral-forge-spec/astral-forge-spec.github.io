/* NashHack: a roguelike where every fight is a zero-sum matrix game and every
   other stage is a ballroom heat where you lead your partner around the floor.

   The full rules live on /nashhack/. The numbers in TUNING below are the ones
   that page quotes, so change both together.

   Mounted into <div id="nashhack">. In Node (no DOM) it exports its internals
   instead, which the balance simulations use. */
(function () {
    'use strict';

    /* --- Tuning ---------------------------------------------------------- */

    var MAX_HP = 20, POTION = 5;
    var MAX_COMP = 4;                 // partner's Composure
    var MAX_CONN = 5, START_CONN = 3; // Connection
    var WHISPER_CONN = 4;             // partner names a monster's habit at this Connection
    var ENRAGE_AT = [8, 16];          // fight rounds at which negative cells grow by 1
    var ACK_GROWTH = 4;               // The Ackermann's negative cells grow every 4 rounds
    var FLEE_BASE = 2;                // flee costs 2, then 3, then 4... HP on one floor
    var DAZE = 2;                     // turns a monster is dazed after you flee / it hits your partner
    var MISREAD_STEP = 0.10;          // misread chance = (5 - Connection) x 10% on unprepared turns
    var CLEAN_BARS = 8;               // clean bars in a row for +1 Connection
    var DROP_CHANCE = 0.25;            // potion drop on a kill

    var STAGES = [
        { type: 'dungeon', name: 'The Crypt', size: 2, mons: 4, pool: 'rgm', hpBonus: 0, cmax: 4 },
        { type: 'heat', name: 'Quarterfinal', dance: 'Waltz', bars: 48, cutoff: 80, couples: 'PPPNNN' },
        { type: 'dungeon', name: 'The Catacombs', size: 3, mons: 6, pool: 'rgmbpw', hpBonus: 1, cmax: 4 },
        { type: 'heat', name: 'Semifinal', dance: 'Quickstep', bars: 46, cutoff: 85, couples: 'PPNNNSSBB' },
        { type: 'dungeon', name: 'The Vault', size: 3, mons: 5, pool: 'gmbpwk', hpBonus: 2, cmax: 5, boss: true }
    ];

    var ROWS = ['Strike', 'Feint', 'Guard'];
    var COLS = ['Lunge', 'Block', 'Wait'];
    var VERBS = ['lunges', 'blocks', 'waits'];
    var DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    var KEYS = {
        ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
        h: [-1, 0], l: [1, 0], k: [0, -1], j: [0, 1],
        a: [-1, 0], d: [1, 0], w: [0, -1], s: [0, 1]
    };

    function rnd(n) { return Math.floor(Math.random() * n); }
    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
    function at(list, x, y) {
        for (var i = 0; i < list.length; i++) if (list[i].x === x && list[i].y === y) return list[i];
        return null;
    }
    function zeros(n) { var a = []; for (var i = 0; i < n; i++) a.push(0); return a; }
    function sample(probs) {
        var r = Math.random(), acc = 0;
        for (var i = 0; i < probs.length; i++) { acc += probs[i]; if (r < acc) return i; }
        return probs.length - 1;
    }

    /* --- Saved progress (codex of monster habits) ------------------------- */

    var store = {
        get: function (k, dflt) {
            try { var v = window.localStorage.getItem('nashhack.' + k); return v ? JSON.parse(v) : dflt; }
            catch (e) { return dflt; }
        },
        set: function (k, v) {
            try { window.localStorage.setItem('nashhack.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ }
        }
    };

    /* --- Game theory ----------------------------------------------------- */

    function gauss(A, b) {
        var n = b.length, i, j, k;
        A = A.map(function (r, i) { return r.concat([b[i]]); });
        for (i = 0; i < n; i++) {
            var piv = i;
            for (k = i + 1; k < n; k++) if (Math.abs(A[k][i]) > Math.abs(A[piv][i])) piv = k;
            if (Math.abs(A[piv][i]) < 1e-9) return null;
            var t = A[i]; A[i] = A[piv]; A[piv] = t;
            for (k = 0; k < n; k++) {
                if (k === i) continue;
                var f = A[k][i] / A[i][i];
                for (j = i; j <= n; j++) A[k][j] -= f * A[i][j];
            }
        }
        return A.map(function (r, i) { return r[n] / r[i]; });
    }

    function subsets(n, k) {
        var out = [];
        (function go(s, cur) {
            if (cur.length === k) { out.push(cur.slice()); return; }
            for (var i = s; i < n; i++) { cur.push(i); go(i + 1, cur); cur.pop(); }
        })(0, []);
        return out;
    }

    // Exact minimax for a small zero-sum game by support enumeration.
    // M[i][j] is the player's payoff (rows maximise, columns minimise).
    // Returns { p: row mix, q: column mix, v: value, saddle } or null.
    function solveExact(M) {
        var m = M.length, n = M[0].length, E = 1e-7;
        for (var k = 1; k <= Math.min(m, n); k++) {
            var RI = subsets(m, k), CJ = subsets(n, k);
            for (var a = 0; a < RI.length; a++) for (var c = 0; c < CJ.length; c++) {
                var I = RI[a], J = CJ[c], A = [], b = [];
                I.forEach(function (i) { A.push(J.map(function (j) { return M[i][j]; }).concat([-1])); b.push(0); });
                A.push(J.map(function () { return 1; }).concat([0])); b.push(1);
                var xq = gauss(A, b);
                if (!xq) continue;
                A = []; b = [];
                J.forEach(function (j) { A.push(I.map(function (i) { return M[i][j]; }).concat([-1])); b.push(0); });
                A.push(I.map(function () { return 1; }).concat([0])); b.push(1);
                var xp = gauss(A, b);
                if (!xp || Math.abs(xq[k] - xp[k]) > 1e-6) continue;
                var v = xq[k], q = zeros(n), p = zeros(m), ok = true, i, j, s;
                J.forEach(function (j, t) { q[j] = Math.max(0, xq[t]); if (xq[t] < -E) ok = false; });
                I.forEach(function (i, t) { p[i] = Math.max(0, xp[t]); if (xp[t] < -E) ok = false; });
                for (i = 0; i < m && ok; i++) { for (s = 0, j = 0; j < n; j++) s += M[i][j] * q[j]; if (s > v + 1e-6) ok = false; }
                for (j = 0; j < n && ok; j++) { for (s = 0, i = 0; i < m; i++) s += p[i] * M[i][j]; if (s < v - 1e-6) ok = false; }
                if (ok) return { p: p, q: q, v: v, saddle: k === 1 };
            }
        }
        return null;
    }

    // Fallback for degenerate matrices: fictitious play converges in zero-sum games.
    function solveApprox(M) {
        var m = M.length, n = M[0].length, rc = zeros(m), cc = zeros(n), T = 4000, i, j, t;
        var rowSum = zeros(m), colSum = zeros(n);
        for (t = 0; t < T; t++) {
            var bi = 0, bj = 0;
            for (i = 1; i < m; i++) if (rowSum[i] > rowSum[bi]) bi = i;
            for (j = 1; j < n; j++) if (colSum[j] < colSum[bj]) bj = j;
            rc[bi]++; cc[bj]++;
            for (i = 0; i < m; i++) rowSum[i] += M[i][bj];
            for (j = 0; j < n; j++) colSum[j] += M[bi][j];
        }
        var p = rc.map(function (x) { return x / T; }), q = cc.map(function (x) { return x / T; }), v = 0;
        for (i = 0; i < m; i++) for (j = 0; j < n; j++) v += p[i] * q[j] * M[i][j];
        return { p: p, q: q, v: v, saddle: false };
    }

    function solve(M) { return solveExact(M) || solveApprox(M); }

    /* --- Monsters -------------------------------------------------------- */

    // The matrix a monster is currently using: its negative cells grow as it enrages.
    function eff(m) {
        return m.M.map(function (r) { return r.map(function (v) { return v < 0 ? v - m.extra : v; }); });
    }

    function pickUniform(m) { return rnd(m.M[0].length); }
    function pickGreedy(m) {
        var M = eff(m), best = 0, bestV = Infinity;
        for (var j = 0; j < M[0].length; j++) {
            var lo = Math.min.apply(null, M.map(function (r) { return r[j]; }));
            if (lo < bestV) { bestV = lo; best = j; }
        }
        return best;
    }
    function pickMirror(m) { return m.hist.length ? m.hist[m.hist.length - 1][0] : rnd(m.M[0].length); }
    function pickBandit(m) { return rnd(m.M[0].length); }
    function pickFictitious(m) {
        var M = eff(m), n = M.length, c = [];
        for (var i = 0; i < n; i++) c.push(1);
        m.hist.forEach(function (h) { c[h[0]]++; });
        var best = [], bestV = Infinity;
        for (var j = 0; j < M[0].length; j++) {
            var e = 0;
            for (i = 0; i < n; i++) e += c[i] * M[i][j];
            if (e < bestV - 1e-9) { bestV = e; best = [j]; } else if (Math.abs(e - bestV) < 1e-9) best.push(j);
        }
        return best[rnd(best.length)];
    }
    function pickHedge(m) {
        var tot = m.w.reduce(function (a, b) { return a + b; }, 0);
        return sample(m.w.map(function (x) { return x / tot; }));
    }
    function pickNash(m) {
        if (!m.sol || m.solExtra !== m.extra) { m.sol = solve(eff(m)); m.solExtra = m.extra; }
        return sample(m.sol.q);
    }

    var KINDS = {
        r: { name: 'Uniform Rat', hp: 3, pick: pickUniform,
             hint: 'Picks a column uniformly at random.' },
        g: { name: 'Greedy Goblin', hp: 4, pick: pickGreedy,
             hint: 'Always plays the column that holds the single cell worst for you.' },
        m: { name: 'Mirror Mimic', hp: 4, pick: pickMirror,
             hint: 'Echoes you: plays the column in the same position as the row you picked last round.' },
        b: { name: 'Bluffing Bandit', hp: 5, pick: pickBandit,
             hint: 'Plays uniformly at random, then announces a move. Honest bandits announce the true move 80% of the time; liars only 20%.' },
        p: { name: 'Fictitious Phantom', hp: 5, pick: pickFictitious,
             hint: 'Best-responds to how often you have played each row in this fight.' },
        w: { name: 'Hedge Wraith', hp: 5, pick: pickHedge,
             hint: 'Multiplicative weights: columns that would have hurt you more get played more often. Exploitable early, close to minimax later.' },
        k: { name: 'Nash Knight', hp: 6, pick: pickNash, fair: true,
             hint: 'Plays its minimax mixed strategy. It cannot be exploited; only the right mix of rows beats it.' },
        A: { name: 'The Ackermann', hp: 12, pick: pickNash, fair: true,
             hint: 'Minimax, and every 4 rounds its negative cells grow by 1. End it quickly.' }
    };

    function cellVal(cmax) { var v = 1 + rnd(cmax); return Math.random() < 0.5 ? v : -v; }

    // Every column has a cell good for you and every row a cell bad for you, so
    // there is no safe row and no hopeless column. Exploitable monsters get a
    // game worth about zero or less at equilibrium: you must read them to win.
    // Fair ones get a mixed game tilted slightly your way, but only the
    // minimax mix collects that edge.
    function makeMatrix(kindKey, st) {
        var fair = KINDS[kindKey].fair, n = st.size, i, j;
        for (var t = 0; ; t++) {
            var M = [];
            for (i = 0; i < n; i++) { M.push([]); for (j = 0; j < n; j++) M[i].push(cellVal(st.cmax)); }
            var ok = true;
            for (j = 0; j < n && ok; j++) ok = M.some(function (r) { return r[j] > 0; });
            for (i = 0; i < n && ok; i++) ok = M[i].some(function (v) { return v < 0; });
            if (!ok) continue;
            var s = solveExact(M);
            if (!s) continue;
            if (t > 20000) return M;
            if (fair ? (!s.saddle && s.v >= 0.4 && s.v <= 1.0) : (s.v >= -0.6 && s.v <= 0.3)) return M;
        }
    }

    /* --- State ----------------------------------------------------------- */

    var S = { mode: 'title' };
    var codex = store.get('codex', {});

    function say(msg) { S.msg = msg; }
    function stage() { return STAGES[S.stage]; }

    function newGame() {
        S = { mode: 'map', stage: 0, hp: MAX_HP, comp: MAX_COMP, conn: START_CONN, kills: 0 };
        enterFloor();
        say('You and your partner enter the Crypt. Find the > to descend.');
    }

    function nextStage() {
        S.stage++;
        var st = stage();
        if (st.type === 'dungeon') {
            enterFloor();
            S.mode = 'map';
            say(st.boss ? 'The Vault. Something enormous is recursing nearby.' : 'You descend into ' + st.name + '.');
        } else {
            S.mode = 'heatIntro';
            say('');
        }
    }

    function lose(reason) { S.mode = 'dead'; S.reason = reason; }

    /* --- Dungeon --------------------------------------------------------- */

    var W = 41, H = 15;

    function bfs(map, sx, sy) {
        var dist = [], q = [[sx, sy]], x, y;
        for (y = 0; y < H; y++) { dist.push([]); for (x = 0; x < W; x++) dist[y].push(-1); }
        dist[sy][sx] = 0;
        while (q.length) {
            var c = q.shift();
            DIRS.forEach(function (d) {
                var nx = c[0] + d[0], ny = c[1] + d[1];
                if (map[ny][nx] === '.' && dist[ny][nx] < 0) { dist[ny][nx] = dist[c[1]][c[0]] + 1; q.push([nx, ny]); }
            });
        }
        return dist;
    }

    function enterFloor() {
        var st = stage(), map = [], cells = [], x, y, i;
        for (y = 0; y < H; y++) { map.push([]); for (x = 0; x < W; x++) map[y].push('#'); }

        // Drunkard's walk, favouring sideways steps because the map is wide.
        var want = Math.floor((W - 2) * (H - 2) * 0.4);
        x = W >> 1; y = H >> 1;
        while (cells.length < want) {
            if (map[y][x] === '#') { map[y][x] = '.'; cells.push([x, y]); }
            var d = DIRS[Math.random() < 0.6 ? rnd(2) : 2 + rnd(2)];
            x = clamp(x + d[0], 1, W - 2);
            y = clamp(y + d[1], 1, H - 2);
        }

        var start = cells[rnd(cells.length)];
        var dist = bfs(map, start[0], start[1]);
        var far = cells.reduce(function (a, c) { return dist[c[1]][c[0]] > dist[a[1]][a[0]] ? c : a; });
        var mons = [], items = [];

        // The partner starts on a floor tile next to you.
        var fx = start[0], fy = start[1];
        for (i = 0; i < 4; i++) {
            var tx = start[0] + DIRS[i][0], ty = start[1] + DIRS[i][1];
            if (map[ty][tx] === '.') { fx = tx; fy = ty; break; }
        }

        function freeCell() {
            for (var t = 0; ; t++) {
                var c = cells[rnd(cells.length)];
                if ((dist[c[1]][c[0]] >= 6 || t > 500) && c !== far && c !== start &&
                    !(c[0] === fx && c[1] === fy) && !at(mons, c[0], c[1]) && !at(items, c[0], c[1])) return c;
            }
        }
        function spawn(k, c) {
            var hp = KINDS[k].hp + (k === 'A' ? 0 : st.hpBonus);
            var mon = { k: k, x: c[0], y: c[1], hp: hp, max: hp, M: null, hist: [], stun: 0, extra: 0, rounds: 0 };
            if (k === 'w') mon.w = [1, 1, 1].slice(0, st.size);
            if (k === 'b') mon.honest = Math.random() < 0.5;
            mons.push(mon);
        }

        for (i = 0; i < st.mons; i++) spawn(st.pool[rnd(st.pool.length)], freeCell());
        if (st.boss) spawn('A', far);
        var c = freeCell();
        items.push({ x: c[0], y: c[1] });

        S.map = map;
        S.px = start[0]; S.py = start[1];
        S.fx = fx; S.fy = fy;
        S.stairs = st.boss ? null : far;
        S.mons = mons;
        S.items = items;
        S.flees = 0;
        S.seen = map.map(function (row) { return row.map(function () { return false; }); });
        reveal();
    }

    // Characters are taller than wide, so sight reaches further sideways.
    function visible(x, y) {
        var dx = x - S.px, dy = y - S.py;
        return dx * dx * 0.45 + dy * dy <= 25;
    }
    function reveal() {
        for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) if (visible(x, y)) S.seen[y][x] = true;
    }

    function move(dx, dy) {
        var nx = S.px + dx, ny = S.py + dy;
        if (S.map[ny][nx] === '#') return;
        var m = at(S.mons, nx, ny);
        if (m) { startFight(m); return; }

        // Your partner steps into the tile you leave (or you swap places).
        var ox = S.px, oy = S.py;
        S.px = nx; S.py = ny;
        S.fx = ox; S.fy = oy;
        say('');

        var it = at(S.items, nx, ny);
        if (it) {
            S.items.splice(S.items.indexOf(it), 1);
            S.hp = Math.min(MAX_HP, S.hp + POTION);
            say('You quaff a potion (+' + POTION + ' HP). It tastes like a fixed point.');
        }
        if (S.stairs && nx === S.stairs[0] && ny === S.stairs[1]) { nextStage(); return; }
        monstersAct();
        reveal();
    }

    function monstersAct() {
        for (var i = 0; i < S.mons.length; i++) {
            var m = S.mons[i];
            if (m.stun > 0) { m.stun--; continue; }
            var dx = S.px - m.x, dy = S.py - m.y, tries = [];
            if (Math.abs(dx) + Math.abs(dy) <= 7) {
                var sx = [Math.sign(dx), 0], sy = [0, Math.sign(dy)];
                tries = Math.abs(dx) >= Math.abs(dy) ? [sx, sy] : [sy, sx];
            } else if (Math.random() < 0.3) {
                tries = [DIRS[rnd(4)]];
            }
            for (var t = 0; t < tries.length; t++) {
                if (!tries[t][0] && !tries[t][1]) continue;
                var nx = m.x + tries[t][0], ny = m.y + tries[t][1];
                if (nx === S.px && ny === S.py) { startFight(m); return; }
                if (nx === S.fx && ny === S.fy) {
                    S.comp--;
                    m.stun = DAZE;
                    say(The(m.k) + ' lunges at your partner! Composure −1.');
                    if (S.comp <= 0) lose('Your partner had had enough of the dungeon and left. You cannot dance alone.');
                    break;
                }
                if (S.map[ny][nx] === '.' && !at(S.mons, nx, ny)) { m.x = nx; m.y = ny; break; }
            }
            if (S.mode !== 'map') return;
        }
    }

    /* --- Fights ---------------------------------------------------------- */

    function startFight(m) {
        if (!m.M) m.M = makeMatrix(m.k, stage());
        S.foe = m;
        S.mode = 'fight';
        S.last = null;
        prepRound(m);
        say(The(m.k) + ' engages you!');
    }

    // Monsters commit to their move before you choose (they never see your
    // current pick). The Bandit also decides what to announce.
    function prepRound(m) {
        m.next = KINDS[m.k].pick(m);
        if (m.k === 'b') {
            var n = m.M[0].length, truthful = Math.random() < (m.honest ? 0.8 : 0.2);
            if (truthful) m.ann = m.next;
            else { var o = rnd(n - 1); m.ann = o >= m.next ? o + 1 : o; }
        }
    }

    // "The Uniform Rat", but not "The The Ackermann".
    function The(k) { var n = KINDS[k].name; return n.indexOf('The ') === 0 ? n : 'The ' + n; }

    function knows(k) { return !!codex[k]; }
    function whispers() { return S.conn >= WHISPER_CONN; }

    function play(r) {
        var m = S.foe, kind = KINDS[m.k], M = eff(m);
        if (r >= M.length) return;
        var c = m.next, v = M[r][c];
        m.hist.push([r, c]);
        S.last = [r, c];

        if (m.k === 'w') {
            // The wraith learns from the payoffs every column would have given.
            var cmax = stage().cmax;
            for (var j = 0; j < m.w.length; j++) m.w[j] *= Math.exp(-0.7 * M[r][j] / cmax);
        }

        var msg = 'You ' + ROWS[r].toLowerCase() + ', it ' + VERBS[c] + '. ';
        if (v > 0) { m.hp -= v; msg += 'It takes ' + v + '.'; }
        else { S.hp += v; msg += 'You take ' + (-v) + '.'; }

        m.rounds++;
        if (m.k === 'A') {
            if (m.rounds % ACK_GROWTH === 0) { m.extra++; msg += ' The Ackermann grows.'; }
        } else if (ENRAGE_AT.indexOf(m.rounds) >= 0) {
            m.extra++; msg += ' ' + The(m.k) + ' is enraged.';
        }

        if (m.hp <= 0) {
            S.mons.splice(S.mons.indexOf(m), 1);
            S.kills++;
            if (!codex[m.k]) {
                codex[m.k] = true;
                store.set('codex', codex);
                msg += ' Codex entry unlocked.';
            }
            if (m.k === 'A') { S.mode = 'won'; say(msg); return; }
            S.mode = 'map';
            msg += ' ' + The(m.k) + ' is defeated.';
            if (Math.random() < DROP_CHANCE && !at(S.items, m.x, m.y)) { S.items.push({ x: m.x, y: m.y }); msg += ' It drops a potion.'; }
        } else if (S.hp <= 0) {
            lose(The(m.k) + ' got the better of you in ' + stage().name + '.');
        } else {
            prepRound(m);
        }
        say(msg);
    }

    function fleeCost() { return FLEE_BASE + S.flees; }

    function flee() {
        var cost = fleeCost();
        S.hp -= cost;
        S.flees++;
        S.foe.stun = DAZE;
        if (S.hp <= 0) { lose('You fled one time too many.'); return; }
        S.mode = 'map';
        say('You flee, taking ' + cost + ' damage. ' + The(S.foe.k) + ' is dazed for ' + DAZE + ' turns.');
    }

    /* --- Ballroom heats -------------------------------------------------- */

    // A ring of floor around a roped-off centre. Line of dance runs
    // counterclockwise: left along the top, down the left side, right along
    // the bottom, up the right side.
    var HW = 27, HH = 11, RX0 = 5, RX1 = 21, RY0 = 4, RY1 = 6, CX = 13, CY = 5;

    var COUPLES = {
        P: { name: 'Pros', note: 'one tile every bar; step aside when blocked' },
        N: { name: 'Newcomers', note: 'sometimes stop, sometimes drift sideways, even into you' },
        S: { name: 'Showboats', note: 'two tiles, then pose for a bar' },
        B: { name: 'Bulldozers', note: 'never step aside, and barge into you if you are in the way' }
    };

    function lod(x, y) {
        if (y < RY0) return x < RX0 ? [0, 1] : [-1, 0];
        if (y > RY1) return x > RX1 ? [0, -1] : [1, 0];
        if (x < RX0) return [0, 1];
        return [0, -1];
    }
    function isWall(x, y) { return x <= 0 || y <= 0 || x >= HW - 1 || y >= HH - 1; }
    function isRope(x, y) { return x >= RX0 && x <= RX1 && y >= RY0 && y <= RY1; }

    function tiles(c) { return [[c.x, c.y], [c.x + c.d[0], c.y + c.d[1]]]; }

    // What occupies (x, y), ignoring couple `self`: 'wall', 'rope', a couple, or null.
    function occupant(x, y, self) {
        if (isWall(x, y)) return 'wall';
        if (isRope(x, y)) return 'rope';
        var all = [S.me].concat(S.couples);
        for (var i = 0; i < all.length; i++) {
            if (all[i] === self) continue;
            var t = tiles(all[i]);
            if ((t[0][0] === x && t[0][1] === y) || (t[1][0] === x && t[1][1] === y)) return all[i];
        }
        return null;
    }

    function angle(x, y) { return Math.atan2(-(y - CY) / (HH / 2), (x - CX) / (HW / 2)); }

    function startHeat() {
        var st = stage();
        S.me = { x: CX + 4, y: 2, d: [-1, 0] };
        S.couples = [];
        S.bar = 0;
        S.fc = 20;
        S.lap = 0;
        S.ang = angle(S.me.x, S.me.y);
        S.prepared = true;
        S.muscle = false;
        S.clean = 0;
        S.partnerHits = 0;

        var track = [];
        for (var y = 1; y < HH - 1; y++) for (var x = 1; x < HW - 1; x++) if (!isRope(x, y)) track.push([x, y]);
        st.couples.split('').forEach(function (t) {
            for (var tries = 0; tries < 500; tries++) {
                var c = track[rnd(track.length)], d = lod(c[0], c[1]);
                var cand = { t: t, x: c[0], y: c[1], d: d, phase: rnd(2) };
                var far = Math.abs(c[0] - S.me.x) + Math.abs(c[1] - S.me.y) >= 5;
                var tt = tiles(cand);
                if (far && !occupant(tt[0][0], tt[0][1], cand) && !occupant(tt[1][0], tt[1][1], cand)) { S.couples.push(cand); break; }
            }
        });
        S.mode = 'heat';
        say('The ' + st.dance + ' begins. Lead your partner counterclockwise around the floor.');
    }

    function partnerHit(msg) {
        S.comp--;
        S.conn = Math.max(0, S.conn - 1);
        S.partnerHits++;
        S.clean = 0;
        if (S.comp <= 0) lose('Your partner walked off the floor mid-' + stage().dance + '.');
        return msg;
    }

    function whatName(o) {
        if (o === 'wall') return 'the wall';
        if (o === 'rope') return 'the rope';
        return 'a ' + COUPLES[o.t].name + ' couple';
    }

    // One bar. dir is [dx, dy] to lead a direction, or null to Hold.
    function bar(dir) {
        var me = S.me, msgs = [], clean = true, hitsBefore = S.partnerHits;

        if (!dir) {
            S.prepared = true;
            msgs.push('You hold for a bar. Your partner is ready for a turn.');
        } else {
            var straight = dir[0] === me.d[0] && dir[1] === me.d[1];
            var actual = dir;
            if (!straight) {
                if (S.muscle) {
                    S.muscle = false;
                    S.conn = Math.max(0, S.conn - 1);
                    clean = false;
                    msgs.push('You muscle the turn through. Connection −1.');
                } else if (!S.prepared && Math.random() < (MAX_CONN - S.conn) * MISREAD_STEP) {
                    actual = me.d;
                    clean = false;
                    msgs.push('Misread! Your partner kept going straight.');
                }
            }
            S.prepared = false;

            if (actual[0] === -me.d[0] && actual[1] === -me.d[1]) {
                // Reverse: the couple spins in place, swapping places.
                me.x += me.d[0]; me.y += me.d[1];
                me.d = [-me.d[0], -me.d[1]];
            } else {
                var nx = me.x + actual[0], ny = me.y + actual[1];
                var fx = nx + actual[0], fy = ny + actual[1];
                var hitF = occupant(fx, fy, me), hitL = occupant(nx, ny, me);
                if (hitF) {
                    clean = false;
                    S.fc -= 3;
                    msgs.push(partnerHit('Your partner backs into ' + whatName(hitF) + '! Floorcraft −3, Composure −1, Connection −1.'));
                } else if (hitL) {
                    clean = false;
                    S.fc -= 1;
                    msgs.push('You bump into ' + whatName(hitL) + '. Floorcraft −1.');
                } else {
                    me.x = nx; me.y = ny; me.d = actual;
                }
            }
            // Facing against the line of dance after any lead costs Floorcraft.
            var l = lod(me.x, me.y);
            if (me.d[0] * l[0] + me.d[1] * l[1] < 0) {
                S.fc -= 1;
                msgs.push('Against the line of dance. Floorcraft −1.');
            }
        }
        if (S.mode === 'dead') { say(msgs.join(' ')); return; }

        // Progress around the floor.
        var a = angle(me.x, me.y), da = a - S.ang;
        if (da > Math.PI) da -= 2 * Math.PI;
        if (da < -Math.PI) da += 2 * Math.PI;
        S.ang = a;
        S.lap += da / (2 * Math.PI);

        // The other couples.
        S.couples.forEach(function (c) {
            if (S.mode === 'dead') return;
            var steps = 1;
            if (c.t === 'N') {
                var r = Math.random();
                if (r < 0.25) return;
                if (r < 0.45) { drift(c, msgs); return; }
            }
            if (c.t === 'S') { c.phase = (c.phase + 1) % 2; if (c.phase === 0) return; steps = 2; }
            for (var s = 0; s < steps; s++) {
                var d = lod(c.x, c.y);
                var nx = c.x + d[0], ny = c.y + d[1], fx = nx + d[0], fy = ny + d[1];
                var o1 = occupant(nx, ny, c), o2 = occupant(fx, fy, c);
                if (!o1 && !o2) { c.x = nx; c.y = ny; c.d = d; continue; }
                if (c.t === 'B' && (o1 === me || o2 === me)) {
                    clean = false;
                    msgs.push(partnerHit('A Bulldozer couple barges into you. Composure −1, Connection −1.'));
                    break;
                }
                if (c.t === 'P' || c.t === 'S') sidestep(c);
                break;
            }
        });
        if (S.mode === 'dead') { say(msgs.join(' ')); return; }

        S.bar++;
        if (clean && S.partnerHits === hitsBefore) {
            S.clean++;
            if (S.clean >= CLEAN_BARS && S.conn < MAX_CONN) { S.conn++; S.clean = 0; msgs.push('Clean dancing. Connection +1.'); }
        } else {
            S.clean = 0;
        }

        if (S.lap >= 1 || S.bar >= stage().bars) endHeat(msgs);
        else say(msgs.join(' '));
    }

    // A newcomer's drift doesn't look where it goes: it can bump your couple.
    function drift(c, msgs) {
        var p = Math.random() < 0.5 ? [c.d[1], -c.d[0]] : [-c.d[1], c.d[0]];
        var t = tiles({ x: c.x + p[0], y: c.y + p[1], d: c.d });
        var o1 = occupant(t[0][0], t[0][1], c), o2 = occupant(t[1][0], t[1][1], c);
        if (o1 === S.me || o2 === S.me) {
            msgs.push(partnerHit('A Newcomer couple drifts into you. Composure −1, Connection −1.'));
            return false;
        }
        if (!o1 && !o2) { c.x += p[0]; c.y += p[1]; }
        return true;
    }

    function sidestep(c) {
        var p = [[c.d[1], -c.d[0]], [-c.d[1], c.d[0]]];
        if (Math.random() < 0.5) p.reverse();
        for (var i = 0; i < 2; i++) {
            var moved = { x: c.x + p[i][0], y: c.y + p[i][1], d: c.d };
            var t = tiles(moved);
            if (!occupant(t[0][0], t[0][1], c) && !occupant(t[1][0], t[1][1], c)) { c.x = moved.x; c.y = moved.y; return; }
        }
    }

    function heatScore() {
        var prog = Math.round(60 * clamp(S.lap, 0, 1));
        var fc = Math.max(0, S.fc);
        var conn = 4 * S.conn;
        return { prog: prog, fc: fc, conn: conn, total: prog + fc + conn };
    }

    function endHeat(msgs) {
        var st = stage(), sc = heatScore();
        S.score = sc;
        if (sc.total < st.cutoff) {
            lose('You were not recalled after the ' + st.name + ': ' + sc.total + ' points, cutoff ' + st.cutoff + '.');
            return;
        }
        S.bonus = S.partnerHits === 0;
        if (S.bonus) { S.comp = Math.min(MAX_COMP, S.comp + 1); S.hp = Math.min(MAX_HP, S.hp + 3); }
        S.mode = 'heatResult';
        say(msgs.join(' '));
    }

    /* --- Node export for simulations ------------------------------------- */

    if (typeof window === 'undefined') {
        module.exports = {
            solve: solve, makeMatrix: makeMatrix, KINDS: KINDS, STAGES: STAGES, eff: eff, prepRound: prepRound,
            state: function () { return S; }, setState: function (s) { S = s; },
            newGame: newGame, move: move, play: play, flee: flee, startHeat: startHeat, bar: bar,
            nextStage: nextStage, lod: lod, heatScore: heatScore, occupant: occupant, tiles: tiles,
            dims: { HW: HW, HH: HH, RX0: RX0, RX1: RX1, RY0: RY0, RY1: RY1 }
        };
        return;
    }

    /* --- Rendering ------------------------------------------------------- */

    var root = document.getElementById('nashhack');
    if (!root) return;

    function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
    function pips(n, max, on, off) { var s = ''; for (var i = 0; i < max; i++) s += i < n ? on : off; return s; }

    function statusHTML() {
        var st = stage();
        var h = '<div class="nh-status">';
        h += '<span>HP <b>' + Math.max(0, S.hp) + '/' + MAX_HP + '</b><span class="nh-bar"><span style="width:' +
            (100 * clamp(S.hp, 0, MAX_HP) / MAX_HP) + '%"></span></span></span>';
        h += '<span title="Your partner\'s Composure">Composure <b class="nh-heart">' + pips(S.comp, MAX_COMP, '♥', '♡') + '</b></span>';
        h += '<span title="Connection">Connection <b>' + pips(S.conn, MAX_CONN, '●', '○') + '</b></span>';
        h += '<span>' + (S.stage + 1) + '/' + STAGES.length + ' · <b>' + st.name + (st.dance ? ' (' + st.dance + ')' : '') + '</b></span>';
        return h + '</div>';
    }

    function dungeonCell(x, y) {
        if (x === S.px && y === S.py) return '<span class="nh-p">@</span>';
        if (x === S.fx && y === S.fy) return '<span class="nh-pt">f</span>';
        if (!S.seen[y][x]) return ' ';
        var vis = visible(x, y), m = vis && at(S.mons, x, y);
        if (m) return '<span class="nh-m nh-is-' + m.k + '">' + m.k + '</span>';
        if (at(S.items, x, y)) return '<span class="nh-i">!</span>';
        if (S.stairs && x === S.stairs[0] && y === S.stairs[1]) return '<span class="nh-s">&gt;</span>';
        var ch = S.map[y][x];
        return '<span class="' + (ch === '#' ? 'nh-w' : 'nh-f') + (vis ? '' : ' nh-dim') + '">' + ch + '</span>';
    }

    function pad(extra) {
        return '<div class="nh-pad">' +
            '<button type="button" data-act="dir" data-dx="0" data-dy="-1" aria-label="Up">↑</button>' +
            '<button type="button" data-act="dir" data-dx="-1" data-dy="0" aria-label="Left">←</button>' +
            '<button type="button" data-act="dir" data-dx="0" data-dy="1" aria-label="Down">↓</button>' +
            '<button type="button" data-act="dir" data-dx="1" data-dy="0" aria-label="Right">→</button>' +
            (extra || '') + '</div>';
    }

    function mapHTML() {
        var rows = [];
        for (var y = 0; y < H; y++) {
            var row = '';
            for (var x = 0; x < W; x++) row += dungeonCell(x, y);
            rows.push(row);
        }
        return '<pre class="nh-map" aria-label="Dungeon map">' + rows.join('\n') + '</pre>' +
            '<div class="nh-help"><span class="nh-p">@</span> you · <span class="nh-pt">f</span> your partner · ' +
            '<span class="nh-s">&gt;</span> stairs · <span class="nh-i">!</span> potion · letters are monsters. ' +
            'Move with arrows or WASD; walk into a monster to fight. Keep monsters off your partner.</div>' + pad();
    }

    function fightHTML() {
        var m = S.foe, kind = KINDS[m.k], M = eff(m), n = M.length, h = '';
        h += '<div class="nh-foe"><span class="nh-m nh-is-' + m.k + '">' + m.k + '</span> <b>' + kind.name +
            '</b> · HP ' + Math.max(0, m.hp) + '/' + m.max + (m.extra ? ' · <span class="nh-neg-t">damage +' + m.extra + '</span>' : '') + '</div>';
        if (knows(m.k)) h += '<div class="nh-hint">Codex: ' + kind.hint + '</div>';
        else if (whispers()) h += '<div class="nh-hint">Your partner whispers: “' + kind.hint + '”</div>';
        else h += '<div class="nh-hint">You don’t know its habits yet. Watch the history.</div>';
        if (m.k === 'b') h += '<div class="nh-announce">It announces: “I will ' + COLS[m.ann].toLowerCase() + ".”</div>";

        h += '<table class="nh-matrix"><tr><th></th>';
        for (var c = 0; c < n; c++) h += '<th>' + COLS[c] + '</th>';
        h += '</tr>';
        for (var r = 0; r < n; r++) {
            h += '<tr><th><button type="button" data-act="row" data-r="' + r + '">' + (r + 1) + ' · ' + ROWS[r] + '</button></th>';
            for (c = 0; c < n; c++) {
                var v = M[r][c];
                var cls = (v > 0 ? 'nh-pos' : 'nh-neg') + (S.last && S.last[0] === r && S.last[1] === c ? ' nh-last' : '');
                h += '<td class="' + cls + '">' + (v > 0 ? '+' + v : '−' + (-v)) + '</td>';
            }
            h += '</tr>';
        }
        h += '</table>';
        h += '<div class="nh-help">Press ' + (n === 2 ? '1 or 2' : '1, 2 or 3') + ' to pick a row; it has already picked a column. ' +
            '+n: it loses n HP · −n: you lose n HP.' +
            (m.k === 'A' ? ' Its damage grows every ' + ACK_GROWTH + ' rounds.' : ' It enrages at rounds ' + ENRAGE_AT.join(' and ') + '.') + '</div>';
        if (m.hist.length) {
            h += '<div class="nh-help">History (round ' + m.rounds + '): ' + m.hist.slice(-12).map(function (p) {
                return ROWS[p[0]][0] + '/' + COLS[p[1]][0];
            }).join(' ') + '</div>';
        }
        h += '<div class="nh-pad"><button type="button" data-act="flee">F · Flee (−' + fleeCost() + ' HP)</button></div>';
        return h;
    }

    function heatCell(x, y) {
        var me = S.me, t = tiles(me);
        if (x === t[0][0] && y === t[0][1]) return '<span class="nh-p">@</span>';
        if (x === t[1][0] && y === t[1][1]) return '<span class="nh-pt">f</span>';
        for (var i = 0; i < S.couples.length; i++) {
            var c = S.couples[i], ct = tiles(c);
            if (x === ct[0][0] && y === ct[0][1]) return '<span class="nh-c nh-c-' + c.t + '">' + c.t + '</span>';
            if (x === ct[1][0] && y === ct[1][1]) return '<span class="nh-c nh-c-' + c.t + '">' + c.t.toLowerCase() + '</span>';
        }
        if (isWall(x, y)) return '<span class="nh-w">#</span>';
        if (isRope(x, y)) {
            var ch = ' ';
            if ((x === RX0 || x === RX1) && (y === RY0 || y === RY1)) ch = '+';
            else if (y === RY0) ch = '&lt;';
            else if (y === RY1) ch = '&gt;';
            else if (x === RX0) ch = 'v';
            else if (x === RX1) ch = '^';
            return '<span class="nh-rope">' + ch + '</span>';
        }
        return '<span class="nh-f">.</span>';
    }

    function heatHTML() {
        var st = stage(), sc = heatScore(), rows = [];
        for (var y = 0; y < HH; y++) {
            var row = '';
            for (var x = 0; x < HW; x++) row += heatCell(x, y);
            rows.push(row);
        }
        var h = '<div class="nh-status">' +
            '<span>Bar <b>' + S.bar + '/' + st.bars + '</b></span>' +
            '<span>Lap <b>' + Math.round(100 * clamp(S.lap, 0, 1)) + '%</b></span>' +
            '<span>Floorcraft <b>' + Math.max(0, S.fc) + '</b></span>' +
            '<span>Score <b>' + sc.total + '</b> / cutoff ' + st.cutoff + '</span>' +
            '<span>' + (S.prepared ? '<b>Prepared</b>' : 'Not prepared') + '</span>' +
            (S.muscle ? '<span><b class="nh-neg-t">Muscle armed</b></span>' : '') + '</div>';
        h += '<pre class="nh-map" aria-label="Dance floor">' + rows.join('\n') + '</pre>';
        h += '<div class="nh-help"><span class="nh-p">@</span><span class="nh-pt">f</span> you and your partner (they’re in front, backing up blind) · ' +
            'arrows on the rope show the line of dance · ' +
            Object.keys(COUPLES).filter(function (k) { return st.couples.indexOf(k) >= 0; }).map(function (k) {
                return '<span class="nh-c nh-c-' + k + '">' + k + k.toLowerCase() + '</span> ' + COUPLES[k].name.toLowerCase();
            }).join(' · ') + '</div>';
        h += pad('<button type="button" data-act="hold">Space · Hold</button>' +
            '<button type="button" data-act="muscle"' + (S.muscle ? ' class="nh-on"' : '') + '>M · Muscle</button>');
        return h;
    }

    function cardHTML(title, body, label) {
        return '<div class="nh-card"><div class="nh-big">' + title + '</div>' + body +
            '<button type="button" data-act="next">' + label + '</button>' +
            '<div class="nh-help">or press Enter · <a href="/nashhack/">full rules</a></div></div>';
    }

    function heatIntroHTML() {
        var st = stage();
        var couples = Object.keys(COUPLES).filter(function (k) { return st.couples.indexOf(k) >= 0; }).map(function (k) {
            return '<li><span class="nh-c nh-c-' + k + '">' + k + k.toLowerCase() + '</span> ' + COUPLES[k].name + ': ' + COUPLES[k].note + '</li>';
        }).join('');
        return cardHTML(st.name + ' · ' + st.dance,
            '<p>Lead your partner one lap counterclockwise in ' + st.bars + ' bars. Score ' + st.cutoff + ' or more to be recalled.</p>' +
            '<ul class="nh-list">' +
            '<li>Arrows / WASD lead a direction. Your partner is in front of you, backing up, and can’t see.</li>' +
            '<li>Turning without preparation can be misread (' + Math.round((MAX_CONN - S.conn) * MISREAD_STEP * 100) + '% at your Connection). ' +
            '<b>Hold</b> (Space) prepares the next turn. <b>Muscle</b> (M) forces it, at −1 Connection.</li>' +
            '<li>Your partner backing into anything: Floorcraft −3, Composure −1, Connection −1.</li>' +
            '<li>Score = 60 × lap + Floorcraft (from 20) + 4 × Connection.</li>' +
            couples + '</ul>', 'Start the ' + st.dance);
    }

    function render() {
        var hadFocus = root.contains(document.activeElement);
        var h = '';
        if (S.mode === 'title') {
            var n = Object.keys(codex).length;
            h += cardHTML('NashHack', '<p>Three dungeons, two dance heats, one partner to lead and protect. Payoff matrices instead of dice.</p>' +
                (n ? '<p class="nh-small">Codex: ' + n + '/' + Object.keys(KINDS).length + ' monster habits learned.</p>' : ''), 'Start');
        } else if (S.mode === 'dead') {
            h += cardHTML('You diverged', '<p>' + esc(S.reason) + '</p><p class="nh-small">Reached stage ' + (S.stage + 1) + '/' + STAGES.length +
                ' · ' + S.kills + ' kills. Monster habits you learned stay in your codex.</p>', 'Try again');
        } else if (S.mode === 'won') {
            h += cardHTML('Halted', '<p>The Ackermann has been reduced to a base case. You and your partner win with ' + S.hp +
                ' HP and ' + S.kills + ' kills.</p>', 'Play again');
        } else if (S.mode === 'heatIntro') {
            h += statusHTML() + heatIntroHTML();
        } else if (S.mode === 'heatResult') {
            var sc = S.score;
            h += statusHTML() + cardHTML('Recalled!',
                '<p>Progress ' + sc.prog + ' + Floorcraft ' + sc.fc + ' + Connection ' + sc.conn + ' = <b>' + sc.total + '</b> (cutoff ' + stage().cutoff + ').</p>' +
                (S.bonus ? '<p>No partner collisions: Composure +1, HP +3.</p>' : ''), 'Continue');
        } else {
            h += statusHTML();
            if (S.mode === 'map') h += mapHTML();
            else if (S.mode === 'fight') h += fightHTML();
            else if (S.mode === 'heat') h += heatHTML();
            h += '<div class="nh-log" aria-live="polite">' + (S.msg ? esc(S.msg) : '&nbsp;') + '</div>';
        }
        root.innerHTML = h;
        // Re-rendering removes the focused button; keep keyboard focus in the game.
        if (hadFocus && !root.contains(document.activeElement)) root.focus({ preventScroll: true });
    }

    function advance() {
        if (S.mode === 'title' || S.mode === 'dead' || S.mode === 'won') newGame();
        else if (S.mode === 'heatIntro') startHeat();
        else if (S.mode === 'heatResult') nextStage();
    }

    function direction(dx, dy) {
        if (S.mode === 'map') move(dx, dy);
        else if (S.mode === 'heat') bar([dx, dy]);
    }

    root.addEventListener('click', function (e) {
        var b = e.target.closest('button[data-act]');
        if (!b) return;
        var act = b.getAttribute('data-act');
        if (act === 'next') advance();
        else if (act === 'dir') direction(+b.getAttribute('data-dx'), +b.getAttribute('data-dy'));
        else if (act === 'row' && S.mode === 'fight') play(+b.getAttribute('data-r'));
        else if (act === 'flee' && S.mode === 'fight') flee();
        else if (act === 'hold' && S.mode === 'heat') bar(null);
        else if (act === 'muscle' && S.mode === 'heat') S.muscle = !S.muscle;
        render();
    });

    root.addEventListener('keydown', function (e) {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        var k = e.key.length === 1 ? e.key.toLowerCase() : e.key, handled = true;
        var playing = S.mode === 'map' || S.mode === 'fight' || S.mode === 'heat';
        if ((S.mode === 'map' || S.mode === 'heat') && KEYS[k]) direction(KEYS[k][0], KEYS[k][1]);
        else if (S.mode === 'fight' && (k === '1' || k === '2' || k === '3')) play(+k - 1);
        else if (S.mode === 'fight' && k === 'f') flee();
        else if (S.mode === 'heat' && (k === ' ' || k === '.')) bar(null);
        else if (S.mode === 'heat' && k === 'm') S.muscle = !S.muscle;
        else if (!playing && (k === 'Enter' || k === ' ')) advance();
        else handled = false;
        if (handled) { e.preventDefault(); render(); }
    });

    render();
})();
