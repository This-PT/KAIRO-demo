import { ProjectsPanel } from "@/components/ProjectsPanel";
import { apiGet, type Project } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  // Independent reads run in parallel.
  const [connection, projects] = await Promise.all([apiGet<{ mode: "demo" | "jira"; baseUrl: string; readOnly?: boolean }>("/api/connection"), apiGet<Project[]>("/api/projects")]);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Connect &amp; Policy</h1>
      <ProjectsPanel connection={connection} initialProjects={projects} />
    </div>
  );
}
