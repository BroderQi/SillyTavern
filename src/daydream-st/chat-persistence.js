import fs from 'node:fs';
import path from 'node:path';

import sanitize from 'sanitize-filename';

import { getChatData, trySaveChat } from '../endpoints/chats.js';
import { humanizedDateTime, isPathUnderParent, uuidv4 } from '../util.js';
import { saveSession } from './session-store.js';

const MAX_HISTORY_ITEMS = 12;

function cleanText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function toHistoryItem(role, content) {
    return {
        role,
        content: cleanText(content),
    };
}

function appendHistory(history, userMessage, assistantMessage) {
    return [
        ...(Array.isArray(history) ? history : []),
        toHistoryItem('user', userMessage),
        toHistoryItem('assistant', assistantMessage),
    ]
        .filter(item => item.content)
        .slice(-MAX_HISTORY_ITEMS);
}

function makeChatMessage({ role, content, userName, characterName }) {
    return {
        name: role === 'user' ? userName : characterName,
        is_user: role === 'user',
        send_date: new Date().toISOString(),
        mes: content,
        extra: {},
    };
}

function getChatName(seedTitle) {
    const baseTitle = cleanText(seedTitle) || 'DayDream';
    return `${baseTitle} - ${humanizedDateTime()}`;
}

function buildChatMetadata(existingMetadata, session, payload, stContext) {
    const metadata = {
        ...(existingMetadata ?? {}),
        daydream: {
            session_id: session.session_id,
            story_id: payload?.state?.story_id ?? payload?.story?.id ?? null,
            story_title: payload?.state?.story_title ?? payload?.story?.title ?? '',
            updated_at: new Date().toISOString(),
            state: payload?.state ?? {},
            story: payload?.story ?? {},
            st_context: stContext,
        },
    };

    metadata.integrity = metadata.integrity || uuidv4();

    const worldNames = Array.isArray(stContext.world_info_names)
        ? stContext.world_info_names.filter(Boolean)
        : [];

    if (worldNames[0]) {
        metadata.world_info = worldNames[0];
    }

    if (cleanText(stContext.system_prompt)) {
        metadata.system_prompt = stContext.system_prompt;
    }

    if (cleanText(stContext.author_note)) {
        metadata.note_prompt = stContext.author_note;
    }

    return metadata;
}

export async function persistDayDreamTurn(request, session, payload, { assistantText, resolvedProvider, st_summary } = {}) {
    if (!request.user?.directories || !session) {
        return session;
    }

    const userMessage = cleanText(payload?.message);
    const assistantMessage = cleanText(assistantText);
    const history = appendHistory(session.history, userMessage, assistantMessage);
    const stContext = {
        ...(session.st_context ?? {}),
    };

    if (!stContext.avatar_url || !userMessage || !assistantMessage) {
        return saveSession(request.user.directories, {
            ...session,
            history,
            st_summary: {
                ...(session.st_summary ?? {}),
                ...(st_summary ?? {}),
                model: resolvedProvider?.model || session?.st_summary?.model || '',
            },
        });
    }

    const avatarUrl = String(stContext.avatar_url);
    const avatarBase = avatarUrl.replace(/\.png$/i, '');
    const chatName = cleanText(stContext.chat_name) || getChatName(payload?.story?.title ?? payload?.state?.story_title);
    const chatFilePath = path.join(request.user.directories.chats, avatarBase, sanitize(`${chatName}.jsonl`));

    if (!isPathUnderParent(request.user.directories.chats, chatFilePath)) {
        throw new Error('Refused to persist DayDream chat outside the SillyTavern chats directory.');
    }

    const existingChat = fs.existsSync(chatFilePath) ? getChatData(chatFilePath) : [];
    const existingHeader = existingChat[0]?.chat_metadata ? existingChat[0] : null;
    const existingMessages = existingHeader ? existingChat.slice(1) : existingChat;

    const userName = cleanText(request.user?.profile?.name) || 'User';
    const characterName = cleanText(st_summary?.character_name) || avatarBase || 'Assistant';
    const metadata = buildChatMetadata(existingHeader?.chat_metadata, session, payload, {
        ...stContext,
        chat_name: chatName,
    });

    const chatData = [
        {
            chat_metadata: metadata,
            user_name: 'unused',
            character_name: 'unused',
        },
        ...existingMessages,
        makeChatMessage({ role: 'user', content: userMessage, userName, characterName }),
        makeChatMessage({ role: 'assistant', content: assistantMessage, userName, characterName }),
    ];

    await trySaveChat(
        chatData,
        chatFilePath,
        false,
        request.user.profile.handle,
        avatarBase,
        request.user.directories.backups,
    );

    return saveSession(request.user.directories, {
        ...session,
        st_context: {
            ...stContext,
            chat_name: chatName,
        },
        history,
        st_summary: {
            ...(session.st_summary ?? {}),
            ...(st_summary ?? {}),
            model: resolvedProvider?.model || session?.st_summary?.model || '',
        },
    });
}
