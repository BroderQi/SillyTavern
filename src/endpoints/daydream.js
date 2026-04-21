import fs from 'node:fs';
import path from 'node:path';

import express from 'express';
import fetch from 'node-fetch';

import { serverDirectory } from '../server-directory.js';
import { forwardFetchResponse, getConfigValue, safeReadFileSync } from '../util.js';
import { readInternalJson } from '../DayDreamer-st/internal-api.js';
import {
    listSillyTavernResources,
    assembleDayDreamerGeneration,
    getProviderSummaryFromSettings,
    persistDayDreamerTurn,
    readUserSettings,
} from '../DayDreamer-st/orchestration.js';
import { dispatchViaSillyTavern } from '../DayDreamer-st/provider-dispatch.js';
import { createSession, loadSession, saveSession, upsertSession } from '../DayDreamer-st/session-store.js';
import { proxyEventStream } from '../DayDreamer-st/streaming.js';

export const router = express.Router();

const DayDreamer_DIR = path.join(serverDirectory, 'public', 'scripts', 'extensions', 'third-party', 'DayDreamer');
const STORIES_PATH = path.join(DayDreamer_DIR, 'data', 'stories.json');
const UI_PROFILES_PATH = path.join(DayDreamer_DIR, 'data', 'ui-profiles.json');
const CORE_PROMPT_PATH = path.join(DayDreamer_DIR, 'prompts', 'engine-core.md');
const TURN_PROMPT_PATH = path.join(DayDreamer_DIR, 'prompts', 'turn-injection.md');
const ENDING_PROMPT_PATH = path.join(DayDreamer_DIR, 'prompts', 'ending.md');

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';
const MAX_MESSAGE_LENGTH = 4000;

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
