import fs from 'node:fs';
import path from 'node:path';

import express from 'express';
import fetch from 'node-fetch';

import { serverDirectory } from '../server-directory.js';
import { forwardFetchResponse, getConfigValue, safeReadFileSync } from '../util.js';
import { callInternalApi, readInternalJson } from '../daydream-st/internal-api.js';
import {
    listSillyTavernResources,
    assembleDayDreamerGeneration,
    getProviderSummaryFromSettings,
    persistDayDreamerTurn,
    readUserSettings,
} from '../daydream-st/orchestration.js';
import { dispatchViaSillyTavern } from '../daydream-st/provider-dispatch.js';
import { createSession, loadSession, saveSession, upsertSession } from '../daydream-st/session-store.js';
import { buildProviderBody } from '../daydream-st/prompt-assembly.js';
import { proxyEventStream } from '../daydream-st/streaming.js';

export const router = express.Router();

// Maintainer note: the public DayDreamer page is the maintained product surface.
// Assets still live under the legacy extension directory, but the extension page itself is deprecated.
// Future story-library and UX changes should target the public page flow first.
const DayDreamer_DIR = path.join(serverDirectory, 'public', 'scripts', 'extensions', 'third-party', 'daydream');
const STORIES_PATH = path.join(DayDreamer_DIR, 'data', 'stories.json');
const UI_PROFILES_PATH = path.join(DayDreamer_DIR, 'data', 'ui-profiles.json');
const CORE_PROMPT_PATH = path.join(DayDreamer_DIR, 'prompts', 'engine-core.md');
const TURN_PROMPT_PATH = path.join(DayDreamer_DIR, 'prompts', 'turn-injection.md');
const ENDING_PROMPT_PATH = path.join(DayDreamer_DIR, 'prompts', 'ending.md');

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';
const MAX_MESSAGE_LENGTH = 4000;
const CUSTOM_STORY_MAX_LENGTH = 2000;
const CUSTOM_STORY_ROUTES = new Set([
    'general_story',
    'short_drama',
    'immersive_novel',
    'romance_tension',
    'suspense_investigation',
    'power_game',
    'healing_growth',
]);
const CUSTOM_STORY_STYLES = new Set(['写实压迫', '细腻沉浸', '爽文推进', '黑色幽默']);

function readJson(filePath, fallback) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        console.error(`Failed to read DayDreamer JSON file: ${filePath}`, error);
        return fallback;
    }
}

function readPrompt(filePath) {
    return safeReadFileSync(filePath) ?? '';
}

function getFallbackProviderConfig() {
    const apiKey = process.env.DayDreamer_API_KEY || getConfigValue('DayDreamer.apiKey', '');
    const baseUrl = process.env.DayDreamer_BASE_URL || getConfigValue('DayDreamer.baseUrl', DEFAULT_BASE_URL);
    const model = process.env.DayDreamer_MODEL || getConfigValue('DayDreamer.model', DEFAULT_MODEL);
    const enabled = Boolean(apiKey) && getConfigValue('DayDreamer.enabled', true, 'boolean');
    const responseTokens = Number(process.env.DayDreamer_RESPONSE_TOKENS || getConfigValue('DayDreamer.responseTokens', 1200, 'number'));

    return {
        configured: enabled,
        enabled,
        apiKey,
        baseUrl: String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, ''),
        model: String(model || DEFAULT_MODEL),
        responseTokens: Number.isFinite(responseTokens) ? responseTokens : 1200,
        chat_completion_source: 'openai',
    };
}

function toPublicProviderConfig(provider, settings = {}) {
    const resolved = getProviderSummaryFromSettings(settings, provider);
    return {
        configured: Boolean(resolved.configured || provider.configured),
        chat_completion_source: resolved.chat_completion_source || provider.chat_completion_source || 'openai',
        model: resolved.model || provider.model || '',
        baseUrl: provider.baseUrl ? provider.baseUrl.replace(/\/\/.*?@/, '//') : undefined,
    };
}

function getStoryFromRequest(stories, body) {
    if (body.story?.id) {
        return stories.find(story => Number(story.id) === Number(body.story.id)) ?? body.story;
    }

    if (body.state?.story_id) {
        return stories.find(story => Number(story.id) === Number(body.state.story_id)) ?? body.story ?? null;
    }

    return body.story ?? null;
}

function compact(value, fallback) {
    if (value === undefined || value === null) {
        return fallback;
    }

    if (typeof value === 'string') {
        return value.slice(0, MAX_MESSAGE_LENGTH);
    }

    return value;
}

