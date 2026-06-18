import { EditorScreen } from '@/features/editor';

export default async function EditorPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <EditorScreen projectId={projectId} />;
}
