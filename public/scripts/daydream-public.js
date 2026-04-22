import EventSourceStream from './sse-core-stream.js';

// Maintainer note: the public DayDreamer page is the active product surface.
// The legacy extension page under /scripts/extensions/third-party/daydream/ is deprecated.
// New story-library or UX work should land here instead of the deprecated extension entry.

const STORAGE_KEY = 'DayDreamer_public_state_v1';
const HISTORY_KEY = 'DayDreamer_public_history_v1';
const MAX_VISIBLE_HISTORY = 0;

const SPACETIME_TAGS = ['历史现实', '当代现实', '近未来科幻', '远未来星际', '架空古代', '奇幻异界', '末日废土', '校园都市', '多元宇宙'];
const THEME_TAGS = ['权谋', '商战', '悬疑', '生存', '情感', '成长', '逆袭', '经营', '职场', '冒险', '战争', '校园', '医疗', '娱乐'];
const ROUTE_LABELS = {
    general_story: '通用稳健',
    short_drama: '短剧强反馈',
    immersive_novel: '沉浸细节',
    romance_tension: '情感拉扯',
    suspense_investigation: '悬疑调查',
    power_game: '权谋博弈',
    healing_growth: '治愈成长',
};
const COVER_PALETTES = [
    ['#245a53', '#9b6b41', '#eef4ed'],
    ['#374f86', '#c26d3d', '#f7efe3'],
    ['#6b3f67', '#d39c49', '#f6eef4'],
    ['#244b5a', '#7ca982', '#eef6f3'],
    ['#5b3a2e', '#b85c38', '#fbf0df'],
    ['#25304f', '#7f8bc8', '#edf0fb'],
    ['#405d3d', '#d2a24c', '#f2f5e8'],
    ['#703d4b', '#d7837f', '#faeeee'],
    ['#2f4f4a', '#d1b45f', '#f5f2df'],
];
const GENDER_OPTIONS = ['男', '女', '不限定'];

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
let csrfToken = '';
let activeTab = 'story';
let isGenerating = false;
let pendingAction = '';
let currentView = null;
let libraryFilters = { spacetime: '', theme: '' };
let selectedStoryDraft = null;
let customStoryRequestId = 0;

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

function hashString(value) {
    return [...String(value ?? '')].reduce((hash, char) => ((hash << 5) - hash + char.charCodeAt(0)) | 0, 0);
}

function compactText(value, maxLength = 42) {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function classifySpacetime(story) {
    const text = `${story?.spacetime ?? ''} ${story?.theme ?? ''} ${story?.story_class ?? ''}`;
    if (/多元|宇宙缝隙|交汇|记忆交易/.test(text)) return '多元宇宙';
    if (/远未来|星港|星海|星际|宇宙|自由星港/.test(text)) return '远未来星际';
    if (/近未来|算法|数据|生物|科技|巨型城市|极地物流|自由星港/.test(text)) return '近未来科幻';
    if (/高魔|魔法|秘库|奇幻|异界|学院高塔/.test(text)) return '奇幻异界';
    if (/末日|后末日|崩溃|灾|封锁|气候异常|废土/.test(text)) return '末日废土';
    if (/学校|校园|高中|大学|书院|寄宿/.test(text)) return '校园都市';
    if (/架空古代|王朝|深宫|边塞|都城|古代|清末|盐运/.test(text)) return '架空古代';
    if (/193|198|199|197|2003|近代|租界|码头|历史|战时/.test(text)) return '历史现实';
    return '当代现实';
}

function classifyTheme(story) {
    const text = `${story?.story_class ?? ''} ${story?.theme ?? ''} ${story?.meta_theme ?? ''} ${story?.route ?? ''}`;
    if (/商|金融|审计|电商|现金|市场|集团|经营/.test(text)) return /经营|积累/.test(text) ? '经营' : '商战';
    if (/权|站队|体系|宫|博弈|筹码|官署/.test(text)) return '权谋';
    if (/悬疑|追查|旧案|线索|真相|案|异常|烧脑/.test(text)) return '悬疑';
    if (/危机|求生|雪灾|末日|物资|崩溃|封锁|生存/.test(text)) return '生存';
    if (/情感|好感|拉扯|社交季|关系/.test(text)) return '情感';
    if (/治愈|成长|校园|高中|少年/.test(text)) return /校园|高中|大学/.test(text) ? '校园' : '成长';
    if (/打脸|逆袭|翻身/.test(text)) return '逆袭';
    if (/职场|公司|运营|行业|新人|工位/.test(text)) return '职场';
    if (/冒险|边境|探索|星海|口岸/.test(text)) return '冒险';
    if (/战|军|边塞|中立都市/.test(text)) return '战争';
    if (/医院|医生|住院|医疗/.test(text)) return '医疗';
    if (/娱乐|短剧|镜头|主演|戏院|直播/.test(text)) return '娱乐';
    return story?.story_class === '经营积累' ? '经营' : '成长';
}

function getStoryTags(story) {
    return [
        classifySpacetime(story),
        classifyTheme(story),
        story?.story_class,
    ].filter(Boolean);
}

function getRouteLabel(route) {
    return ROUTE_LABELS[route] ?? route ?? ROUTE_LABELS.general_story;
}

function getCoverPalette(story) {
    const index = Math.abs(hashString(story?.title || story?.opening || story?.theme)) % COVER_PALETTES.length;
    return COVER_PALETTES[index];
}

function getCoverStyle(story) {
    const [a, b, c] = getCoverPalette(story);
    return `--cover-a:${a};--cover-b:${b};--cover-c:${c};`;
}

function normalizeGender(value) {
    return GENDER_OPTIONS.includes(value) ? value : '男';
}

function renderGenderOptions(selectedGender) {
    const activeGender = normalizeGender(selectedGender);
    return GENDER_OPTIONS.map(gender => `
        <button
            type="button"
            class="dd-gender ${gender === activeGender ? 'active' : ''}"
            data-gender="${escapeHtml(gender)}"
            aria-pressed="${gender === activeGender ? 'true' : 'false'}"
        >
            ${escapeHtml(gender)}
        </button>
    `).join('');
}

function getWorldview(story) {
    const explicitWorldview = String(story?.worldview ?? '').trim();
    if (explicitWorldview) {
        return explicitWorldview;
    }

    const constraints = (story?.custom_constraints ?? []).filter(Boolean).join('；');
    const lines = [
        `这是一个发生在${story?.spacetime || '未知时空'}的故事。${story?.theme ? `核心矛盾围绕${story.theme}展开。` : ''}`,
        `${story?.protagonist_setup ? `你将以${story.protagonist_setup}的身份入局。` : ''}${story?.opening ? `第一幕从“${story.opening.replace(/^开场：?/, '')}”开始。` : ''}`,
        constraints ? `世界规则：${constraints}。` : '',
        `${story?.style ? `叙事风格偏向${story.style}。` : ''}${story?.system_type && story.system_type !== '无' ? `机制：${story.system_type}。` : ''}`,
    ].filter(Boolean);
    return lines.join('\n\n');
}

function renderTagPills(tags) {
    return tags.map(tag => `<span class="dd-tag-pill">${escapeHtml(tag)}</span>`).join('');
}

function setShellMode(mode) {
    const shell = qs('.dd-shell');
    shell?.classList.toggle('dd-preplay', mode !== 'play');
    shell?.classList.toggle('dd-playing', mode === 'play');
    qs('#dd_stats').hidden = mode !== 'play';
    qs('#dd_custom_action').closest('.dd-action-bar').hidden = mode !== 'play';
    qs('#dd_tabs').hidden = mode !== 'play';
    qs('#dd_quick_random').hidden = mode === 'play';
    qs('#dd_quick_custom').hidden = mode === 'play';
    qs('#dd_open_setup').hidden = mode !== 'play';
}

function renderHeader(title, subtitle, mode = 'preplay') {
    const titleElement = qs('#dd_story_title');
    titleElement.textContent = title || '';
    titleElement.hidden = !title;
    qs('#dd_story_class').textContent = subtitle || '世界引擎';
    setShellMode(mode);
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
        custom_story_data: null,
        route: 'general_story',
        story_class: '',
        st_context: createDefaultStContext(),
        character: { name: '', gender: '男', custom: {} },
        stats: { ...defaultStats },
        relationships: [],
        world_entries: [],
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
            st_context: createDefaultStContext(),
            stats: { ...defaultStats, ...(saved?.stats ?? {}) },
            character: { name: '', gender: '男', custom: {}, ...(saved?.character ?? {}) },
            relationships: toRecordList(saved?.relationships),
            world_entries: normalizeWorldEntries(saved?.world_entries),
        };
    } catch {
        return createState();
    }
}