function extractAssistantText(payload) {
    const choice = payload?.choices?.[0];
    return choice?.message?.content ?? choice?.delta?.content ?? choice?.text ?? '';
}

function extractJsonObject(text) {
    const source = String(text ?? '').trim();
    if (!source) {
        throw new Error('Empty custom story response.');
    }

    try {
        return JSON.parse(source);
    } catch {
        const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
        if (fenced) {
            return JSON.parse(fenced);
        }

        const start = source.indexOf('{');
        const end = source.lastIndexOf('}');
        if (start >= 0 && end > start) {
            return JSON.parse(source.slice(start, end + 1));
        }

        throw new Error('Custom story response did not contain JSON.');
    }
}

function normalizeString(value, fallback, maxLength = 120) {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    return (text || fallback).slice(0, maxLength);
}

function normalizeStringArray(value, fallback, maxItems = 3, maxLength = 80) {
    const array = Array.isArray(value) ? value : fallback;
    return array
        .map(item => normalizeString(item, '', maxLength))
        .filter(Boolean)
        .slice(0, maxItems);
}

function getAllowedStoryClasses(uiProfiles = {}) {
    const keys = Object.keys(uiProfiles).filter(Boolean);
    return keys.length ? keys : ['通用'];
}

function getCustomStoryIntent(seedText) {
    const text = String(seedText ?? '');
    const hasSuspenseIntent = /悬疑|烧脑|破案|侦探|调查|查案|案件|旧案|真相|线索|谜团|怪谈|失踪|尸|诡|异常|规则/.test(text);
    const hasWealthIntent = /一千万|千万|百万|一个亿|亿|暴富|有钱|神豪|消费|花钱|到账|现金|彩票|中奖|财富|资产|存款|投资/.test(text);
    const hasBusinessIntent = /创业|经营|开店|公司|生意|项目|品牌|电商|直播带货|商战|现金流|融资|市场/.test(text);
    const hasReversalIntent = /短剧|爽|打脸|逆袭|反杀|翻盘|被看不起|羞辱|退婚|雪藏|网暴|抢走|压制/.test(text);

    if (hasSuspenseIntent) {
        return null;
    }

    if (hasWealthIntent && hasBusinessIntent) {
        return {
            story_class: '经营积累',
            route: hasReversalIntent ? 'short_drama' : 'general_story',
            style: hasReversalIntent ? '爽文推进' : '写实压迫',
            meta_theme: '现实逆袭',
            system_type: /神豪|消费|花钱|一千万|暴富|到账|现金/.test(text) ? '神豪消费' : undefined,
        };
    }

    if (hasWealthIntent || hasReversalIntent) {
        return {
            story_class: '打脸逆袭',
            route: 'short_drama',
            style: '爽文推进',
            meta_theme: '现实逆袭',
            system_type: hasWealthIntent ? '神豪消费' : undefined,
        };
    }

    return null;
}

function normalizeGeneratedStory(rawStory, seedText, uiProfiles) {
    const allowedClasses = getAllowedStoryClasses(uiProfiles);
    const intent = getCustomStoryIntent(seedText);
    const storyClassSeed = intent?.story_class ?? rawStory?.story_class;
    const routeSeed = intent?.route ?? rawStory?.route;
    const styleSeed = intent?.style ?? rawStory?.style;
    const storyClass = allowedClasses.includes(storyClassSeed) ? storyClassSeed : '通用';
    const route = CUSTOM_STORY_ROUTES.has(routeSeed) ? routeSeed : 'general_story';
    const style = CUSTOM_STORY_STYLES.has(styleSeed) ? styleSeed : '细腻沉浸';
    const constraints = normalizeStringArray(rawStory?.custom_constraints, [
        '行动必须经过世界规则校验',
        '每一幕都要产生清晰后果',
        '关键矛盾不能一次说穿',
    ]);
    const openingText = normalizeString(rawStory?.opening, seedText, 96).replace(/^开场：?/, '');

    return {
        id: null,
        is_custom: true,
        title: normalizeString(rawStory?.title, '自定义故事', 18),
        spacetime: normalizeString(rawStory?.spacetime, '用户自定义时空', 80),
        theme: normalizeString(rawStory?.theme, seedText, 90),
        protagonist_setup: normalizeString(rawStory?.protagonist_setup, '由玩家昵称定义的入局者', 90),
        system_type: normalizeString(intent?.system_type ?? rawStory?.system_type, '无', 36),
        custom_constraints: constraints,
        meta_theme: normalizeString(intent?.meta_theme ?? rawStory?.meta_theme, storyClass, 36),
        story_class: storyClass,
        style,
        route,
        opening: `开场：${openingText}`,
        seed_text: seedText,
    };
}

