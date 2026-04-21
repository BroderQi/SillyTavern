import {
    chat,
    chat_metadata,
    event_types,
    eventSource,
    extension_prompt_roles,
    extension_prompt_types,
    saveMetadata,
    saveSettingsDebounced,
    sendTextareaMessage,
    setExtensionPrompt,
} from '../../../../script.js';
import { extension_settings, renderExtensionTemplateAsync } from '../../../extensions.js';

const MODULE_NAME = 'third-party/daydream';
const MODULE_KEY = 'daydream';
const EXT_PATH = 'scripts/extensions/third-party/daydream';
const PROMPT_KEYS = {
    core: `${MODULE_KEY}_core`,
    state: `${MODULE_KEY}_state`,
    turn: `${MODULE_KEY}_turn`,
};

const FILTER_DIMENSIONS = [
    { key: 'spacetime', label: '时空背景' },
    { key: 'theme', label: '核心题材' },
    { key: 'protagonist_setup', label: '主角设定' },
    { key: 'system_type', label: '系统机制' },
    { key: 'story_class', label: '玩法爽点' },
];

const defaultSettings = {
    enabled: false,
    panelOpen: false,
    injectionDepth: 1,
};

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
let corePrompt = '';
let turnPrompt = '';
let endingPrompt = '';
let activeTab = 'story';
let lastProcessedMessageId = null;
let endingRequested = false;

function ensureSettings() {
    if (!extension_settings[MODULE_KEY]) {
        extension_settings[MODULE_KEY] = structuredClone(defaultSettings);
    }

    for (const [key, value] of Object.entries(defaultSettings)) {
        if (extension_settings[MODULE_KEY][key] === undefined) {
            extension_settings[MODULE_KEY][key] = value;
        }
    }

    return extension_settings[MODULE_KEY];
}

function createEmptyState() {
    return {
        enabled: true,
        version: '0.1.0',
        story_id: null,
        story_title: '',
        custom_story: '',
        route: 'general_story',
        story_class: '',
        ui_profile_id: '',
        character: {
            name: '',
            gender: '',
            custom: {},
        },
        stats: structuredClone(defaultStats),
        relationships: [],
        resources: [],
        triggered_events: [],
        current_stage: 'opening',
        stage_progress: 0,
        main_objective: '',
        core_conflict: '',
        pending_foreshadows: [],
        active_hooks: [],
        activated_emotions: [],
        important_branches: [],
        near_ending: false,
        last_options: [],
        last_scene: null,
        last_status_text: '',
        last_message_id: null,
    };
}

function getState() {
    if (!chat_metadata.daydream || typeof chat_metadata.daydream !== 'object') {
        chat_metadata.daydream = createEmptyState();
    }

    const state = chat_metadata.daydream;
    const fresh = createEmptyState();

    for (const [key, value] of Object.entries(fresh)) {
        if (state[key] === undefined) {
            state[key] = value;
        }
    }

    state.character ??= fresh.character;
    state.stats = { ...defaultStats, ...(state.stats ?? {}) };
    state.relationships ??= [];
    state.resources ??= [];
    state.triggered_events ??= [];
    state.pending_foreshadows ??= [];
    state.active_hooks ??= [];
    state.activated_emotions ??= [];
    state.important_branches ??= [];
    state.last_options ??= [];
    return state;
}

