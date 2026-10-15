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

const ALLOWED_ORIGINS = [
  "https://joshuae.dev",
  "http://joshuae.dev",
  "http://localhost:4173",
  "http://localhost:5173",
  "http://127.0.0.1:4173",
  "http://127.0.0.1:5173",
];

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin");
    const allowedOrigin = ALLOWED_ORIGINS.includes(origin)
      ? origin
      : "https://joshuae.dev";

    const corsHeaders = {
      "Access-Control-Allow-Origin": allowedOrigin,
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      Vary: "Origin",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (!env.GITHUB_TOKEN) {
      return new Response("Missing GITHUB_TOKEN", {
        status: 500,
        headers: corsHeaders,
      });
    }

    const cache = caches.default;
    const key = new Request(new URL(request.url).origin + "/pinned-cache-key");
    let hit = await cache.match(key);

    if (!hit) {
      const gh = await fetch("https://api.github.com/graphql", {
        method: "POST",
        headers: {
          Authorization: `bearer ${env.GITHUB_TOKEN}`,
          "Content-Type": "application/json",
          "User-Agent": "pinned-repos-worker",
        },
        body: JSON.stringify({
          query: QUERY,
          variables: { login: "JoshuaSLE" },
        }),
      });
      if (!gh.ok) {
        return new Response(`Upstream error ${gh.status}`, {
          status: 502,
          headers: corsHeaders,
        });
      }

      const json = await gh.json();
      const nodes = json?.data?.user?.pinnedItems?.nodes;
      if (!nodes) {
        return new Response("Bad upstream data", {
          status: 502,
          headers: corsHeaders,
        });
      }

      const repos = nodes.map((n) => ({
        name: n.name,
        description: n.description,
        html_url: n.url,
        language: n.primaryLanguage?.name ?? null,
        topics: n.repositoryTopics.nodes.map((t) => t.topic.name),
      }));

      hit = new Response(JSON.stringify(repos), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=300",
        },
      });
      ctx.waitUntil(cache.put(key, hit.clone()));
    }

    const headers = new Headers(hit.headers);
    for (const [k, v] of Object.entries(corsHeaders)) headers.set(k, v);
    return new Response(hit.body, { status: 200, headers });
  },
};
