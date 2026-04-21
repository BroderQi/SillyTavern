import EventSourceStream from './sse-core-stream.js';

const STORAGE_KEY = 'daydream_public_state_v1';
const HISTORY_KEY = 'daydream_public_history_v1';

const FILTER_DIMENSIONS = [
    { key: 'spacetime', label: '时空背景' },
    { key: 'theme', label: '核心题材' },
    { key: 'protagonist_setup', label: '主角设定' },
    { key: 'system_type', label: '系统机制' },
    { key: 'story_class', label: '玩法爽点' },
];

const defaultStats = {
    turn_count: 0,
    age: 20,
    energy: 75,
    talent: 68,
    morality: 50,
    risk_level: 0,
    trust_level: 50,
    social_status: 50,
    prestige: 50,
    leverage: 0,
    health: 100,
    supplies: 3,
    focus: 80,
    clues: 0,
    mood: 50,
    affection: 0,
    tension: 0,
    growth: 0,
    cashflow: 0,
    reputation: 0,
};

const statLabels = {
    turn_count: '回合',
    age: '年龄',
    energy: '体力',
    talent: '才华',
    morality: '道德',
    risk_level: '风险',
    trust_level: '信任',
    social_status: '地位',
    prestige: '威望',
    leverage: '筹码',
    health: '生命',
    supplies: '物资',
    focus: '精力',
    clues: '线索',
    mood: '心绪',
    affection: '好感',
    tension: '拉扯',
    growth: '成长',
    cashflow: '现金',
    reputation: '声望',
};

let stories = [];
let uiProfiles = {};
let provider = {};
let sillyTavern = { available: false, characters: [], world_names: [] };
let csrfToken = '';
let activeTab = 'story';
let isGenerating = false;
let pendingAction = '';
const stCharacterChats = new Map();
const stCharacterChatsLoading = new Set();

function qs(selector) {
    return document.querySelector(selector);
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function createDefaultStContext() {
    return {
        avatar_url: '',
        chat_name: '',
        world_info_names: [],
        system_prompt: '',
        author_note: '',
    };
}

function getDefaultProfile() {
    return structuredClone(
        uiProfiles['通用']
        ?? uiProfiles.general
        ?? Object.values(uiProfiles)[0]
        ?? { top_stats: [], tabs: [] },
    );
}

function createState() {
    return {
        version: '0.1.0',
        session_id: null,
        story_id: null,
        story_title: '',
        custom_story: '',
        route: 'general_story',
        story_class: '',
        st_context: createDefaultStContext(),
        character: { name: '', gender: '男', custom: {} },
        stats: { ...defaultStats },
        relationships: [],
        resources: [],
        triggered_events: [],
        current_stage: 'opening',
        stage_progress: 0,
        main_objective: '',
        core_conflict: '',
        pending_foreshadows: [],
        active_hooks: [],
        important_branches: [],
        near_ending: false,
        last_scene: null,
        last_status_text: '',
        last_options: [],
    };
}

function loadState() {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
        return {
            ...createState(),
            ...(saved ?? {}),
            st_context: { ...createDefaultStContext(), ...(saved?.st_context ?? {}) },
            stats: { ...defaultStats, ...(saved?.stats ?? {}) },
            character: { name: '', gender: '男', custom: {}, ...(saved?.character ?? {}) },
        };
    } catch {
        return createState();
    }
}

function saveState(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadHistory() {
    try {
        return JSON.parse(localStorage.getItem(HISTORY_KEY)) ?? [];
    } catch {
        return [];
    }
}

function saveHistory(history) {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-12)));
}

async function fetchSession(sessionId) {
    if (!sessionId || !csrfToken) {
        return null;
    }

    const response = await fetch('/api/daydream/session/get', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({ session_id: sessionId }),
    }).catch(() => null);

    if (!response?.ok) {
        return null;
    }

    return await response.json().catch(() => null);
}

async function restoreSessionFromServer() {
    const state = loadState();
    if (!state.session_id) {
        return;
    }

    const session = await fetchSession(state.session_id);
    if (!session) {
        return;
    }

    const restoredState = {
        ...createState(),
        ...(session.state ?? {}),
        session_id: session.session_id ?? state.session_id,
        st_context: {
            ...createDefaultStContext(),
            ...(session.st_context ?? {}),
            ...(state.st_context ?? {}),
        },
        stats: {
            ...defaultStats,
            ...(session.state?.stats ?? {}),
        },
        character: {
            name: '',
            gender: '男',
            custom: {},
            ...(session.state?.character ?? {}),
        },
    };

    saveState(restoredState);
    if (Array.isArray(session.history)) {
        saveHistory(session.history);
    }
}

async function syncSession(state, history = loadHistory()) {
    if (!state?.session_id || !csrfToken) {
        return null;
    }

    const response = await fetch('/api/daydream/session/save', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({
            session_id: state.session_id,
            st_context: state.st_context ?? {},
            state,
            history,
        }),
    }).catch(() => null);

    if (!response?.ok) {
        return null;
    }

    return await response.json().catch(() => null);
}

async function loadCharacterChats(avatarUrl) {
    if (!avatarUrl || stCharacterChats.has(avatarUrl) || stCharacterChatsLoading.has(avatarUrl)) {
        return stCharacterChats.get(avatarUrl) ?? [];
    }

    stCharacterChatsLoading.add(avatarUrl);

    try {
        const response = await fetch('/api/daydream/st/chats', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken,
            },
            body: JSON.stringify({ avatar_url: avatarUrl }),
        });

        const chats = response.ok ? await response.json() : [];
        stCharacterChats.set(avatarUrl, Array.isArray(chats) ? chats : []);
        return stCharacterChats.get(avatarUrl) ?? [];
    } catch {
        stCharacterChats.set(avatarUrl, []);
        return [];
    } finally {
        stCharacterChatsLoading.delete(avatarUrl);
    }
}

