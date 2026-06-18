import { ProjectHubScreen } from '@/features/projects';

export default async function ProjectHubPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <ProjectHubScreen projectId={projectId} />;
}
