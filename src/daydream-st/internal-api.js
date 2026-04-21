import fetch from 'node-fetch';

function getBaseUrl(request) {
    const protocol = request.protocol || 'http';
    const host = request.get('host');
    if (!host) {
        throw new Error('Unable to resolve DayDreamer internal API base URL: missing host header.');
    }
    return `${protocol}://${host}`;
}

function buildHeaders(request, accept, hasBody) {
    const headers = {
        Accept: accept,
    };

    if (hasBody) {
        headers['Content-Type'] = 'application/json';
    }

    const cookie = request.headers.cookie;
    if (cookie) {
        headers.Cookie = cookie;
    }

    const csrfToken = request.headers['x-csrf-token'];
    if (csrfToken) {
        headers['X-CSRF-Token'] = String(csrfToken);
    }

    return headers;
}

export async function callInternalApi(request, endpoint, { method = 'POST', body, accept = 'application/json' } = {}) {
    const url = new URL(endpoint, getBaseUrl(request));
    const hasBody = body !== undefined;

    return await fetch(url, {
        method,
        headers: buildHeaders(request, accept, hasBody),
        body: hasBody ? JSON.stringify(body) : undefined,
    });
}

export async function readInternalJson(request, endpoint, body) {
    const response = await callInternalApi(request, endpoint, { method: 'POST', body });
    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Internal API request failed: ${endpoint} ${response.status} ${text}`);
    }

    return await response.json();
}