function getStory(state = loadState()) {
    if (state.story_id) {
        return stories.find(story => Number(story.id) === Number(state.story_id)) ?? null;
    }

    if (state.custom_story) {
        return {
            title: state.story_title || '自定义故事',
            spacetime: '用户自定义',
            theme: state.custom_story,
            protagonist_setup: state.character?.name ? `${state.character.name} 的自定义主角` : '用户自定义主角',
            system_type: '按用户设定',
            custom_constraints: ['遵循用户自定义设定', '动作必须经过世界规则校验'],
            meta_theme: '自定义',
            story_class: state.story_class || '通用',
            style: '细腻沉浸',
            route: state.route || 'general_story',
            opening: state.custom_story,
        };
    }

    return null;
}

function mergeProfile(base, override) {
    return {
        ...base,
        ...(override ?? {}),
        top_stats: override?.top_stats ?? base.top_stats,
        tabs: override?.tabs ?? base.tabs,
    };
}

let getProfile = function (story) {
    let profile = structuredClone(uiProfiles['通用'] ?? { top_stats: [], tabs: [] });
    if (story?.story_class && uiProfiles[story.story_class]) {
        profile = mergeProfile(profile, structuredClone(uiProfiles[story.story_class]));
    }
    if (story?.ui_profile) {
        profile = mergeProfile(profile, story.ui_profile);
    }
    return profile;
};

let bootstrap = async function () {
    const [boot, csrf] = await Promise.all([
        fetch('/api/daydream/bootstrap').then(r => r.json()),
        fetch('/csrf-token').then(r => r.json()),
    ]);
    stories = boot.stories ?? [];
    uiProfiles = boot.uiProfiles ?? {};
    provider = boot.provider ?? {};
    csrfToken = csrf.token ?? '';
};

function render() {
    const state = loadState();
    const story = getStory(state);
    const profile = getProfile(story);
    if (syncDerivedStats(state, profile)) saveState(state);

    qs('#dd_story_title').textContent = story?.title || 'DayDream';
    qs('#dd_story_class').textContent = story?.story_class || '世界引擎';

    renderStats(profile, state);
    renderTabs(profile);
    renderContent(activeTab, state, story, profile);

    if (!story) {
        showSetup();
    }
}

function renderShell(profile, state) {
    renderStats(profile, state);
    renderTabs(profile);
}

function renderStats(profile, state) {
    qs('#dd_stats').innerHTML = (profile.top_stats ?? []).map(stat => `
        <div class="dd-stat">
            <span>${escapeHtml(stat.label)}</span>
            <b>${escapeHtml(state.stats?.[stat.key] ?? '-')}</b>
        </div>
    `).join('');
}

function renderTabs(profile) {
    const tabs = profile.tabs ?? [];
    if (!tabs.some(tab => tab.key === activeTab)) {
        activeTab = 'story';
    }

    qs('#dd_tabs').innerHTML = tabs.map(tab => `
        <button class="dd-tab ${tab.key === activeTab ? 'active' : ''}" data-tab="${escapeHtml(tab.key)}">
            <span>${escapeHtml(tab.label)}</span>
        </button>
    `).join('');

    document.querySelectorAll('.dd-tab').forEach(button => {
        button.addEventListener('click', () => {
            activeTab = button.dataset.tab;
            render();
        });
    });
}

function getTabLabel(profile, key, fallback) {
    return profile.tabs?.find(tab => tab.key === key)?.label ?? fallback;
}

let renderContent = function (tab, state, story, profile) {
    if (tab === 'story') return renderStory(state, story);
    if (tab === 'stats') return renderStatsPanel(state, profile, getTabLabel(profile, 'stats', '属性'));
    if (tab === 'relations') return renderList(getTabLabel(profile, 'relations', '人脉'), getTabListItems('relations', state, profile), '暂无明确关系变化。');
    if (tab === 'messages') return renderList(getTabLabel(profile, 'messages', '线索 / 通讯'), getTabListItems('messages', state, profile), '暂无可查看的信息。');
    if (tab === 'events') return renderList(getTabLabel(profile, 'events', '事件'), getTabListItems('events', state, profile), '暂无已触发事件。');
    if (tab === 'inventory') return renderList(getTabLabel(profile, 'inventory', '资产 / 资源'), getTabListItems('inventory', state, profile), '暂无记录资源。');
    return renderSettings(story);
};

function getTabListItems(tab, state, profile) {
    const lists = {
        relations: state.relationships ?? [],
        messages: [...(state.active_hooks ?? []), ...(state.pending_foreshadows ?? [])],
        events: [...(state.triggered_events ?? []), ...(state.important_branches ?? [])],
        inventory: state.resources ?? [],
    };
    const list = lists[tab] ?? [];
    return list.length ? list : getSnapshotItemsForTab(tab, state, profile);
}

function getSnapshotItemsForTab(tab, state, profile) {
    const tabLabel = getTabLabel(profile, tab, '');
    const snapshotKeys = {
        messages: ['clues'],
        inventory: ['supplies', 'cashflow'],
    };
    const keys = new Set(snapshotKeys[tab] ?? []);
    return (profile.top_stats ?? [])
        .filter(stat => (keys.has(stat.key) || stat.label === tabLabel) && state.stats?.[stat.key] !== undefined)
        .map(stat => ({
            name: stat.label || statLabels[stat.key] || stat.key,
            value: state.stats[stat.key],
            status: '当前快照，明细尚未生成',
        }));
}

function formatText(text) {
    return escapeHtml(text).replace(/\n{2,}/g, '<br><br>').replace(/\n/g, '<br>');
}

function renderStory(state, story) {
    const scene = state.last_scene;
    const options = state.last_options ?? [];
    qs('#dd_content').innerHTML = `
        <section class="dd-card">
            <div class="dd-kicker">${escapeHtml(story?.story_class || '未选择故事')}</div>
            <h2>${escapeHtml(scene?.title || story?.title || '尚未入局')}</h2>
            <div class="dd-screen">${formatText(scene?.screen || story?.opening || '请选择故事，或输入自定义脑洞开始。')}</div>
            <div class="dd-plot">${formatText(scene?.plot || '')}</div>
        </section>
        <section class="dd-options">
            ${options.length ? options.map(option => `
                <button class="dd-option" data-option="${option.index}">
                    <b>${option.index}</b>
                    <span>${escapeHtml(option.text)}</span>
                </button>
            `).join('') : '<div class="dd-empty">选择故事后，行动选项会出现在这里。</div>'}
        </section>
    `;

    document.querySelectorAll('.dd-option').forEach(button => {
        button.addEventListener('click', () => {
            const option = options.find(item => Number(item.index) === Number(button.dataset.option));
            if (option) selectAction(option.text);
        });
    });
}

