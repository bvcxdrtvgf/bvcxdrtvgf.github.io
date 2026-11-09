(() => {
    const ranks = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
    const eightRank = ranks.indexOf('8');
    const achievements = [
        { id: 'join', title: '君はお金持ちになれるかな？', description: 'ゲームに参加する' },
        { id: 'win-1', title: '大富豪？', description: '1勝利する（まだ始まったばっかり）' },
        { id: 'win-5', title: '小金持ち', description: '5勝利する' },
        { id: 'win-10', title: 'お金持ち', description: '10勝利する' },
        { id: 'win-50', title: '大金持ち', description: '50勝利する' },
        { id: 'win-100', title: '大富豪！！', description: '100勝利する' },
        { id: 'win-5000', title: '銀行強盗2', description: '5,000勝利する（ん、私じゃない）' },
        { id: 'revolution', title: '革命家', description: '革命を起こす' },
        { id: 'toshiotoshi', title: '都落ち', description: '都落ちする（かつての栄光は消え去った）' },
        { id: 'illegal-finish', title: '不正は許さん！', description: '反則上がりを試みる' }
    ];
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
        animatedGameId: '',
        cpuTimer: null,
        adminModeEnabled: false
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

    function unlockedAchievements() {
        return JSON.parse(localStorage.getItem('daifugo-achievements-v1') || '[]')
            .filter(id => achievements.some(achievement => achievement.id === id));
    }

    function renderAchievements() {
        const unlocked = unlockedAchievements();
        element('achievement-open').textContent = `実績 ${unlocked.length}/${achievements.length}`;
        element('win-count').textContent = String(currentVictoryCount());
        renderAchievementDisplayButtons();
        const list = element('achievement-list');
        list.replaceChildren();
        achievements.forEach(achievement => {
            const item = document.createElement('li');
            item.textContent = `${achievement.title} — ${unlocked.includes(achievement.id) ? '獲得済み' : '未獲得'}：${achievement.description}`;
            list.append(item);
        });
    }

    function selectedAchievement() {
        const id = localStorage.getItem('daifugo-selected-achievement') || '';
        return unlockedAchievements().includes(id) ? id : '';
    }

    function renderAchievementDisplayButtons() {
        const container = element('achievement-display-buttons');
        container.replaceChildren();
        const unlocked = unlockedAchievements();
        [{ id: '', title: '表示しない' }, ...achievements].forEach(achievement => {
            const button = document.createElement('button');
            button.type = 'button';
            const isUnlocked = !achievement.id || unlocked.includes(achievement.id);
            button.textContent = achievement.id
                ? `${isUnlocked ? '✓' : '🔒'} ${achievement.title}`
                : achievement.title;
            button.disabled = !isUnlocked;
            button.setAttribute('aria-pressed', String(selectedAchievement() === achievement.id));
            button.addEventListener('click', () => selectAchievement(achievement.id));
            container.append(button);
        });
    }

    function selectAchievement(id) {
        if (id && !unlockedAchievements().includes(id)) return;
        localStorage.setItem('daifugo-selected-achievement', id);
        renderAchievementDisplayButtons();
        const room = state.room;
        if (state.mode !== 'online' || !room?.public?.players?.[state.uid]) return;
        room.public.players[state.uid].achievement = id || null;
        render(room.public, state.uid, room.code);
        room.publicRef.child(`players/${state.uid}/achievement`).set(id || null).catch(error => {
            console.error('大富豪の実績表示を同期できませんでした。', error);
            setMessage(`実績表示の同期に失敗しました: ${error.message}`);
        });
    }

    function syncHiddenAchievement(id) {
        const room = state.room;
        if (state.mode !== 'online' || !room?.public?.players?.[state.uid]) return;
        room.public.players[state.uid].hiddenAchievement = id || null;
        render(room.public, state.uid, room.code);
        room.publicRef.child(`players/${state.uid}/hiddenAchievement`).set(id || null).catch(error => {
            console.error('大富豪の隠し実績表示を同期できませんでした。', error);
            setMessage(`隠し実績表示の同期に失敗しました: ${error.message}`);
        });
    }

    function openAchievements() {
        renderAchievements();
        element('achievement-dialog').showModal();
    }

    function awardAchievement(id) {
        const unlocked = unlockedAchievements();
        if (unlocked.includes(id)) return false;
        unlocked.push(id);
        localStorage.setItem('daifugo-achievements-v1', JSON.stringify(unlocked));
        renderAchievements();
        setMessage(`実績「${achievements.find(achievement => achievement.id === id).title}」を獲得しました。`);
        return true;
    }

    function currentVictoryCount() {
        const counts = JSON.parse(localStorage.getItem('shared-game-victory-counts-v1') || '{}');
        return Number.isSafeInteger(counts.daifugo) && counts.daifugo >= 0 ? counts.daifugo : 0;
    }

    function toggleAdminPanel() {
        if (state.adminModeEnabled) {
            disableAdminMode();
            return;
        }
        const login = element('admin-login');
        login.hidden = !login.hidden;
        if (!login.hidden) element('admin-code').focus();
    }

    function unlockAdminMode() {
        const input = element('admin-code');
        if (!window.verifyAdminAccessCode?.(input.value)) {
            input.value = '';
            input.setCustomValidity('管理コードが違います。');
            input.reportValidity();
            input.setCustomValidity('');
            return;
        }
        input.value = '';
        state.adminModeEnabled = true;
        element('admin-login').hidden = true;
        element('admin-settings').hidden = false;
        element('admin-wins').value = String(currentVictoryCount());
        element('admin-toggle').textContent = '管理者モード: ON';
        setMessage('管理者モードを有効にしました。');
    }

    function setAdminWins() {
        if (!state.adminModeEnabled) {
            setMessage('管理者認証後に操作してください。');
            return;
        }
        const input = element('admin-wins');
        const wins = Number(input.value);
        if (!input.value.trim() || !Number.isSafeInteger(wins) || wins < 0) {
            setMessage('勝利数は0以上の整数で入力してください。');
            return;
        }
        try {
            window.setSharedGameVictoryCount('daifugo', wins);
        } catch (error) {
            setMessage(error.message || '勝利数を変更できませんでした。');
            return;
        }
        awardWinMilestones();
        renderAchievements();
        setMessage(`大富豪の勝利数を${wins}に変更しました。`);
    }

    function disableAdminMode() {
        state.adminModeEnabled = false;
        element('admin-login').hidden = true;
        element('admin-settings').hidden = true;
        element('admin-toggle').textContent = '管理者モード';
        setMessage('大富豪の管理者モードを終了しました。');
    }

    function awardWinMilestones() {
        const wins = currentVictoryCount();
        [1, 5, 10, 50, 100, 5000]
            .filter(target => wins >= target)
            .forEach(target => awardAchievement(`win-${target}`));
        element('win-count').textContent = String(wins);
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

    function combination(cards, revolution = false) {
        if (!Array.isArray(cards) || cards.length < 1 || cards.length > 13) return null;
        const parsed = cards.map(card => typeof card === 'string' ? cardById(card) : card);
        if (parsed.some(card => !card)) return null;
        const count = parsed.length;
        if (parsed.every(card => card.rank === parsed[0].rank)) {
            if (count > 4) return null;
            return {
                type: 'set',
                count,
                rank: parsed[0].rank,
                suit: Math.max(...parsed.map(card => card.suit))
            };
        }
        if (count < 3 || new Set(parsed.map(card => card.suit)).size !== 1) return null;
        const sortedRanks = parsed.map(card => card.rank).sort((a, b) => a - b);
        if (new Set(sortedRanks).size !== count
            || sortedRanks[count - 1] - sortedRanks[0] !== count - 1) return null;
        return {
            type: 'stair',
            count,
            rank: revolution ? sortedRanks[0] : sortedRanks[count - 1],
            suit: parsed[0].suit
        };
    }

    function beats(next, previous, revolution) {
        if (!previous || next.count !== previous.count || next.type !== previous.type) return false;
        if (next.rank !== previous.rank) return revolution
            ? next.rank < previous.rank
            : next.rank > previous.rank;
        return next.suit > previous.suit;
    }

    function suitsMatch(cards, requiredSuits) {
        const selectedSuits = [...new Set(cards.map(card => card.suit))];
        return selectedSuits.length === requiredSuits.length
            && requiredSuits.every(suit => selectedSuits.includes(suit));
    }

    function illegalFinish(cards, revolution) {
        return cards.some(card => card.rank === eightRank || card.id === '0-3'
            || (revolution ? card.rank === 0 : card.rank === 12));
    }

    function canPass(room, uid, hand) {
        return Boolean(room.game.tableCount)
            || (room.game.turnUid === uid && hand.length === 1
                && illegalFinish(hand.map(cardById).filter(Boolean), room.game.revolution));
    }

    function nextAvailableRank(room) {
        const used = new Set(Object.values(room.players)
            .map(player => player.rank).filter(rank => Number.isInteger(rank)));
        for (let rank = 1; rank <= room.playerOrder.length; rank++) {
            if (!used.has(rank)) return rank;
        }
        return room.playerOrder.length;
    }

    function syncWinnerOrder(room) {
        room.game.winnerOrder = room.playerOrder
            .filter(uid => Number.isInteger(room.players[uid]?.rank))
            .sort((a, b) => room.players[a].rank - room.players[b].rank);
    }

    function awardPlace(room, uid) {
        const player = room.players[uid];
        if (!player || player.rank != null) return;
        player.rank = nextAvailableRank(room);
        room.game.winnerOrder.push(uid);
        const previousChampion = room.players[room.game.previousChampionUid];
        if (player.rank === 1 && room.game.previousChampionUid
            && room.game.previousChampionUid !== uid && previousChampion?.rank == null) {
            previousChampion.rank = room.playerOrder.length;
            room.game.winnerOrder.push(room.game.previousChampionUid);
            room.game.message += `。前回の大富豪 ${previousChampion.name} は都落ちで最下位！`;
        }
        syncWinnerOrder(room);
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

    function clearTrick(room, leadUid, message = '場が流れました。次のプレイヤーから出せます。') {
        room.game.table = [];
        room.game.tableCount = 0;
        room.game.tableRank = null;
        room.game.passed = [];
        room.game.lastPlayUid = null;
        room.game.suitLock = null;
        room.game.turnUid = leadUid || activePlayers(room)[0] || '';
        room.game.message = message;
    }

    function finishIfDone(room) {
        const game = room.game;
        const active = activePlayers(room);
        if (active.length > 1) return false;
        if (active.length === 1 && room.players[active[0]].rank == null) awardPlace(room, active[0]);
        room.status = 'finished';
        game.turnUid = '';
        syncWinnerOrder(room);
        game.message = `ゲーム終了。順位: ${game.winnerOrder.map((uid, index) =>
            `${index + 1}位 ${room.players[uid].name}`).join('、')}`;
        if (game.winnerOrder.length) {
            room.previousChampionUid = game.winnerOrder[0];
            if (state.mode === 'cpu') {
                localStorage.setItem('daifugo-previous-champion', game.winnerOrder[0]);
            }
        }
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
            const currentHand = Array.isArray(player.hand) ? player.hand : action.hand || [];
            if (!canPass(room, uid, currentHand)) throw new Error('場にカードがないときはパスできません。');
            game.suitLock = null;
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
        const nextCombo = combination(played, game.revolution);
        if (!nextCombo) throw new Error('同じ数字の1〜4枚か、同じマークで3枚以上の階段を選んでください。');
        const isRevolution = nextCombo.type === 'set' && nextCombo.count === 4
            || nextCombo.type === 'stair' && nextCombo.count >= 4;
        const revolutionAfterPlay = isRevolution ? !game.revolution : game.revolution;
        const spadeThreeReturn = !game.revolution && game.tableCount === 1
            && cardById(game.table[0])?.rank === 12
            && ids.length === 1 && ids[0] === '0-3';
        const activeSuitLock = game.suitLock?.targetUid === uid ? game.suitLock : null;
        if (activeSuitLock && !suitsMatch(played, activeSuitLock.suits)) {
            throw new Error('マーク縛り中です。次の1手は同じマークを含めてください。');
        }
        if (game.tableCount && !spadeThreeReturn && !beats(nextCombo, game.tableRank, game.revolution)) {
            throw new Error('場のカードと同じ枚数で、より強いカードを出してください。');
        }
        if (game.firstPlay && !ids.includes('0-0')) {
            throw new Error('最初の手番は3♦を含めて出してください。');
        }
        const remainingHand = currentHand.filter(id => !ids.includes(id));
        if (!remainingHand.length && illegalFinish(played, revolutionAfterPlay)) {
            throw new Error('反則上がりです。2・8・3♠（革命中は3）では上がれません。');
        }
        if (game.firstPlay) game.firstPlay = false;
        const previousTable = game.table.map(cardById).filter(Boolean);
        game.suitLock = null;
        if (Array.isArray(player.hand)) {
            player.hand = player.hand.filter(id => !ids.includes(id));
            player.handCount = player.hand.length;
        } else {
            player.handCount = Math.max(0, (player.handCount || 0) - ids.length);
        }
        player.lastAction = `${ids.map(id => cardLabel(cardById(id))).join(' ')} を出した`;
        game.table = ids;
        game.tableCount = ids.length;
        game.lastPlayUid = uid;
        game.passed = game.passed.filter(passedUid => passedUid !== uid);
        game.message = `${player.name} が ${player.lastAction}`;
        if (isRevolution) {
            game.revolution = !game.revolution;
            game.message += `（革命${game.revolution ? '！' : '解除'}）`;
        }
        game.tableRank = combination(played, game.revolution);
        const trickWasCut = spadeThreeReturn || ids.some(id => cardById(id).rank === eightRank);
        const cutMessage = spadeThreeReturn
            ? `${player.name} のスペ3返し！場が流れました。`
            : `${player.name} の8切り！場が流れました。`;
        let nextLockSuits = [];
        if (!trickWasCut && !activeSuitLock && previousTable.length) {
            const previousSuits = [...new Set(previousTable.map(card => card.suit))];
            const playedSuits = [...new Set(played.map(card => card.suit))];
            if (previousSuits.length === playedSuits.length
                && previousSuits.every(suit => playedSuits.includes(suit))) {
                nextLockSuits = playedSuits;
            }
        }
        const remainingCards = Array.isArray(player.hand) ? player.hand.length : player.handCount;
        if (remainingCards === 0) {
            awardPlace(room, uid);
            game.message += `。${player.rank}位で上がり！`;
        }
        if (trickWasCut) {
            const nextLeadUid = player.rank == null ? uid : nextActive(room, uid);
            clearTrick(room, nextLeadUid, cutMessage);
            finishIfDone(room);
            return room;
        }
        const targetUid = nextActive(room, uid, true);
        if (nextLockSuits.length && targetUid && !trickWasCut) {
            game.suitLock = { suits: nextLockSuits, targetUid };
            game.message += `（次の1手は${nextLockSuits.map(suit => suits[suit].symbol).join('・')}縛り）`;
        }
        advanceAfterAction(room, uid);
        return room;
    }

    function makeStartedRoom(room, deck) {
        const next = JSON.parse(JSON.stringify(room));
        const players = next.playerOrder.map(uid => next.players[uid]);
        if (next.status !== 'waiting' || players.length < 2 || players.length > 4
            || players.some(player => player.connected === false)) {
            throw new Error('接続中のプレイヤーが2〜4人必要です。');
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
            gameId: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
            turnUid: firstPlayer.uid,
            table: [],
            tableCount: 0,
            tableRank: null,
            lastPlayUid: null,
            passed: [],
            revolution: false,
            firstPlay: true,
            previousChampionUid: next.previousChampionUid || null,
            suitLock: null,
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
            const identity = document.createElement('span');
            identity.textContent = `${index + 1}. ${player.name}${playerUid === uid ? '（あなた）' : ''}`;
            const hiddenAchievementTitle = window.getSharedHiddenAchievementTitle?.(player.hiddenAchievement);
            if (hiddenAchievementTitle) {
                const hiddenBadge = document.createElement('span');
                hiddenBadge.className = 'poker-achievement-badge';
                hiddenBadge.textContent = hiddenAchievementTitle;
                identity.append(hiddenBadge);
            }
            item.append(identity);
            const stats = document.createElement('div');
            stats.textContent = `勝利数: ${Number.isSafeInteger(player.wins) && player.wins >= 0 ? player.wins : 0}${rank}${count}${connection}`;
            item.append(stats);
            const achievement = achievements.find(entry => entry.id === player.achievement);
            if (achievement) {
                const badge = document.createElement('span');
                badge.className = 'poker-achievement-badge';
                badge.textContent = achievement.title;
                item.append(badge);
            }
            playersList.append(item);
        });
        const startButton = element('start-game');
        startButton.hidden = !code || room.hostUid !== uid || room.status !== 'waiting';
        const connectedCount = (room.playerOrder || []).filter(playerUid =>
            room.players[playerUid]?.connected !== false).length;
        startButton.disabled = connectedCount < 2 || connectedCount > 4;
        const rematchButton = element('rematch');
        rematchButton.hidden = room.status !== 'finished'
            || (state.mode === 'online' && room.hostUid !== uid);
        const game = room.game;
        const animateDealtHand = Boolean(game?.gameId && state.animatedGameId !== game.gameId);
        if (animateDealtHand) {
            state.animatedGameId = game.gameId;
            window.playCardGameSound?.('draw');
        }
        const table = element('table-cards');
        table.replaceChildren();
        (game?.table || []).map(cardById).filter(Boolean).forEach(card => {
            const cardElement = createCardElement(card, true);
            cardElement.classList.add('daifugo-card-enter');
            table.append(cardElement);
        });
        const byPlayer = room.players?.[uid];
        const hand = element('own-hand');
        hand.replaceChildren();
        const visibleHand = state.mode === 'online' ? state.hand : byPlayer?.hand || [];
        visibleHand.map(cardById).filter(Boolean).forEach(card => {
            const button = document.createElement('button');
            button.className = 'daifugo-card';
            if (animateDealtHand) button.classList.add('daifugo-card-enter');
            if (suits[card.suit].red) button.classList.add('red');
            button.setAttribute('aria-label', cardLabel(card));
            appendCardFace(button, card);
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
        element('pass').disabled = !isMyTurn || !canPass(room, uid, visibleHand);
        element('trick-info').textContent = game
            ? `場: ${game.tableCount ? `${game.tableCount}枚${game.tableRank?.type === 'stair' ? '階段' : '出し'}` : 'なし'} · 革命: ${game.revolution ? 'ON' : 'OFF'}${game.suitLock ? ` · 次の1手は${game.suitLock.suits.map(suit => suits[suit].symbol).join('・')}縛り` : ''}`
            : '参加者が2人以上（最大4人）になると開始できます。';
        element('status').textContent = game?.message || '2人以上で開始できます（最大4人）。';
        element('message').textContent = room.status === 'finished' ? game.message : '';
    }

    function createCardElement(card, faceUp) {
        const cardElement = document.createElement('span');
        cardElement.className = 'daifugo-card';
        if (suits[card.suit].red) cardElement.classList.add('red');
        if (faceUp) {
            appendCardFace(cardElement, card);
            cardElement.setAttribute('aria-label', cardLabel(card));
        } else {
            cardElement.textContent = '🂠';
        }
        return cardElement;
    }

    function appendCardFace(cardElement, card) {
        const label = cardLabel(card);
        const top = document.createElement('span');
        top.className = 'daifugo-card-rank';
        top.textContent = label;

        const center = document.createElement('span');
        center.className = 'daifugo-card-center';
        const character = window.getDaifugoCharacterCard?.(card.rank);
        if (character) {
            const image = document.createElement('img');
            image.src = character.src.normalize('NFD');
            image.alt = character.name;
            center.append(image);
        } else {
            center.textContent = suits[card.suit].symbol;
        }

        const bottom = document.createElement('span');
        bottom.className = 'daifugo-card-rank daifugo-card-rank-bottom';
        bottom.textContent = label;
        cardElement.append(top, center, bottom);
    }

    function renderCurrent() {
        if (state.mode === 'cpu' && state.room) {
            render(state.room, 'human', '');
        } else if (state.room?.public) {
            render(state.room.public, state.uid, state.room.code);
        }
        const room = state.mode === 'online' ? state.room?.public : state.room;
        if (room?.players?.[state.uid]?.rank === room?.playerOrder?.length
            && room.game?.previousChampionUid === state.uid
            && room.game.winnerOrder?.[0] !== state.uid) {
            awardAchievement('toshiotoshi');
        }
        if (room?.status === 'finished' && room.players?.[state.uid]?.rank === 1
            && window.recordCardGameVictory?.('daifugo', room.game?.gameId)) {
            awardWinMilestones();
            room.players[state.uid].wins = currentVictoryCount();
            render(room, state.uid, state.mode === 'online' ? state.room.code : '');
            if (state.mode === 'online') {
                state.room.publicRef.child(`players/${state.uid}/wins`).set(currentVictoryCount()).catch(error => {
                    console.error('大富豪の勝利数を同期できませんでした。', error);
                    setMessage(`勝利数の同期に失敗しました: ${error.message}`);
                });
            }
            window.playCardGameSound?.('win');
            window.playCardGameVictoryAnimation?.();
        }
    }

    function awardSuccessfulPlayAchievements(previousRevolution, room) {
        if (previousRevolution !== room.game.revolution) awardAchievement('revolution');
    }

    function awardIllegalFinishAttempt(error) {
        if (error?.message?.startsWith('反則上がりです。')) {
            awardAchievement('illegal-finish');
        }
    }

    function beginScreen() {
        document.getElementById('start-screen').hidden = true;
        document.getElementById('poker-screen').hidden = true;
        document.getElementById('blackjack-screen').hidden = true;
        document.getElementById('daifugo-screen').hidden = false;
        window.setGameContentInert?.(false);
        element('player-name').value = localStorage.getItem('daifugo-player-name') || '';
        renderAchievements();
    }

    function startDaifugo() {
        beginScreen();
        document.body.classList.remove('poker-mode', 'blackjack-mode');
        document.body.classList.add('daifugo-mode');
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
            previousChampionUid: localStorage.getItem('daifugo-previous-champion') || null,
            game: null
        }, shuffle(makeDeck()));
        room.isHost = false;
        state.room = room;
        state.mode = 'cpu';
        state.hand = [];
        awardAchievement('join');
        renderCurrent();
        runCpuTurn();
    }

    function candidatePlays(hand) {
        const plays = [];
        function addSubsets(cards, count, start = 0, selected = []) {
            if (selected.length === count) {
                plays.push([...selected]);
                return;
            }
            for (let index = start; index <= cards.length - (count - selected.length); index++) {
                selected.push(cards[index]);
                addSubsets(cards, count, index + 1, selected);
                selected.pop();
            }
        }

        const byRank = new Map();
        const bySuit = Array.from({ length: suits.length }, () => new Map());
        hand.forEach(card => {
            if (!byRank.has(card.rank)) byRank.set(card.rank, []);
            byRank.get(card.rank).push(card);
            bySuit[card.suit].set(card.rank, card);
        });
        byRank.forEach(cards => {
            for (let count = 1; count <= Math.min(cards.length, 4); count++) {
                addSubsets(cards, count);
            }
        });
        bySuit.forEach((cards, suit) => {
            for (let start = 0; start < ranks.length - 2; start++) {
                for (let end = start + 2; end < ranks.length; end++) {
                    const stair = [];
                    for (let rank = start; rank <= end; rank++) {
                        if (!cards.has(rank)) break;
                        stair.push(cards.get(rank));
                    }
                    if (stair.length === end - start + 1) plays.push(stair);
                }
            }
        });
        return plays;
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
                const options = candidatePlays(cpuHand)
                    .filter(cards => {
                        const combo = combination(cards, room.game.revolution);
                        const spadeThreeReturn = !room.game.revolution && room.game.tableCount === 1
                            && cardById(room.game.table[0])?.rank === 12
                            && cards.length === 1 && cards[0].id === '0-3';
                        const revolutionAfterPlay = combo && (
                            combo.type === 'set' && combo.count === 4
                            || combo.type === 'stair' && combo.count >= 4
                        ) ? !room.game.revolution : room.game.revolution;
                        const lock = room.game.suitLock?.targetUid === uid ? room.game.suitLock : null;
                        return combo
                            && (!room.game.tableCount || spadeThreeReturn
                                || beats(combo, room.game.tableRank, room.game.revolution))
                            && (!room.game.firstPlay || cards.some(card => card.id === '0-0'))
                            && (!lock || suitsMatch(cards, lock.suits))
                            && !(cards.length === cpuHand.length && illegalFinish(cards, revolutionAfterPlay));
                    })
                    .sort((a, b) => {
                        const first = combination(a, room.game.revolution);
                        const second = combination(b, room.game.revolution);
                        return first.count - second.count
                            || (room.game.revolution ? second.rank - first.rank : first.rank - second.rank)
                            || first.suit - second.suit;
                    });
                if (options.length) {
                    room = applyAction(room, uid, { type: 'play', cards: options[0].map(card => card.id) });
                } else {
                    room = applyAction(room, uid, { type: 'pass' });
                }
                state.room = room;
                state.selected.clear();
                window.playCardGameSound?.('move');
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
            const wins = currentVictoryCount();
            const achievement = selectedAchievement();
            const hiddenAchievement = window.getSelectedSharedHiddenAchievement?.() || '';
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
                        [user.uid]: { uid: user.uid, name, wins, achievement: achievement || null, hiddenAchievement: hiddenAchievement || null, connected: true, handCount: 0, rank: null }
                    },
                    playerOrder: [user.uid],
                    previousChampionUid: null,
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
            awardAchievement('join');
            publicRef.child(`players/${user.uid}`).onDisconnect().update({ connected: false })
                .catch(error => console.error('大富豪の切断状態を登録できませんでした。', error));
            setMessage('部屋を作成しました。2人以上で開始できます（最大4人）。');
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
            const wins = currentVictoryCount();
            const achievement = selectedAchievement();
            const hiddenAchievement = window.getSelectedSharedHiddenAchievement?.() || '';
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
                const activeOrder = (latest.playerOrder || []).filter(uid =>
                    latest.players?.[uid]?.connected !== false || uid === user.uid);
                const players = Object.fromEntries(activeOrder
                    .filter(uid => uid !== user.uid)
                    .map(uid => [uid, latest.players[uid]]));
                if (!activeOrder.includes(user.uid) && activeOrder.length >= 4) {
                    failure = 'この部屋は満員です（4人まで）。';
                    return;
                }
                players[user.uid] = {
                    ...(latest.players?.[user.uid] || {}),
                    uid: user.uid,
                    name,
                    wins,
                    achievement: achievement || null,
                    hiddenAchievement: hiddenAchievement || null,
                    connected: true,
                    handCount: 0,
                    rank: null
                };
                return {
                    ...latest,
                    players,
                    playerOrder: activeOrder.includes(user.uid)
                        ? activeOrder : [...activeOrder, user.uid]
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
            awardAchievement('join');
            publicRef.child(`players/${user.uid}`).onDisconnect().update({ connected: false })
                .catch(error => console.error('大富豪の切断状態を登録できませんでした。', error));
            setMessage('部屋に参加しました。2人以上でホストが開始できます（最大4人）。');
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

    async function startOnlineRound(room, expectedStatus, previousChampionUid) {
        const actionButton = element(expectedStatus === 'waiting' ? 'start-game' : 'rematch');
        if (actionButton.disabled) return;
        actionButton.disabled = true;
        try {
            const deck = shuffle(makeDeck());
            const snapshot = await room.publicRef.once('value');
            const previouslyRead = snapshot.val();
            if (!previouslyRead) throw new Error('部屋が見つかりません。');
            let usePreviouslyRead = true;
            let failure = '';
            const connected = (previouslyRead.playerOrder || []).filter(uid =>
                previouslyRead.players?.[uid]?.connected !== false);
            if (connected.length < 2 || connected.length > 4) {
                throw new Error('接続中のプレイヤーが2〜4人必要です。');
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
                if (!latest || latest.hostUid !== room.public?.hostUid || latest.status !== expectedStatus) {
                    failure = '部屋の状態が変わったため開始できません。';
                    return;
                }
                const latestConnected = (latest.playerOrder || []).filter(uid =>
                    latest.players?.[uid]?.connected !== false);
                if (latestConnected.length !== connected.length
                    || latestConnected.some((uid, index) => uid !== connected[index])) {
                    failure = '参加者が変わりました。人数を確認して再度開始してください。';
                    return;
                }
                if (latestConnected.length < 2 || latestConnected.length > 4) {
                    failure = '接続中のプレイヤーが2〜4人必要です。';
                    return;
                }
                const next = JSON.parse(JSON.stringify({
                    ...latest,
                    playerOrder: latestConnected,
                    previousChampionUid: latestConnected.includes(previousChampionUid)
                        ? previousChampionUid : null
                }));
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
                    previousChampionUid: next.previousChampionUid,
                    suitLock: null,
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
        } finally {
            actionButton.disabled = false;
            renderCurrent();
        }
    }

    async function startDaifugoOnlineGame() {
        const room = state.room;
        if (state.mode !== 'online' || !room?.isHost || room.public?.status !== 'waiting') return;
        await startOnlineRound(room, 'waiting', room.public.previousChampionUid || null);
    }

    async function rematchDaifugoGame() {
        const room = state.room;
        if (room?.status === 'finished') {
            const previousChampionUid = room.game.winnerOrder[0] || null;
            const nextRoom = makeStartedRoom({
                ...room,
                status: 'waiting',
                previousChampionUid
            }, shuffle(makeDeck()));
            nextRoom.isHost = false;
            state.room = nextRoom;
            state.selected.clear();
            renderCurrent();
            runCpuTurn();
            return;
        }
        const onlineRoom = room?.public;
        if (state.mode !== 'online' || !room?.isHost || onlineRoom?.status !== 'finished') return;
        await startOnlineRound(room, 'finished', onlineRoom.game?.winnerOrder?.[0] || null);
    }

    async function submitOnlineAction(action) {
        const room = state.room;
        if (!room?.roomRef) return;
        const previousRevolution = room.public?.game?.revolution || false;
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
                awardSuccessfulPlayAchievements(previousRevolution, room.public);
                await room.privateRef.set(state.hand);
            }
            window.playCardGameSound?.('move');
            state.selected.clear();
            renderCurrent();
        } catch (error) {
            awardIllegalFinishAttempt(error);
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
            const previousRevolution = state.room.game.revolution;
            try {
                state.room = applyAction(state.room, state.uid, { type: 'play', cards });
                awardSuccessfulPlayAchievements(previousRevolution, state.room);
                window.playCardGameSound?.('move');
                state.selected.clear();
                renderCurrent();
                runCpuTurn();
            } catch (error) {
                awardIllegalFinishAttempt(error);
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
                window.playCardGameSound?.('move');
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
            document.getElementById('daifugo-screen').hidden = true;
            document.getElementById('start-screen').hidden = false;
            document.body.classList.remove('daifugo-mode');
            window.setGameContentInert?.(true);
        }
    }

    function closeDaifugo() {
        if (state.room) {
            leaveDaifugoGame();
            return;
        }
        clearTimeout(state.cpuTimer);
        document.getElementById('daifugo-screen').hidden = true;
        document.getElementById('start-screen').hidden = false;
        document.body.classList.remove('daifugo-mode');
        window.setGameContentInert?.(true);
    }

    window.startDaifugo = startDaifugo;
    window.syncDaifugoHiddenAchievement = syncHiddenAchievement;
    window.openDaifugoAchievements = openAchievements;
    window.getDaifugoAdminAchievements = () => achievements;
    window.isDaifugoAchievementUnlocked = id => unlockedAchievements().includes(id);
    window.grantDaifugoAdminAchievement = id =>
        achievements.some(achievement => achievement.id === id) && awardAchievement(id);
    window.isDaifugoAdminModeEnabled = () => state.adminModeEnabled;
    window.toggleDaifugoAdminPanel = toggleAdminPanel;
    window.unlockDaifugoAdminMode = unlockAdminMode;
    window.setDaifugoAdminWins = setAdminWins;
    window.disableDaifugoAdminMode = disableAdminMode;
    window.startDaifugoCpuGame = startDaifugoCpuGame;
    window.createDaifugoRoom = createDaifugoRoom;
    window.joinDaifugoRoom = joinDaifugoRoom;
    window.startDaifugoOnlineGame = startDaifugoOnlineGame;
    window.rematchDaifugoGame = rematchDaifugoGame;
    window.playDaifugoCards = playDaifugoCards;
    window.passDaifugoTurn = passDaifugoTurn;
    window.leaveDaifugoGame = leaveDaifugoGame;
    window.closeDaifugo = closeDaifugo;
})();