function saveState(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function saveHistory(history) {
    if (MAX_VISIBLE_HISTORY <= 0) {
        localStorage.removeItem(HISTORY_KEY);
        return;
    }

    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-MAX_VISIBLE_HISTORY)));
}

async function fetchSession(sessionId) {
    if (!sessionId || !csrfToken) {
        return null;
    }

    const response = await fetch('/api/DayDreamer/session/get', {
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
        st_context: createDefaultStContext(),
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
        relationships: normalizePeople(session.state?.relationships),
        world_entries: normalizeWorldEntries(session.state?.world_entries),
    };

    saveState(restoredState);
    saveHistory([]);
}

async function syncSession(state, history = []) {
    if (!state?.session_id || !csrfToken) {
        return null;
    }

    const response = await fetch('/api/DayDreamer/session/save', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({
            session_id: state.session_id,
            st_context: createDefaultStContext(),
            state,
            history: [],
        }),
    }).catch(() => null);

    if (!response?.ok) {
        return null;
    }

    return await response.json().catch(() => null);
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
            ...(state.custom_story_data ?? {}),
            is_custom: true,
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
        fetch('/api/DayDreamer/bootstrap').then(r => r.json()),
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

    if (currentView === 'detail' && selectedStoryDraft) {
        return renderStoryDetail(selectedStoryDraft);
    }

    if (currentView === 'custom') {
        return renderCustomBuilder();
    }

    if (currentView === 'library' || !story) {
        return renderLibrary();
    }

    const profile = getProfile(story);
    if (syncDerivedStats(state, profile)) saveState(state);

    renderHeader(story?.title || 'DayDreamer', story?.story_class || '世界引擎', 'play');

    renderStats(profile, state);
    renderTabs(profile);
    renderContent(activeTab, state, story, profile);
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
    const tabs = getProductTabs(profile);
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
    return getProductTabs(profile).find(tab => tab.key === key)?.label ?? fallback;
}

function getPersonMetricLabel(profile, story) {
    const statKeys = new Set((profile?.top_stats ?? []).map(stat => stat.key));
    const storyClass = story?.story_class || '';

    if (statKeys.has('affection')) return statKeys.has('tension') ? '好感 / 拉扯' : '好感';
    if (statKeys.has('trust_level')) return '信任 / 立场';
    if (statKeys.has('leverage')) return '筹码 / 立场';
    if (statKeys.has('prestige')) return '声望 / 阵营';
    if (statKeys.has('clues')) return '嫌疑 / 可信度';
    if (statKeys.has('supplies')) return '协作 / 可靠度';
    if (statKeys.has('cashflow')) return '合作 / 价值';
    if (/权谋|打脸|经营/.test(storyClass)) return '立场 / 价值';
    if (/危机|求生/.test(storyClass)) return '信任 / 协作';
    if (/悬疑/.test(storyClass)) return '嫌疑 / 可信度';

    return '关系指标';
}

