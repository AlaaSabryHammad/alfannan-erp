import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Shield, Users, CheckSquare, Square, ShieldCheck, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Card } from '../../components/ui/Card';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { usePermission } from '../../contexts/AuthContext';
import { getApiErrorMessage } from '../../lib/utils';
import apiClient from '../../lib/api';

// ─── Types ─────────────────────────────────────────────────────────────────────
interface Permission {
  id: number;
  code: string;
  group: string;
  nameAr: string;
}

interface RoleData {
  id: number;
  code: string;
  nameAr: string;
  description: string | null;
  userCount: number;
  permissionCount: number;
  permissions: Permission[];
}

interface PermissionGroup {
  group: string;
  permissions: Permission[];
}

// ─── Group name labels ────────────────────────────────────────────────────────
const groupLabels: Record<string, string> = {
  dashboard: 'لوحة القيادة',
  products: 'المنتجات والأصناف',
  inventory: 'المخزون والمستودعات',
  sales: 'المبيعات',
  customers: 'العملاء',
  purchases: 'المشتريات',
  suppliers: 'الموردون',
  accounts: 'الحسابات',
  partners: 'الشركاء',
  reports: 'التقارير',
  users: 'المستخدمون',
  roles: 'الأدوار والصلاحيات',
  settings: 'الإعدادات',
  transfers: 'تحويل المخزون',
};

// ─── Role code colors ──────────────────────────────────────────────────────────
const roleColors: Record<string, { badge: 'danger' | 'warning' | 'info' | 'success' | 'default'; bg: string; icon: string }> = {
  ADMIN: { badge: 'danger', bg: 'bg-red-50 border-red-200', icon: 'text-danger' },
  MANAGER: { badge: 'warning', bg: 'bg-amber-50 border-amber-200', icon: 'text-warning' },
  ACCOUNTANT: { badge: 'info', bg: 'bg-blue-50 border-blue-200', icon: 'text-blue-600' },
  STOREKEEPER: { badge: 'success', bg: 'bg-green-50 border-green-200', icon: 'text-success' },
  CASHIER: { badge: 'default', bg: 'bg-gray-50 border-gray-200', icon: 'text-app-muted' },
};

// ─── Toast ────────────────────────────────────────────────────────────────────
function toast(msg: string, type: 'success' | 'error' = 'success') {
  const div = document.createElement('div');
  div.className = `fixed top-4 left-1/2 -translate-x-1/2 z-[9999] px-5 py-3 rounded-xl shadow-lg text-white text-sm font-medium ${type === 'success' ? 'bg-green-600' : 'bg-red-600'}`;
  div.textContent = msg;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 3000);
}

