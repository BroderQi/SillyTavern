import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const SESSIONS_DIR_NAME = 'DayDreamer-sessions';
const SESSION_ID_PATTERN = /^[a-z0-9-]{8,128}$/i;

function getSessionsDirectory(directories) {
    return path.join(directories.root, SESSIONS_DIR_NAME);
}

function ensureSessionsDirectory(directories) {
    const directory = getSessionsDirectory(directories);
    fs.mkdirSync(directory, { recursive: true });
    return directory;
}

function getSessionPath(directories, sessionId) {
    return path.join(ensureSessionsDirectory(directories), `${sessionId}.json`);
}

function isValidSessionId(sessionId) {
    return typeof sessionId === 'string' && SESSION_ID_PATTERN.test(sessionId);
}

function createDefaultSession(sessionId, seed = {}) {
    const now = new Date().toISOString();
    const stContext = { ...(seed?.st_context ?? {}) };
    const state = { ...(seed?.state ?? {}) };
    const history = [];
    const session = {
        session_id: sessionId,
        created_at: now,
        updated_at: now,
        story_id: null,
        character_avatar: null,
        chat_name: null,
        chat_metadata: {},
        selected_world_info: [],
        author_note_config: {},
        system_prompt_override: '',
        preset_identity: '',
        provider_source: '',
        ...seed,
    };

    session.st_context = stContext;
    session.state = state;
    session.history = history;
    session.story_id = seed?.story_id ?? state?.story_id ?? null;
    session.character_avatar = seed?.character_avatar ?? stContext.avatar_url ?? null;
    session.chat_name = seed?.chat_name ?? stContext.chat_name ?? null;
    session.chat_metadata = { ...(seed?.chat_metadata ?? {}) };
    session.selected_world_info = Array.isArray(seed?.selected_world_info)
        ? seed.selected_world_info
        : (Array.isArray(stContext.world_info_names) ? stContext.world_info_names : []);
    session.author_note_config = typeof seed?.author_note_config === 'object' && seed.author_note_config !== null
        ? seed.author_note_config
        : (stContext.author_note ? { prompt: stContext.author_note } : {});
    session.system_prompt_override = seed?.system_prompt_override ?? stContext.system_prompt ?? '';
    session.preset_identity = seed?.preset_identity ?? '';
    session.provider_source = seed?.provider_source ?? '';

    return session;
}

export function createSession(directories, seed = {}) {
    const sessionId = crypto.randomUUID();
    const session = createDefaultSession(sessionId, seed);
    saveSession(directories, session);
    return session;
}

export function loadSession(directories, sessionId) {
    if (!isValidSessionId(sessionId)) {
        return null;
    }

    const sessionPath = getSessionPath(directories, sessionId);
    if (!fs.existsSync(sessionPath)) {
        return null;
    }

    try {
        const text = fs.readFileSync(sessionPath, 'utf8');
        const parsed = JSON.parse(text);
        return createDefaultSession(sessionId, parsed);
    } catch (error) {
        console.error(`Failed to read DayDreamer session ${sessionId}:`, error);
        return null;
    }
}

export function saveSession(directories, session) {
    if (!session || !isValidSessionId(session.session_id)) {
        throw new Error('Invalid DayDreamer session payload.');
    }

    const normalized = createDefaultSession(session.session_id, {
        ...session,
        updated_at: new Date().toISOString(),
    });

    const sessionPath = getSessionPath(directories, normalized.session_id);
    fs.writeFileSync(sessionPath, JSON.stringify(normalized, null, 2), 'utf8');
    return normalized;
}

export function upsertSession(directories, sessionId, updater = {}) {
    const existing = sessionId ? loadSession(directories, sessionId) : null;
    const session = existing ?? createSession(directories);
    return saveSession(directories, {
        ...session,
        ...updater,
        st_context: {
            ...(session.st_context ?? {}),
            ...(updater?.st_context ?? {}),
        },
        state: {
            ...(session.state ?? {}),
            ...(updater?.state ?? {}),
        },
        history: [],
    });
}