function getProductTabs(profile) {
    const tabs = [...(profile?.tabs ?? [])];
    const hasWorldBook = tabs.some(tab => tab.key === 'world');
    if (!hasWorldBook) {
        const settingsIndex = tabs.findIndex(tab => tab.key === 'settings');
        const worldTab = { key: 'world', label: '世界书', icon: 'book' };
        if (settingsIndex >= 0) {
            tabs.splice(settingsIndex, 0, worldTab);
        } else {
            tabs.push(worldTab);
        }
    }

    return tabs;
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

function createClientId(prefix = 'dd') {
    return globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizePersonRecord(item, index = 0) {
    if (typeof item === 'string') {
        const name = item.trim();
        return name ? { id: createClientId('person'), name, note: '', source: 'generated' } : null;
    }

    if (!item || typeof item !== 'object') {
        return null;
    }

    const name = String(item.name || item.title || item.label || item.character || item.person || '').trim();
    const note = String(item.note || item.detail || item.description || item.summary || item.content || '').trim();
    const relation = String(item.relation || item.status || item.role || '').trim();
    const affinity = item.affinity ?? item.value ?? item.trust ?? '';
    const id = String(item.id || item.uid || name || `person-${index}`).trim();

    if (!name && !note && !relation) {
        return null;
    }

    return {
        ...item,
        id: id || createClientId('person'),
        name: name || '未命名人物',
        relation,
        affinity,
        note,
    };
}

function normalizePeople(records) {
    return toRecordList(records).map(normalizePersonRecord).filter(Boolean);
}

function normalizeWorldEntry(item, index = 0) {
    if (typeof item === 'string') {
        const content = item.trim();
        return content ? {
            id: createClientId('world'),
            title: content.slice(0, 18),
            keys: [],
            content,
            enabled: true,
            source: 'generated',
        } : null;
    }

    if (!item || typeof item !== 'object') {
        return null;
    }

    const title = String(item.title || item.name || item.comment || item.key || '').trim();
    const content = String(item.content || item.detail || item.description || item.summary || '').trim();
    const rawKeys = item.keys ?? item.key ?? item.keywords ?? [];
    const keys = Array.isArray(rawKeys)
        ? rawKeys.map(key => String(key).trim()).filter(Boolean)
        : String(rawKeys).split(/[,，、]/).map(key => key.trim()).filter(Boolean);

    if (!title && !content && keys.length === 0) {
        return null;
    }

    return {
        ...item,
        id: String(item.id || item.uid || title || `world-${index}`).trim() || createClientId('world'),
        title: title || keys[0] || '未命名设定',
        keys,
        content,
        enabled: item.enabled !== false,
    };
}

function normalizeWorldEntries(records) {
    return toRecordList(records).map(normalizeWorldEntry).filter(Boolean);
}

function recordMergeKey(item) {
    return String(item?.id || item?.name || item?.title || item?.content || JSON.stringify(item)).toLowerCase();
}

function mergeNormalizedRecords(current, incoming, normalizer, limit = 40) {
    const merged = [...normalizer(incoming), ...normalizer(current)];
    const seen = new Set();
    return merged.filter(item => {
        const key = recordMergeKey(item);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    }).slice(0, limit);
}

function renderList(title, list, emptyText) {
    qs('#dd_content').innerHTML = `
        <section class="dd-card">
            <h2>${escapeHtml(title)}</h2>
            ${(list ?? []).length ? `<div class="dd-list">${list.map(item => `<div class="dd-story-choice">${formatItem(item)}</div>`).join('')}</div>` : `<div class="dd-empty">${escapeHtml(emptyText)}</div>`}
        </section>
    `;
}

function renderPeoplePanel(state, profile) {
    const title = getTabLabel(profile, 'relations', '人物');
    const story = getStory(state);
    const metricLabel = getPersonMetricLabel(profile, story);
    const people = normalizePeople(state.relationships);
    qs('#dd_content').innerHTML = `
        <section class="dd-card">
            <div class="dd-panel-title">
                <h2>${escapeHtml(title)}</h2>
                <button id="dd_add_person" class="dd-small-action" title="添加人物">添加</button>
            </div>
            <div class="dd-protagonist">
                <b>${escapeHtml(state.character?.name || '未命名主角')}</b>
                <span>${escapeHtml(state.character?.gender || '未设定')} · 主角</span>
            </div>
            ${people.length ? `<div class="dd-list">${people.map((person, index) => `
                <article class="dd-editable-row">
                    <div>
                        <b>${escapeHtml(person.name)}</b>
                        <span>${escapeHtml([person.relation, person.affinity !== '' ? `${metricLabel} ${person.affinity}` : '', person.note].filter(Boolean).join(' · ') || '人物档案')}</span>
                    </div>
                    <div class="dd-row-actions">
                        <button data-edit-person="${index}" title="编辑人物">编辑</button>
                        <button data-delete-person="${index}" title="删除人物">删除</button>
                    </div>
                </article>
            `).join('')}</div>` : '<div class="dd-empty">暂无人物档案。可以手动添加，也可以让剧情生成。</div>'}
        </section>
    `;

    qs('#dd_add_person')?.addEventListener('click', () => showPersonEditor());
    document.querySelectorAll('[data-edit-person]').forEach(button => {
        button.addEventListener('click', () => showPersonEditor(Number(button.dataset.editPerson)));
    });
    document.querySelectorAll('[data-delete-person]').forEach(button => {
        button.addEventListener('click', async () => {
            const nextState = loadState();
            const list = normalizePeople(nextState.relationships);
            list.splice(Number(button.dataset.deletePerson), 1);
            nextState.relationships = list;
            saveState(nextState);
            await syncSession(nextState);
            render();
        });
    });
}

function showPersonEditor(index = -1) {
    const state = loadState();
    const story = getStory(state);
    const profile = getProfile(story);
    const metricLabel = getPersonMetricLabel(profile, story);
    const people = normalizePeople(state.relationships);
    const person = index >= 0 ? people[index] : {};

    qs('#dd_modal').hidden = false;
    qs('#dd_modal').innerHTML = `
        <div class="dd-dialog">
            <button id="dd_close_person" class="dd-dialog-close" title="关闭" aria-label="关闭">×</button>
            <h2>${index >= 0 ? '编辑人物' : '添加人物'}</h2>
            <label for="dd_person_name">姓名</label>
            <input id="dd_person_name" type="text" value="${escapeHtml(person.name || '')}" placeholder="人物姓名">
            <label for="dd_person_relation">关系 / 立场</label>
            <input id="dd_person_relation" type="text" value="${escapeHtml(person.relation || '')}" placeholder="盟友、对手、家人、雇主...">
            <label for="dd_person_affinity">${escapeHtml(metricLabel)}</label>
            <input id="dd_person_affinity" type="text" value="${escapeHtml(person.affinity ?? '')}" placeholder="可填数字或简短描述">
            <label for="dd_person_note">备注</label>
            <textarea id="dd_person_note" rows="5" placeholder="人物背景、最近互动、隐藏动机">${escapeHtml(person.note || '')}</textarea>
            <button id="dd_save_person" class="dd-primary" style="width:100%;margin-top:14px;">保存</button>
        </div>
    `;

    qs('#dd_close_person')?.addEventListener('click', hideSetup);
    qs('#dd_save_person')?.addEventListener('click', async () => {
        const nextState = loadState();
        const list = normalizePeople(nextState.relationships);
        const draft = normalizePersonRecord({
            ...(person ?? {}),
            id: person?.id || createClientId('person'),
            name: qs('#dd_person_name')?.value?.trim() || '未命名人物',
            relation: qs('#dd_person_relation')?.value?.trim() || '',
            affinity: qs('#dd_person_affinity')?.value?.trim() || '',
            note: qs('#dd_person_note')?.value?.trim() || '',
            source: 'user',
        });
        if (index >= 0) list[index] = draft;
        else list.unshift(draft);
        nextState.relationships = list.filter(Boolean);
        saveState(nextState);
        await syncSession(nextState);
        hideSetup();
        render();
    });
}

function renderWorldBookPanel(state) {
    const entries = normalizeWorldEntries(state.world_entries);
    qs('#dd_content').innerHTML = `
        <section class="dd-card">
            <div class="dd-panel-title">
                <h2>世界书</h2>
                <button id="dd_add_world_entry" class="dd-small-action" title="添加世界书">添加</button>
            </div>
            ${entries.length ? `<div class="dd-list">${entries.map((entry, index) => `
                <article class="dd-editable-row ${entry.enabled ? '' : 'disabled'}">
                    <div>
                        <b>${escapeHtml(entry.title)}</b>
                        <span>${escapeHtml([entry.keys?.length ? `关键词：${entry.keys.join('、')}` : '', entry.content].filter(Boolean).join(' · ') || '空条目')}</span>
                    </div>
                    <div class="dd-row-actions">
                        <button data-toggle-world="${index}" title="${entry.enabled ? '停用' : '启用'}">${entry.enabled ? '停用' : '启用'}</button>
                        <button data-edit-world="${index}" title="编辑世界书">编辑</button>
                        <button data-delete-world="${index}" title="删除世界书">删除</button>
                    </div>
                </article>
            `).join('')}</div>` : '<div class="dd-empty">暂无世界书条目。剧情可以自动生成，你也可以手动添加。</div>'}
        </section>
    `;

    qs('#dd_add_world_entry')?.addEventListener('click', () => showWorldEntryEditor());
    document.querySelectorAll('[data-edit-world]').forEach(button => {
        button.addEventListener('click', () => showWorldEntryEditor(Number(button.dataset.editWorld)));
    });
    document.querySelectorAll('[data-toggle-world]').forEach(button => {
        button.addEventListener('click', async () => {
            const nextState = loadState();
            const list = normalizeWorldEntries(nextState.world_entries);
            const entry = list[Number(button.dataset.toggleWorld)];
            if (entry) entry.enabled = !entry.enabled;
            nextState.world_entries = list;
            saveState(nextState);
            await syncSession(nextState);
            render();
        });
    });
    document.querySelectorAll('[data-delete-world]').forEach(button => {
        button.addEventListener('click', async () => {
            const nextState = loadState();
            const list = normalizeWorldEntries(nextState.world_entries);
            list.splice(Number(button.dataset.deleteWorld), 1);
            nextState.world_entries = list;
            saveState(nextState);
            await syncSession(nextState);
            render();
        });
    });
}

function showWorldEntryEditor(index = -1) {
    const state = loadState();
    const entries = normalizeWorldEntries(state.world_entries);
    const entry = index >= 0 ? entries[index] : {};

    qs('#dd_modal').hidden = false;
    qs('#dd_modal').innerHTML = `
        <div class="dd-dialog">
            <button id="dd_close_world" class="dd-dialog-close" title="关闭" aria-label="关闭">×</button>
            <h2>${index >= 0 ? '编辑世界书' : '添加世界书'}</h2>
            <label for="dd_world_title">标题</label>
            <input id="dd_world_title" type="text" value="${escapeHtml(entry.title || '')}" placeholder="地点、规则、组织、物品...">
            <label for="dd_world_keys">关键词</label>
            <input id="dd_world_keys" type="text" value="${escapeHtml((entry.keys ?? []).join('、'))}" placeholder="用顿号或逗号分隔">
            <label for="dd_world_content">内容</label>
            <textarea id="dd_world_content" rows="7" placeholder="这条设定在剧情中代表什么">${escapeHtml(entry.content || '')}</textarea>
            <label class="dd-checkbox-line">
                <input id="dd_world_enabled" type="checkbox" ${entry.enabled === false ? '' : 'checked'}>
                <span>生成时启用</span>
            </label>
            <button id="dd_save_world" class="dd-primary" style="width:100%;margin-top:14px;">保存</button>
        </div>
    `;

    qs('#dd_close_world')?.addEventListener('click', hideSetup);
    qs('#dd_save_world')?.addEventListener('click', async () => {
        const nextState = loadState();
        const list = normalizeWorldEntries(nextState.world_entries);
        const draft = normalizeWorldEntry({
            ...(entry ?? {}),
            id: entry?.id || createClientId('world'),
            title: qs('#dd_world_title')?.value?.trim() || '未命名设定',
            keys: qs('#dd_world_keys')?.value?.split(/[,，、]/).map(key => key.trim()).filter(Boolean) ?? [],
            content: qs('#dd_world_content')?.value?.trim() || '',
            enabled: Boolean(qs('#dd_world_enabled')?.checked),
            source: 'user',
        });
        if (index >= 0) list[index] = draft;
        else list.unshift(draft);
        nextState.world_entries = list.filter(Boolean);
        saveState(nextState);
        await syncSession(nextState);
        hideSetup();
        render();
    });
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
            ${provider.configured ? '' : '<div class="dd-error" style="margin-top:12px;">服务器尚未配置 DayDreamer 模型。</div>'}
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
    showLibrary();
}

function hideSetup() {
    qs('#dd_modal').hidden = true;
    qs('#dd_modal').innerHTML = '';
}

function getCharacterDraft() {
    return {
        name: qs('#dd_detail_name')?.value?.trim() || qs('#dd_name')?.value?.trim() || '',
        gender: normalizeGender(document.querySelector('.dd-gender.active')?.dataset.gender),
        custom: {},
    };
}

function getFilteredStories() {
    return stories.filter(story => {
        if (libraryFilters.spacetime && classifySpacetime(story) !== libraryFilters.spacetime) return false;
        if (libraryFilters.theme && classifyTheme(story) !== libraryFilters.theme) return false;
        return true;
    });
}

function getStoryCountForFilter(type, value) {
    return stories.filter(story => {
        const matchesOwn = type === 'spacetime' ? classifySpacetime(story) === value : classifyTheme(story) === value;
        const matchesOther = type === 'spacetime'
            ? !libraryFilters.theme || classifyTheme(story) === libraryFilters.theme
            : !libraryFilters.spacetime || classifySpacetime(story) === libraryFilters.spacetime;
        return matchesOwn && matchesOther;
    }).length;
}

function renderCategoryNav(title, type, tags) {
    const chips = tags.map(tag => {
        const count = getStoryCountForFilter(type, tag);
        return `
            <button class="dd-filter-chip ${libraryFilters[type] === tag ? 'active' : ''}" data-filter-type="${type}" data-filter-value="${escapeHtml(tag)}" ${count ? '' : 'disabled'}>
                <span>${escapeHtml(tag)}</span>
                <b>${count}</b>
            </button>
        `;
    }).join('');

    return `
        <section class="dd-category">
            <div class="dd-section-title">
                <h2>${escapeHtml(title)}</h2>
                ${libraryFilters[type] ? `<button class="dd-filter-clear" data-clear-filter="${type}">清除</button>` : ''}
            </div>
            <div class="dd-chip-row" role="list">
                ${chips}
            </div>
        </section>
    `;
}

function renderStoryCard(story, index) {
    const tags = getStoryTags(story);
    return `
        <button class="dd-library-card" data-story-id="${story.id}" style="${getCoverStyle(story)}">
            <span class="dd-card-cover" aria-hidden="true">
                <span class="dd-cover-mark">${escapeHtml(String(story.title || 'D').slice(0, 2))}</span>
                <span class="dd-cover-line"></span>
                <span class="dd-cover-index">${String(index + 1).padStart(2, '0')}</span>
            </span>
            <span class="dd-library-title">${escapeHtml(story.title)}</span>
            <span class="dd-library-tags">${renderTagPills(tags.slice(0, 3))}</span>
            <span class="dd-library-opening">${escapeHtml(compactText(story.opening, 34))}</span>
        </button>
    `;
}

function renderLibrary() {
    currentView = 'library';
    selectedStoryDraft = null;
    hideSetup();
    renderHeader('', '选择一个世界进入白日梦', 'preplay');

    const list = getFilteredStories();
    qs('#dd_content').innerHTML = `
        <section class="dd-library">
            <div class="dd-library-topline">
                <span>${list.length} / ${stories.length} 个故事</span>
                ${(libraryFilters.spacetime || libraryFilters.theme) ? '<button id="dd_clear_filters" class="dd-filter-clear">全部故事</button>' : ''}
            </div>
            ${renderCategoryNav('主题分类', 'theme', THEME_TAGS)}
            ${renderCategoryNav('时空分类', 'spacetime', SPACETIME_TAGS)}
            <section class="dd-story-grid" aria-label="故事库">
                ${list.map((story, index) => renderStoryCard(story, index)).join('') || '<div class="dd-empty">这个组合暂时没有故事。</div>'}
            </section>
        </section>
    `;

    qs('#dd_clear_filters')?.addEventListener('click', () => {
        libraryFilters = { spacetime: '', theme: '' };
        renderLibrary();
    });
    document.querySelectorAll('[data-clear-filter]').forEach(button => {
        button.addEventListener('click', () => {
            libraryFilters[button.dataset.clearFilter] = '';
            renderLibrary();
        });
    });
    document.querySelectorAll('.dd-filter-chip').forEach(button => {
        button.addEventListener('click', () => {
            const type = button.dataset.filterType;
            const value = button.dataset.filterValue;
            libraryFilters[type] = libraryFilters[type] === value ? '' : value;
            renderLibrary();
        });
    });
    document.querySelectorAll('.dd-library-card').forEach(button => {
        button.addEventListener('click', () => {
            const story = stories.find(item => Number(item.id) === Number(button.dataset.storyId));
            renderStoryDetail(story);
        });
    });
}

function showLibrary() {
    currentView = 'library';
    renderLibrary();
}

function pickRandomStory() {
    const pool = getFilteredStories();
    return pool[Math.floor(Math.random() * pool.length)] ?? stories[Math.floor(Math.random() * stories.length)];
}

function showRandomStoryDetail() {
    const story = pickRandomStory();
    if (story) renderStoryDetail(story);
}

function getStoryInfoRows(story) {
    return [
        ['主角身份', story?.protagonist_setup || '由玩家昵称进入故事'],
        ['世界机制', story?.system_type && story.system_type !== '无' ? story.system_type : 'DayDreamer 动态推演'],
        ['开局事件', story?.opening || '由设定生成第一幕'],
        ['叙事路线', getRouteLabel(story?.route || 'general_story')],
    ];
}

function renderStoryDetail(story) {
    if (!story) return renderLibrary();
    currentView = 'detail';
    selectedStoryDraft = story;
    hideSetup();
    renderHeader(story.title || '故事详情', story.story_class || '世界引擎', 'preplay');

    const saved = loadState();
    const detailImage = String(story?.detail_image || '').trim();
    const detailImageAlt = String(story?.detail_image_alt || story?.title || '故事详情图').trim();
    qs('#dd_content').innerHTML = `
        <section class="dd-detail">
            <button id="dd_back_library" class="dd-text-button">返回故事库</button>
            <div class="dd-detail-cover" style="${getCoverStyle(story)}">
                <div class="dd-cover-mark">${escapeHtml(String(story.title || 'D').slice(0, 2))}</div>
                <div class="dd-detail-cover-copy">
                    <span>${escapeHtml(classifySpacetime(story))}</span>
                    <h2>${escapeHtml(story.title || '自定义故事')}</h2>
                </div>
            </div>
            <div class="dd-detail-tags">${renderTagPills(getStoryTags(story))}</div>
            ${detailImage ? `
                <section class="dd-detail-image-card">
                    <img
                        class="dd-detail-image"
                        src="${escapeHtml(detailImage)}"
                        alt="${escapeHtml(detailImageAlt)}"
                        loading="lazy"
                        onerror="this.closest('.dd-detail-image-card')?.remove()"
                    >
                </section>
            ` : ''}
            <section class="dd-detail-section">
                <h2>世界观</h2>
                <div class="dd-screen">${formatText(getWorldview(story))}</div>
            </section>
            <section class="dd-info-grid">
                ${getStoryInfoRows(story).map(([label, value]) => `
                    <div class="dd-info-item">
                        <span>${escapeHtml(label)}</span>
                        <b>${escapeHtml(value)}</b>
                    </div>
                `).join('')}
            </section>
            <section class="dd-start-panel">
                <label for="dd_detail_name">昵称</label>
                <input id="dd_detail_name" type="text" value="${escapeHtml(saved.character?.name || '')}" placeholder="输入你在故事里的名字">
                <div class="dd-field-group">
                    <span>性别</span>
                    <div class="dd-gender-group" role="group" aria-label="用户性别">
                        ${renderGenderOptions(saved.character?.gender)}
                    </div>
                </div>
                <button id="dd_start_detail" class="dd-primary">开始体验</button>
            </section>
        </section>
    `;

    qs('#dd_back_library')?.addEventListener('click', showLibrary);
    qs('#dd_start_detail')?.addEventListener('click', () => startStory(story));
    document.querySelectorAll('.dd-gender').forEach(button => {
        button.addEventListener('click', () => {
            document.querySelectorAll('.dd-gender').forEach(item => {
                const isActive = item === button;
                item.classList.toggle('active', isActive);
                item.setAttribute('aria-pressed', isActive ? 'true' : 'false');
            });
        });
    });
    qs('#dd_detail_name')?.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
            event.preventDefault();
            startStory(story);
        }
    });
}

