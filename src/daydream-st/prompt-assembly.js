import {
    buildStateBlock,
    extractAuthorNote,
    extractCharacterContext,
    extractChatMessages,
    extractSystemPrompt,
    flattenWorldInfoBooks,
    getDayDreamProfile,
    getProviderSummaryFromSettings,
} from './context-loader.js';

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
    };
}

export function buildSystemSections({ story, state, uiProfiles, corePrompt, turnPrompt, endingPrompt, settings, stContext, stData, message }) {
    const isEnding = /^\s*(?:end|\u7ed3\u675f)\s*$/i.test(String(message ?? ''));
    const profile = getDayDreamProfile(story, uiProfiles ?? {});
    const stateBlock = buildStateBlock(story, state, profile);
    const systemPrompt = extractSystemPrompt(settings, stData.characterData, stData.chatMetadata, stContext);
    const authorNote = extractAuthorNote(settings, stData.chatMetadata, stContext);
    const characterContext = extractCharacterContext(stData.characterData, stData.chatMetadata);
    const worldInfoText = flattenWorldInfoBooks(stData.worldBooks);
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

    sections.push([
        '[DayDream Current Story]',
        JSON.stringify(story ?? {}, null, 2),
        '',
        '[DayDream Current State]',
        JSON.stringify(stateBlock, null, 2),
        '',
        '[DayDream Visible UI]',
        JSON.stringify({
            top_stats: stateBlock.visible_stats,
            tabs: (profile.tabs ?? []).map(tab => ({ key: tab.key, label: tab.label })),
            mapping: uiMapping,
        }, null, 2),
        '',
        '[DayDream Output Contract] Visible text must output title, environment, plot, and options first. State changes, resources, events, relationships, foreshadows, and stat updates must be written to the ending <!-- DAYDREAM_META ... --> JSON comment block. Only update keys visible in top_stats.',
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
        { role: 'user', content: compact(message, '') || 'Begin the DayDream story.' },
    ];
}

export function buildProviderBody(settings, messages, fallbackProvider) {
    const oai = settings.oai_settings ?? {};
    const provider = getProviderSummaryFromSettings(settings, fallbackProvider);

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
        max_tokens: oai.openai_max_tokens ?? fallbackProvider.responseTokens ?? 1200,
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
