function extractTextFromContentPart(part) {
    if (typeof part === 'string') {
        return part;
    }

    if (!part || typeof part !== 'object') {
        return '';
    }

    if (typeof part.text === 'string') {
        return part.text;
    }

    if (typeof part.content === 'string') {
        return part.content;
    }

    return '';
}

function extractTextFromChoice(choice) {
    if (!choice || typeof choice !== 'object') {
        return '';
    }

    const direct =
        choice?.delta?.content
        ?? choice?.message?.content
        ?? choice?.text
        ?? '';

    if (typeof direct === 'string') {
        return direct;
    }

    if (Array.isArray(direct)) {
        return direct.map(extractTextFromContentPart).join('');
    }

    return '';
}

function extractDeltaFromEvent(rawEvent) {
    const dataLines = rawEvent
        .split(/\r?\n/)
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trimStart())
        .filter(Boolean);

    if (dataLines.length === 0) {
        return '';
    }

    const payloadText = dataLines.join('\n');
    if (payloadText === '[DONE]') {
        return '';
    }

    try {
        const payload = JSON.parse(payloadText);
        return extractTextFromChoice(payload?.choices?.[0]);
    } catch {
        return '';
    }
}

export async function proxyEventStream(upstream, response, { onComplete } = {}) {
    let statusCode = upstream.status;
    if (statusCode === 401) {
        statusCode = 400;
    }

    response.statusCode = statusCode;
    response.statusMessage = upstream.statusText;

    const contentType = upstream.headers.get('content-type') || 'text/event-stream; charset=utf-8';
    response.setHeader('Content-Type', contentType);
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('X-Accel-Buffering', 'no');

    if (!upstream.body) {
        response.end();
        await onComplete?.({ text: '' });
        return { text: '' };
    }

    let rawBuffer = '';
    let fullText = '';
    let closed = false;
    const decoder = new TextDecoder();

    const handleClose = () => {
        if (closed) {
            return;
        }

        closed = true;
        if (typeof upstream.body.destroy === 'function') {
            upstream.body.destroy();
        }
    };

    response.on('close', handleClose);

    try {
        for await (const chunk of upstream.body) {
            if (closed) {
                break;
            }

            response.write(chunk);

            rawBuffer += decoder.decode(chunk, { stream: true });

            let separatorIndex = rawBuffer.indexOf('\n\n');
            while (separatorIndex !== -1) {
                const rawEvent = rawBuffer.slice(0, separatorIndex);
                rawBuffer = rawBuffer.slice(separatorIndex + 2);
                fullText += extractDeltaFromEvent(rawEvent);
                separatorIndex = rawBuffer.indexOf('\n\n');
            }
        }

        rawBuffer += decoder.decode();

        if (rawBuffer.trim()) {
            fullText += extractDeltaFromEvent(rawBuffer);
        }
    } finally {
        response.off('close', handleClose);
        if (!response.writableEnded) {
            response.end();
        }
    }

    await onComplete?.({ text: fullText });
    return { text: fullText };
}