function renderCustomBuilder() {
    currentView = 'custom';
    selectedStoryDraft = null;
    hideSetup();
    renderHeader('自定义游戏', '把一个设定变成可玩的世界', 'preplay');

    qs('#dd_content').innerHTML = `
        <section class="dd-custom-builder">
            <button id="dd_back_library" class="dd-text-button">返回故事库</button>
            <label for="dd_custom_text">设定</label>
            <textarea id="dd_custom_text" rows="8" placeholder="例如：我在近未来医院后勤部，发现一批被篡改的急救物资流向记录。"></textarea>
            <button id="dd_build_custom" class="dd-primary">生成详情页</button>
            <div id="dd_custom_feedback" class="dd-custom-feedback" aria-live="polite"></div>
        </section>
    `;

    qs('#dd_back_library')?.addEventListener('click', showLibrary);
    qs('#dd_build_custom')?.addEventListener('click', () => {
        const text = qs('#dd_custom_text')?.value?.trim();
        if (!text) return;
        createCustomStoryWithAi(text);
    });
}

function renderCustomCreationState(seedText, message = '虚拟世界正在创建') {
    const feedback = qs('#dd_custom_feedback');
    if (!feedback) return;

    feedback.innerHTML = `
        <div class="dd-creating-world">
            <div class="dd-creating-orbit" aria-hidden="true"></div>
            <div>
                <b>${escapeHtml(message)}</b>
                <span>${escapeHtml(compactText(seedText, 64))}</span>
            </div>
        </div>
    `;
}

