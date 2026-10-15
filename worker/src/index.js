const GITHUB_LOGIN = "JoshuaSLE";
const GRAPHQL_URL = "https://api.github.com/graphql";
const CACHE_TTL_SECONDS = 300;
const DEFAULT_ORIGIN = "https://joshuae.dev";
const ALLOWED_ORIGINS = new Set([
  "https://joshuae.dev",
  "http://joshuae.dev",
  "http://localhost:4173",
  "http://localhost:5173",
  "http://127.0.0.1:4173",
  "http://127.0.0.1:5173",
]);

const QUERY = `
query($login: String!) {
  user(login: $login) {
    pinnedItems(first: 6, types: REPOSITORY) {
      nodes {
        ... on Repository {
          name
          description
          url
          primaryLanguage { name }
          repositoryTopics(first: 10) { nodes { topic { name } } }
        }
      }
    }
  }
}`;

function getCorsHeaders(request) {
  const origin = request.headers.get("Origin");
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin)
      ? origin
      : DEFAULT_ORIGIN,
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

function withCors(response, cors) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(cors)) headers.set(key, value);
  return new Response(response.body, { status: response.status, headers });
}

function textResponse(message, status, cors) {
  return new Response(message, { status, headers: cors });
}

async function fetchPinnedRepos(token) {
  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      Authorization: `bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "pinned-repos-worker",
    },
    body: JSON.stringify({ query: QUERY, variables: { login: GITHUB_LOGIN } }),
  });
  if (!res.ok) throw new Error(`GitHub responded ${res.status}`);

  const { data, errors } = await res.json();
  if (errors?.length) throw new Error(`GraphQL: ${errors[0].message}`);

  const nodes = data?.user?.pinnedItems?.nodes;
  if (!nodes) throw new Error("Unexpected GitHub response shape");

  return nodes.filter(Boolean).map((n) => ({
    name: n.name,
    description: n.description,
    html_url: n.url,
    language: n.primaryLanguage?.name ?? null,
    topics: n.repositoryTopics?.nodes?.map((t) => t.topic.name) ?? [],
  }));
}

export default {
  async fetch(request, env, ctx) {
    const cors = getCorsHeaders(request);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return textResponse("Method not allowed", 405, cors);
    }
    if (!env.GITHUB_TOKEN) {
      return textResponse("Missing GITHUB_TOKEN", 500, cors);
    }

    const cache = caches.default;
    const cacheKey = new Request(new URL("/pinned", request.url));

    const cached = await cache.match(cacheKey);
    if (cached) return withCors(cached, cors);

    try {
      const repos = await fetchPinnedRepos(env.GITHUB_TOKEN);
      const response = new Response(JSON.stringify(repos), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}`,
        },
      });
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
      return withCors(response, cors);
    } catch (err) {
      console.error(err);
      return textResponse("Upstream error", 502, cors);
    }
  },
};