function selectAction(text) {
    const action = String(text ?? '').trim();
    if (!action) return;
    if (isGenerating) {
        pendingAction = action;
        const input = qs('#dd_custom_action');
        if (input?.value?.trim() === action) input.value = '';
        renderPendingOption();
        showQueuedActionPopup();
        return;
    }
    sendAction(action);
}

function renderPendingOption() {
    document.querySelectorAll('.dd-option').forEach(button => {
        const isPending = button.dataset.action === pendingAction;
        button.classList.toggle('pending', isPending);
        if (isPending) button.setAttribute('aria-busy', 'true');
        else button.removeAttribute('aria-busy');
    });

    qs('#dd_queued_action')?.remove();
    if (pendingAction) {
        const options = qs('.dd-options');
        options?.insertAdjacentHTML('afterend', renderPendingAction());
    }
}

function renderPendingAction() {
    if (!pendingAction) return '';
    return '<div id="dd_queued_action" class="dd-pending-action" role="status">已选择，正在加载新场景中...</div>';
}

function showQueuedActionPopup() {
    qs('#dd_queue_popup')?.remove();
    qs('.dd-shell')?.insertAdjacentHTML('beforeend', `
        <div id="dd_queue_popup" class="dd-queue-popup" role="status">
            <b>已收到行动</b>
            <span>正在进入下一幕...</span>
        </div>
    `);
}

function hideQueuedActionPopup() {
    qs('#dd_queue_popup')?.remove();
}

function renderStatsPanel(state, profile, title) {
    const visibleStats = (profile.top_stats ?? []).map(stat => ({
        ...stat,
        value: state.stats?.[stat.key] ?? '-',
    }));

    qs('#dd_content').innerHTML = `
        <section class="dd-card">
            <h2>${escapeHtml(title)}</h2>
            ${visibleStats.length ? `<div class="dd-list">
                ${visibleStats.map(stat => `
                    <div class="dd-story-choice dd-stat-row">
                        <b>${escapeHtml(stat.label || statLabels[stat.key] || stat.key)}</b>
                        <span>${escapeHtml(stat.value)}</span>
                    </div>
                `).join('')}
            </div>` : '<div class="dd-empty">暂无状态记录。</div>'}
        </section>
    `;
}

function formatItem(item) {
    if (typeof item === 'string') return escapeHtml(item);
    if (item && typeof item === 'object') {
        const title = item.name || item.title || item.label || item.key || '记录';
        const detail = formatItemDetail(item);
        return `<b>${escapeHtml(title)}</b><span>${escapeHtml(detail || '已记录')}</span>`;
    }
    return escapeHtml(String(item ?? ''));
}

function formatItemDetail(item) {
    const labels = {
        detail: '',
        description: '',
        summary: '',
        relation: '关系',
        type: '类型',
        status: '状态',
        affinity: '好感',
        value: '数值',
        quantity: '数量',
        amount: '数量',
        count: '数量',
        owner: '归属',
        source: '来源',
        location: '位置',
        time: '时间',
        content: '内容',
        evidence: '证据',
        effect: '效果',
        risk: '风险',
        progress: '进展',
        note: '备注',
        reason: '原因',
    };
    const titleKeys = new Set(['name', 'title', 'label', 'key']);
    return Object.entries(item)
        .filter(([key, value]) => !titleKeys.has(key) && value !== undefined && value !== null && value !== '')
        .map(([key, value]) => {
            const text = Array.isArray(value) ? value.join('、') : String(value);
            const label = labels[key] ?? key;
            return label ? `${label}：${text}` : text;
        })
        .join('；');
}

function renderList(title, list, emptyText) {
    qs('#dd_content').innerHTML = `
        <section class="dd-card">
            <h2>${escapeHtml(title)}</h2>
            ${(list ?? []).length ? `<div class="dd-list">${list.map(item => `<div class="dd-story-choice">${formatItem(item)}</div>`).join('')}</div>` : `<div class="dd-empty">${escapeHtml(emptyText)}</div>`}
        </section>
    `;
}

let renderSettings = function (story) {
    qs('#dd_content').innerHTML = `
        <section class="dd-card">
            <h2>设置</h2>
            <div class="dd-list">
                <button id="dd_reset_story" class="dd-story-choice">重新选择故事</button>
                <button id="dd_end_story" class="dd-story-choice">生成结局</button>
                <button id="dd_clear_local" class="dd-story-choice">清空本地存档</button>
            </div>
            ${provider.configured ? '' : '<div class="dd-error" style="margin-top:12px;">服务器尚未配置 DayDream 模型。</div>'}
            <div class="dd-empty" style="margin-top:12px;">${escapeHtml(story?.title || '未选择故事')}</div>
        </section>
    `;
    qs('#dd_reset_story').addEventListener('click', showSetup);
    qs('#dd_end_story').addEventListener('click', () => sendAction('结束'));
    qs('#dd_clear_local').addEventListener('click', () => {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(HISTORY_KEY);
        render();
    });
};