async function createCustomStoryWithAi(text) {
    if (!provider.configured) {
        qs('#dd_custom_feedback').innerHTML = `<div class="dd-error">服务器尚未配置 DayDreamer 模型，暂时不能创建自定义世界。</div>`;
        return;
    }

    const requestId = ++customStoryRequestId;
    const button = qs('#dd_build_custom');
    const textarea = qs('#dd_custom_text');
    const phases = [
        '正在提炼时空、主题和主角处境',
        '正在生成世界规则和开场事件',
        '正在整理成 stories.json 格式',
    ];
    let phaseIndex = 0;

    button.disabled = true;
    textarea.disabled = true;
    qs('#DayDreamer_public_app').classList.add('dd-loading');
    renderCustomCreationState(text, phases[phaseIndex]);
    const timer = setInterval(() => {
        phaseIndex = Math.min(phaseIndex + 1, phases.length - 1);
        renderCustomCreationState(text, phases[phaseIndex]);
    }, 4200);

    try {
        const response = await fetch('/api/DayDreamer/custom-story', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken,
            },
            body: JSON.stringify({ text }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error || '虚拟世界创建失败。');
        }

        if (requestId !== customStoryRequestId || currentView !== 'custom') {
            return;
        }

        renderStoryDetail({
            ...createCustomStoryDraft(text),
            ...(data.story ?? {}),
            is_custom: true,
        });
    } catch (error) {
        const feedback = qs('#dd_custom_feedback');
        if (feedback) {
            feedback.innerHTML = `<div class="dd-error">${escapeHtml(error.message || '虚拟世界创建失败，请稍后再试。')}</div>`;
        }
    } finally {
        clearInterval(timer);
        button.disabled = false;
        textarea.disabled = false;
        qs('#DayDreamer_public_app').classList.remove('dd-loading');
    }
}