// ─── Permission Edit Modal ─────────────────────────────────────────────────────
function PermissionsModal({
  role,
  allGroups,
  open,
  onClose,
  canEdit,
}: {
  role: RoleData;
  allGroups: PermissionGroup[];
  open: boolean;
  onClose: () => void;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set(role.permissions.map(p => p.code)));

  const toggle = (code: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const toggleGroup = (perms: Permission[]) => {
    const allChecked = perms.every(p => selected.has(p.code));
    setSelected(prev => {
      const next = new Set(prev);
      if (allChecked) {
        perms.forEach(p => next.delete(p.code));
      } else {
        perms.forEach(p => next.add(p.code));
      }
      return next;
    });
  };

  const saveMutation = useMutation({
    mutationFn: () => apiClient.put(`/roles/${role.id}/permissions`, { permissionCodes: Array.from(selected) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['roles'] });
      toast('تم تحديث الصلاحيات بنجاح');
      onClose();
    },
    onError: (err) => toast(getApiErrorMessage(err, 'حدث خطأ أثناء الحفظ'), 'error'),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`صلاحيات دور: ${role.nameAr}`}
      size="xl"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>إلغاء</Button>
          {canEdit && (
            <Button loading={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
              حفظ الصلاحيات ({selected.size})
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4 max-h-[60vh] overflow-y-auto">
        {allGroups.map(g => {
          const allChecked = g.permissions.every(p => selected.has(p.code));
          const someChecked = g.permissions.some(p => selected.has(p.code));
          return (
            <div key={g.group} className="border border-app-border rounded-xl overflow-hidden">
              {/* Group header */}
              <button
                className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors"
                onClick={() => canEdit && toggleGroup(g.permissions)}
                disabled={!canEdit}
              >
                <div className="flex items-center gap-2">
                  {allChecked ? (
                    <CheckSquare size={16} className="text-primary" />
                  ) : someChecked ? (
                    <CheckSquare size={16} className="text-app-muted opacity-50" />
                  ) : (
                    <Square size={16} className="text-app-muted" />
                  )}
                  <span className="font-bold text-sm text-app-text">
                    {groupLabels[g.group] ?? g.group}
                  </span>
                </div>
                <span className="text-xs text-app-muted">
                  {g.permissions.filter(p => selected.has(p.code)).length} / {g.permissions.length}
                </span>
              </button>

              {/* Permissions grid */}
              <div className="grid grid-cols-2 gap-0 divide-y divide-app-border/60">
                {g.permissions.map(p => (
                  <label
                    key={p.code}
                    className={`flex items-center gap-2.5 px-4 py-2.5 cursor-pointer hover:bg-primary-50/50 transition-colors ${!canEdit ? 'cursor-default opacity-70' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(p.code)}
                      onChange={() => canEdit && toggle(p.code)}
                      disabled={!canEdit}
                      className="w-4 h-4 rounded accent-primary flex-shrink-0"
                    />
                    <div>
                      <p className="text-xs font-medium text-app-text">{p.nameAr}</p>
                      <p className="text-xs text-app-muted font-mono">{p.code}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

// ─── Create Role Modal ─────────────────────────────────────────────────────────
function CreateRoleModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [code, setCode] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [description, setDescription] = useState('');

  const createMutation = useMutation({
    mutationFn: () =>
      apiClient.post('/roles', {
        code: code.trim().toUpperCase(),
        nameAr: nameAr.trim(),
        description: description.trim() || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['roles'] });
      toast('تم إنشاء الدور بنجاح');
      setCode('');
      setNameAr('');
      setDescription('');
      onClose();
    },
    onError: (err) => toast(getApiErrorMessage(err, 'تعذّر إنشاء الدور'), 'error'),
  });

  const canSubmit = code.trim().length >= 2 && nameAr.trim().length >= 1;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="إضافة دور صلاحية جديد"
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>إلغاء</Button>
          <Button
            loading={createMutation.isPending}
            disabled={!canSubmit}
            onClick={() => createMutation.mutate()}
          >
            إنشاء الدور
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Input
          label="رمز الدور (إنجليزي كبير)"
          placeholder="مثال: SUPERVISOR"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
        />
        <Input
          label="اسم الدور بالعربية"
          placeholder="مثال: مشرف الفرع"
          value={nameAr}
          onChange={(e) => setNameAr(e.target.value)}
        />
        <Input
          label="الوصف (اختياري)"
          placeholder="وصف مختصر لمهام هذا الدور"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <p className="text-xs text-app-muted">
          بعد الإنشاء، اضغط زر «الصلاحيات» على بطاقة الدور لتحديد صلاحياته.
        </p>
      </div>
    </Modal>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────
export function RolesPage() {
  const canEdit = usePermission('roles.edit');
  const qc = useQueryClient();
  const [permModalRole, setPermModalRole] = useState<RoleData | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<RoleData | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiClient.delete(`/roles/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['roles'] });
      toast('تم حذف الدور');
      setDeleteTarget(null);
    },
    onError: (err) => toast(getApiErrorMessage(err, 'تعذّر حذف الدور'), 'error'),
  });

  const BUILTIN = ['ADMIN', 'MANAGER', 'ACCOUNTANT', 'STOREKEEPER', 'CASHIER'];

  const { data: roles, isLoading: rolesLoading } = useQuery({
    queryKey: ['roles'],
    queryFn: async () => (await apiClient.get<RoleData[]>('/roles')).data,
  });

  const { data: permGroups, isLoading: permsLoading } = useQuery({
    queryKey: ['permissions-grouped'],
    queryFn: async () => (await apiClient.get<PermissionGroup[]>('/permissions')).data,
  });

  return (
    <div>
      <PageHeader
        title="أدوار وصلاحيات النظام"
        subtitle="إدارة أدوار المستخدمين وتعيين الصلاحيات لكل دور"
        actions={
          canEdit && (
            <Button icon={<Plus size={16} />} onClick={() => setCreateOpen(true)}>
              إضافة دور صلاحية جديد
            </Button>
          )
        }
      />

      {rolesLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="bg-white rounded-2xl border border-app-border shadow-sm p-6 animate-pulse">
              <div className="h-8 bg-gray-200 rounded mb-4 w-1/2" />
              <div className="h-4 bg-gray-200 rounded mb-2 w-3/4" />
              <div className="h-4 bg-gray-200 rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {(roles ?? []).map(role => {
            const colors = roleColors[role.code] ?? { badge: 'default' as const, bg: 'bg-gray-50 border-gray-200', icon: 'text-app-muted' };
            return (
              <Card key={role.id} padding="none" className={`p-6 border ${colors.bg} flex flex-col gap-4`}>
                {/* Header */}
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${colors.bg}`}>
                      <ShieldCheck size={22} className={colors.icon} />
                    </div>
                    <div>
                      <h3 className="font-bold text-app-text text-base">{role.nameAr}</h3>
                      <Badge variant={colors.badge} className="mt-1">{role.code}</Badge>
                    </div>
                  </div>
                </div>

                {/* Description */}
                {role.description && (
                  <p className="text-xs text-app-muted leading-relaxed">{role.description}</p>
                )}

                {/* Stats */}
                <div className="flex items-center gap-4 text-xs">
                  <div className="flex items-center gap-1.5 text-app-muted">
                    <CheckSquare size={13} className="text-primary" />
                    <span className="font-bold text-app-text">{role.permissionCount}</span>
                    <span>صلاحية مفعّلة</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-app-muted">
                    <Users size={13} className="text-primary" />
                    <span className="font-bold text-app-text">{role.userCount}</span>
                    <span>مستخدم</span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 mt-auto">
                  <Button
                    variant="outline"
                    size="sm"
                    icon={<Shield size={14} />}
                    onClick={() => setPermModalRole(role)}
                    className="flex-1"
                  >
                    الصلاحيات
                  </Button>
                  {canEdit && !BUILTIN.includes(role.code) && (
                    <Button
                      variant="danger"
                      size="sm"
                      icon={<Trash2 size={14} />}
                      onClick={() => setDeleteTarget(role)}
                      title="حذف الدور"
                    >
                      حذف
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Permissions Modal */}
      {permModalRole && !permsLoading && permGroups && (
        <PermissionsModal
          role={permModalRole}
          allGroups={permGroups}
          open={!!permModalRole}
          onClose={() => setPermModalRole(null)}
          canEdit={canEdit}
        />
      )}

      {/* Create Role Modal */}
      <CreateRoleModal open={createOpen} onClose={() => setCreateOpen(false)} />

      {/* Delete Confirm */}
      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="تأكيد حذف الدور"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>إلغاء</Button>
            <Button
              variant="danger"
              loading={deleteMutation.isPending}
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              حذف
            </Button>
          </>
        }
      >
        <p className="text-sm text-app-text">
          هل تريد حذف الدور <span className="font-bold text-primary">{deleteTarget?.nameAr}</span>؟
          لا يمكن حذف الأدوار الأساسية أو الأدوار المرتبطة بمستخدمين.
        </p>
      </Modal>
    </div>
  );
}
