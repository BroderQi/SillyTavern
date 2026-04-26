import fs from 'node:fs';
import path from 'node:path';

import { SETTINGS_FILE } from '../constants.js';
import { getChatData } from '../endpoints/chats.js';
import { readWorldInfoFile } from '../endpoints/worldinfo.js';
import { serverDirectory } from '../server-directory.js';
import { humanizedDateTime } from '../util.js';
import { readInternalJson } from './internal-api.js';

const MAX_HISTORY_ITEMS = 12;
const MAX_MESSAGE_LENGTH = 4000;

function compact(value, fallback) {
    if (value === undefined || value === null) {
        return fallback;
    }

    if (typeof value === 'string') {
        return value.slice(0, MAX_MESSAGE_LENGTH);
    }

    return value;
}

function defaultSettings() {
    const defaultPath = path.join(serverDirectory, 'default', 'content', SETTINGS_FILE);

    try {
        return JSON.parse(fs.readFileSync(defaultPath, 'utf8'));
    } catch {
        return {};
    }
}

export function readUserSettings(request) {
    const fallback = defaultSettings();

    if (!request?.user?.directories?.root) {
        return fallback;
    }

    const settingsPath = path.join(request.user.directories.root, SETTINGS_FILE);
    if (!fs.existsSync(settingsPath)) {
        return fallback;
    }

    try {
        return { ...fallback, ...JSON.parse(fs.readFileSync(settingsPath, 'utf8')) };
    } catch (error) {
        console.error('Failed to parse DayDreamer user settings:', error);
        return fallback;
    }
}

function getModelForSource(oaiSettings = {}, fallbackModel = '') {
    switch (oaiSettings.chat_completion_source) {
        case 'openai':
            return oaiSettings.openai_model || fallbackModel;
        case 'claude':
            return oaiSettings.claude_model || fallbackModel;
        case 'openrouter':
            return oaiSettings.openrouter_model || fallbackModel;
        case 'ai21':
            return oaiSettings.ai21_model || fallbackModel;
        case 'makersuite':
            return oaiSettings.google_model || fallbackModel;
        case 'vertexai':
            return oaiSettings.vertexai_model || fallbackModel;
        case 'mistralai':
            return oaiSettings.mistralai_model || fallbackModel;
        case 'custom':
            return oaiSettings.custom_model || fallbackModel;
        case 'cohere':
            return oaiSettings.cohere_model || fallbackModel;
        case 'perplexity':
            return oaiSettings.perplexity_model || fallbackModel;
        case 'groq':
            return oaiSettings.groq_model || fallbackModel;
        case 'electronhub':
            return oaiSettings.electronhub_model || fallbackModel;
        case 'chutes':
            return oaiSettings.chutes_model || fallbackModel;
        case 'nanogpt':
            return oaiSettings.nanogpt_model || fallbackModel;
        case 'deepseek':
            return oaiSettings.deepseek_model || fallbackModel;
        case 'aimlapi':
            return oaiSettings.aimlapi_model || fallbackModel;
        case 'xai':
            return oaiSettings.xai_model || fallbackModel;
        case 'pollinations':
            return oaiSettings.pollinations_model || fallbackModel;
        case 'moonshot':
            return oaiSettings.moonshot_model || fallbackModel;
        case 'fireworks':
            return oaiSettings.fireworks_model || fallbackModel;
        case 'cometapi':
            return oaiSettings.cometapi_model || fallbackModel;
        case 'azure_openai':
            return oaiSettings.azure_openai_model || fallbackModel;
        case 'zai':
            return oaiSettings.zai_model || fallbackModel;
        case 'siliconflow':
            return oaiSettings.siliconflow_model || fallbackModel;
        default:
            return fallbackModel;
    }
}

export function getProviderSummaryFromSettings(settings = {}, fallback = {}) {
    const oai = settings.oai_settings ?? {};
    const source = oai.chat_completion_source || fallback.chat_completion_source || 'openai';
    const model = getModelForSource(oai, fallback.model || '');

    return {
        configured: Boolean(model || fallback.configured),
        chat_completion_source: source,
        model,
    };
}

