(() => {
    const ranks = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
    const suits = [
        { id: 'D', symbol: '♦', red: true },
        { id: 'C', symbol: '♣', red: false },
        { id: 'H', symbol: '♥', red: true },
        { id: 'S', symbol: '♠', red: false }
    ];
    const state = {
        mode: '',
        room: null,
        listener: null,
        privateListener: null,
        hand: [],
        uid: '',
        name: '',
        selected: new Set(),
        cpuTimer: null
    };

    function element(id) {
        return document.getElementById(`daifugo-${id}`);
    }

    function getDatabase() {
        if (!window.firebase?.apps?.length) {
            throw new Error('Firebaseを読み込めません。ページを再読み込みしてください。');
        }
        return window.firebase.database();
    }

    async function getUser() {
        if (typeof window.getOnlineFirebaseUser !== 'function') {
            throw new Error('オンライン認証を初期化できません。ページを再読み込みしてください。');
        }
        return window.getOnlineFirebaseUser();
    }

    function playerName() {
        const input = element('player-name');
        const name = input.value.trim() || `プレイヤー${Math.floor(Math.random() * 9000) + 1000}`;
        input.value = name;
        input.maxLength = 16;
        localStorage.setItem('daifugo-player-name', name);
        return name;
    }

    function setMessage(message) {
        element('message').textContent = message;
    }

    function setBusy(busy) {
        ['create-room', 'join-room', 'cpu-start'].forEach(id => {
            element(id).disabled = busy;
        });
    }

    function makeDeck() {
        return suits.flatMap((suit, suitIndex) => ranks.map((rank, rankIndex) => ({
            id: `${rankIndex}-${suitIndex}`,
            rank: rankIndex,
            suit: suitIndex
        })));
    }

    function shuffle(cards) {
        for (let i = cards.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [cards[i], cards[j]] = [cards[j], cards[i]];
        }
        return cards;
    }

    function cardById(id) {
        const [rank, suit] = String(id).split('-').map(Number);
        if (!Number.isInteger(rank) || !Number.isInteger(suit) || !ranks[rank] || !suits[suit]) return null;
        return { id, rank, suit };
    }

    function compareCards(a, b) {
        return a.rank - b.rank || a.suit - b.suit;
    }

    function cardLabel(card) {
        return `${ranks[card.rank]}${suits[card.suit].symbol}`;
    }

    function combination(cards) {
        if (!Array.isArray(cards) || cards.length < 1 || cards.length > 4) return null;
        const parsed = cards.map(card => typeof card === 'string' ? cardById(card) : card);
        if (parsed.some(card => !card)) return null;
        if (!parsed.every(card => card.rank === parsed[0].rank)) return null;
        return {
            count: parsed.length,
            rank: parsed[0].rank,
            suit: Math.max(...parsed.map(card => card.suit))
        };
    }

    function beats(next, previous, revolution) {
        if (!previous || next.count !== previous.count) return false;
        if (next.rank !== previous.rank) return revolution
            ? next.rank < previous.rank
            : next.rank > previous.rank;
        return next.suit > previous.suit;
    }

    function activePlayers(room) {
        return (room.playerOrder || []).filter(uid =>
            room.players?.[uid] && room.players[uid].rank == null && room.players[uid].connected !== false);
    }

    function nextActive(room, afterUid, canRespond = false) {
        const order = room.playerOrder || [];
        const start = Math.max(0, order.indexOf(afterUid));
        for (let offset = 1; offset <= order.length; offset++) {
            const uid = order[(start + offset) % order.length];
            const player = room.players?.[uid];
            if (!player || player.rank != null || player.connected === false) continue;
            if (canRespond && room.game.passed.includes(uid)) continue;
            return uid;
        }
        return '';
    }

    function clearTrick(room, leadUid) {
        room.game.table = [];
        room.game.tableCount = 0;
        room.game.tableRank = null;
        room.game.passed = [];
        room.game.lastPlayUid = null;
        room.game.turnUid = leadUid || activePlayers(room)[0] || '';
        room.game.message = '場が流れました。次のプレイヤーから出せます。';
    }

    function finishIfDone(room) {
        const game = room.game;
        const active = activePlayers(room);
        if (active.length > 1) return false;
        if (active.length === 1 && room.players[active[0]].rank == null) {
            room.players[active[0]].rank = 4;
            game.winnerOrder.push(active[0]);
        }
        room.status = 'finished';
        game.turnUid = '';
        game.message = `ゲーム終了。順位: ${game.winnerOrder.map((uid, index) =>
            `${index + 1}位 ${room.players[uid].name}`).join('、')}`;
        return true;
    }

    function advanceAfterAction(room, actorUid) {
        const game = room.game;
        if (finishIfDone(room)) return;
        const active = activePlayers(room);
        const leadUid = game.lastPlayUid;
        if (leadUid && active.every(uid => uid === leadUid || game.passed.includes(uid))) {
            clearTrick(room, room.players[leadUid]?.rank == null
                ? leadUid : nextActive(room, leadUid));
            return;
        }
        const nextUid = nextActive(room, actorUid, Boolean(leadUid));
        if (nextUid) {
            game.turnUid = nextUid;
            return;
        }
        if (leadUid) {
            clearTrick(room, room.players[leadUid]?.rank == null
                ? leadUid : nextActive(room, leadUid));
        }
    }

    function applyAction(source, uid, action) {
        const room = JSON.parse(JSON.stringify(source));
        const game = room.game;
        const player = room.players?.[uid];
        if (room.status !== 'playing' || game?.turnUid !== uid || !player || player.rank != null) {
            throw new Error('あなたの番ではありません。');
        }
        if (action.type === 'pass') {
            if (!game.tableCount) throw new Error('場にカードがないときはパスできません。');
            if (!game.passed.includes(uid)) game.passed.push(uid);
            player.lastAction = 'パス';
            advanceAfterAction(room, uid);
            return room;
        }
        if (action.type !== 'play') throw new Error('操作を確認できません。');
        const ids = [...new Set(action.cards || [])];
        const currentHand = Array.isArray(player.hand) ? player.hand : action.hand;
        const hand = new Set(currentHand || []);
        if (!ids.length || ids.some(id => !hand.has(id))) throw new Error('選択したカードが手札にありません。');
        const played = ids.map(cardById).filter(Boolean);
        const nextCombo = combination(played);
        if (!nextCombo) throw new Error('同じ数字のカードを1〜4枚選んでください。');
        if (game.tableCount && !beats(nextCombo, game.tableRank, game.revolution)) {
            throw new Error('場のカードと同じ枚数で、より強いカードを出してください。');
        }
        if (game.firstPlay && !ids.includes('0-0')) {
            throw new Error('最初の手番は3♦を含めて出してください。');
        }
        game.firstPlay = false;
        if (Array.isArray(player.hand)) {
            player.hand = player.hand.filter(id => !ids.includes(id));
            player.handCount = player.hand.length;
        } else {
            player.handCount = Math.max(0, (player.handCount || 0) - ids.length);
        }
        player.lastAction = `${ids.map(id => cardLabel(cardById(id))).join(' ')} を出した`;
        game.table = ids;
        game.tableCount = ids.length;
        game.tableRank = nextCombo;
        game.lastPlayUid = uid;
        game.passed = game.passed.filter(passedUid => passedUid !== uid);
        game.message = `${player.name} が ${player.lastAction}`;
        if (ids.length === 4) {
            game.revolution = !game.revolution;
            game.message += `（革命${game.revolution ? '！' : '解除'}）`;
        }
        const remainingCards = Array.isArray(player.hand) ? player.hand.length : player.handCount;
        if (remainingCards === 0) {
            player.rank = game.winnerOrder.length + 1;
            game.winnerOrder.push(uid);
            game.message += `。${player.rank}位で上がり！`;
        }
        advanceAfterAction(room, uid);
        return room;
    }

    function makeStartedRoom(room, deck) {
        const next = JSON.parse(JSON.stringify(room));
        const players = next.playerOrder.map(uid => next.players[uid]);
        if (next.status !== 'waiting' || players.length !== 4
            || players.some(player => player.connected === false)) {
            throw new Error('接続中のプレイヤーが4人そろってから開始してください。');
        }
        players.forEach(player => {
            player.hand = [];
            player.rank = null;
            player.lastAction = '';
        });
        deck.forEach((card, index) => players[index % players.length].hand.push(card.id));
        players.forEach(player => player.hand.sort((a, b) => compareCards(cardById(a), cardById(b))));
        const firstPlayer = players.find(player => player.hand.includes('0-0'));
        next.status = 'playing';
        next.game = {
            turnUid: firstPlayer.uid,
            table: [],
            tableCount: 0,
            tableRank: null,
            lastPlayUid: null,
            passed: [],
            revolution: false,
            firstPlay: true,
            winnerOrder: [],
            message: '3♦を持つプレイヤーから開始します。'
        };
        return next;
    }

    function render(room, uid, code) {
        element('lobby').hidden = true;
        element('room').hidden = false;
        element('room-code-display').textContent = code ? `部屋コード: ${code}` : 'CPU戦';
        const playersList = element('players');
        playersList.replaceChildren();
        (room.playerOrder || []).forEach((playerUid, index) => {
            const player = room.players[playerUid];
            if (!player) return;
            const item = document.createElement('li');
            item.className = 'daifugo-player';
            if (room.game?.turnUid === playerUid) item.classList.add('current');
            const rank = player.rank ? ` · ${player.rank}位` : '';
            const count = room.status === 'playing'
                ? ` · 手札 ${player.handCount ?? player.hand?.length ?? 0}枚` : '';
            const connection = player.connected === false ? ' · 切断中' : '';
            item.textContent = `${index + 1}. ${player.name}${playerUid === uid ? '（あなた）' : ''}${rank}${count}${connection}`;
            playersList.append(item);
        });
        const startButton = element('start-game');
        startButton.hidden = !code || room.hostUid !== uid || room.status !== 'waiting';
        startButton.disabled = (room.playerOrder || []).length !== 4
            || (room.playerOrder || []).some(playerUid => room.players[playerUid]?.connected === false);
        const game = room.game;
        const table = element('table-cards');
        table.replaceChildren();
        (game?.table || []).map(cardById).filter(Boolean).forEach(card =>
            table.append(createCardElement(card, true)));
        const byPlayer = room.players?.[uid];
        const hand = element('own-hand');
        hand.replaceChildren();
        const visibleHand = state.mode === 'online' ? state.hand : byPlayer?.hand || [];
        visibleHand.map(cardById).filter(Boolean).forEach(card => {
            const button = document.createElement('button');
            button.className = 'daifugo-card';
            if (suits[card.suit].red) button.classList.add('red');
            button.textContent = cardLabel(card);
            button.disabled = room.status !== 'playing' || game.turnUid !== uid;
            if (state.selected.has(card.id)) button.classList.add('selected');
            button.setAttribute('aria-pressed', String(state.selected.has(card.id)));
            button.addEventListener('click', () => {
                if (state.selected.has(card.id)) state.selected.delete(card.id);
                else state.selected.add(card.id);
                render(room, uid, code);
            });
            hand.append(button);
        });
        const isMyTurn = room.status === 'playing' && game.turnUid === uid;
        element('play').disabled = !isMyTurn || state.selected.size === 0;
        element('pass').disabled = !isMyTurn || !game.tableCount;
        element('trick-info').textContent = game
            ? `場: ${game.tableCount ? `${game.tableCount}枚出し` : 'なし'} · 革命: ${game.revolution ? 'ON' : 'OFF'}`
            : 'ホストが4人そろったらゲームを開始します。';
        element('status').textContent = game?.message || '4人で開始を待っています。';
        element('message').textContent = room.status === 'finished' ? game.message : '';
    }

    function createCardElement(card, faceUp) {
        const cardElement = document.createElement('span');
        cardElement.className = 'daifugo-card';
        if (suits[card.suit].red) cardElement.classList.add('red');
        cardElement.textContent = faceUp ? cardLabel(card) : '🂠';
        return cardElement;
    }

    function renderCurrent() {
        if (state.mode === 'cpu' && state.room) {
            render(state.room, 'human', '');
        } else if (state.room?.public) {
            render(state.room.public, state.uid, state.room.code);
        }
    }

    function beginScreen() {
        document.getElementById('start-screen').hidden = true;
        document.getElementById('poker-screen').hidden = true;
        document.getElementById('blackjack-screen').hidden = true;
        document.getElementById('daifugo-screen').hidden = false;
        window.setGameContentInert?.(false);
        element('player-name').value = localStorage.getItem('daifugo-player-name') || '';
    }

    function startDaifugo() {
        beginScreen();
        element('lobby').hidden = false;
        element('room').hidden = true;
        setMessage('');
    }

    function startDaifugoCpuGame() {
        state.mode = 'cpu';
        state.uid = 'human';
        state.name = playerName();
        state.selected.clear();
        const players = {
            human: { uid: 'human', name: state.name, connected: true, isCpu: false, hand: [], rank: null },
            cpu1: { uid: 'cpu1', name: 'CPU 1', connected: true, isCpu: true, hand: [], rank: null },
            cpu2: { uid: 'cpu2', name: 'CPU 2', connected: true, isCpu: true, hand: [], rank: null },
            cpu3: { uid: 'cpu3', name: 'CPU 3', connected: true, isCpu: true, hand: [], rank: null }
        };
        const room = makeStartedRoom({
            status: 'waiting',
            hostUid: 'human',
            players,
            playerOrder: ['human', 'cpu1', 'cpu2', 'cpu3'],
            game: null
        }, shuffle(makeDeck()));
        room.isHost = false;
        state.room = room;
        state.mode = 'cpu';
        state.hand = [];
        renderCurrent();
        runCpuTurn();
    }

    function runCpuTurn() {
        clearTimeout(state.cpuTimer);
        if (state.mode !== 'cpu' || state.room?.status !== 'playing') return;
        let room = state.room;
        const uid = room.game.turnUid;
        if (!room.players[uid]?.isCpu) return;
        state.cpuTimer = setTimeout(() => {
            try {
                const cpuHand = room.players[uid].hand.map(cardById).filter(Boolean);
                const count = room.game.tableCount || 1;
                const grouped = new Map();
                cpuHand.forEach(card => {
                    if (!grouped.has(card.rank)) grouped.set(card.rank, []);
                    grouped.get(card.rank).push(card);
                });
                const options = [...grouped.values()]
                    .filter(group => group.length >= count)
                    .map(group => group.slice(0, count))
                    .filter(cards => {
                        const combo = combination(cards);
                        return combo && (!room.game.tableCount || beats(combo, room.game.tableRank, room.game.revolution))
                            && (room.game.tableCount || room.game.winnerOrder.length
                                || cards.some(card => card.id === '0-0'));
                    })
                    .sort((a, b) => compareCards(a[0], b[0]));
                if (options.length) {
                    room = applyAction(room, uid, { type: 'play', cards: options[0].map(card => card.id) });
                } else if (room.game.tableCount) {
                    room = applyAction(room, uid, { type: 'pass' });
                } else {
                    const lowestCard = cpuHand[0];
                    room = applyAction(room, uid, { type: 'play', cards: [lowestCard.id] });
                }
                state.room = room;
                state.selected.clear();
                renderCurrent();
                runCpuTurn();
            } catch (error) {
                setMessage(error.message);
            }
        }, 650);
    }

    async function createDaifugoRoom() {
        setBusy(true);
        try {
            const user = await getUser();
            const name = playerName();
            const database = getDatabase();
            let code = '';
            let roomRef;
            let publicRef;
            let created = false;
            for (let attempt = 0; attempt < 5 && !created; attempt++) {
                code = String(Math.floor(100000 + Math.random() * 900000));
                roomRef = database.ref(`daifugoRooms/${code}`);
                const roomData = {
                    status: 'waiting',
                    hostUid: user.uid,
                    hostName: name,
                    players: {
                        [user.uid]: { uid: user.uid, name, connected: true, handCount: 0, rank: null }
                    },
                    playerOrder: [user.uid],
                    game: null
                };
                publicRef = roomRef.child('public');
                const result = await publicRef.transaction(
                    current => current === null ? roomData : undefined, undefined, false
                );
                created = result.committed;
                if (created) {
                    await roomRef.child(`private/${user.uid}/hand`).set([]);
                }
            }
            if (!created) throw new Error('部屋コードを確保できませんでした。もう一度お試しください。');
            state.mode = 'online';
            state.uid = user.uid;
            state.name = name;
            state.hand = [];
            state.selected.clear();
            state.room = {
                code,
                roomRef,
                publicRef,
                privateRef: roomRef.child(`private/${user.uid}/hand`),
                isHost: true,
                public: null
            };
            attachRoomListener();
            publicRef.child(`players/${user.uid}`).onDisconnect().update({ connected: false })
                .catch(error => console.error('大富豪の切断状態を登録できませんでした。', error));
            setMessage('部屋を作成しました。4人そろったらゲームを開始できます。');
        } catch (error) {
            console.error('大富豪の部屋を作成できませんでした。', error);
            setMessage(error.message || '部屋を作成できませんでした。');
        } finally {
            setBusy(false);
        }
    }

    async function joinDaifugoRoom() {
        const code = element('room-code').value.trim();
        if (!/^\d{6}$/.test(code)) {
            setMessage('6桁の部屋コードを入力してください。');
            return;
        }
        setBusy(true);
        try {
            const user = await getUser();
            const name = playerName();
            const roomRef = getDatabase().ref(`daifugoRooms/${code}`);
            const publicRef = roomRef.child('public');
            const snapshot = await publicRef.once('value');
            const previouslyRead = snapshot.val();
            if (!previouslyRead) throw new Error('部屋が見つかりません。コードを確認してください。');
            let failure = '';
            let usePreviouslyRead = true;
            const result = await publicRef.transaction(current => {
                const latest = current || (usePreviouslyRead ? previouslyRead : null);
                usePreviouslyRead = false;
                if (!latest) {
                    failure = '部屋が終了しています。';
                    return;
                }
                if (latest.status !== 'waiting') {
                    failure = 'この部屋ではすでにゲームが始まっています。';
                    return;
                }
                const players = { ...latest.players };
                if (!players[user.uid] && (latest.playerOrder || []).length >= 4) {
                    failure = 'この部屋は満員です（4人まで）。';
                    return;
                }
                players[user.uid] = {
                    ...(players[user.uid] || {}),
                    uid: user.uid,
                    name,
                    connected: true,
                    handCount: 0,
                    rank: null
                };
                return {
                    ...latest,
                    players,
                    playerOrder: latest.playerOrder?.includes(user.uid)
                        ? latest.playerOrder : [...latest.playerOrder, user.uid]
                };
            }, undefined, false);
            if (!result.committed) throw new Error(failure || '参加を確定できませんでした。部屋を確認してください。');
            await roomRef.child(`private/${user.uid}/hand`).set([]);
            state.mode = 'online';
            state.uid = user.uid;
            state.name = name;
            state.hand = [];
            state.selected.clear();
            state.room = {
                code,
                roomRef,
                publicRef,
                privateRef: roomRef.child(`private/${user.uid}/hand`),
                isHost: false,
                public: result.snapshot.val()
            };
            attachRoomListener();
            publicRef.child(`players/${user.uid}`).onDisconnect().update({ connected: false })
                .catch(error => console.error('大富豪の切断状態を登録できませんでした。', error));
            setMessage('部屋に参加しました。4人そろったらホストが開始します。');
        } catch (error) {
            console.error('大富豪の部屋に参加できませんでした。', error);
            setMessage(error.message || '部屋に参加できませんでした。');
        } finally {
            setBusy(false);
        }
    }

    function attachRoomListener() {
        const room = state.room;
        room.listener = snapshot => {
            if (state.room !== room) return;
            if (!snapshot.exists()) {
                setMessage('部屋が終了しました。');
                room.public = null;
                element('room').hidden = true;
                element('lobby').hidden = false;
                return;
            }
            room.public = snapshot.val();
            renderCurrent();
        };
        room.publicRef.on('value', room.listener, error => {
            console.error('大富豪の部屋を同期できませんでした。', error);
            setMessage(`部屋の同期に失敗しました: ${error.message}`);
        });
        room.privateListener = snapshot => {
            if (state.room !== room) return;
            state.hand = Array.isArray(snapshot.val()) ? snapshot.val() : [];
            renderCurrent();
        };
        room.privateRef.on('value', room.privateListener, error => {
            console.error('大富豪の手札を同期できませんでした。', error);
            setMessage(`手札を同期できません: ${error.message}`);
        });
        beginScreen();
        renderCurrent();
    }

    async function startDaifugoOnlineGame() {
        const room = state.room;
        if (state.mode !== 'online' || !room?.isHost || room.public?.status !== 'waiting') return;
        try {
            const deck = shuffle(makeDeck());
            const snapshot = await room.publicRef.once('value');
            const previouslyRead = snapshot.val();
            if (!previouslyRead) throw new Error('部屋が見つかりません。');
            let usePreviouslyRead = true;
            let failure = '';
            const connected = (previouslyRead.playerOrder || []).filter(uid =>
                previouslyRead.players?.[uid]?.connected !== false);
            if (connected.length !== 4) {
                throw new Error('接続中のプレイヤーが4人そろってから開始してください。');
            }
            const hands = Object.fromEntries(connected.map(uid => [uid, []]));
            deck.forEach((card, index) => hands[connected[index % connected.length]].push(card.id));
            Object.values(hands).forEach(hand =>
                hand.sort((a, b) => compareCards(cardById(a), cardById(b))));
            const firstPlayerUid = connected.find(uid => hands[uid].includes('0-0'));
            const privateUpdates = Object.fromEntries(connected.map(uid => [uid, { hand: hands[uid] }]));
            await room.roomRef.child('private').update(privateUpdates);
            const result = await room.publicRef.transaction(current => {
                const latest = current || (usePreviouslyRead ? previouslyRead : null);
                usePreviouslyRead = false;
                if (!latest || latest.hostUid !== room.public?.hostUid || latest.status !== 'waiting') {
                    failure = '部屋の状態が変わったため開始できません。';
                    return;
                }
                const latestConnected = (latest.playerOrder || []).filter(uid =>
                    latest.players?.[uid]?.connected !== false);
                if (latestConnected.length !== connected.length
                    || latestConnected.some((uid, index) => uid !== connected[index])) {
                    failure = '参加者が変わりました。4人そろってから再度開始してください。';
                    return;
                }
                if (latestConnected.length !== 4) {
                    failure = '接続中のプレイヤーが4人そろってから開始してください。';
                    return;
                }
                const next = JSON.parse(JSON.stringify({ ...latest, playerOrder: latestConnected }));
                next.status = 'playing';
                next.playerOrder.forEach(uid => {
                    next.players[uid].rank = null;
                    next.players[uid].handCount = hands[uid].length;
                    next.players[uid].lastAction = '';
                });
                next.game = {
                    turnUid: firstPlayerUid,
                    table: [],
                    tableCount: 0,
                    tableRank: null,
                    lastPlayUid: null,
                    passed: [],
                    revolution: false,
                    firstPlay: true,
                    winnerOrder: [],
                    message: '3♦を持つプレイヤーから開始します。'
                };
                return next;
            }, undefined, false);
            if (!result.committed) throw new Error(failure || 'ゲームを開始できませんでした。');
            room.public = result.snapshot.val();
            renderCurrent();
        } catch (error) {
            console.error('大富豪を開始できませんでした。', error);
            setMessage(error.message || 'ゲームを開始できませんでした。');
        }
    }

    async function submitOnlineAction(action) {
        const room = state.room;
        if (!room?.roomRef) return;
        try {
            let failure = '';
            const result = await room.publicRef.transaction(current => {
                if (!current) return;
                try {
                    return applyAction(current, state.uid, { ...action, hand: state.hand });
                } catch (error) {
                    failure = error.message;
                    return;
                }
            }, undefined, false);
            if (!result.committed) throw new Error(failure || '操作を反映できませんでした。');
            room.public = result.snapshot.val();
            if (action.type === 'play') {
                state.hand = state.hand.filter(id => !action.cards.includes(id));
                await room.privateRef.set(state.hand);
            }
            state.selected.clear();
            renderCurrent();
        } catch (error) {
            setMessage(error.message);
        }
    }

    function playDaifugoCards() {
        const cards = [...state.selected];
        if (!cards.length) {
            setMessage('出すカードを選択してください。');
            return;
        }
        if (state.mode === 'cpu') {
            try {
                state.room = applyAction(state.room, state.uid, { type: 'play', cards });
                state.selected.clear();
                renderCurrent();
                runCpuTurn();
            } catch (error) {
                setMessage(error.message);
            }
        } else {
            submitOnlineAction({ type: 'play', cards });
        }
    }

    function passDaifugoTurn() {
        if (state.mode === 'cpu') {
            try {
                state.room = applyAction(state.room, state.uid, { type: 'pass' });
                state.selected.clear();
                renderCurrent();
                runCpuTurn();
            } catch (error) {
                setMessage(error.message);
            }
        } else {
            submitOnlineAction({ type: 'pass' });
        }
    }

    async function leaveDaifugoGame() {
        if (state.mode === 'cpu') {
            clearTimeout(state.cpuTimer);
            state.room = null;
            state.mode = '';
            element('room').hidden = true;
            element('lobby').hidden = false;
            setMessage('CPU戦を終了しました。');
            return;
        }
        const room = state.room;
        if (!room?.roomRef) return;
        try {
            await room.publicRef.child(`players/${state.uid}`).onDisconnect().cancel();
            if (room.isHost) {
                await Promise.all((room.public?.playerOrder || []).map(uid =>
                    room.roomRef.child(`private/${uid}`).remove()));
                await room.publicRef.remove();
            } else if (room.public?.status === 'waiting') {
                await room.publicRef.transaction(current => {
                    if (!current?.players?.[state.uid]) return;
                    const players = { ...current.players };
                    delete players[state.uid];
                    return {
                        ...current,
                        players,
                        playerOrder: current.playerOrder.filter(uid => uid !== state.uid)
                    };
                }, undefined, false);
            } else {
                await room.publicRef.child(`players/${state.uid}/connected`).set(false);
            }
        } catch (error) {
            console.error('大富豪の部屋から退出できませんでした。', error);
            setMessage(`退出できませんでした: ${error.message}`);
        } finally {
            room.publicRef.off('value', room.listener);
            room.privateRef.off('value', room.privateListener);
            state.room = null;
            state.mode = '';
            state.hand = [];
            state.selected.clear();
            element('room').hidden = true;
            element('daifugo-screen').hidden = true;
            document.getElementById('start-screen').hidden = false;
            window.setGameContentInert?.(true);
        }
    }

    function closeDaifugo() {
        if (state.room) {
            leaveDaifugoGame();
            return;
        }
        clearTimeout(state.cpuTimer);
        element('daifugo-screen').hidden = true;
        document.getElementById('start-screen').hidden = false;
        window.setGameContentInert?.(true);
    }

    window.startDaifugo = startDaifugo;
    window.startDaifugoCpuGame = startDaifugoCpuGame;
    window.createDaifugoRoom = createDaifugoRoom;
    window.joinDaifugoRoom = joinDaifugoRoom;
    window.startDaifugoOnlineGame = startDaifugoOnlineGame;
    window.playDaifugoCards = playDaifugoCards;
    window.passDaifugoTurn = passDaifugoTurn;
    window.leaveDaifugoGame = leaveDaifugoGame;
    window.closeDaifugo = closeDaifugo;
})();
