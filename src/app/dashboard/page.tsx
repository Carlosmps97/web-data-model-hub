'use client';

import React, { useEffect, useState } from 'react';
import AppLayout from '@/components/layout/AppLayout';
import Header from '@/components/layout/Header';
import { modelsService } from '@/services';
import { useModelStore } from '@/store/useModelStore';
import type { DataModel } from '@/types/model';

interface DashboardStats {
  totalProjects: number;
  totalModels: number;
  totalTables: number;
  totalRelationships: number;
  totalColumns: number;
}

interface RecentModel {
  projectId: string;
  projectName: string;
  model: DataModel;
}

export default function DashboardPage() {
  const { projects, loadProjects } = useModelStore();
  const [stats, setStats] = useState<DashboardStats>({
    totalProjects: 0,
    totalModels: 0,
    totalTables: 0,
    totalRelationships: 0,
    totalColumns: 0,
  });
  const [recent, setRecent] = useState<RecentModel[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    async function computeStats() {
      if (projects.length === 0) {
        setStats({
          totalProjects: 0,
          totalModels: 0,
          totalTables: 0,
          totalRelationships: 0,
          totalColumns: 0,
        });
        setRecent([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      let totalModels = 0;
      let totalTables = 0;
      let totalRelationships = 0;
      let totalColumns = 0;
      const recentCandidates: RecentModel[] = [];

      for (const project of projects) {
        try {
          // One round-trip per project: `full: true` hydrates tables
          // and relationships server-side so the dashboard no longer
          // fires N+1 requests to `/api/models/:id`.
          const models = await modelsService.listModels({
            projectId: project.id,
            full: true,
          });
          totalModels += models.length;

          for (const full of models) {
            totalTables += full.tables.length;
            totalRelationships += full.relationships.length;
            totalColumns += full.tables.reduce((sum, t) => sum + t.columns.length, 0);
            recentCandidates.push({ projectId: project.id, projectName: project.name, model: full });
          }
        } catch { /* skip */ }
      }

      // Sort recent models by updatedAt desc, take top 5
      recentCandidates.sort((a, b) =>
        new Date(b.model.updatedAt).getTime() - new Date(a.model.updatedAt).getTime()
      );

      setStats({
        totalProjects: projects.length,
        totalModels,
        totalTables,
        totalRelationships,
        totalColumns,
      });
      setRecent(recentCandidates.slice(0, 5));
      setLoading(false);
    }

    computeStats();
  }, [projects]);

  return (
    <AppLayout>
      <Header crumbs={[{ label: 'Dashboard' }]} />

      <div className="app-content">
        <div className="page-intro">
          <h1 className="page-intro-title">Dashboard</h1>
          <p className="page-intro-description">Overview of your data modeling workspace</p>
        </div>

        {/* Stats Grid */}
        <div className="dashboard-stats-grid">
          <StatCard
            label="Projects"
            value={stats.totalProjects}
            color="var(--color-accent-primary)"
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
            }
            loading={loading}
          />
          <StatCard
            label="Data models"
            value={stats.totalModels}
            color="#5C6BC0"
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <ellipse cx="12" cy="5" rx="9" ry="3" />
                <path d="M3 5v14a9 3 0 0 0 18 0V5" />
                <path d="M3 12a9 3 0 0 0 18 0" />
              </svg>
            }
            loading={loading}
          />
          <StatCard
            label="Tables"
            value={stats.totalTables}
            color="#2E8B57"
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="3" y1="9" x2="21" y2="9" />
                <line x1="3" y1="15" x2="21" y2="15" />
                <line x1="9" y1="3" x2="9" y2="21" />
                <line x1="15" y1="3" x2="15" y2="21" />
              </svg>
            }
            loading={loading}
          />
          <StatCard
            label="Relationships"
            value={stats.totalRelationships}
            color="#D4821A"
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="6" cy="6" r="3" />
                <circle cx="18" cy="18" r="3" />
                <path d="M8.5 8.5l7 7" />
              </svg>
            }
            loading={loading}
          />
          <StatCard
            label="Columns"
            value={stats.totalColumns}
            color="#7B5EA7"
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="4" y1="6" x2="20" y2="6" />
                <line x1="4" y1="12" x2="20" y2="12" />
                <line x1="4" y1="18" x2="20" y2="18" />
              </svg>
            }
            loading={loading}
          />
        </div>

        {/* Recent activity + Project distribution */}
        <div className="dashboard-section-grid">
          <div className="dashboard-card">
            <h3 className="dashboard-card-title">Recent activity</h3>
            {loading ? (
              <div className="dashboard-card-empty">Loading…</div>
            ) : recent.length === 0 ? (
              <div className="dashboard-card-empty">No models yet. Create a project and add a model to get started.</div>
            ) : (
              <div className="dashboard-recent-list">
                {recent.map((r) => (
                  <a
                    key={r.model.id}
                    href={`/projects/${r.projectId}/models/${r.model.id}`}
                    className="dashboard-recent-item"
                  >
                    <div>
                      <div className="dashboard-recent-title">{r.model.name}</div>
                      <div className="dashboard-recent-sub">
                        {r.projectName} • {r.model.tables.length} table{r.model.tables.length !== 1 ? 's' : ''}
                      </div>
                    </div>
                    <span className="dashboard-recent-date">
                      {new Date(r.model.updatedAt).toLocaleDateString('en-US', {
                        month: 'short', day: 'numeric',
                      })}
                    </span>
                  </a>
                ))}
              </div>
            )}
          </div>

          <div className="dashboard-card">
            <h3 className="dashboard-card-title">Projects overview</h3>
            {loading ? (
              <div className="dashboard-card-empty">Loading…</div>
            ) : projects.length === 0 ? (
              <div className="dashboard-card-empty">No projects yet.</div>
            ) : (
              <div className="dashboard-projects-list">
                {projects.slice(0, 6).map((p) => (
                  <a key={p.id} href={`/projects/${p.id}`} className="dashboard-project-row">
                    <div className="dashboard-project-dot" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="dashboard-project-name">{p.name}</div>
                      {p.description && (
                        <div className="dashboard-project-desc">{p.description}</div>
                      )}
                    </div>
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

// ── Stat Card ──
interface StatCardProps {
  label: string;
  value: number;
  color: string;
  icon: React.ReactNode;
  loading: boolean;
}

function StatCard({ label, value, color, icon, loading }: StatCardProps) {
  return (
    <div className="dashboard-stat-card">
      <div className="dashboard-stat-icon" style={{ background: `${color}18`, color }}>
        {icon}
      </div>
      <div className="dashboard-stat-body">
        <div className="dashboard-stat-value">
          {loading ? <span className="dashboard-stat-skeleton" /> : value.toLocaleString()}
        </div>
        <div className="dashboard-stat-label">{label}</div>
      </div>
    </div>
  );
}
