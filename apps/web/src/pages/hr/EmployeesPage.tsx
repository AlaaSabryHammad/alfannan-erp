import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Pencil } from 'lucide-react';
import apiClient from '../../lib/api';
import { usePermission } from '../../contexts/AuthContext';
import { formatMoney, getApiErrorMessage } from '../../lib/utils';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { Input, Select } from '../../components/ui/Input';
import { DataTable } from '../../components/ui/DataTable';
import type { Column } from '../../components/ui/DataTable';
import type { PaginatedResponse, PaginationMeta } from '../../types';

interface Employee {
  id: number;
  nameAr: string;
  nationalId: string | null;
  phone: string | null;
  position: string | null;
  department: string | null;
  managerId: number | null;
  basicSalary: number;
  allowances: number;
  deductions: number;
  bankAccount: string | null;
  hireDate: string;
  status: 'ACTIVE' | 'INACTIVE';
}

function toast(msg: string, type: 'success' | 'error' = 'success') {
  const div = document.createElement('div');
  div.className = `fixed top-4 left-1/2 -translate-x-1/2 z-[9999] px-5 py-3 rounded-xl shadow-lg text-white text-sm font-medium ${
    type === 'success' ? 'bg-green-600' : 'bg-red-600'
  }`;
  div.textContent = msg;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 2500);
}