export async function listSillyTavernResources(request) {
    if (!request.user?.directories) {
        return {
            available: false,
            characters: [],
            world_names: [],
        };
    }

    try {
        const characterFiles = fs.readdirSync(request.user.directories.characters, { withFileTypes: true })
            .filter(file => file.isFile() && path.extname(file.name).toLowerCase() === '.png')
            .map(file => ({
                name: path.parse(file.name).name,
                avatar_url: file.name,
            }));
        const worldNames = fs.readdirSync(request.user.directories.worlds, { withFileTypes: true })
            .filter(file => file.isFile() && path.extname(file.name).toLowerCase() === '.json')
            .map(file => path.parse(file.name).name)
            .sort((a, b) => a.localeCompare(b));

        return {
            available: true,
            characters: characterFiles,
            world_names: worldNames,
        };
    } catch (error) {
        console.warn('Failed to enumerate SillyTavern DayDreamer resources:', error.message);
        return {
            available: false,
            characters: [],
            world_names: [],
        };
    }
}

export function getDayDreamerProfile(story, uiProfiles = {}) {
    let profile = structuredClone(uiProfiles['通用'] ?? uiProfiles.general ?? Object.values(uiProfiles)[0] ?? { top_stats: [], tabs: [] });

    if (story?.story_class && uiProfiles[story.story_class]) {
        profile = {
            ...profile,
            ...structuredClone(uiProfiles[story.story_class]),
            top_stats: uiProfiles[story.story_class]?.top_stats ?? profile.top_stats,
            tabs: uiProfiles[story.story_class]?.tabs ?? profile.tabs,
        };
    }

    if (story?.ui_profile) {
        profile = {
            ...profile,
            ...story.ui_profile,
            top_stats: story.ui_profile?.top_stats ?? profile.top_stats,
            tabs: story.ui_profile?.tabs ?? profile.tabs,
        };
    }

    return profile;
}

export function buildStateBlock(story, state, profile) {
    const visibleStats = (profile.top_stats ?? []).map(stat => ({
        key: stat.key,
        label: stat.label,
        value: state.stats?.[stat.key],
    }));

    return {
        story_title: story?.title ?? state.story_title ?? '',
        route: story?.route ?? state.route ?? 'general_story',
        story_class: story?.story_class ?? state.story_class ?? '',
        style: story?.style ?? '',
        current_stage: state.current_stage ?? 'opening',
        stage_progress: state.stage_progress ?? 0,
        stats: state.stats ?? {},
        character: state.character ?? {},
        relationships: state.relationships ?? [],
        world_entries: Array.isArray(state.world_entries)
            ? state.world_entries.filter(entry => entry?.enabled !== false)
            : [],
        resources: state.resources ?? [],
        triggered_events: state.triggered_events ?? [],
        main_objective: state.main_objective ?? '',
        core_conflict: state.core_conflict ?? story?.theme ?? '',
        pending_foreshadows: state.pending_foreshadows ?? [],
        active_hooks: state.active_hooks ?? [],
        important_branches: state.important_branches ?? [],
        last_scene: state.last_scene ?? null,
        last_status_text: state.last_status_text ?? '',
        last_options: Array.isArray(state.last_options) ? state.last_options : [],
        near_ending: state.near_ending ?? false,
        visible_stats: visibleStats,
    };
}

export function normalizeHistoryItems(history) {
    return (Array.isArray(history) ? history : [])
        .filter(item => item && ['user', 'assistant'].includes(item.role) && item.content)
        .map(item => ({
            role: item.role,
            content: String(item.content).slice(0, MAX_MESSAGE_LENGTH),
        }))
        .slice(-MAX_HISTORY_ITEMS);
}

export function extractChatMetadata(chatData) {
    return chatData?.[0]?.chat_metadata ?? {};
}

export function extractChatMessages(chatData) {
    return (Array.isArray(chatData) ? chatData.slice(1) : [])
        .filter(message => message && !message.is_system && typeof message.mes === 'string')
        .map(message => ({
            role: message.is_user ? 'user' : 'assistant',
            content: String(message.mes).slice(0, MAX_MESSAGE_LENGTH),
        }))
        .slice(-MAX_HISTORY_ITEMS);
}

export function extractAuthorNote(settings, chatMetadata, stContext) {
    return compact(
        stContext.author_note
        ?? chatMetadata.note_prompt
        ?? settings.extension_settings?.note?.default
        ?? '',
        '',
    );
}

export function extractSystemPrompt(settings, characterData, chatMetadata, stContext) {
    return compact(
        stContext.system_prompt
        ?? chatMetadata.system_prompt
        ?? characterData?.data?.system_prompt
        ?? (settings.power_user?.sysprompt?.enabled ? settings.power_user?.sysprompt?.content : '')
        ?? '',
        '',
    );
}

