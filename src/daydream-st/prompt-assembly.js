import {
    buildStateBlock,
    extractAuthorNote,
    extractCharacterContext,
    extractChatMessages,
    extractSystemPrompt,
    flattenWorldInfoBooks,
    getDayDreamerProfile,
    getProviderSummaryFromSettings,
} from './context-loader.js';

const MAX_MESSAGE_LENGTH = 4000;
const DAYDREAM_MIN_RESPONSE_TOKENS = 4096;

function compact(value, fallback) {
    if (value === undefined || value === null) {
        return fallback;
    }

    if (typeof value === 'string') {
        return value.slice(0, MAX_MESSAGE_LENGTH);
    }

    return value;
}

function getUiMapping(profile) {
    const findLabel = (key, fallback) => profile.tabs?.find(tab => tab.key === key)?.label ?? fallback;

    return {
        top_stats: 'Only update keys that are visible in the current top stats bar.',
        stats: {
            tab_label: findLabel('stats', 'Stats'),
            fields: ['status_changes', 'stats_delta', 'stats'],
        },
        relations: {
            tab_label: findLabel('relations', 'Relations'),
            fields: ['relationships'],
        },
        messages: {
            tab_label: findLabel('messages', 'Messages'),
            fields: ['active_hooks', 'pending_foreshadows'],
        },
        events: {
            tab_label: findLabel('events', 'Events'),
            fields: ['events', 'important_branches'],
        },
        inventory: {
            tab_label: findLabel('inventory', 'Inventory'),
            fields: ['resources'],
        },
        world: {
            tab_label: findLabel('world', 'World Book'),
            fields: ['world_entries'],
        },
    };
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

function formatDayDreamerWorldEntry(entry) {
    if (!entry || typeof entry !== 'object' || entry.enabled === false) {
        return '';
    }

    const title = compact(entry.title || entry.name || entry.comment || 'World Entry', 'World Entry');
    const keys = Array.isArray(entry.keys) && entry.keys.length
        ? `Keywords: ${entry.keys.join(', ')}`
        : '';
    const content = compact(entry.content || entry.detail || entry.description || entry.summary || '', '');

    if (!content && !keys) {
        return '';
    }

    return [`- ${title}`, keys, content].filter(Boolean).join('\n');
}

function buildDayDreamerWorldBook(state) {
    const entries = Array.isArray(state?.world_entries)
        ? state.world_entries.map(formatDayDreamerWorldEntry).filter(Boolean)
        : [];

    if (!entries.length) {
        return '';
    }

    return `[DayDreamer Editable World Book]\n${entries.join('\n\n')}`;
}

export function buildSystemSections({ story, state, uiProfiles, corePrompt, turnPrompt, endingPrompt, settings, stContext, stData, message }) {
    const isEnding = /^\s*(?:end|\u7ed3\u675f)\s*$/i.test(String(message ?? ''));
    const profile = getDayDreamerProfile(story, uiProfiles ?? {});
    const stateBlock = buildStateBlock(story, state, profile);
    const systemPrompt = extractSystemPrompt(settings, stData.characterData, stData.chatMetadata, stContext);
    const authorNote = extractAuthorNote(settings, stData.chatMetadata, stContext);
    const characterContext = extractCharacterContext(stData.characterData, stData.chatMetadata);
    const worldInfoText = flattenWorldInfoBooks(stData.worldBooks);
    const DayDreamerWorldBook = buildDayDreamerWorldBook(state);
    const uiMapping = getUiMapping(profile);
    const sections = [corePrompt];

    if (systemPrompt) {
        sections.push(`[SillyTavern System Prompt]\n${systemPrompt}`);
    }

    if (characterContext.name || characterContext.description || characterContext.personality || characterContext.scenario) {
        sections.push([
            '[SillyTavern Character Card]',
            characterContext.name ? `Name: ${characterContext.name}` : '',
            characterContext.description ? `Description:\n${characterContext.description}` : '',
            characterContext.personality ? `Personality:\n${characterContext.personality}` : '',
            characterContext.scenario ? `Scenario:\n${characterContext.scenario}` : '',
            characterContext.mesExamples ? `Example Dialogue:\n${characterContext.mesExamples}` : '',
            characterContext.creatorNotes ? `Creator Notes:\n${characterContext.creatorNotes}` : '',
            characterContext.depthPrompt ? `Depth Prompt:\n${characterContext.depthPrompt}` : '',
            characterContext.postHistoryInstructions ? `Post-History Instructions:\n${characterContext.postHistoryInstructions}` : '',
        ].filter(Boolean).join('\n\n'));
    }

    if (authorNote) {
        sections.push(`[SillyTavern Author's Note]\n${authorNote}`);
    }

    if (worldInfoText) {
        sections.push(worldInfoText);
    }

    if (DayDreamerWorldBook) {
        sections.push(DayDreamerWorldBook);
    }

    sections.push([
        '[DayDreamer Current Story]',
        JSON.stringify(story ?? {}, null, 2),
        '',
        '[DayDreamer Current State]',
        JSON.stringify(stateBlock, null, 2),
        '',
        '[DayDreamer Visible UI]',
        JSON.stringify({
            top_stats: stateBlock.visible_stats,
            tabs: getProductTabs(profile).map(tab => ({ key: tab.key, label: tab.label })),
            mapping: uiMapping,
        }, null, 2),
        '',
        '[DayDreamer Continuity Contract]',
        [
            '- Treat Current State and recent chat history as canonical continuity.',
            '- Do not rename existing characters, classmates, teams, places, seats, possessions, or relationships unless the user explicitly changes them or the story reveals an intentional alias.',
            '- If a person already exists in relationships, keep that exact name and role. If a new important person appears, add a stable relationships record in DAYDREAM_META.',
            '- Preserve concrete scene facts from the previous turn, especially location, seating, companions, injuries, resources, promises, and unresolved actions.',
            '- When a new durable fact appears in visible prose, register it in DAYDREAM_META as relationships, events, resources, active_hooks, pending_foreshadows, important_branches, or world_entries so it survives later turns.',
        ].join('\n'),
        '',
        '[DayDreamer Output Contract] Visible text must output exactly these sections in order: 【标题】, 【环境】, 【剧情】, 【选项】. Keep 【剧情】 concise enough that the four options and metadata are never omitted. State changes, people/relationships, resources, events, foreshadows, editable world book entries, and stat updates must be written to the ending <!-- DAYDREAM_META ... --> JSON comment block. Only update keys visible in top_stats. Write durable generated lore to world_entries as objects with title, keys, content, and enabled.',
        '',
        turnPrompt,
        isEnding ? `\n${endingPrompt}` : '',
    ].join('\n'));

    return {
        profile,
        stateBlock,
        systemContent: sections.filter(Boolean).join('\n\n'),
    };
}

export function buildMessages({ systemContent, requestHistory, stChatMessages, message }) {
    const baseHistory = stChatMessages.length > 0 ? stChatMessages : requestHistory;

    return [
        { role: 'system', content: systemContent },
        ...baseHistory,
        { role: 'user', content: compact(message, '') || 'Begin the DayDreamer story.' },
    ];
}

export function buildProviderBody(settings, messages, fallbackProvider) {
    const oai = settings.oai_settings ?? {};
    const provider = getProviderSummaryFromSettings(settings, fallbackProvider);
    const configuredMaxTokens = Number(oai.openai_max_tokens ?? fallbackProvider.responseTokens ?? DAYDREAM_MIN_RESPONSE_TOKENS);
    const maxTokens = Math.max(
        Number.isFinite(configuredMaxTokens) ? configuredMaxTokens : DAYDREAM_MIN_RESPONSE_TOKENS,
        DAYDREAM_MIN_RESPONSE_TOKENS,
    );

    return {
        chat_completion_source: provider.chat_completion_source,
        model: provider.model,
        messages,
        stream: true,
        temperature: oai.temp_openai ?? 1,
        top_p: oai.top_p_openai ?? 1,
        top_k: oai.top_k_openai ?? 0,
        presence_penalty: oai.pres_pen_openai ?? 0,
        frequency_penalty: oai.freq_pen_openai ?? 0,
        max_tokens: maxTokens,
        reverse_proxy: oai.reverse_proxy ?? '',
        proxy_password: oai.proxy_password ?? '',
        custom_url: oai.custom_url ?? '',
        assistant_prefill: oai.assistant_prefill ?? '',
        assistant_impersonation: oai.assistant_impersonation ?? '',
        custom_prompt_post_processing: oai.custom_prompt_post_processing ?? '',
        reasoning_effort: oai.reasoning_effort ?? '',
        verbosity: oai.verbosity ?? '',
        enable_web_search: oai.enable_web_search ?? false,
        custom_include_body: oai.custom_include_body ?? '',
        custom_include_headers: oai.custom_include_headers ?? '',
    };
}

export function assemblePromptPayload({ story, state, uiProfiles, corePrompt, turnPrompt, endingPrompt, settings, stContext, stData, message, requestHistory, fallbackProvider }) {
    const { profile, stateBlock, systemContent } = buildSystemSections({
        story,
        state,
        uiProfiles,
        corePrompt,
        turnPrompt,
        endingPrompt,
        settings,
        stContext,
        stData,
        message,
    });
    const stChatMessages = extractChatMessages(stData.chatData);
    const messages = buildMessages({
        systemContent,
        requestHistory,
        stChatMessages,
        message,
    });

    return {
        profile,
        stateBlock,
        systemContent,
        messages,
        providerBody: buildProviderBody(settings, messages, fallbackProvider),
        resolvedProvider: getProviderSummaryFromSettings(settings, fallbackProvider),
        stChatMessages,
    };
}