function showSetup() {
    const state = loadState();
    qs('#dd_modal').hidden = false;
    qs('#dd_modal').innerHTML = `
        <div class="dd-dialog">
            <button id="dd_close_setup" class="dd-dialog-close" title="关闭" aria-label="关闭">×</button>
            <h2>创建角色</h2>
            <p>选择故事后直接进入第一幕。</p>
            <label>角色姓名</label>
            <input id="dd_name" type="text" value="${escapeHtml(state.character?.name || '')}" placeholder="输入角色名">
            <label>角色性别</label>
            <div class="dd-segment">
                <button class="dd-gender ${state.character?.gender !== '女' ? 'active' : ''}" data-gender="男">男</button>
                <button class="dd-gender ${state.character?.gender === '女' ? 'active' : ''}" data-gender="女">女</button>
            </div>
            <div class="dd-entry-grid">
                <button id="dd_random">随机故事</button>
                <button id="dd_preset">预设故事</button>
                <button id="dd_custom">自定义故事</button>
            </div>
            <div id="dd_picker"></div>
        </div>
    `;

    qs('#dd_close_setup').addEventListener('click', hideSetup);
    document.querySelectorAll('.dd-gender').forEach(button => {
        button.addEventListener('click', () => {
            document.querySelectorAll('.dd-gender').forEach(item => item.classList.remove('active'));
            button.classList.add('active');
        });
    });
    qs('#dd_random').addEventListener('click', () => startStory(stories[Math.floor(Math.random() * stories.length)]));
    qs('#dd_preset').addEventListener('click', renderDimensionPicker);
    qs('#dd_custom').addEventListener('click', renderCustomPicker);
}

function hideSetup() {
    qs('#dd_modal').hidden = true;
    qs('#dd_modal').innerHTML = '';
}

function getCharacterDraft() {
    return {
        name: qs('#dd_name')?.value?.trim() || '',
        gender: document.querySelector('.dd-gender.active')?.dataset.gender || '男',
        custom: {},
    };
}

function renderDimensionPicker() {
    qs('#dd_picker').innerHTML = `
        <h3>按什么类型找故事？</h3>
        <div class="dd-filter-grid">
            ${FILTER_DIMENSIONS.map(dim => `<button class="dd-dim" data-dim="${dim.key}">${dim.label}</button>`).join('')}
            <button id="dd_all">查看全部 ${stories.length} 个</button>
        </div>
    `;
    document.querySelectorAll('.dd-dim').forEach(button => button.addEventListener('click', () => renderTypePicker(button.dataset.dim)));
    qs('#dd_all').addEventListener('click', () => renderStoryPicker(stories, '全部故事'));
}

function renderTypePicker(dimension) {
    const counts = new Map();
    for (const story of stories) counts.set(story[dimension], (counts.get(story[dimension]) ?? 0) + 1);
    qs('#dd_picker').innerHTML = `
        <h3>${escapeHtml(FILTER_DIMENSIONS.find(item => item.key === dimension)?.label || dimension)}</h3>
        <div class="dd-list">
            ${[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => `
                <button class="dd-type" data-value="${escapeHtml(value)}"><span>${escapeHtml(value)}</span><b>${count}</b></button>
            `).join('')}
        </div>
    `;
    document.querySelectorAll('.dd-type').forEach(button => {
        button.addEventListener('click', () => renderStoryPicker(stories.filter(story => story[dimension] === button.dataset.value), button.dataset.value));
    });
}

function renderStoryPicker(list, title) {
    qs('#dd_picker').innerHTML = `
        <h3>${escapeHtml(title)}（${list.length}）</h3>
        <div class="dd-story-list">
            ${list.map(story => `
                <button class="dd-story-choice" data-story-id="${story.id}">
                    <b>${story.id}. ${escapeHtml(story.title)}</b>
                    <span>${escapeHtml(story.opening)}</span>
                </button>
            `).join('')}
        </div>
    `;
    document.querySelectorAll('.dd-story-choice[data-story-id]').forEach(button => {
        button.addEventListener('click', () => startStory(stories.find(story => Number(story.id) === Number(button.dataset.storyId))));
    });
}

function renderCustomPicker() {
    qs('#dd_picker').innerHTML = `
        <h3>自定义故事</h3>
        <textarea id="dd_custom_text" rows="5" placeholder="一句话告诉我：你想进入什么世界、你是谁、你最想体验什么。"></textarea>
        <button id="dd_start_custom" class="dd-primary" style="width:100%;margin-top:10px;">开始</button>
    `;
    qs('#dd_start_custom').addEventListener('click', () => {
        const text = qs('#dd_custom_text').value.trim();
        if (!text) return;
        const state = createState();
        state.story_title = '自定义故事';
        state.custom_story = text;
        state.story_class = '通用';
        state.main_objective = text;
        state.core_conflict = text;
        state.active_hooks = [text];
        state.character = getCharacterDraft();
        saveState(state);
        saveHistory([]);
        hideSetup();
        render();
        sendAction(`开始自定义 DayDream 故事：${text}`);
    });
}

function startStory(story) {
    if (!story) return;
    const state = createState();
    state.story_id = story.id;
    state.story_title = story.title;
    state.route = story.route;
    state.story_class = story.story_class;
    state.main_objective = story.opening;
    state.core_conflict = story.theme;
    state.active_hooks = [story.opening];
    state.character = getCharacterDraft();
    saveState(state);
    saveHistory([]);
    hideSetup();
    render();
    sendAction(`开始 DayDream 预设故事《${story.title}》。角色姓名：${state.character.name || '未命名'}。角色性别：${state.character.gender}。请根据当前剧本生成第一幕，直接进入事件现场。`);
}

function getSection(text, label) {
    return String(text ?? '').match(new RegExp(`【${label}】([\\s\\S]*?)(?=\\n?【[^】]+】|$)`))?.[1]?.trim() ?? '';
}

function stripDayDreamMeta(text) {
    return String(text ?? '')
        .replace(/<!--\s*DAYDREAM_META[\s\S]*?-->/gi, '')
        .replace(/<!--\s*DAYDREAM_META[\s\S]*$/i, '')
        .replace(/<daydream_meta\b[\s\S]*?<\/daydream_meta>/gi, '')
        .replace(/<daydream_meta\b[\s\S]*$/i, '')
        .trim();
}

function parseDayDreamMeta(text) {
    const source = String(text ?? '');
    const raw = source.match(/<!--\s*DAYDREAM_META\s*([\s\S]*?)\s*-->/i)?.[1]?.trim()
        ?? source.match(/<daydream_meta\b[^>]*>([\s\S]*?)<\/daydream_meta>/i)?.[1]?.trim();
    if (!raw) return null;

    try {
        return JSON.parse(raw);
    } catch {
        const json = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
        try {
            return JSON.parse(json);
        } catch {
            return null;
        }
    }
}