function createCustomStoryDraft(text) {
    const titleSeed = text.split(/[，。,.；;\n]/).find(Boolean)?.trim() || '自定义故事';
    const title = titleSeed.length > 12 ? `${titleSeed.slice(0, 12)}...` : titleSeed;
    return {
        id: null,
        is_custom: true,
        title,
        spacetime: '用户自定义时空',
        theme: text,
        protagonist_setup: '由玩家昵称定义的入局者',
        system_type: 'DayDreamer 世界引擎',
        custom_constraints: ['遵循用户自定义设定', '行动必须经过世界规则校验', '每一幕都保留可选择的分支'],
        meta_theme: classifyTheme({ theme: text }),
        story_class: '通用',
        style: '细腻沉浸',
        route: 'general_story',
        opening: text,
    };
}

function startStory(story) {
    if (!story) return;
    const state = createState();
    const character = getCharacterDraft();
    if (story.is_custom) {
        state.story_title = story.title || '自定义故事';
        state.custom_story = story.opening || story.theme || '';
        state.custom_story_data = {
            ...story,
            id: null,
            is_custom: true,
        };
    } else {
        state.story_id = story.id;
        state.story_title = story.title;
    }
    state.route = story.route || 'general_story';
    state.story_class = story.story_class || '通用';
    state.main_objective = story.opening;
    state.core_conflict = story.theme;
    state.active_hooks = [story.opening].filter(Boolean);
    state.character = character;
    state.relationships = normalizePeople(story.relationships);
    state.world_entries = normalizeWorldEntries(story.world_entries);
    saveState(state);
    saveHistory([]);
    hideSetup();
    currentView = null;
    selectedStoryDraft = null;
    activeTab = 'story';
    render();

    const name = state.character.name || '未命名';
    const gender = state.character.gender || '男';
    if (story.is_custom) {
        sendAction(`开始自定义 DayDreamer 故事：${story.opening}。角色昵称：${name}。角色性别：${gender}。请根据这个设定生成第一幕，直接进入事件现场。`);
    } else {
        sendAction(`开始 DayDreamer 预设故事《${story.title}》。角色昵称：${name}。角色性别：${gender}。${story.role_prompt ? `${story.role_prompt}。` : ''}请根据当前剧本生成第一幕，直接进入事件现场。`);
    }
}

