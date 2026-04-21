import { Readable } from 'node:stream';

import { callInternalApi } from './internal-api.js';

function getStreamingStatusCode(statusCode) {
    return statusCode === 401 ? 400 : statusCode;
}

function parseSseEvent(rawEvent, onPayload) {
    const dataLines = rawEvent
        .split(/\r?\n/)
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trimStart());

    if (dataLines.length === 0) {
        return;
    }

    const data = dataLines.join('\n');
    if (data === '[DONE]') {
        return;
    }

    try {
        onPayload(JSON.parse(data));
    } catch {
        // Ignore partial or non-JSON events while streaming through.
    }
}

function drainSseBuffer(buffer, onPayload) {
    let remaining = buffer;

    while (true) {
        const match = remaining.match(/\r?\n\r?\n/);
        if (!match || match.index === undefined) {
            break;
        }

        const rawEvent = remaining.slice(0, match.index);
        remaining = remaining.slice(match.index + match[0].length);
        parseSseEvent(rawEvent, onPayload);
    }

    return remaining;
}

function extractCompletionText(payload) {
    const choice = payload?.choices?.[0];
    return choice?.delta?.content ?? choice?.message?.content ?? choice?.text ?? '';
}

export async function dispatchViaSillyTavern(request, providerBody) {
    return await callInternalApi(request, '/api/backends/chat-completions/generate', {
        method: 'POST',
        body: providerBody,
        accept: 'text/event-stream',
    });
}

export async function streamCompletionToResponse(upstream, response, { headers = {}, onComplete, onError } = {}) {
    const statusCode = getStreamingStatusCode(upstream.status);
    const contentType = upstream.headers.get('content-type') || 'text/event-stream; charset=utf-8';
    const isSse = /text\/event-stream/i.test(contentType);

    response.statusCode = statusCode;
    response.statusMessage = upstream.statusText;
    response.setHeader('Content-Type', contentType);
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('X-Accel-Buffering', 'no');

    for (const [name, value] of Object.entries(headers)) {
        if (value !== undefined && value !== null && value !== '') {
            response.setHeader(name, value);
        }
    }

    if (!upstream.body) {
        if (!response.writableEnded) {
            response.end();
        }
        const emptyResult = { text: '', model: upstream.headers.get('x-DayDreamer-model') || '' };
        if (typeof onComplete === 'function') {
            await onComplete(emptyResult);
        }
        return emptyResult;
    }

    return await new Promise((resolve, reject) => {
        let sseBuffer = '';
        let rawBody = '';
        let fullText = '';
        let model = upstream.headers.get('x-DayDreamer-model') || '';

        const finish = async () => {
            if (!isSse && rawBody) {
                try {
                    const payload = JSON.parse(rawBody);
                    fullText = extractCompletionText(payload) || fullText;
                    model ||= payload?.model ?? '';
                } catch {
                    // Ignore non-JSON non-stream payloads.
                }
            } else if (isSse && sseBuffer.trim()) {
                drainSseBuffer(`${sseBuffer}\n\n`, payload => {
                    fullText += extractCompletionText(payload);
                    model ||= payload?.model ?? '';
                });
            }

            if (!response.writableEnded) {
                response.end();
            }

            const result = { text: fullText, model };

            try {
                if (typeof onComplete === 'function') {
                    await onComplete(result);
                }
                resolve(result);
            } catch (error) {
                reject(error);
            }
        };

        upstream.body.on('data', chunk => {
            response.write(chunk);

            const chunkText = chunk.toString('utf8');
            if (isSse) {
                sseBuffer = drainSseBuffer(`${sseBuffer}${chunkText}`, payload => {
                    fullText += extractCompletionText(payload);
                    model ||= payload?.model ?? '';
                });
            } else {
                rawBody += chunkText;
            }
        });

        upstream.body.on('end', () => {
            void finish();
        });

        upstream.body.on('error', error => {
            if (!response.writableEnded) {
                response.end();
            }

            if (typeof onError === 'function') {
                void Promise.resolve(onError(error));
            }

            reject(error);
        });

        response.socket?.on('close', () => {
            if (upstream.body instanceof Readable) {
                upstream.body.destroy();
            }

            if (!response.writableEnded) {
                response.end();
            }
        });
    });
}