function normalizeOption(option, index) {
    if (typeof option === 'string') {
        return { index: index + 1, text: option.trim() };
    }
    if (option && typeof option === 'object') {
        return { index: index + 1, text: String(option.text || option.label || option.action || '').trim() };
    }
    return { index: index + 1, text: '' };
}

function parseOptions(text, meta) {
    if (Array.isArray(meta?.options)) {
        return meta.options
            .map(normalizeOption)
            .filter(option => option.text && !/自定义输入/.test(option.text))
            .slice(0, 4);
    }

    return (getSection(text, '选项') || getSection(text, '行动选项'))
        .split('\n')
        .map(line => line.match(/^\s*([1-4])[.、:：]\s*(.+?)\s*$/))
        .filter(Boolean)
        .map(match => ({ index: Number(match[1]), text: match[2].trim() }))
        .filter(option => !/自定义输入/.test(option.text))
        .slice(0, 4);
}

function formatStatusChange(change) {
    if (typeof change === 'string') return change;
    if (!change || typeof change !== 'object') return String(change ?? '');

    const key = change.key || change.stat;
    const label = change.label || statLabels[key] || key || '状态';
    const delta = Number(change.delta);
    const deltaText = Number.isFinite(delta) && delta !== 0 ? `${delta > 0 ? '+' : ''}${delta}` : '';
    const valueText = change.value !== undefined ? `（当前：${change.value}）` : '';
    const reasonText = change.reason ? ` —— ${change.reason}` : '';
    return `${label}${deltaText}${valueText}${reasonText}`;
}

function formatStatusChanges(meta, fallback) {
    if (Array.isArray(meta?.status_changes) && meta.status_changes.length) {
        return meta.status_changes.map(formatStatusChange).filter(Boolean).join('\n');
    }
    return fallback || '';
}

function parseVisibleScene(text) {
    const visibleText = stripDayDreamMeta(text);
    const hasStructuredLabels = /【(?:标题|环境|画面|剧情|选项|行动选项|结局)】/.test(visibleText);
    return {
        title: getSection(visibleText, '标题'),
        screen: getSection(visibleText, '环境') || getSection(visibleText, '画面'),
        plot: getSection(visibleText, '剧情') || getSection(visibleText, '结局') || (hasStructuredLabels ? '' : visibleText),
        options: parseOptions(visibleText, null),
    };
}

function parseReply(text) {
    const meta = parseDayDreamMeta(text);
    const ending = getSection(text, '结局');
    if (ending || meta?.is_ending) {
        const visibleEnding = ending || stripDayDreamMeta(text);
        return {
            title: getSection(text, '标题') || meta?.title || '结局',
            screen: getSection(text, '环境') || getSection(text, '画面') || meta?.screen || '',
            plot: visibleEnding,
            status: formatStatusChanges(meta, ''),
            options: [],
            isEnding: true,
            meta,
        };
    }

    const visibleText = stripDayDreamMeta(text);
    const legacyPlot = getSection(text, '剧情');
    const plot = legacyPlot || visibleText || text;
    return {
        title: getSection(text, '标题') || meta?.title || plot.split('\n').find(line => line.trim())?.slice(0, 16) || '',
        screen: getSection(text, '环境') || getSection(text, '画面') || meta?.screen,
        plot,
        status: formatStatusChanges(meta, getSection(text, '状态变化')),
        options: parseOptions(text, meta),
        isEnding: Boolean(meta?.is_ending),
        meta,
    };
}

function applyStatusText(state, status) {
    if (!status) return;
    for (const [key, label] of Object.entries(statLabels)) {
        if (!status.includes(label) || key === 'turn_count') continue;
        const line = status.split('\n').find(item => item.includes(label)) ?? status;
        if (/[↑+＋]/.test(line)) state.stats[key] = Number(state.stats[key] ?? 0) + 1;
        if (/[↓\-－]/.test(line)) state.stats[key] = Number(state.stats[key] ?? 0) - 1;
        const number = line.match(new RegExp(`${label}[^0-9\\-－]*([\\-－]?\\d+)`));
        if (number) state.stats[key] = Number(number[1].replace('－', '-'));
    }
}

function applyStatsObject(state, stats, mode) {
    if (!stats || typeof stats !== 'object') return;
    for (const [key, value] of Object.entries(stats)) {
        const number = Number(value);
        if (!Number.isFinite(number)) continue;
        state.stats[key] = mode === 'delta' ? Number(state.stats[key] ?? 0) + number : number;
    }
}

function toRecordList(value) {
    if (!Array.isArray(value)) return [];
    return value
        .map(item => {
            if (typeof item === 'string') return item.trim();
            if (item && typeof item === 'object') return item;
            return '';
        })
        .filter(Boolean);
}

function prependRecords(current, incoming, limit = 20) {
    const records = [...toRecordList(incoming), ...(current ?? [])];
    const seen = new Set();
    return records.filter(item => {
        const key = typeof item === 'string' ? item : JSON.stringify(item);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    }).slice(0, limit);
}

function syncDerivedStats(state, profile) {
    let changed = false;
    const topKeys = new Set((profile?.top_stats ?? []).map(stat => stat.key));
    if (topKeys.has('clues')) {
        const clues = prependRecords([], [...(state.active_hooks ?? []), ...(state.pending_foreshadows ?? [])], 999).length;
        if (state.stats.clues !== clues) {
            state.stats.clues = clues;
            changed = true;
        }
    }
    return changed;
}