function getSection(text, label) {
    return String(text ?? '').match(new RegExp(`【${label}】([\\s\\S]*?)(?=\\n?【[^】]+】|$)`))?.[1]?.trim() ?? '';
}

function stripDayDreamerMeta(text) {
    return String(text ?? '')
        .replace(/<!--\s*DayDreamer_META[\s\S]*?-->/gi, '')
        .replace(/<!--\s*DayDreamer_META[\s\S]*$/i, '')
        .replace(/<DayDreamer_meta\b[\s\S]*?<\/DayDreamer_meta>/gi, '')
        .replace(/<DayDreamer_meta\b[\s\S]*$/i, '')
        .trim();
}

function parseDayDreamerMeta(text) {
    const source = String(text ?? '');
    const raw = source.match(/<!--\s*DayDreamer_META\s*([\s\S]*?)\s*-->/i)?.[1]?.trim()
        ?? source.match(/<DayDreamer_meta\b[^>]*>([\s\S]*?)<\/DayDreamer_meta>/i)?.[1]?.trim();
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
    const visibleText = stripDayDreamerMeta(text);
    const hasStructuredLabels = /【(?:标题|环境|画面|剧情|选项|行动选项|结局)】/.test(visibleText);
    return {
        title: getSection(visibleText, '标题'),
        screen: getSection(visibleText, '环境') || getSection(visibleText, '画面'),
        plot: getSection(visibleText, '剧情') || getSection(visibleText, '结局') || (hasStructuredLabels ? '' : visibleText),
        options: parseOptions(visibleText, null),
    };
}