export function extractCharacterContext(characterData, chatMetadata) {
    if (!characterData) {
        return {};
    }

    return {
        name: characterData.name,
        description: compact(characterData.description, ''),
        personality: compact(characterData.personality, ''),
        scenario: compact(chatMetadata.scenario ?? characterData.scenario, ''),
        mesExamples: compact(chatMetadata.mes_example ?? characterData.mes_example, ''),
        creatorNotes: compact(characterData?.data?.creator_notes, ''),
        postHistoryInstructions: compact(characterData?.data?.post_history_instructions, ''),
        depthPrompt: compact(characterData?.data?.extensions?.depth_prompt?.prompt, ''),
    };
}

function formatWorldInfoEntry(entry) {
    if (!entry || typeof entry !== 'object') {
        return '';
    }

    const keys = Array.isArray(entry.key) ? entry.key.filter(Boolean).join(', ') : '';
    const title = entry.comment || entry.uid || keys || 'Entry';
    const content = compact(entry.content, '');

    if (!content) {
        return '';
    }

    return `- ${title}\n${content}`;
}

export function flattenWorldInfoBooks(books) {
    const sections = [];

    for (const [name, book] of Object.entries(books ?? {})) {
        const entries = Object.values(book?.entries ?? {})
            .map(formatWorldInfoEntry)
            .filter(Boolean)
            .join('\n\n');

        if (entries) {
            sections.push(`[World Info: ${name}]\n${entries}`);
        }
    }

    return sections.join('\n\n');
}

function getChatFilePath(directories, avatarUrl, chatName) {
    const characterDirectory = String(avatarUrl).replace('.png', '');
    return path.join(directories.chats, characterDirectory, `${chatName}.jsonl`);
}

export async function loadSillyTavernContext(request, stContext = {}) {
    if (!request.user?.directories) {
        return {
            characterData: null,
            chatData: [],
            chatMetadata: {},
            worldBooks: {},
            resolvedContext: { ...stContext },
        };
    }

    const characterData = stContext.avatar_url
        ? await readInternalJson(request, '/api/characters/get', {
            avatar_url: stContext.avatar_url,
        }).catch(() => null)
        : null;

    const shouldLoadChatHistory = stContext.enable_chat_history === true;
    const candidateChatName = shouldLoadChatHistory ? (stContext.chat_name || characterData?.chat || '') : '';
    const chatFilePath = shouldLoadChatHistory && stContext.avatar_url && candidateChatName
        ? getChatFilePath(request.user.directories, stContext.avatar_url, candidateChatName)
        : '';
    const chatData = chatFilePath && fs.existsSync(chatFilePath)
        ? getChatData(chatFilePath)
        : [];
    const chatMetadata = extractChatMetadata(chatData);
    const configuredWorlds = new Set([
        ...(Array.isArray(stContext.world_info_names) ? stContext.world_info_names : []),
        chatMetadata.world_info,
        characterData?.data?.extensions?.world,
    ].filter(Boolean));

    const worldBooks = {};
    for (const worldName of configuredWorlds) {
        worldBooks[worldName] = readWorldInfoFile(request.user.directories, worldName, true);
    }

    return {
        characterData,
        chatData,
        chatMetadata,
        worldBooks,
        resolvedContext: {
            ...stContext,
            chat_name: candidateChatName || stContext.chat_name || '',
            world_info_names: [...configuredWorlds],
        },
    };
}

export function buildStSummary(stData) {
    return {
        has_character: Boolean(stData.characterData),
        has_chat: extractChatMessages(stData.chatData).length > 0,
        world_info_names: Object.keys(stData.worldBooks ?? {}).filter(name => stData.worldBooks[name]),
    };
}

export function getResolvedChatBinding({ stContext = {}, stData = {}, story = {}, state = {}, settings = {} }) {
    if (!stContext.avatar_url) {
        return {
            avatar_url: '',
            chat_name: '',
            user_name: stContext.user_name || settings.username || 'User',
            character_name: stContext.character_name || stData.characterData?.name || state.character?.name || 'Character',
        };
    }

    const baseName = story?.title || state?.story_title || stData.characterData?.name || 'DayDreamer';

    return {
        avatar_url: stContext.avatar_url,
        chat_name: stContext.chat_name || stData.resolvedContext?.chat_name || `${baseName} - ${humanizedDateTime()}`,
        user_name: stContext.user_name || settings.username || 'User',
        character_name: stContext.character_name || stData.characterData?.name || 'Character',
    };
}