function applyMetaUpdates(state, meta, profile) {
    if (!meta || typeof meta !== 'object') return;

    applyStatsObject(state, meta.stats_delta, 'delta');
    applyStatsObject(state, meta.stats, 'absolute');
    if (Array.isArray(meta.status_changes)) {
        for (const change of meta.status_changes) {
            if (!change || typeof change !== 'object') continue;
            const key = change.key || change.stat;
            if (!key) continue;
            if (change.value !== undefined) {
                applyStatsObject(state, { [key]: change.value }, 'absolute');
            } else if (change.delta !== undefined) {
                applyStatsObject(state, { [key]: change.delta }, 'delta');
            }
        }
    }

    state.relationships = prependRecords(state.relationships, meta.relationships);
    state.resources = prependRecords(state.resources, meta.resources);
    state.triggered_events = prependRecords(state.triggered_events, meta.events);
    state.active_hooks = prependRecords(state.active_hooks, meta.active_hooks);
    state.pending_foreshadows = prependRecords(state.pending_foreshadows, meta.pending_foreshadows);
    state.important_branches = prependRecords(state.important_branches, meta.important_branches);
    syncDerivedStats(state, profile);
}

function renderStreamingReply(story, text) {
    if (activeTab !== 'story') return;

    const scene = parseVisibleScene(text);
    const optionsReady = scene.options.length >= 4;
    const optionHtml = scene.options.length
        ? `<section class="dd-options">${scene.options.map(option => `
            <button class="dd-option ${option.text === pendingAction ? 'pending' : ''}" data-action="${escapeHtml(option.text)}" ${optionsReady ? '' : 'disabled'}>
                <b>${option.index}</b>
                <span>${escapeHtml(option.text)}</span>
            </button>
        `).join('')}</section>`
        : '';

    qs('#dd_content').innerHTML = `
        <section class="dd-card">
            <div class="dd-kicker">${escapeHtml(story?.story_class || '生成中')}</div>
            ${scene.title ? `<h2>${escapeHtml(scene.title)}</h2>` : ''}
            ${scene.screen ? `<div class="dd-screen">${formatText(scene.screen)}</div>` : ''}
            ${scene.plot ? `<div class="dd-plot">${formatText(scene.plot)}</div>` : '<div class="dd-empty">DayDream 正在生成下一幕...</div>'}
        </section>
        ${optionHtml}
        ${renderPendingAction()}
    `;

    document.querySelectorAll('.dd-option[data-action]').forEach(button => {
        button.addEventListener('click', () => selectAction(button.dataset.action));
    });
}

async function readDayDreamStream(response, onDelta) {
    const contentType = response.headers.get('content-type') ?? '';
    if (!response.body || !contentType.includes('text/event-stream')) {
        const data = await response.json();
        return {
            text: data?.text ?? data?.choices?.[0]?.message?.content ?? '',
            model: data?.model ?? '',
        };
    }

    const eventStream = new EventSourceStream();
    response.body.pipeThrough(eventStream);
    const reader = eventStream.readable.getReader();
    let fullText = '';
    let model = response.headers.get('x-daydream-model') || '';

    while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const rawData = value.data;
        if (rawData === '[DONE]') break;

        const payload = JSON.parse(rawData);
        if (payload?.error) {
            throw new Error(payload.error?.message || payload.error || '生成失败');
        }

        const choice = payload?.choices?.[0];
        const delta = choice?.delta?.content ?? choice?.message?.content ?? choice?.text ?? '';
        model ||= payload?.model ?? '';
        if (!delta) continue;

        fullText += delta;
        onDelta(fullText);
    }

    return { text: fullText, model };
}

let sendAction = async function (text) {
    const message = String(text ?? '').trim();
    if (!message) return;

    const state = loadState();
    const story = getStory(state);
    const profile = getProfile(story);
    if (isGenerating) {
        pendingAction = message;
        qs('#dd_custom_action').value = '';
        renderPendingOption();
        showQueuedActionPopup();
        return;
    }
    if (!story) {
        showSetup();
        return;
    }

    if (!provider.configured) {
        renderError('服务器尚未配置 DayDream 模型。请让管理员设置 DAYDREAM_API_KEY。');
        return;
    }

    qs('#dd_custom_action').value = '';
    hideQueuedActionPopup();
    isGenerating = true;
    qs('#daydream_public_app').classList.add('dd-loading');
    if (activeTab === 'story') renderStreamingReply(story, '');

    let completed = false;
    try {
        const history = loadHistory();
        const response = await fetch('/api/daydream/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'text/event-stream',
                'X-CSRF-Token': csrfToken,
            },
            body: JSON.stringify({
                session_id: state.session_id,
                st_context: state.st_context ?? {},
                story,
                state,
                message,
                history,
            }),
        });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || '生成失败');
        }

        const sessionId = response.headers.get('x-daydream-session-id');
        if (sessionId) {
            state.session_id = sessionId;
        }
        const avatarUrl = response.headers.get('x-daydream-avatar-url');
        const chatName = response.headers.get('x-daydream-chat-name');
        if (avatarUrl || chatName) {
            state.st_context = {
                ...createDefaultStContext(),
                ...(state.st_context ?? {}),
                ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
                ...(chatName ? { chat_name: chatName } : {}),
            };
        }
        let lastPaint = 0;
        const data = await readDayDreamStream(response, (streamText) => {
            const now = Date.now();
            if (now - lastPaint < 50) return;
            lastPaint = now;
            if (activeTab === 'story') renderStreamingReply(story, streamText);
        });

        const scene = parseReply(data.text);
        state.last_scene = {
            title: scene.title || story.title || '剧情推进',
            screen: scene.screen,
            plot: scene.plot,
        };
        state.last_status_text = scene.status;
        state.last_options = scene.options;
        state.near_ending = scene.isEnding;
        state.stats.turn_count = Number(state.stats.turn_count || 0) + (scene.isEnding ? 0 : 1);
        if (scene.meta) {
            applyMetaUpdates(state, scene.meta, profile);
        } else {
            applyStatusText(state, scene.status);
            if (scene.status) state.triggered_events = [scene.status, ...(state.triggered_events ?? [])].slice(0, 20);
            syncDerivedStats(state, profile);
        }

        const nextHistory = [...history, { role: 'user', content: message }, { role: 'assistant', content: stripDayDreamMeta(data.text) || scene.plot }];
        saveHistory(nextHistory);
        saveState(state);
        await syncSession(state, nextHistory).catch(() => null);
        if (activeTab === 'story') render();
        else renderShell(profile, state);
        completed = true;
    } catch (error) {
        pendingAction = '';
        hideQueuedActionPopup();
        renderError(error.message || '生成失败');
    } finally {
        isGenerating = false;
        qs('#daydream_public_app').classList.remove('dd-loading');
        if (completed && pendingAction) {
            const action = pendingAction;
            pendingAction = '';
            sendAction(action);
        }
    }
};