function getCurrentStory() {
    const state = getState();
    if (state.story_id) {
        return stories.find(x => x.id === Number(state.story_id)) ?? null;
    }

    if (state.custom_story) {
        return {
            id: null,
            title: state.story_title || '自定义故事',
            spacetime: '由用户自定义',
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

function getUiProfile(story = getCurrentStory()) {
    let profile = structuredClone(uiProfiles['通用'] ?? { top_stats: [], tabs: [] });
    if (story?.story_class && uiProfiles[story.story_class]) {
        profile = mergeProfile(profile, structuredClone(uiProfiles[story.story_class]));
    }
    if (story?.ui_profile) {
        profile = mergeProfile(profile, story.ui_profile);
    }
    return profile;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

async function loadAsset(path, type = 'text') {
    const response = await fetch(`${EXT_PATH}/${path}`);
    if (!response.ok) {
        throw new Error(`Failed to load ${path}: ${response.status}`);
    }
    return type === 'json' ? response.json() : response.text();
}

async function loadAssets() {
    [stories, uiProfiles, corePrompt, turnPrompt, endingPrompt] = await Promise.all([
        loadAsset('data/stories.json', 'json'),
        loadAsset('data/ui-profiles.json', 'json'),
        loadAsset('prompts/engine-core.md'),
        loadAsset('prompts/turn-injection.md'),
        loadAsset('prompts/ending.md'),
    ]);
}

async function saveState() {
    chat_metadata.daydream = getState();
    chat_metadata.tainted = true;
    await saveMetadata();
}

function clearInjection() {
    setExtensionPrompt(PROMPT_KEYS.core, '', extension_prompt_types.NONE, 0);
    setExtensionPrompt(PROMPT_KEYS.state, '', extension_prompt_types.NONE, 0);
    setExtensionPrompt(PROMPT_KEYS.turn, '', extension_prompt_types.NONE, 0);
}

function buildStateInjection() {
    const state = getState();
    const story = getCurrentStory();

    if (!story) {
        return [
            '【DayDream 当前状态】',
            '尚未选择故事。若用户要求开始，请引导其选择随机故事、预设故事或自定义故事。',
        ].join('\n');
    }

    const compactState = {
        story_title: story.title,
        route: story.route,
        story_class: story.story_class,
        style: story.style,
        current_stage: state.current_stage,
        stage_progress: state.stage_progress,
        stats: state.stats,
        character: state.character,
        relationships: state.relationships,
        resources: state.resources,
        triggered_events: state.triggered_events,
        main_objective: state.main_objective,
        core_conflict: state.core_conflict,
        pending_foreshadows: state.pending_foreshadows,
        active_hooks: state.active_hooks,
        important_branches: state.important_branches,
        near_ending: state.near_ending,
    };

    return [
        '【DayDream 当前剧本】',
        JSON.stringify(story, null, 2),
        '',
        '【DayDream 当前状态】',
        JSON.stringify(compactState, null, 2),
    ].join('\n');
}

function updateInjection() {
    const settings = ensureSettings();
    if (!settings.enabled) {
        clearInjection();
        return;
    }

    const depth = Number(settings.injectionDepth ?? 1);
    setExtensionPrompt(PROMPT_KEYS.core, corePrompt, extension_prompt_types.BEFORE_PROMPT, 0, false, extension_prompt_roles.SYSTEM);
    setExtensionPrompt(PROMPT_KEYS.state, buildStateInjection(), extension_prompt_types.IN_CHAT, depth, false, extension_prompt_roles.SYSTEM);
    const roundPrompt = endingRequested ? `${turnPrompt}\n\n${endingPrompt}` : turnPrompt;
    setExtensionPrompt(PROMPT_KEYS.turn, roundPrompt, extension_prompt_types.IN_PROMPT, 0, false, extension_prompt_roles.SYSTEM);
}

function createShell() {
    if ($('#daydream_app').length) {
        return;
    }

    const html = `
        <div id="daydream_app" class="daydream-app" style="display:none;">
            <div class="daydream-backdrop"></div>
            <div class="daydream-phone">
                <div class="daydream-topbar">
                    <div class="daydream-story-title"></div>
                    <button class="daydream-icon-button" id="daydream_close_panel" title="关闭"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <div id="daydream_stats" class="daydream-stats"></div>
                <main id="daydream_content" class="daydream-content"></main>
                <div id="daydream_action_bar" class="daydream-action-bar">
                    <input id="daydream_custom_action" class="text_pole" type="text" placeholder="输入自定义行动..." />
                    <button id="daydream_send_action" class="daydream-send" title="发送"><i class="fa-solid fa-paper-plane"></i></button>
                </div>
                <nav id="daydream_tabs" class="daydream-tabs"></nav>
                <div id="daydream_modal" class="daydream-modal" style="display:none;"></div>
            </div>
        </div>`;

    $('body').append(html);
}

async function appendSettings() {
    if ($('#daydream_settings').length) {
        return;
    }

    const settingsHtml = await renderExtensionTemplateAsync(MODULE_NAME, 'settings');
    const container = $('#extensions_settings2').length ? $('#extensions_settings2') : $('#extensions_settings');
    container.append(settingsHtml);

    const settings = ensureSettings();
    $('#daydream_enabled').prop('checked', settings.enabled);
    $('#daydream_injection_depth').val(settings.injectionDepth);

    $('#daydream_enabled').on('input', async function () {
        settings.enabled = !!$(this).prop('checked');
        settings.panelOpen = settings.enabled ? settings.panelOpen : false;
        saveSettingsDebounced();
        updateInjection();
        renderAll();
    });

    $('#daydream_injection_depth').on('input', function () {
        settings.injectionDepth = Number($(this).val() || 1);
        saveSettingsDebounced();
        updateInjection();
    });

    $('#daydream_open_panel').on('click', () => {
        settings.enabled = true;
        settings.panelOpen = true;
        $('#daydream_enabled').prop('checked', true);
        saveSettingsDebounced();
        updateInjection();
        renderAll();
    });

    $('#daydream_pick_story').on('click', () => {
        settings.enabled = true;
        settings.panelOpen = true;
        $('#daydream_enabled').prop('checked', true);
        saveSettingsDebounced();
        renderAll();
        showSetupModal();
    });

    $('#daydream_reset_state').on('click', async () => {
        if (!confirm('重置当前聊天的 DayDream 状态？')) {
            return;
        }
        chat_metadata.daydream = createEmptyState();
        await saveState();
        updateInjection();
        renderAll();
        showSetupModal();
    });
}

function appendMenuButton() {
    if ($('#daydream_menu_button').length || !$('#extensionsMenu').length) {
        return;
    }

    $('#extensionsMenu').append(`
        <div id="daydream_menu_button" class="list-group-item flex-container flexGap5">
            <div class="fa-solid fa-cloud-sun extensionsMenuExtensionButton"></div>
            <span>DayDream</span>
        </div>
    `);
    $('#daydream_menu_button').on('click', () => {
        const settings = ensureSettings();
        settings.enabled = true;
        settings.panelOpen = true;
        $('#daydream_enabled').prop('checked', true);
        saveSettingsDebounced();
        updateInjection();
        renderAll();
    });
}

function bindShellEvents() {
    $('#daydream_close_panel').on('click', () => {
        const settings = ensureSettings();
        settings.panelOpen = false;
        saveSettingsDebounced();
        renderAll();
    });

    $('#daydream_send_action').on('click', () => {
        const text = String($('#daydream_custom_action').val() ?? '').trim();
        if (text) {
            sendAction(text);
        }
    });

    $('#daydream_custom_action').on('keydown', event => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            const text = String($('#daydream_custom_action').val() ?? '').trim();
            if (text) {
                sendAction(text);
            }
        }
    });
}

function renderAll() {
    const settings = ensureSettings();
    $('#daydream_app').toggle(!!settings.enabled && !!settings.panelOpen);

    if (!settings.enabled || !settings.panelOpen) {
        return;
    }

    const state = getState();
    const story = getCurrentStory();
    const profile = getUiProfile(story);

    $('.daydream-story-title').text(story?.title || 'DayDream 世界引擎');
    renderStats(profile, state);
    renderTabs(profile);
    renderContent(activeTab);

    if (!story) {
        showSetupModal();
    }
}

function renderStats(profile, state) {
    const stats = profile.top_stats ?? [];
    $('#daydream_stats').empty().append(stats.map(stat => {
        const value = state.stats?.[stat.key] ?? '-';
        return `
            <div class="daydream-stat" data-key="${escapeHtml(stat.key)}">
                <i class="fa-solid fa-${escapeHtml(stat.icon || 'circle')}"></i>
                <span>${escapeHtml(stat.label)}</span>
                <b>${escapeHtml(value)}</b>
            </div>`;
    }).join(''));
}

function renderTabs(profile) {
    const tabs = profile.tabs ?? [];
    if (!tabs.some(tab => tab.key === activeTab)) {
        activeTab = 'story';
    }

    $('#daydream_tabs').empty().append(tabs.map(tab => `
        <button class="daydream-tab ${tab.key === activeTab ? 'active' : ''}" data-tab="${escapeHtml(tab.key)}" title="${escapeHtml(tab.label)}">
            <i class="fa-solid fa-${escapeHtml(tab.icon || 'circle')}"></i>
            <span>${escapeHtml(tab.label)}</span>
        </button>
    `).join(''));

    $('#daydream_tabs .daydream-tab').off('click').on('click', function () {
        activeTab = String($(this).data('tab'));
        renderAll();
    });
}

function renderContent(tab) {
    switch (tab) {
        case 'relations':
            renderListPanel('人脉', getState().relationships, '暂无明确关系变化。');
            break;
        case 'messages':
            renderListPanel('线索 / 通讯', [...getState().active_hooks, ...getState().pending_foreshadows], '暂无可查看的信息。');
            break;
        case 'stats':
            renderStatsPanel();
            break;
        case 'events':
            renderListPanel('事件', [...getState().triggered_events, ...getState().important_branches], '暂无已触发事件。');
            break;
        case 'inventory':
            renderListPanel('资产 / 资源', getState().resources, '暂无记录资源。');
            break;
        case 'settings':
            renderGameSettingsPanel();
            break;
        case 'story':
        default:
            renderStoryPanel();
            break;
    }
}

function renderStoryPanel() {
    const state = getState();
    const story = getCurrentStory();
    const scene = state.last_scene;

    const options = state.last_options ?? [];
    const optionHtml = options.length
        ? options.map(option => `<button class="daydream-option" data-option="${option.index}"><b>${option.index}</b><span>${escapeHtml(option.text)}</span></button>`).join('')
        : '<div class="daydream-empty">选择故事后，第一幕生成的行动选项会出现在这里。</div>';

    $('#daydream_content').html(`
        <section class="daydream-card daydream-scene-card">
            <div class="daydream-scene-kicker">${escapeHtml(story?.story_class || '未选择故事')}</div>
            <h2>${escapeHtml(scene?.title || story?.title || '尚未入局')}</h2>
            <div class="daydream-screen">${escapeHtml(scene?.screen || story?.opening || '请选择故事，或输入自定义脑洞开始。')}</div>
            <div class="daydream-plot">${formatTextBlock(scene?.plot || '')}</div>
        </section>
        <section class="daydream-options">
            ${optionHtml}
        </section>
    `);

    $('.daydream-option').off('click').on('click', function () {
        const index = Number($(this).data('option'));
        const option = options.find(x => x.index === index);
        if (option) {
            sendAction(option.text);
        }
    });
}

function renderListPanel(title, items, emptyText) {
    const list = Array.isArray(items) ? items : [];
    const body = list.length
        ? `<div class="daydream-list">${list.map(item => `<div class="daydream-list-item">${formatListItem(item)}</div>`).join('')}</div>`
        : `<div class="daydream-empty">${escapeHtml(emptyText)}</div>`;
    $('#daydream_content').html(`<section class="daydream-card"><h2>${escapeHtml(title)}</h2>${body}</section>`);
}

function renderStatsPanel() {
    const state = getState();
    const entries = Object.entries(state.stats ?? {});
    $('#daydream_content').html(`
        <section class="daydream-card">
            <h2>属性</h2>
            <div class="daydream-stat-grid">
                ${entries.map(([key, value]) => `
                    <div>
                        <span>${escapeHtml(statLabels[key] || key)}</span>
                        <b>${escapeHtml(value)}</b>
                    </div>
                `).join('')}
            </div>
        </section>
    `);
}

function renderGameSettingsPanel() {
    const story = getCurrentStory();
    $('#daydream_content').html(`
        <section class="daydream-card">
            <h2>设置</h2>
            <div class="daydream-settings-actions">
                <button id="daydream_ui_pick_again" class="menu_button">重新选择故事</button>
                <button id="daydream_ui_end_story" class="menu_button">生成结局</button>
                <button id="daydream_ui_sync" class="menu_button">同步最近回复</button>
            </div>
            <div class="daydream-story-meta">
                <b>${escapeHtml(story?.title || '未选择故事')}</b>
                <span>${escapeHtml(story?.spacetime || '')}</span>
                <span>${escapeHtml(story?.theme || '')}</span>
            </div>
        </section>
    `);

    $('#daydream_ui_pick_again').on('click', showSetupModal);
    $('#daydream_ui_end_story').on('click', () => sendAction('结束'));
    $('#daydream_ui_sync').on('click', () => parseLatestAssistantMessage(true));
}

function formatTextBlock(text) {
    return escapeHtml(text).replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>');
}

function formatListItem(item) {
    if (typeof item === 'string') {
        return escapeHtml(item);
    }
    if (item && typeof item === 'object') {
        const title = item.name || item.title || item.label || item.key || '记录';
        const detail = item.description || item.value || item.status || JSON.stringify(item);
        return `<b>${escapeHtml(title)}</b><span>${escapeHtml(detail)}</span>`;
    }
    return escapeHtml(String(item ?? ''));
}

function showSetupModal() {
    const state = getState();
    $('#daydream_modal').show().html(`
        <div class="daydream-dialog">
            <button id="daydream_modal_close" class="daydream-icon-button daydream-modal-close"><i class="fa-solid fa-xmark"></i></button>
            <h2>创建角色</h2>
            <p>选择进入方式后，DayDream 会把剧本和状态注入到下一次生成里。</p>
            <label>角色姓名</label>
            <input id="daydream_character_name" class="text_pole" type="text" value="${escapeHtml(state.character?.name || '')}" placeholder="输入角色名" />
            <label>角色性别</label>
            <div class="daydream-segmented">
                <button class="daydream-gender ${state.character?.gender !== '女' ? 'active' : ''}" data-gender="男">男</button>
                <button class="daydream-gender ${state.character?.gender === '女' ? 'active' : ''}" data-gender="女">女</button>
            </div>
            <div class="daydream-entry-grid">
                <button id="daydream_random_story"><i class="fa-solid fa-dice"></i><span>随机故事</span></button>
                <button id="daydream_preset_story"><i class="fa-solid fa-layer-group"></i><span>预设故事</span></button>
                <button id="daydream_custom_story"><i class="fa-solid fa-pen-nib"></i><span>自定义故事</span></button>
            </div>
            <div id="daydream_picker_body"></div>
        </div>
    `);

    $('#daydream_modal_close').on('click', hideModal);
    $('.daydream-gender').on('click', function () {
        $('.daydream-gender').removeClass('active');
        $(this).addClass('active');
    });
    $('#daydream_random_story').on('click', () => startStory(pickRandom(stories)));
    $('#daydream_preset_story').on('click', renderDimensionPicker);
    $('#daydream_custom_story').on('click', renderCustomStoryPicker);
}

function hideModal() {
    $('#daydream_modal').hide().empty();
}

function getCharacterDraft() {
    return {
        name: String($('#daydream_character_name').val() || '').trim(),
        gender: String($('.daydream-gender.active').data('gender') || '男'),
        custom: {},
    };
}

function renderDimensionPicker() {
    $('#daydream_picker_body').html(`
        <h3>按什么类型找故事？</h3>
        <div class="daydream-filter-grid">
            ${FILTER_DIMENSIONS.map(dim => `<button class="daydream-dimension" data-dimension="${dim.key}">${dim.label}</button>`).join('')}
            <button id="daydream_show_all_stories">查看全部 ${stories.length} 个故事</button>
        </div>
    `);

    $('.daydream-dimension').on('click', function () {
        renderTypePicker(String($(this).data('dimension')));
    });
    $('#daydream_show_all_stories').on('click', () => renderStoryPicker(stories, '全部故事'));
}

function renderTypePicker(dimension) {
    const counts = new Map();
    for (const story of stories) {
        const value = story[dimension] || '未分类';
        counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    const label = FILTER_DIMENSIONS.find(x => x.key === dimension)?.label ?? dimension;
    const items = [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), 'zh-Hans-CN'));

    $('#daydream_picker_body').html(`
        <div class="daydream-picker-head">
            <button id="daydream_back_dimensions" class="menu_button">返回</button>
            <h3>${escapeHtml(label)}</h3>
        </div>
        <div class="daydream-type-list">
            ${items.map(([value, count]) => `<button class="daydream-type" data-value="${escapeHtml(value)}"><span>${escapeHtml(value)}</span><b>${count}</b></button>`).join('')}
        </div>
    `);

    $('#daydream_back_dimensions').on('click', renderDimensionPicker);
    $('.daydream-type').on('click', function () {
        const value = String($(this).data('value'));
        renderStoryPicker(stories.filter(story => story[dimension] === value), value);
    });
}

function renderStoryPicker(list, title) {
    $('#daydream_picker_body').html(`
        <div class="daydream-picker-head">
            <button id="daydream_back_dimensions" class="menu_button">返回</button>
            <h3>${escapeHtml(title)}（${list.length}）</h3>
        </div>
        <div class="daydream-story-list">
            ${list.map(story => `
                <button class="daydream-story-choice" data-story-id="${story.id}">
                    <b>${story.id}. ${escapeHtml(story.title)}</b>
                    <span>${escapeHtml(story.opening)}</span>
                </button>
            `).join('')}
        </div>
    `);

    $('#daydream_back_dimensions').on('click', renderDimensionPicker);
    $('.daydream-story-choice').on('click', function () {
        const story = stories.find(x => x.id === Number($(this).data('story-id')));
        startStory(story);
    });
}

function renderCustomStoryPicker() {
    $('#daydream_picker_body').html(`
        <h3>自定义故事</h3>
        <textarea id="daydream_custom_story_text" class="text_pole" rows="5" placeholder="一句话告诉我：你想进入什么世界、你是谁、你最想体验什么。"></textarea>
        <button id="daydream_start_custom" class="daydream-primary-button">开始自定义故事</button>
    `);

    $('#daydream_start_custom').on('click', () => {
        const text = String($('#daydream_custom_story_text').val() || '').trim();
        if (!text) {
            toastr.warning('请先写下你的故事脑洞。');
            return;
        }
        startCustomStory(text);
    });
}

function pickRandom(list) {
    return list[Math.floor(Math.random() * list.length)];
}

async function startStory(story) {
    if (!story) {
        return;
    }

    const state = getState();
    state.enabled = true;
    state.story_id = story.id;
    state.story_title = story.title;
    state.custom_story = '';
    state.route = story.route;
    state.story_class = story.story_class;
    state.current_stage = 'opening';
    state.stage_progress = 0;
    state.main_objective = story.opening;
    state.core_conflict = story.theme;
    state.character = getCharacterDraft();
    state.stats = { ...defaultStats, turn_count: 0 };
    state.relationships = [];
    state.resources = [];
    state.triggered_events = [];
    state.pending_foreshadows = [];
    state.active_hooks = [story.opening];
    state.important_branches = [];
    state.last_options = [];
    state.last_scene = null;
    state.last_status_text = '';

    await saveState();
    hideModal();
    updateInjection();
    renderAll();
    await sendAction(buildStartMessage(story));
}

async function startCustomStory(text) {
    const state = getState();
    state.enabled = true;
    state.story_id = null;
    state.story_title = '自定义故事';
    state.custom_story = text;
    state.route = 'general_story';
    state.story_class = '通用';
    state.current_stage = 'opening';
    state.stage_progress = 0;
    state.main_objective = text;
    state.core_conflict = text;
    state.character = getCharacterDraft();
    state.stats = { ...defaultStats, turn_count: 0 };
    state.relationships = [];
    state.resources = [];
    state.triggered_events = [];
    state.pending_foreshadows = [];
    state.active_hooks = [text];
    state.important_branches = [];
    state.last_options = [];
    state.last_scene = null;
    state.last_status_text = '';

    await saveState();
    hideModal();
    updateInjection();
    renderAll();
    await sendAction(`开始自定义 DayDream 故事：${text}`);
}

function buildStartMessage(story) {
    const state = getState();
    const name = state.character?.name ? `角色姓名：${state.character.name}。` : '';
    const gender = state.character?.gender ? `角色性别：${state.character.gender}。` : '';
    return `${name}${gender}开始 DayDream 预设故事《${story.title}》。请根据当前剧本生成第一幕，直接进入事件现场。`;
}

async function sendAction(text) {
    const clean = String(text ?? '').trim();
    if (!clean) {
        return;
    }

    endingRequested = /^结束\s*$/.test(clean);

    const settings = ensureSettings();
    settings.enabled = true;
    settings.panelOpen = true;
    saveSettingsDebounced();
    $('#daydream_enabled').prop('checked', true);
    $('#daydream_custom_action').val('');
    updateInjection();
    renderAll();

    const textarea = $('#send_textarea');
    if (!textarea.length) {
        toastr.warning('找不到 SillyTavern 输入框。');
        return;
    }

    try {
        textarea.val(clean);
        textarea[0].dispatchEvent(new Event('input', { bubbles: true }));
        await sendTextareaMessage();
    } catch (error) {
        console.error('DayDream send failed', error);
        toastr.error('发送 DayDream 行动失败，请确认当前已打开角色聊天。');
    }
}

function getSection(text, label) {
    const pattern = new RegExp(`【${label}】([\\s\\S]*?)(?=\\n?【[^】]+】|$)`);
    return String(text ?? '').match(pattern)?.[1]?.trim() ?? '';
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
    if (!raw) {
        return null;
    }

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

    const section = getSection(text, '选项') || getSection(text, '行动选项');
    const options = [];
    for (const line of section.split('\n')) {
        const match = line.match(/^\s*([1-4])[.、:：]\s*(.+?)\s*$/);
        if (match) {
            const optionText = match[2].replace(/^选项\s*/, '').trim();
            if (optionText && !/自定义输入/.test(optionText)) {
                options.push({ index: Number(match[1]), text: optionText });
            }
        }
    }
    return options.slice(0, 4);
}

function formatStatusChange(change) {
    if (typeof change === 'string') {
        return change;
    }
    if (!change || typeof change !== 'object') {
        return String(change ?? '');
    }

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

function parseScene(text) {
    const meta = parseDayDreamMeta(text);
    const ending = getSection(text, '结局');
    if (ending || meta?.is_ending) {
        return {
            title: getSection(text, '标题') || meta?.title || '结局',
            screen: getSection(text, '环境') || getSection(text, '画面') || meta?.screen || '',
            plot: ending || stripDayDreamMeta(text),
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

async function parseLatestAssistantMessage(force = false) {
    for (let i = chat.length - 1; i >= 0; i--) {
        const message = chat[i];
        if (!message?.is_user && !message?.is_system && message?.mes) {
            await parseAssistantMessage(i, force);
            return;
        }
    }
}

async function parseAssistantMessage(messageId, force = false) {
    const settings = ensureSettings();
    const state = getState();
    const message = chat[messageId];

    if (!settings.enabled || !state.story_id && !state.custom_story || !message?.mes || message?.is_user || message?.is_system) {
        return;
    }

    if (!force && lastProcessedMessageId === messageId) {
        return;
    }

    const scene = parseScene(message.mes);
    if (!force && !scene.title && !scene.plot && !scene.status && scene.options.length === 0 && !scene.isEnding) {
        return;
    }

    lastProcessedMessageId = messageId;
    endingRequested = false;
    state.last_message_id = messageId;
    state.last_scene = {
        title: scene.title || state.last_scene?.title || getCurrentStory()?.title || '剧情推进',
        screen: scene.screen,
        plot: scene.plot || message.mes,
    };
    state.last_status_text = scene.status;
    state.last_options = scene.options;
    state.near_ending = !!scene.isEnding;
    state.stats.turn_count = Number(state.stats.turn_count || 0) + (scene.isEnding ? 0 : 1);
    if (scene.meta) {
        applyMetaUpdates(scene.meta);
    } else {
        applyStatusText(scene.status);
    }

    if (!scene.meta && scene.status) {
        state.triggered_events.unshift(scene.status);
        state.triggered_events = state.triggered_events.slice(0, 20);
    }

    await saveState();
    updateInjection();
    renderAll();
}

function applyStatsObject(stats, mode) {
    if (!stats || typeof stats !== 'object') {
        return;
    }

    const state = getState();
    for (const [key, value] of Object.entries(stats)) {
        const number = Number(value);
        if (!Number.isFinite(number)) {
            continue;
        }
        state.stats[key] = mode === 'delta' ? Number(state.stats[key] ?? 0) + number : number;
    }
}

function toRecordList(value) {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .map(item => {
            if (typeof item === 'string') {
                return item.trim();
            }
            if (item && typeof item === 'object') {
                return item;
            }
            return '';
        })
        .filter(Boolean);
}

function prependRecords(current, incoming, limit = 20) {
    const records = [...toRecordList(incoming), ...(current ?? [])];
    const seen = new Set();
    return records.filter(item => {
        const key = typeof item === 'string' ? item : JSON.stringify(item);
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    }).slice(0, limit);
}

function applyMetaUpdates(meta) {
    if (!meta || typeof meta !== 'object') {
        return;
    }

    const state = getState();
    applyStatsObject(meta.stats_delta, 'delta');
    applyStatsObject(meta.stats, 'absolute');
    if (Array.isArray(meta.status_changes)) {
        for (const change of meta.status_changes) {
            if (!change || typeof change !== 'object') {
                continue;
            }
            const key = change.key || change.stat;
            if (!key) {
                continue;
            }
            if (change.value !== undefined) {
                applyStatsObject({ [key]: change.value }, 'absolute');
            } else if (change.delta !== undefined) {
                applyStatsObject({ [key]: change.delta }, 'delta');
            }
        }
    }

    state.relationships = prependRecords(state.relationships, meta.relationships);
    state.resources = prependRecords(state.resources, meta.resources);
    state.triggered_events = prependRecords(state.triggered_events, meta.events);
    state.active_hooks = prependRecords(state.active_hooks, meta.active_hooks);
    state.pending_foreshadows = prependRecords(state.pending_foreshadows, meta.pending_foreshadows);
    state.important_branches = prependRecords(state.important_branches, meta.important_branches);
}

function applyStatusText(status) {
    if (!status) {
        return;
    }

    const state = getState();
    for (const [key, label] of Object.entries(statLabels)) {
        if (!status.includes(label) || key === 'turn_count') {
            continue;
        }

        const line = status.split('\n').find(x => x.includes(label)) ?? status;
        if (/[↑+＋]/.test(line)) {
            state.stats[key] = Number(state.stats[key] ?? 0) + 1;
        } else if (/[↓\-－]/.test(line)) {
            state.stats[key] = Number(state.stats[key] ?? 0) - 1;
        }

        const numberMatch = line.match(new RegExp(`${label}[^0-9\\-－]*([\\-－]?\\d+)`));
        if (numberMatch) {
            state.stats[key] = Number(numberMatch[1].replace('－', '-'));
        }
    }
}

function registerEvents() {
    eventSource.on(event_types.GENERATION_AFTER_COMMANDS, () => updateInjection());
    eventSource.on(event_types.MESSAGE_RECEIVED, messageId => parseAssistantMessage(messageId));
    eventSource.on(event_types.GENERATION_ENDED, () => parseLatestAssistantMessage());
    eventSource.on(event_types.CHAT_CHANGED, () => {
        lastProcessedMessageId = null;
        renderAll();
        updateInjection();
    });
    eventSource.on(event_types.CHAT_LOADED, () => {
        lastProcessedMessageId = null;
        renderAll();
        updateInjection();
    });
}

jQuery(async () => {
    try {
        ensureSettings();
        await loadAssets();
        createShell();
        await appendSettings();
        appendMenuButton();
        bindShellEvents();
        registerEvents();
        updateInjection();
        renderAll();
    } catch (error) {
        console.error('DayDream initialization failed', error);
        toastr.error('DayDream 扩展初始化失败，请查看控制台。');
    }
});