function parseReply(text) {
    const meta = parseDayDreamerMeta(text);
    const ending = getSection(text, '结局');
    if (ending || meta?.is_ending) {
        const visibleEnding = ending || stripDayDreamerMeta(text);
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

    const visibleText = stripDayDreamerMeta(text);
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
    const list = Array.isArray(value)
        ? value
        : (value && typeof value === 'object' ? [value] : (typeof value === 'string' ? [value] : []));
    return list
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

    state.relationships = mergeNormalizedRecords(state.relationships, meta.relationships, normalizePeople, 40);
    state.world_entries = mergeNormalizedRecords(
        state.world_entries,
        meta.world_entries ?? meta.world_info ?? meta.lorebook_entries,
        normalizeWorldEntries,
        60,
    );
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
            ${scene.plot ? `<div class="dd-plot">${formatText(scene.plot)}</div>` : '<div class="dd-empty">DayDreamer 正在生成下一幕...</div>'}
        </section>
        ${optionHtml}
        ${renderPendingAction()}
    `;

    document.querySelectorAll('.dd-option[data-action]').forEach(button => {
        button.addEventListener('click', () => selectAction(button.dataset.action));
    });
}

async function readDayDreamerStream(response, onDelta) {
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
    let model = response.headers.get('x-DayDreamer-model') || '';

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
        renderError('服务器尚未配置 DayDreamer 模型。请让管理员设置 DayDreamer_API_KEY。');
        return;
    }

    qs('#dd_custom_action').value = '';
    hideQueuedActionPopup();
    isGenerating = true;
    qs('#DayDreamer_public_app').classList.add('dd-loading');
    if (activeTab === 'story') renderStreamingReply(story, '');

    let completed = false;
    try {
        const response = await fetch('/api/DayDreamer/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'text/event-stream',
                'X-CSRF-Token': csrfToken,
            },
            body: JSON.stringify({
                session_id: state.session_id,
                st_context: createDefaultStContext(),
                story,
                state,
                message,
                history: [],
            }),
        });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || '生成失败');
        }

        const sessionId = response.headers.get('x-DayDreamer-session-id');
        if (sessionId) {
            state.session_id = sessionId;
        }
        let lastPaint = 0;
        const data = await readDayDreamerStream(response, (streamText) => {
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

        state.st_context = createDefaultStContext();
        saveHistory([]);
        saveState(state);
        await syncSession(state, []).catch(() => null);
        if (activeTab === 'story') render();
        else renderShell(profile, state);
        completed = true;
    } catch (error) {
        pendingAction = '';
        hideQueuedActionPopup();
        renderError(error.message || '生成失败');
    } finally {
        isGenerating = false;
        qs('#DayDreamer_public_app').classList.remove('dd-loading');
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
        fetch('/api/DayDreamer/bootstrap').then(r => r.json()),
        fetch('/csrf-token').then(r => r.json()),
    ]);

    stories = boot.stories ?? [];
    uiProfiles = boot.uiProfiles ?? {};
    provider = boot.provider ?? {};
    csrfToken = csrf.token ?? '';

    await restoreSessionFromServer();
};

renderContent = function (tab, state, story, profile) {
    if (tab === 'story') return renderStory(state, story);
    if (tab === 'stats') return renderStatsPanel(state, profile, getTabLabel(profile, 'stats', '状态'));
    if (tab === 'relations') return renderPeoplePanel(state, profile);
    if (tab === 'messages') return renderList(getTabLabel(profile, 'messages', '线索'), getTabListItems('messages', state, profile), '暂无线索或消息。');
    if (tab === 'events') return renderList(getTabLabel(profile, 'events', '事件'), getTabListItems('events', state, profile), '暂无事件记录。');
    if (tab === 'inventory') return renderList(getTabLabel(profile, 'inventory', '资源'), getTabListItems('inventory', state, profile), '暂无资源记录。');
    if (tab === 'world') return renderWorldBookPanel(state);
    return renderSettings(state, story);
};

renderSettings = function (state, story) {
    qs('#dd_content').innerHTML = `
        <section class="dd-card">
            <h2>设置</h2>
            <div class="dd-list">
                <button id="dd_reset_story" class="dd-story-choice">重新选择故事</button>
                <button id="dd_end_story" class="dd-story-choice">生成结局</button>
                <button id="dd_clear_local" class="dd-story-choice">清空本地状态</button>
            </div>
            <div class="dd-empty" style="margin-top:12px;">${escapeHtml(story?.title || '当前没有进行中的故事')}</div>
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
        renderError('No model is configured for DayDreamer yet.');
        return;
    }

    qs('#dd_custom_action').value = '';
    hideQueuedActionPopup();
    isGenerating = true;
    qs('#DayDreamer_public_app').classList.add('dd-loading');
    if (activeTab === 'story') renderStreamingReply(story, '');

    let completed = false;
    try {
        const response = await fetch('/api/DayDreamer/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'text/event-stream',
                'X-CSRF-Token': csrfToken,
            },
            body: JSON.stringify({
                session_id: state.session_id,
                st_context: createDefaultStContext(),
                story,
                state,
                message,
                history: [],
            }),
        });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'Generation failed.');
        }

        const sessionId = response.headers.get('x-DayDreamer-session-id');
        if (sessionId) {
            state.session_id = sessionId;
        }

        let lastPaint = 0;
        const data = await readDayDreamerStream(response, (streamText) => {
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

        state.st_context = createDefaultStContext();
        saveHistory([]);
        saveState(state);
        await syncSession(state, []).catch(() => null);
        if (activeTab === 'story') render();
        else renderShell(profile, state);
        completed = true;
    } catch (error) {
        pendingAction = '';
        hideQueuedActionPopup();
        renderError(error.message || 'Generation failed.');
    } finally {
        isGenerating = false;
        qs('#DayDreamer_public_app').classList.remove('dd-loading');
        if (completed && pendingAction) {
            const action = pendingAction;
            pendingAction = '';
            sendAction(action);
        }
    }
};

qs('#dd_quick_random').addEventListener('click', showRandomStoryDetail);
qs('#dd_quick_custom').addEventListener('click', renderCustomBuilder);
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
    renderError(`DayDreamer 启动失败：${error.message}`);
}