export function EmployeesPage() {
  const qc = useQueryClient();
  const canCreate = usePermission('hr.create');
  const canDelete = usePermission('hr.delete');

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Employee | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Employee | null>(null);

  const { data, isLoading } = useQuery<PaginatedResponse<Employee>>({
    queryKey: ['employees', page, pageSize, search],
    queryFn: async () => (await apiClient.get<PaginatedResponse<Employee>>('/employees', { params: { page, pageSize, search } })).data,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiClient.delete(`/employees/${id}`),
    onSuccess: () => {
      toast('تم حذف الموظف ✓');
      qc.invalidateQueries({ queryKey: ['employees'] });
      setDeleteTarget(null);
    },
    onError: (err) => toast(getApiErrorMessage(err, 'تعذّر حذف الموظف'), 'error'),
  });

  const columns: Array<Column<Employee>> = [
    {
      key: 'nameAr',
      header: 'اسم الموظف',
      render: (r) => (
        <div>
          <p className="font-medium text-app-text">{r.nameAr}</p>
          <p className="text-xs text-app-muted">{r.position ?? '—'}</p>
        </div>
      ),
    },
    {
      key: 'department',
      header: 'القسم',
      render: (r) => <span className="text-app-muted">{r.department ?? '—'}</span>,
    },
    {
      key: 'phone',
      header: 'الهاتف',
      render: (r) => <span className="font-mono text-xs">{r.phone ?? '—'}</span>,
    },
    {
      key: 'basicSalary',
      header: 'الراتب الأساسي',
      render: (r) => <span className="font-mono">{formatMoney(r.basicSalary)}</span>,
    },
    {
      key: 'allowances',
      header: 'البدلات',
      render: (r) => <span className="font-mono text-success">+ {formatMoney(r.allowances)}</span>,
    },
    {
      key: 'deductions',
      header: 'الخصومات',
      render: (r) => <span className="font-mono text-danger">− {formatMoney(r.deductions)}</span>,
    },
    {
      key: 'net',
      header: 'الصافي',
      render: (r) => <span className="font-mono font-bold text-primary">{formatMoney(r.basicSalary + r.allowances - r.deductions)}</span>,
    },
    {
      key: 'status',
      header: 'الحالة',
      render: (r) => <Badge variant={r.status === 'ACTIVE' ? 'success' : 'default'}>{r.status === 'ACTIVE' ? 'نشط' : 'غير نشط'}</Badge>,
    },
    {
      key: 'actions',
      header: 'إجراءات',
      render: (r) => (
        <div className="flex items-center gap-1">
          {canCreate && (
            <button
              onClick={() => setEditTarget(r)}
              title="تعديل"
              className="p-1.5 text-app-muted hover:text-primary hover:bg-primary/10 rounded-lg transition-colors"
            >
              <Pencil size={15} />
            </button>
          )}
          {canDelete && (
            <button
              onClick={() => setDeleteTarget(r)}
              title="حذف"
              className="p-1.5 text-app-muted hover:text-danger hover:bg-danger/10 rounded-lg transition-colors"
            >
              <Trash2 size={15} />
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="الموظفون"
        subtitle="إدارة بيانات الموظفين والرواتب والبدلات والخصومات"
        actions={
          canCreate ? (
            <Button icon={<Plus size={16} />} onClick={() => setCreateOpen(true)}>
              موظف جديد
            </Button>
          ) : null
        }
      />

      <div className="bg-white rounded-2xl border border-app-border shadow-sm p-5">
        <DataTable
          columns={columns}
          data={data?.data ?? []}
          pagination={data?.pagination as PaginationMeta | undefined}
          loading={isLoading}
          onPageChange={setPage}
          onPageSizeChange={(s) => {
            setPageSize(s);
            setPage(1);
          }}
          onSearch={(q) => {
            setSearch(q);
            setPage(1);
          }}
          searchValue={search}
          rowKey={(r) => r.id}
          emptyText="لا يوجد موظفون بعد"
          exportTitle="تقرير الموظفين"
        />
      </div>

      {(createOpen || editTarget) && (
        <EmployeeFormModal
          editTarget={editTarget}
          onClose={() => {
            setCreateOpen(false);
            setEditTarget(null);
          }}
          onSaved={() => {
            setCreateOpen(false);
            setEditTarget(null);
            qc.invalidateQueries({ queryKey: ['employees'] });
          }}
        />
      )}

      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="تأكيد الحذف"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              إلغاء
            </Button>
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
          سيتم حذف الموظف <span className="font-bold">{deleteTarget?.nameAr}</span>.
        </p>
      </Modal>
    </div>
  );
}

// ── Employee form modal (create + edit) ───────────────────────────────────────
function EmployeeFormModal({
  editTarget,
  onClose,
  onSaved,
}: {
  editTarget: Employee | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [nameAr, setNameAr] = useState(editTarget?.nameAr ?? '');
  const [nationalId, setNationalId] = useState(editTarget?.nationalId ?? '');
  const [phone, setPhone] = useState(editTarget?.phone ?? '');
  const [position, setPosition] = useState(editTarget?.position ?? '');
  const [department, setDepartment] = useState(editTarget?.department ?? '');
  const [managerId, setManagerId] = useState(editTarget?.managerId ? String(editTarget.managerId) : '');
  const [basicSalary, setBasicSalary] = useState(editTarget ? String(editTarget.basicSalary) : '');
  const [allowances, setAllowances] = useState(editTarget ? String(editTarget.allowances) : '');
  const [deductions, setDeductions] = useState(editTarget ? String(editTarget.deductions) : '');
  const [bankAccount, setBankAccount] = useState(editTarget?.bankAccount ?? '');
  const [hireDate, setHireDate] = useState(editTarget ? editTarget.hireDate.slice(0, 10) : new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE'>(editTarget?.status ?? 'ACTIVE');

  const { data: employeesResponse } = useQuery<PaginatedResponse<Employee>>({
    queryKey: ['employees', 'all-for-manager'],
    queryFn: async () => (await apiClient.get<PaginatedResponse<Employee>>('/employees', { params: { page: 1, pageSize: 500 } })).data,
  });
  const managerOptions = (employeesResponse?.data ?? []).filter((e) => e.id !== editTarget?.id);

  const mutation = useMutation({
    mutationFn: (payload: unknown) =>
      editTarget
        ? apiClient.put(`/employees/${editTarget.id}`, payload)
        : apiClient.post('/employees', payload),
    onSuccess: () => {
      toast(editTarget ? 'تم تحديث الموظف ✓' : 'تمت إضافة الموظف ✓');
      onSaved();
    },
    onError: (err) => toast(getApiErrorMessage(err, 'تعذّر الحفظ'), 'error'),
  });

  function handleSubmit() {
    if (!nameAr || !basicSalary) {
      toast('يرجى إدخال الاسم والراتب الأساسي', 'error');
      return;
    }
    mutation.mutate({
      nameAr,
      nationalId: nationalId || null,
      phone: phone || null,
      position: position || null,
      department: department || null,
      managerId: managerId ? parseInt(managerId) : null,
      basicSalary: Number(basicSalary) || 0,
      allowances: Number(allowances) || 0,
      deductions: Number(deductions) || 0,
      bankAccount: bankAccount || null,
      hireDate,
      status,
    });
  }

  const net = (Number(basicSalary) || 0) + (Number(allowances) || 0) - (Number(deductions) || 0);

  return (
    <Modal
      open
      onClose={onClose}
      title={editTarget ? 'تعديل موظف' : 'موظف جديد'}
      size="xl"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button onClick={handleSubmit} loading={mutation.isPending}>
            حفظ
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label="اسم الموظف" value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
          <Input label="رقم الهوية" value={nationalId} onChange={(e) => setNationalId(e.target.value)} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label="الهاتف" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <Input label="الوظيفة" value={position} onChange={(e) => setPosition(e.target.value)} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label="القسم" value={department} onChange={(e) => setDepartment(e.target.value)} />
          <Input label="الحساب البنكي" value={bankAccount} onChange={(e) => setBankAccount(e.target.value)} />
        </div>
        <Select label="المسؤول المباشر (اختياري)" value={managerId} onChange={(e) => setManagerId(e.target.value)}>
          <option value="">— بدون مسؤول مباشر —</option>
          {managerOptions.map((m) => (
            <option key={m.id} value={String(m.id)}>{m.nameAr}{m.position ? ` — ${m.position}` : ''}</option>
          ))}
        </Select>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Input label="الراتب الأساسي" type="number" value={basicSalary} onChange={(e) => setBasicSalary(e.target.value)} />
          <Input label="البدلات" type="number" value={allowances} onChange={(e) => setAllowances(e.target.value)} />
          <Input label="الخصومات" type="number" value={deductions} onChange={(e) => setDeductions(e.target.value)} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label="تاريخ التعيين" type="date" value={hireDate} onChange={(e) => setHireDate(e.target.value)} />
          <Select label="الحالة" value={status} onChange={(e) => setStatus(e.target.value as 'ACTIVE' | 'INACTIVE')}>
            <option value="ACTIVE">نشط</option>
            <option value="INACTIVE">غير نشط</option>
          </Select>
        </div>
        <div className="bg-primary-50 rounded-lg p-3 flex justify-between items-center">
          <span className="text-sm text-app-muted">صافي الراتب المتوقع:</span>
          <span className="text-lg font-bold text-primary">{formatMoney(net)}</span>
        </div>
      </div>
    </Modal>
  );
}
