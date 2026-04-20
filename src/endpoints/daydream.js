import fs from 'node:fs';
import path from 'node:path';

import express from 'express';

import { serverDirectory } from '../server-directory.js';
import { getConfigValue, safeReadFileSync } from '../util.js';

export const router = express.Router();

const DAYDREAM_DIR = path.join(serverDirectory, 'public', 'scripts', 'extensions', 'third-party', 'daydream');
const STORIES_PATH = path.join(DAYDREAM_DIR, 'data', 'stories.json');
const UI_PROFILES_PATH = path.join(DAYDREAM_DIR, 'data', 'ui-profiles.json');
const CORE_PROMPT_PATH = path.join(DAYDREAM_DIR, 'prompts', 'engine-core.md');
const TURN_PROMPT_PATH = path.join(DAYDREAM_DIR, 'prompts', 'turn-injection.md');
const ENDING_PROMPT_PATH = path.join(DAYDREAM_DIR, 'prompts', 'ending.md');

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';
const MAX_HISTORY_ITEMS = 12;
const MAX_MESSAGE_LENGTH = 4000;

function mergeProfile(base, override) {
    return {
        ...base,
        ...(override ?? {}),
        top_stats: override?.top_stats ?? base.top_stats ?? [],
        tabs: override?.tabs ?? base.tabs ?? [],
    };
}

function getProfile(story, uiProfiles) {
    let profile = structuredClone(uiProfiles['通用'] ?? { top_stats: [], tabs: [] });
    if (story?.story_class && uiProfiles[story.story_class]) {
        profile = mergeProfile(profile, structuredClone(uiProfiles[story.story_class]));
    }
    if (story?.ui_profile) {
        profile = mergeProfile(profile, story.ui_profile);
    }
    return profile;
}

function writeSse(response, event, data) {
    response.write(`event: ${event}\n`);
    response.write(`data: ${JSON.stringify(data)}\n\n`);
    response.flush?.();
}

function getDeltaFromCompletionChunk(chunk) {
    const choice = chunk?.choices?.[0];
    return choice?.delta?.content ?? choice?.message?.content ?? choice?.text ?? '';
}

async function pipeCompletionStream(upstream, response, provider) {
    const contentType = upstream.headers.get('content-type') ?? '';

    response.status(200);
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders?.();

    if (!contentType.includes('text/event-stream')) {
        const data = await upstream.json();
        const text = data?.choices?.[0]?.message?.content ?? '';
        if (text) {
            writeSse(response, 'delta', { text });
        }
        writeSse(response, 'done', { text, model: provider.model });
        response.end();
        return;
    }

    const decoder = new TextDecoder('utf-8');
    const reader = upstream.body?.getReader();
    let pending = '';
    let fullText = '';

    if (!reader) {
        writeSse(response, 'error', { error: 'DayDream provider did not return a readable stream.' });
        response.end();
        return;
    }

    const processLine = (line) => {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) {
            return;
        }

        const payload = trimmed.slice(5).trim();
        if (!payload || payload === '[DONE]') {
            return;
        }

        try {
            const delta = getDeltaFromCompletionChunk(JSON.parse(payload));
            if (delta) {
                fullText += delta;
                writeSse(response, 'delta', { text: delta });
            }
        } catch {
            // Ignore keepalive or provider-specific event frames that are not completion chunks.
        }
    };

    while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        pending += decoder.decode(value, { stream: true });
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() ?? '';
        for (const line of lines) {
            processLine(line);
        }
    }

    pending += decoder.decode();
    for (const line of pending.split(/\r?\n/)) {
        processLine(line);
    }

    writeSse(response, 'done', { text: fullText, model: provider.model });
    response.end();
}

function readJson(filePath, fallback) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        console.error(`Failed to read DayDream JSON file: ${filePath}`, error);
        return fallback;
    }
}

function readPrompt(filePath) {
    return safeReadFileSync(filePath) ?? '';
}

function getProviderConfig() {
    const apiKey = process.env.DAYDREAM_API_KEY || getConfigValue('daydream.apiKey', '');
    const baseUrl = process.env.DAYDREAM_BASE_URL || getConfigValue('daydream.baseUrl', DEFAULT_BASE_URL);
    const model = process.env.DAYDREAM_MODEL || getConfigValue('daydream.model', DEFAULT_MODEL);
    const enabled = Boolean(apiKey) && getConfigValue('daydream.enabled', true, 'boolean');
    const responseTokens = Number(process.env.DAYDREAM_RESPONSE_TOKENS || getConfigValue('daydream.responseTokens', 1200, 'number'));

    return {
        enabled,
        apiKey,
        baseUrl: String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, ''),
        model: String(model || DEFAULT_MODEL),
        responseTokens: Number.isFinite(responseTokens) ? responseTokens : 1200,
    };
}

