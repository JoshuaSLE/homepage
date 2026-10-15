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

const ALLOWED_ORIGINS = ["http://joshuae.dev", "http://localhost:5173"];

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") ?? "";
    const cors = {
      "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin)
        ? origin
        : ALLOWED_ORIGINS[0],
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      Vary: "Origin",
    };
    if (request.method === "OPTIONS")
      return new Response(null, { headers: cors });

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
      if (!gh.ok)
        return new Response("Upstream error", { status: 502, headers: cors });

      const json = await gh.json();
      const nodes = json?.data?.user?.pinnedItems?.nodes;
      if (!nodes)
        return new Response("Bad upstream data", {
          status: 502,
          headers: cors,
        });

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
    for (const [k, v] of Object.entries(cors)) headers.set(k, v);
    return new Response(hit.body, { headers });
  },
};