function buildCustomStoryPrompt(seedText, uiProfiles = {}) {
    const storyClasses = getAllowedStoryClasses(uiProfiles);
    return [
        '你是 DayDreamer 的世界创建器。请根据用户输入，先按五维法则提炼世界，再生成一个可直接写入 stories.json 的单个故事对象。',
        '',
        '五维法则：',
        '1. spacetime：时代/地区/文明层级/社会条件，决定技术上限与制度边界。',
        '2. theme：核心驱动力，决定主要冲突形态。',
        '3. protagonist_setup：主角身份+位置+处境+优势短板。',
        '4. system_type：显性玩法机制；没有就写“无”。',
        '5. custom_constraints：三条不可违背的世界规则，每条短而具体。',
        '',
        `story_class 必须从这些中文值中选择：${storyClasses.join('、')}`,
        'route 必须从这些英文值中选择：general_story、short_drama、immersive_novel、romance_tension、suspense_investigation、power_game、healing_growth',
        'style 必须从这些中文值中选择：写实压迫、细腻沉浸、爽文推进、黑色幽默',
        '',
        '分类倾向：',
        '- 不要把模糊脑洞默认写成悬疑。只有用户明确要求悬疑、破案、调查、真相、怪谈、失踪、诡异、规则异常时，才优先选择 story_class=悬疑烧脑 或 route=suspense_investigation。',
        '- 用户提到“一千万、突然暴富、神豪、到账、彩票、花钱、消费、被看不起后翻盘”等财富/逆袭爽点时，默认 story_class=打脸逆袭，route=short_drama，style=爽文推进；重点是压制、诱惑、消费选择、公开反应和筹码变化，不要写成无脑炫富。',
        '- 用户提到创业、经营、开店、公司、生意、投资、现金流、市场窗口时，默认 story_class=经营积累；若同时有打脸/短剧/逆袭诉求，route=short_drama，否则用 general_story。',
        '- 大众默认体验偏短剧式快速入局：开场三段内出现压迫、诱惑、争夺、地位落差或必须决策的问题。',
        '',
        '只输出 JSON，不要 Markdown，不要解释。JSON 字段必须严格为：',
        '{"title":"","spacetime":"","theme":"","protagonist_setup":"","system_type":"","custom_constraints":["","",""],"meta_theme":"","story_class":"","style":"","route":"","opening":""}',
        '',
        '要求：',
        '- title 2 到 8 个中文字符，像故事库标题，不要叫“自定义故事”。',
        '- opening 必须以“开场：”开头，并给出第一幕的具体触发事件。',
        '- 内容必须使用简体中文。',
        '',
        `[用户输入]\n${seedText}`,
    ].join('\n');
}

async function readCompletionJsonResponse(response) {
    const payload = await response.json();
    if (payload?.error) {
        throw new Error(payload.error?.message || payload.error || 'Custom story generation failed.');
    }
    return extractAssistantText(payload);
}

async function generateCustomStoryViaSillyTavern(request, messages, settings, fallbackProvider) {
    const providerBody = {
        ...buildProviderBody(settings, messages, fallbackProvider),
        stream: false,
        temperature: 0.72,
        max_tokens: Math.min(Number(fallbackProvider.responseTokens || 1200), 1400),
    };
    const upstream = await callInternalApi(request, '/api/backends/chat-completions/generate', {
        method: 'POST',
        body: providerBody,
        accept: 'application/json',
    });

    if (!upstream.ok) {
        const errorText = await upstream.text().catch(() => '');
        throw new Error(`SillyTavern custom story dispatch failed: ${upstream.status} ${errorText}`);
    }

    return await readCompletionJsonResponse(upstream);
}

async function generateCustomStoryViaFallback(fallbackProvider, messages) {
    const upstream = await fetch(`${fallbackProvider.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${fallbackProvider.apiKey}`,
        },
        body: JSON.stringify({
            model: fallbackProvider.model,
            messages,
            temperature: 0.72,
            max_tokens: Math.min(Number(fallbackProvider.responseTokens || 1200), 1400),
            stream: false,
        }),
    });

    if (!upstream.ok) {
        const errorText = await upstream.text().catch(() => '');
        throw new Error(`Fallback custom story dispatch failed: ${upstream.status} ${errorText}`);
    }

    return await readCompletionJsonResponse(upstream);
}