function renderError(message) {
    qs('#dd_content').innerHTML = `<section class="dd-card"><div class="dd-error">${escapeHtml(message)}</div></section>`;
}

getProfile = function (story) {
    let profile = getDefaultProfile();
    if (story?.story_class && uiProfiles[story.story_class]) {
        profile = mergeProfile(profile, structuredClone(uiProfiles[story.story_class]));
    }
    if (story?.ui_profile) {
        profile = mergeProfile(profile, story.ui_profile);
    }
    return profile;
};

bootstrap = async function () {
    const [boot, csrf] = await Promise.all([
        fetch('/api/daydream/bootstrap').then(r => r.json()),
        fetch('/csrf-token').then(r => r.json()),
    ]);

    stories = boot.stories ?? [];
    uiProfiles = boot.uiProfiles ?? {};
    provider = boot.provider ?? {};
    sillyTavern = boot.sillyTavern ?? { available: false, characters: [], world_names: [] };
    csrfToken = csrf.token ?? '';

    await restoreSessionFromServer();

    const restoredState = loadState();
    if (restoredState.st_context?.avatar_url) {
        await loadCharacterChats(restoredState.st_context.avatar_url);
    }
};

renderContent = function (tab, state, story, profile) {
    if (tab === 'story') return renderStory(state, story);
    if (tab === 'stats') return renderStatsPanel(state, profile, getTabLabel(profile, 'stats', 'Stats'));
    if (tab === 'relations') return renderList(getTabLabel(profile, 'relations', 'Relations'), getTabListItems('relations', state, profile), 'No relation updates yet.');
    if (tab === 'messages') return renderList(getTabLabel(profile, 'messages', 'Messages'), getTabListItems('messages', state, profile), 'No clues or messages yet.');
    if (tab === 'events') return renderList(getTabLabel(profile, 'events', 'Events'), getTabListItems('events', state, profile), 'No events recorded yet.');
    if (tab === 'inventory') return renderList(getTabLabel(profile, 'inventory', 'Inventory'), getTabListItems('inventory', state, profile), 'No resources recorded yet.');
    return renderSettings(state, story);
};

renderSettings = function (state, story) {
    const stContext = { ...createDefaultStContext(), ...(state.st_context ?? {}) };
    const avatarUrl = stContext.avatar_url || '';
    const chats = avatarUrl ? (stCharacterChats.get(avatarUrl) ?? []) : [];
    const isLoadingChats = avatarUrl && stCharacterChatsLoading.has(avatarUrl);
    const selectedWorlds = new Set(Array.isArray(stContext.world_info_names) ? stContext.world_info_names : []);

    if (avatarUrl && !stCharacterChats.has(avatarUrl) && !stCharacterChatsLoading.has(avatarUrl)) {
        loadCharacterChats(avatarUrl).then(() => render()).catch(() => null);
    }

    qs('#dd_content').innerHTML = `
        <section class="dd-card">
            <h2>Settings</h2>
            <div class="dd-list">
                <button id="dd_reset_story" class="dd-story-choice">Choose another story</button>
                <button id="dd_end_story" class="dd-story-choice">Generate ending</button>
                <button id="dd_clear_local" class="dd-story-choice">Clear local state</button>
            </div>
            ${provider.configured ? '' : '<div class="dd-error" style="margin-top:12px;">No DayDream model is available yet.</div>'}
            <div class="dd-empty" style="margin-top:12px;">${escapeHtml(story?.title || 'No active story')}</div>
        </section>
        <section class="dd-card" style="margin-top:14px;">
            <h2>SillyTavern Backend</h2>
            ${sillyTavern.available ? `
                <div class="dd-settings-form">
                    <label for="dd_st_character">Character card</label>
                    <select id="dd_st_character">
                        <option value="">None</option>
                        ${(sillyTavern.characters ?? []).map(character => `
                            <option value="${escapeHtml(character.avatar_url)}" ${character.avatar_url === avatarUrl ? 'selected' : ''}>
                                ${escapeHtml(character.name)}
                            </option>
                        `).join('')}
                    </select>

                    <label for="dd_st_chat">Chat history</label>
                    <select id="dd_st_chat" ${avatarUrl ? '' : 'disabled'}>
                        <option value="">${isLoadingChats ? 'Loading chats...' : 'Create or use current DayDream chat'}</option>
                        ${chats.map(chat => `
                            <option value="${escapeHtml(chat.file_id || chat.file_name || '')}" ${(chat.file_id || chat.file_name || '') === stContext.chat_name ? 'selected' : ''}>
                                ${escapeHtml(chat.file_id || chat.file_name || '')}
                            </option>
                        `).join('')}
                    </select>

                    <label for="dd_st_worlds">World Info</label>
                    <select id="dd_st_worlds" multiple size="${Math.min(Math.max((sillyTavern.world_names ?? []).length, 3), 8)}">
                        ${(sillyTavern.world_names ?? []).map(worldName => `
                            <option value="${escapeHtml(worldName)}" ${selectedWorlds.has(worldName) ? 'selected' : ''}>
                                ${escapeHtml(worldName)}
                            </option>
                        `).join('')}
                    </select>

                    <label for="dd_st_system_prompt">System prompt override</label>
                    <textarea id="dd_st_system_prompt" rows="4" placeholder="Optional">${escapeHtml(stContext.system_prompt || '')}</textarea>

                    <label for="dd_st_author_note">Author's Note override</label>
                    <textarea id="dd_st_author_note" rows="4" placeholder="Optional">${escapeHtml(stContext.author_note || '')}</textarea>

                    <div class="dd-settings-actions">
                        <button id="dd_save_st_bindings" class="dd-primary">Save ST bindings</button>
                        <button id="dd_clear_st_bindings">Clear ST bindings</button>
                    </div>

                    <div class="dd-hint">
                        DayDream keeps the frontend. SillyTavern handles character card, chat history, world info, system prompt, and note injection behind the scenes.
                    </div>
                </div>
            ` : `
                <div class="dd-empty">Log in to use SillyTavern-backed character cards, chat history, and world info from DayDream.</div>
            `}
        </section>
    `;

    qs('#dd_reset_story').addEventListener('click', showSetup);
    qs('#dd_end_story').addEventListener('click', () => sendAction('结束'));
    qs('#dd_clear_local').addEventListener('click', () => {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(HISTORY_KEY);
        render();
    });

    if (!sillyTavern.available) {
        return;
    }

    qs('#dd_st_character')?.addEventListener('change', async (event) => {
        const nextState = loadState();
        nextState.st_context = {
            ...createDefaultStContext(),
            ...(nextState.st_context ?? {}),
            avatar_url: event.target.value || '',
            chat_name: '',
        };
        saveState(nextState);
        if (event.target.value) {
            await loadCharacterChats(event.target.value);
        }
        render();
    });

    qs('#dd_save_st_bindings')?.addEventListener('click', async () => {
        const nextState = loadState();
        nextState.st_context = {
            ...createDefaultStContext(),
            ...(nextState.st_context ?? {}),
            avatar_url: qs('#dd_st_character')?.value || '',
            chat_name: qs('#dd_st_chat')?.value || '',
            world_info_names: Array.from(qs('#dd_st_worlds')?.selectedOptions ?? []).map(option => option.value).filter(Boolean),
            system_prompt: qs('#dd_st_system_prompt')?.value?.trim() || '',
            author_note: qs('#dd_st_author_note')?.value?.trim() || '',
        };
        saveState(nextState);
        await syncSession(nextState);
        render();
    });

    qs('#dd_clear_st_bindings')?.addEventListener('click', async () => {
        const nextState = loadState();
        nextState.st_context = createDefaultStContext();
        saveState(nextState);
        await syncSession(nextState);
        render();
    });
};

