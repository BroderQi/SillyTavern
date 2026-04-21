import {
    buildStSummary,
    getProviderSummaryFromSettings,
    getResolvedChatBinding,
    listSillyTavernResources,
    loadSillyTavernContext,
    normalizeHistoryItems,
    readUserSettings,
} from './context-loader.js';
import { assemblePromptPayload } from './prompt-assembly.js';

function buildDayDreamMetadata(session, payload, generation, assistantText) {
    const state = payload.state ?? {};
    const story = generation.story ?? payload.story ?? {};
    const worldInfoNames = Array.isArray(generation.st_context.world_info_names)
        ? generation.st_context.world_info_names
        : [];
    const metadata = {
        ...(generation.stData.chatMetadata ?? {}),
        updated_at: new Date().toISOString(),
        world_info: worldInfoNames[0] ?? generation.stData.chatMetadata?.world_info,
    };

    if (generation.st_context.author_note) {
        metadata.note_prompt = generation.st_context.author_note;
    }

    if (generation.st_context.system_prompt) {
        metadata.system_prompt = generation.st_context.system_prompt;
    }

    metadata['daydream.state'] = state;
    metadata['daydream.story'] = {
        id: story?.id ?? state.story_id ?? null,
        title: story?.title ?? state.story_title ?? '',
        route: story?.route ?? state.route ?? 'general_story',
        story_class: story?.story_class ?? state.story_class ?? '',
    };
    metadata['daydream.ui_profile'] = generation.profile ?? {};
    metadata['daydream.system'] = {
        session_id: session?.session_id ?? null,
        author_note: generation.st_context.author_note ?? metadata.note_prompt ?? '',
        system_prompt: generation.st_context.system_prompt ?? metadata.system_prompt ?? '',
        world_info_names: worldInfoNames,
        provider_source: generation.resolvedProvider.chat_completion_source ?? '',
        provider_model: generation.resolvedProvider.model ?? '',
        last_reply_preview: String(assistantText ?? '').slice(0, 400),
    };
    metadata.daydream = {
        state: metadata['daydream.state'],
        story: metadata['daydream.story'],
        ui_profile: metadata['daydream.ui_profile'],
        system: metadata['daydream.system'],
    };

    return metadata;
}

export { getProviderSummaryFromSettings, listSillyTavernResources, readUserSettings };

export async function assembleDayDreamGeneration(request, payload, session, options) {
    const settings = readUserSettings(request);
    const stContext = {
        ...(session?.st_context ?? {}),
        ...(payload?.st_context ?? {}),
    };
    const stData = await loadSillyTavernContext(request, stContext);
    const chatBinding = getResolvedChatBinding({
        stContext: {
            ...stContext,
            ...stData.resolvedContext,
        },
        stData,
        story: options.story,
        state: payload.state ?? {},
        settings,
    });
    const resolvedStContext = {
        ...stContext,
        ...stData.resolvedContext,
        chat_name: chatBinding.chat_name || stData.resolvedContext.chat_name || stContext.chat_name || '',
    };
    const requestHistory = normalizeHistoryItems(payload.history);
    const promptPayload = assemblePromptPayload({
        story: options.story,
        state: payload.state ?? {},
        uiProfiles: options.uiProfiles,
        corePrompt: options.corePrompt,
        turnPrompt: options.turnPrompt,
        endingPrompt: options.endingPrompt,
        settings,
        stContext: resolvedStContext,
        stData,
        message: payload.message,
        requestHistory,
        fallbackProvider: options.fallbackProvider,
    });

    return {
        story: options.story,
        settings,
        st_context: resolvedStContext,
        stData,
        chatBinding,
        profile: promptPayload.profile,
        stateBlock: promptPayload.stateBlock,
        messages: promptPayload.messages,
        providerBody: promptPayload.providerBody,
        resolvedProvider: promptPayload.resolvedProvider,
        st_summary: buildStSummary(stData),
    };
}

export async function persistDayDreamTurn(request, session, payload, generation, assistantText) {
    const chatMetadata = buildDayDreamMetadata(session, payload, generation, assistantText);

    return {
        chatMetadata,
        st_context: generation.st_context,
    };
}