function getBaseProfile(uiProfiles = {}) {
    return structuredClone(
        uiProfiles['通用']
        ?? uiProfiles.general
        ?? Object.values(uiProfiles)[0]
        ?? { top_stats: [], tabs: [] },
    );
}

function getProductTabs(profile) {
    const tabs = [...(profile?.tabs ?? [])];
    if (!tabs.some(tab => tab.key === 'world')) {
        const settingsIndex = tabs.findIndex(tab => tab.key === 'settings');
        const worldTab = { key: 'world', label: '世界书' };
        if (settingsIndex >= 0) {
            tabs.splice(settingsIndex, 0, worldTab);
        } else {
            tabs.push(worldTab);
        }
    }

    return tabs;
}

function buildFallbackMessages({ body, story, uiProfiles, corePrompt, turnPrompt, endingPrompt }) {
    const state = body.state ?? {};
    const history = [];
    const message = compact(body.message, '');
    const isEnding = /^\s*(结束|end)\s*$/i.test(message);
    const baseProfile = getBaseProfile(uiProfiles);
    const storyProfile = story?.story_class && uiProfiles[story.story_class] ? structuredClone(uiProfiles[story.story_class]) : {};
    const profile = {
        ...baseProfile,
        ...storyProfile,
        ...(story?.ui_profile ?? {}),
        top_stats: story?.ui_profile?.top_stats ?? storyProfile.top_stats ?? baseProfile.top_stats ?? [],
        tabs: story?.ui_profile?.tabs ?? storyProfile.tabs ?? baseProfile.tabs ?? [],
    };
    const visibleStats = (profile.top_stats ?? []).map(stat => ({
        key: stat.key,
        label: stat.label,
        value: state.stats?.[stat.key],
    }));

    const systemPrompt = [
        corePrompt,
        '',
        '[DayDreamer Current Story]',
        JSON.stringify(story ?? {}, null, 2),
        '',
        '[DayDreamer Current State]',
        JSON.stringify({
            story_title: story?.title ?? state.story_title ?? '',
            route: story?.route ?? state.route ?? 'general_story',
            story_class: story?.story_class ?? state.story_class ?? '',
            style: story?.style ?? '',
            current_stage: state.current_stage ?? 'opening',
            stage_progress: state.stage_progress ?? 0,
            stats: state.stats ?? {},
            character: state.character ?? {},
            relationships: state.relationships ?? [],
            world_entries: Array.isArray(state.world_entries) ? state.world_entries.filter(entry => entry?.enabled !== false) : [],
            resources: state.resources ?? [],
            triggered_events: state.triggered_events ?? [],
            main_objective: state.main_objective ?? '',
            core_conflict: state.core_conflict ?? story?.theme ?? '',
            pending_foreshadows: state.pending_foreshadows ?? [],
            active_hooks: state.active_hooks ?? [],
            important_branches: state.important_branches ?? [],
            last_options: Array.isArray(state.last_options) ? state.last_options : [],
            near_ending: state.near_ending ?? false,
            visible_stats: visibleStats,
        }, null, 2),
        '',
        '[DayDreamer Visible UI]',
        JSON.stringify({
            top_stats: visibleStats,
            tabs: getProductTabs(profile).map(tab => ({ key: tab.key, label: tab.label })),
        }, null, 2),
        '',
        turnPrompt,
        isEnding ? `\n${endingPrompt}` : '',
    ].join('\n');

    return [
        { role: 'system', content: systemPrompt },
        ...history
            .filter(item => item && ['user', 'assistant'].includes(item.role) && item.content)
            .map(item => ({ role: item.role, content: String(item.content).slice(0, MAX_MESSAGE_LENGTH) })),
        { role: 'user', content: message || 'Begin the DayDreamer story.' },
    ];
}

async function dispatchFallbackProvider(provider, messages, response) {
    const upstream = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
            Authorization: `Bearer ${provider.apiKey}`,
        },
        body: JSON.stringify({
            model: provider.model,
            messages,
            temperature: 0.85,
            max_tokens: provider.responseTokens,
            stream: true,
        }),
    });

    if (!upstream.ok) {
        const errorText = await upstream.text();
        console.error('DayDreamer fallback provider error:', upstream.status, errorText);
        response.status(502).json({ error: 'DayDreamer provider request failed.' });
        return null;
    }

    response.setHeader('Content-Type', upstream.headers.get('content-type') || 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('X-Accel-Buffering', 'no');
    response.setHeader('X-DayDreamer-Model', provider.model);
    return upstream;
}

