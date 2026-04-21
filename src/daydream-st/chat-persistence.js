import { saveSession } from './session-store.js';

function cleanText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function buildLightweightMetadata(session, payload, assistantText) {
    return {
        ...(session?.chat_metadata ?? {}),
        DayDreamer: {
            session_id: session?.session_id ?? null,
            story_id: payload?.state?.story_id ?? payload?.story?.id ?? null,
            story_title: payload?.state?.story_title ?? payload?.story?.title ?? '',
            updated_at: new Date().toISOString(),
            state: payload?.state ?? {},
            story: payload?.story ?? {},
            last_reply_preview: cleanText(assistantText).slice(0, 400),
        },
    };
}

export async function persistDayDreamerTurn(request, session, payload, { assistantText, resolvedProvider, st_summary } = {}) {
    if (!request.user?.directories || !session) {
        return session;
    }

    return saveSession(request.user.directories, {
        ...session,
        state: payload?.state ?? session.state,
        history: [],
        chat_metadata: buildLightweightMetadata(session, payload, assistantText),
        st_summary: {
            ...(session.st_summary ?? {}),
            ...(st_summary ?? {}),
            model: resolvedProvider?.model || session?.st_summary?.model || '',
        },
    });
}