function toPublicProviderConfig(config) {
    return {
        configured: config.enabled,
        baseUrl: config.baseUrl.replace(/\/\/.*?@/, '//'),
        model: config.model,
    };
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

function getStoryFromRequest(stories, body) {
    if (body.story?.id) {
        return stories.find(story => Number(story.id) === Number(body.story.id)) ?? body.story;
    }

    if (body.state?.story_id) {
        return stories.find(story => Number(story.id) === Number(body.state.story_id)) ?? body.story ?? null;
    }

    return body.story ?? null;
}

function buildMessages({ body, story, uiProfiles, corePrompt, turnPrompt, endingPrompt }) {
    const state = body.state ?? {};
    const history = Array.isArray(body.history) ? body.history.slice(-MAX_HISTORY_ITEMS) : [];
    const message = compact(body.message, '');
    const isEnding = /^\s*结束\s*$/.test(message);
    const profile = getProfile(story, uiProfiles ?? {});
    const visibleStats = (profile.top_stats ?? []).map(stat => ({
        key: stat.key,
        label: stat.label,
        value: state.stats?.[stat.key],
    }));

    const stateBlock = {
        story_title: story?.title ?? state.story_title ?? '',
        route: story?.route ?? state.route ?? 'general_story',
        story_class: story?.story_class ?? state.story_class ?? '',
        style: story?.style ?? '',
        current_stage: state.current_stage ?? 'opening',
        stage_progress: state.stage_progress ?? 0,
        stats: state.stats ?? {},
        character: state.character ?? {},
        relationships: state.relationships ?? [],
        resources: state.resources ?? [],
        triggered_events: state.triggered_events ?? [],
        main_objective: state.main_objective ?? '',
        core_conflict: state.core_conflict ?? story?.theme ?? '',
        pending_foreshadows: state.pending_foreshadows ?? [],
        active_hooks: state.active_hooks ?? [],
        important_branches: state.important_branches ?? [],
        near_ending: state.near_ending ?? false,
        visible_stats: visibleStats,
    };

    const systemPrompt = [
        corePrompt,
        '',
        '【DayDream 当前剧本】',
        JSON.stringify(story ?? {}, null, 2),
        '',
        '【DayDream 当前状态】',
        JSON.stringify(stateBlock, null, 2),
        '',
        '【DayDream 当前可见 UI】',
        JSON.stringify({
            top_stats: visibleStats,
            tabs: (profile.tabs ?? []).map(tab => ({ key: tab.key, label: tab.label })),
        }, null, 2),
        '',
        '【状态变化】优先更新当前可见 UI 中存在的状态项；不要发明与当前剧本无关的属性名。',
        '',
        turnPrompt,
        isEnding ? `\n${endingPrompt}` : '',
    ].join('\n');

    const messages = [
        { role: 'system', content: systemPrompt },
        ...history
            .filter(item => item && ['user', 'assistant'].includes(item.role) && item.content)
            .map(item => ({ role: item.role, content: String(item.content).slice(0, MAX_MESSAGE_LENGTH) })),
        { role: 'user', content: message || '开始 DayDream 故事。' },
    ];

    return messages;
}

router.get('/bootstrap', (_request, response) => {
    const provider = getProviderConfig();
    response.json({
        provider: toPublicProviderConfig(provider),
        stories: readJson(STORIES_PATH, []),
        uiProfiles: readJson(UI_PROFILES_PATH, {}),
    });
});

router.post('/generate', async (request, response) => {
    const provider = getProviderConfig();

    if (!provider.enabled) {
        return response.status(503).json({
            error: 'DayDream public generation is not configured. Set DAYDREAM_API_KEY on the server.',
        });
    }

    const body = request.body ?? {};
    const stories = readJson(STORIES_PATH, []);
    const uiProfiles = readJson(UI_PROFILES_PATH, {});
    const story = getStoryFromRequest(stories, body);

    if (!story && !body.state?.custom_story) {
        return response.status(400).json({ error: 'No DayDream story was provided.' });
    }

    const corePrompt = readPrompt(CORE_PROMPT_PATH);
    const turnPrompt = readPrompt(TURN_PROMPT_PATH);
    const endingPrompt = readPrompt(ENDING_PROMPT_PATH);

    try {
        const upstream = await fetch(`${provider.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'text/event-stream',
                'Authorization': `Bearer ${provider.apiKey}`,
            },
            body: JSON.stringify({
                model: provider.model,
                messages: buildMessages({ body, story, uiProfiles, corePrompt, turnPrompt, endingPrompt }),
                temperature: 0.85,
                max_tokens: provider.responseTokens,
                stream: true,
            }),
        });

        if (!upstream.ok) {
            const errorText = await upstream.text();
            console.error('DayDream provider error:', upstream.status, errorText);
            return response.status(502).json({ error: 'DayDream provider request failed.' });
        }

        return pipeCompletionStream(upstream, response, provider);
    } catch (error) {
        console.error('DayDream generation failed:', error);
        if (response.headersSent) {
            writeSse(response, 'error', { error: 'DayDream generation failed.' });
            return response.end();
        }
        return response.status(500).json({ error: 'DayDream generation failed.' });
    }
});