function requireSessionSupport(request, response) {
    if (!request.user?.directories) {
        response.status(403).json({ error: 'DayDreamer server sessions require a SillyTavern user context.' });
        return false;
    }

    return true;
}

router.get('/bootstrap', async (request, response) => {
    const fallbackProvider = getFallbackProviderConfig();
    const settings = request.user ? readUserSettings(request) : {};
    const sillyTavern = await listSillyTavernResources(request);

    response.json({
        provider: toPublicProviderConfig(fallbackProvider, settings),
        stories: readJson(STORIES_PATH, []),
        uiProfiles: readJson(UI_PROFILES_PATH, {}),
        sillyTavern,
    });
});

router.post('/st/chats', async (request, response) => {
    if (!requireSessionSupport(request, response)) {
        return;
    }

    if (!request.body?.avatar_url) {
        return response.json([]);
    }

    try {
        const chats = await readInternalJson(request, '/api/characters/chats', {
            avatar_url: request.body.avatar_url,
            simple: true,
        });
        return response.json(Array.isArray(chats) ? chats : []);
    } catch (error) {
        console.error('Failed to list DayDreamer character chats:', error);
        return response.status(500).json({ error: 'Failed to list SillyTavern chats.' });
    }
});

router.post('/session/create', (request, response) => {
    if (!requireSessionSupport(request, response)) {
        return;
    }

    const session = createSession(request.user.directories, {
        st_context: request.body?.st_context ?? {},
        state: request.body?.state ?? {},
        history: [],
    });

    response.json(session);
});

router.post('/session/get', (request, response) => {
    if (!requireSessionSupport(request, response)) {
        return;
    }

    const session = loadSession(request.user.directories, request.body?.session_id);
    if (!session) {
        return response.status(404).json({ error: 'DayDreamer session not found.' });
    }

    response.json(session);
});

router.post('/session/load', (request, response) => {
    if (!requireSessionSupport(request, response)) {
        return;
    }

    const session = loadSession(request.user.directories, request.body?.session_id);
    if (!session) {
        return response.status(404).json({ error: 'DayDreamer session not found.' });
    }

    response.json(session);
});

router.post('/session/save', (request, response) => {
    if (!requireSessionSupport(request, response)) {
        return;
    }

    const session = upsertSession(request.user.directories, request.body?.session_id, {
        st_context: request.body?.st_context ?? {},
        state: request.body?.state ?? {},
        history: [],
    });

    response.json(session);
});

router.post('/custom-story', async (request, response) => {
    const fallbackProvider = getFallbackProviderConfig();
    const seedText = String(request.body?.text ?? '').trim().slice(0, CUSTOM_STORY_MAX_LENGTH);

    if (!seedText) {
        return response.status(400).json({ error: '请输入一个自定义游戏设定。' });
    }

    if (!request.user?.directories && !fallbackProvider.enabled) {
        return response.status(503).json({
            error: '服务器尚未配置 DayDreamer 模型。请让管理员设置 DayDreamer_API_KEY，或登录后使用 SillyTavern 模型配置。',
        });
    }

    const uiProfiles = readJson(UI_PROFILES_PATH, {});
    const messages = [
        {
            role: 'system',
            content: buildCustomStoryPrompt(seedText, uiProfiles),
        },
        {
            role: 'user',
            content: '生成 stories.json 兼容的单个故事对象。',
        },
    ];

    try {
        const text = request.user?.directories
            ? await generateCustomStoryViaSillyTavern(request, messages, readUserSettings(request), fallbackProvider)
            : await generateCustomStoryViaFallback(fallbackProvider, messages);
        const rawStory = extractJsonObject(text);
        const story = normalizeGeneratedStory(rawStory, seedText, uiProfiles);

        return response.json({ story });
    } catch (error) {
        console.error('DayDreamer custom story generation failed:', error);
        return response.status(500).json({ error: '虚拟世界创建失败，请稍后再试。' });
    }
});