sendAction = async function (text) {
    const message = String(text ?? '').trim();
    if (!message) return;

    const state = loadState();
    const story = getStory(state);
    const profile = getProfile(story);
    if (isGenerating) {
        pendingAction = message;
        qs('#dd_custom_action').value = '';
        renderPendingOption();
        showQueuedActionPopup();
        return;
    }
    if (!story) {
        showSetup();
        return;
    }

    if (!provider.configured) {
        renderError('No model is configured for DayDream yet.');
        return;
    }

    qs('#dd_custom_action').value = '';
    hideQueuedActionPopup();
    isGenerating = true;
    qs('#daydream_public_app').classList.add('dd-loading');
    if (activeTab === 'story') renderStreamingReply(story, '');

    let completed = false;
    try {
        const history = loadHistory();
        const response = await fetch('/api/daydream/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'text/event-stream',
                'X-CSRF-Token': csrfToken,
            },
            body: JSON.stringify({
                session_id: state.session_id,
                st_context: state.st_context ?? {},
                story,
                state,
                message,
                history,
            }),
        });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'Generation failed.');
        }

        const sessionId = response.headers.get('x-daydream-session-id');
        if (sessionId) {
            state.session_id = sessionId;
        }

        let lastPaint = 0;
        const data = await readDayDreamStream(response, (streamText) => {
            const now = Date.now();
            if (now - lastPaint < 50) return;
            lastPaint = now;
            if (activeTab === 'story') renderStreamingReply(story, streamText);
        });

        const scene = parseReply(data.text);
        state.last_scene = {
            title: scene.title || story.title || 'Story Progress',
            screen: scene.screen,
            plot: scene.plot,
        };
        state.last_status_text = scene.status;
        state.last_options = scene.options;
        state.near_ending = scene.isEnding;
        state.stats.turn_count = Number(state.stats.turn_count || 0) + (scene.isEnding ? 0 : 1);
        if (scene.meta) {
            applyMetaUpdates(state, scene.meta, profile);
        } else {
            applyStatusText(state, scene.status);
            if (scene.status) state.triggered_events = [scene.status, ...(state.triggered_events ?? [])].slice(0, 20);
            syncDerivedStats(state, profile);
        }

        const nextHistory = [...history, { role: 'user', content: message }, { role: 'assistant', content: stripDayDreamMeta(data.text) || scene.plot }];
        saveHistory(nextHistory);

        const remoteSession = state.session_id ? await fetchSession(state.session_id) : null;
        if (remoteSession?.st_context) {
            state.st_context = {
                ...createDefaultStContext(),
                ...(state.st_context ?? {}),
                ...(remoteSession.st_context ?? {}),
            };

            if (state.st_context.avatar_url) {
                await loadCharacterChats(state.st_context.avatar_url);
            }
        }

        saveState(state);
        await syncSession(state, nextHistory).catch(() => null);
        if (activeTab === 'story') render();
        else renderShell(profile, state);
        completed = true;
    } catch (error) {
        pendingAction = '';
        hideQueuedActionPopup();
        renderError(error.message || 'Generation failed.');
    } finally {
        isGenerating = false;
        qs('#daydream_public_app').classList.remove('dd-loading');
        if (completed && pendingAction) {
            const action = pendingAction;
            pendingAction = '';
            sendAction(action);
        }
    }
};

qs('#dd_open_setup').addEventListener('click', showSetup);
qs('#dd_send_action').addEventListener('click', () => selectAction(qs('#dd_custom_action').value));
qs('#dd_custom_action').addEventListener('keydown', event => {
    if (event.key === 'Enter') {
        event.preventDefault();
        selectAction(qs('#dd_custom_action').value);
    }
});

try {
    await bootstrap();
    render();
} catch (error) {
    renderError(`DayDream 启动失败：${error.message}`);
}
