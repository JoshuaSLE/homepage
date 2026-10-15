const API = import.meta.env.VITE_PINNED_API as string;
const CACHE_KEY = "pinned-repos";

interface GitHubRepo {
  name: string;
  description: string | null;
  html_url: string;
  language: string | null;
  topics: string[];
}

export async function initProjects(): Promise<void> {
  const grid = document.getElementById("projects-grid");
  if (!grid) return;

  // Same tab/session (reloads): reuse. New open: sessionStorage is empty, so refetch.
  try {
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (cached) {
      renderProjects(grid, JSON.parse(cached) as GitHubRepo[]);
      return;
    }
  } catch {}

  grid.innerHTML = `<p class="loading">Loading projects from GitHub...</p>`;

  try {
    const res = await fetch(API);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const projects = (await res.json()) as GitHubRepo[];
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify(projects));
    } catch {}
    renderProjects(grid, projects);
  } catch (err) {
    console.error(err);
    grid.innerHTML = `<p class="error">Failed to load projects.</p>`;
  }
}

function renderProjects(container: HTMLElement, projects: GitHubRepo[]): void {
  container.innerHTML = projects
    .map((repo) => {
      const tech = [repo.language, ...(repo.topics || [])]
        .filter(Boolean)
        .join(" • ");
      return `
        <article class="project-card">
          <h3>${repo.name}</h3>
          <p class="project-tech">${tech || "GitHub"}</p>
          <p class="project-description">${repo.description || ""}</p>
          <a href="${repo.html_url}" target="_blank" rel="noopener noreferrer" class="project-link">
            View on GitHub →
          </a>
        </article>
      `;
    })
    .join("");
}