router.post('/generate', async (request, response) => {
    const fallbackProvider = getFallbackProviderConfig();
    const body = request.body ?? {};
    const stories = readJson(STORIES_PATH, []);
    const uiProfiles = readJson(UI_PROFILES_PATH, {});
    const story = getStoryFromRequest(stories, body);

    if (!story && !body.state?.custom_story) {
        return response.status(400).json({ error: 'No DayDreamer story was provided.' });
    }

    const corePrompt = readPrompt(CORE_PROMPT_PATH);
    const turnPrompt = readPrompt(TURN_PROMPT_PATH);
    const endingPrompt = readPrompt(ENDING_PROMPT_PATH);

    try {
        let session = null;
        if (request.user?.directories) {
            session = upsertSession(request.user.directories, body.session_id, {
                st_context: body.st_context ?? {},
                state: body.state ?? {},
                history: [],
            });
            response.setHeader('X-DayDreamer-Session-Id', session.session_id);
        }

        if (request.user?.directories) {
            const generation = await assembleDayDreamerGeneration(request, body, session, {
                story,
                uiProfiles,
                corePrompt,
                turnPrompt,
                endingPrompt,
                fallbackProvider,
            });

            session = session ? saveSession(request.user.directories, {
                ...session,
                st_context: generation.st_context,
                state: body.state ?? session.state,
                history: [],
                st_summary: generation.st_summary,
                story_id: body.state?.story_id ?? story?.id ?? session.story_id,
                character_avatar: generation.st_context.avatar_url ?? session.character_avatar,
                chat_name: generation.st_context.chat_name ?? session.chat_name,
                selected_world_info: generation.st_summary.world_info_names ?? session.selected_world_info,
                author_note_config: generation.st_context.author_note ? { prompt: generation.st_context.author_note } : (session.author_note_config ?? {}),
                system_prompt_override: generation.st_context.system_prompt ?? session.system_prompt_override,
                preset_identity: generation.resolvedProvider.model ?? session.preset_identity,
                provider_source: generation.resolvedProvider.chat_completion_source ?? session.provider_source,
            }) : null;

            const upstream = await dispatchViaSillyTavern(request, generation.providerBody);

            if (!upstream.ok) {
                const errorText = await upstream.text().catch(() => '');
                console.error('DayDreamer ST dispatch failed:', upstream.status, errorText);
                return response.status(502).json({ error: 'DayDreamer SillyTavern dispatch failed.' });
            }

            response.setHeader('X-DayDreamer-Model', generation.resolvedProvider.model || fallbackProvider.model);
            if (session?.session_id) {
                response.setHeader('X-DayDreamer-Session-Id', session.session_id);
            }
            return await proxyEventStream(upstream, response, {
                onComplete: async ({ text }) => {
                    if (!session) {
                        return;
                    }

                    try {
                        const persisted = await persistDayDreamerTurn(
                            request,
                            session,
                            { ...body, story },
                            generation,
                            text,
                        );

                        session = saveSession(request.user.directories, {
                            ...session,
                            ...persisted,
                            chat_metadata: persisted.chatMetadata ?? session.chat_metadata,
                            st_context: persisted.st_context ?? generation.st_context,
                            state: body.state ?? persisted.state,
                            history: [],
                            st_summary: generation.st_summary,
                            story_id: body.state?.story_id ?? story?.id ?? persisted.story_id,
                            character_avatar: persisted.st_context?.avatar_url ?? generation.st_context.avatar_url ?? persisted.character_avatar,
                            chat_name: persisted.st_context?.chat_name ?? generation.st_context.chat_name ?? persisted.chat_name,
                            selected_world_info: generation.st_summary.world_info_names ?? persisted.selected_world_info,
                            author_note_config: generation.st_context.author_note ? { prompt: generation.st_context.author_note } : (persisted.author_note_config ?? {}),
                            system_prompt_override: generation.st_context.system_prompt ?? persisted.system_prompt_override,
                            preset_identity: generation.resolvedProvider.model ?? persisted.preset_identity,
                            provider_source: generation.resolvedProvider.chat_completion_source ?? persisted.provider_source,
                        });
                    } catch (error) {
                        console.error('Failed to persist DayDreamer lightweight session metadata:', error);
                    }
                },
            });
        }

        if (!fallbackProvider.enabled) {
            return response.status(503).json({
                error: 'DayDreamer generation is not configured. Log in to use SillyTavern-backed generation or set DayDreamer_API_KEY as a fallback.',
            });
        }

        const messages = buildFallbackMessages({ body, story, uiProfiles, corePrompt, turnPrompt, endingPrompt });
        const upstream = await dispatchFallbackProvider(fallbackProvider, messages, response);
        if (!upstream) {
            return;
        }

        return forwardFetchResponse(upstream, response);
    } catch (error) {
        console.error('DayDreamer generation failed:', error);
        if (response.headersSent) {
            return response.end();
        }
        return response.status(500).json({ error: 'DayDreamer generation failed.' });
    }
});
