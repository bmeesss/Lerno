import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Badge, EmptyState, LoadingRow } from '../components/ui/Primitives';
import { useToast } from '../components/ui/Toast';
import { useAuth } from '../hooks/useAuth';
import { ApiError } from '../lib/api';
import { adminService, type Paged } from '../services/reportService';
import type { AdminMetrics, AdminUser, Report, StudySetSummary } from '../types';

type Tab = 'metrics' | 'reports' | 'users' | 'sets';

export function AdminPage() {
  const [tab, setTab] = useState<Tab>('metrics');
  const { user } = useAuth();

  if (user?.profile.role !== 'admin') {
    return (
      <EmptyState
        title="Admins only"
        description="You need the admin role to open the moderation area."
      />
    );
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Admin</h1>
          <p>Moderation, users and basic system metrics.</p>
        </div>
      </div>

      <div className="tabs" role="tablist">
        {(
          [
            ['metrics', 'Metrics'],
            ['reports', 'Reports'],
            ['users', 'Users'],
            ['sets', 'Public sets'],
          ] as [Tab, string][]
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            className={`tab${tab === value ? ' tab-active' : ''}`}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'metrics' ? <MetricsTab /> : null}
      {tab === 'reports' ? <ReportsTab /> : null}
      {tab === 'users' ? <UsersTab /> : null}
      {tab === 'sets' ? <SetsTab /> : null}
    </>
  );
}

function MetricsTab() {
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminService
      .metrics()
      .then(setMetrics)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'Failed'));
  }, []);

  if (error) return <EmptyState title="Could not load metrics" description={error} />;
  if (!metrics) return <LoadingRow large />;

  const cards: [string, number][] = [
    ['Users', metrics.users],
    ['Total sets', metrics.totalSets],
    ['Public sets', metrics.publicSets],
    ['Open reports', metrics.openReports],
    ['Cards', metrics.cards],
    ['Quiz attempts', metrics.quizAttempts],
  ];

  return (
    <div className="admin-metrics">
      {cards.map(([label, value]) => (
        <div key={label} className="card stat-card">
          <div className="stat-label">{label}</div>
          <div className="stat-value">{value}</div>
        </div>
      ))}
    </div>
  );
}

function ReportsTab() {
  const toast = useToast();
  const [reports, setReports] = useState<Paged<Report> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    adminService
      .listReports()
      .then(setReports)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'Failed'));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function resolve(reportId: string, status: 'resolved' | 'dismissed') {
    try {
      await adminService.resolveReport(reportId, status);
      toast.show(`Report ${status}`, 'success');
      load();
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : 'Action failed', 'error');
    }
  }

  if (error) return <EmptyState title="Could not load reports" description={error} />;
  if (!reports) return <LoadingRow large />;

  return (
    <div className="stack" style={{ gap: 10 }}>
      {reports.items.length === 0 ? (
        <EmptyState title="No reports" description="The queue is empty — nothing to moderate." />
      ) : (
        reports.items.map((report) => (
          <div key={report.id} className="card">
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 10,
                flexWrap: 'wrap',
              }}
            >
              <div>
                <strong>{report.reason}</strong>
                <div className="muted" style={{ fontSize: '0.825rem', marginTop: 2 }}>
                  {report.targetType} · {report.targetId.slice(0, 8)}… ·{' '}
                  {new Date(report.createdAt).toLocaleString()}
                </div>
              </div>
              <Badge
                variant={
                  report.status === 'open'
                    ? 'warning'
                    : report.status === 'resolved'
                      ? 'accent'
                      : 'default'
                }
              >
                {report.status}
              </Badge>
            </div>
            {report.details ? (
              <p style={{ marginTop: 10, fontSize: '0.925rem' }}>{report.details}</p>
            ) : null}
            {report.status === 'open' ? (
              <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                <Button size="sm" onClick={() => void resolve(report.id, 'resolved')}>
                  Resolve
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void resolve(report.id, 'dismissed')}
                >
                  Dismiss
                </Button>
              </div>
            ) : null}
          </div>
        ))
      )}
    </div>
  );
}

function UsersTab() {
  const toast = useToast();
  const [users, setUsers] = useState<Paged<AdminUser> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    adminService
      .listUsers()
      .then(setUsers)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'Failed'));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function toggleRole(user: AdminUser) {
    try {
      await adminService.setRole(user.id, user.role === 'admin' ? 'user' : 'admin');
      toast.show('Role updated', 'success');
      load();
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : 'Action failed', 'error');
    }
  }

  async function remove(user: AdminUser) {
    if (!window.confirm(`Delete user ${user.email}? This cannot be undone.`)) return;
    try {
      await adminService.deleteUser(user.id);
      toast.show('User deleted', 'success');
      load();
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : 'Action failed', 'error');
    }
  }

  if (error) return <EmptyState title="Could not load users" description={error} />;
  if (!users) return <LoadingRow large />;

  return (
    <div className="stack" style={{ gap: 10 }}>
      {users.items.map((user) => (
        <div key={user.id} className="list-row">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600 }}>{user.displayName || user.email}</div>
            <div className="muted" style={{ fontSize: '0.825rem' }}>
              {user.email} · joined {new Date(user.createdAt).toLocaleDateString()}
            </div>
          </div>
          <Badge variant={user.role === 'admin' ? 'accent' : 'default'}>{user.role}</Badge>
          <Button variant="secondary" size="sm" onClick={() => void toggleRole(user)}>
            {user.role === 'admin' ? 'Make user' : 'Make admin'}
          </Button>
          <Button variant="danger" size="sm" onClick={() => void remove(user)}>
            Delete
          </Button>
        </div>
      ))}
    </div>
  );
}

function SetsTab() {
  const toast = useToast();
  const [sets, setSets] = useState<Paged<StudySetSummary> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    adminService
      .listSets()
      .then(setSets)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'Failed'));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function moderate(setId: string, action: 'unpublish' | 'restore') {
    try {
      await adminService.moderateSet(setId, action);
      toast.show(action === 'unpublish' ? 'Set unpublished' : 'Set restored', 'success');
      load();
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : 'Action failed', 'error');
    }
  }

  if (error) return <EmptyState title="Could not load sets" description={error} />;
  if (!sets) return <LoadingRow large />;

  return (
    <div className="stack" style={{ gap: 10 }}>
      {sets.items.length === 0 ? (
        <EmptyState title="No public sets" description="Nothing is published right now." />
      ) : (
        sets.items.map((set) => (
          <div key={set.id} className="list-row">
            <div style={{ flex: 1, minWidth: 0 }}>
              <Link to={`/sets/${set.id}`} style={{ fontWeight: 600 }}>
                {set.title}
              </Link>
              <div className="muted" style={{ fontSize: '0.825rem' }}>
                by {set.authorName} · {set.cardCount} cards
              </div>
            </div>
            <Badge variant="accent">{set.visibility}</Badge>
            <Button variant="danger" size="sm" onClick={() => void moderate(set.id, 'unpublish')}>
              Unpublish
            </Button>
          </div>
        ))
      )}
    </div>
  );
}
