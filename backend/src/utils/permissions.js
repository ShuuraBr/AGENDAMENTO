export const PROFILE_LABELS = {
  ADMIN: 'Administrador',
  GESTOR: 'Gestor',
  OPERADOR: 'Operador',
  PORTARIA: 'Portaria'
};

export const ALL_PERMISSIONS = [
  'dashboard.view',
  'docas.view',
  'logs.view',
  'cadastros.view',
  'cadastros.manage',
  'users.manage',
  'agendamentos.view',
  'agendamentos.create',
  'agendamentos.consulta_nf',
  'agendamentos.definir_doca',
  'agendamentos.approve',
  'agendamentos.reprove',
  'agendamentos.reschedule',
  'agendamentos.cancel',
  'agendamentos.start',
  'agendamentos.finish',
  'agendamentos.no_show',
  'agendamentos.checkin',
  'agendamentos.documentos',
  'agendamentos.notas',
  'agendamentos.notify',
  'financeiro.summary',
  'relatorio.view',
  'relatorio.manage',
  'relatorio.terceirizado.view',
  'relatorio.terceirizado.manage'
];

export const PROFILE_PERMISSIONS = {
  ADMIN: [...ALL_PERMISSIONS],
  GESTOR: ALL_PERMISSIONS.filter((permission) => permission !== 'users.manage'),
  OPERADOR: [
    'dashboard.view',
    'docas.view',
    'cadastros.view',
    'agendamentos.view',
    'agendamentos.create',
    'agendamentos.consulta_nf',
    'agendamentos.definir_doca',
    'agendamentos.approve',
    'agendamentos.reprove',
    'agendamentos.reschedule',
    'agendamentos.cancel',
    'agendamentos.start',
    'agendamentos.finish',
    'agendamentos.no_show',
    'agendamentos.checkin',
    'agendamentos.documentos',
    'agendamentos.notas',
    'agendamentos.notify',
    'relatorio.view',
    'relatorio.terceirizado.view'
  ],
  PORTARIA: [
    'docas.view',
    'agendamentos.view',
    'agendamentos.consulta_nf',
    'agendamentos.no_show',
    'agendamentos.checkin'
  ]
};

export function normalizeProfile(profile) {
  return String(profile || '').trim().toUpperCase();
}

export function getPermissionsForProfile(profile) {
  const normalized = normalizeProfile(profile);
  return [...new Set(PROFILE_PERMISSIONS[normalized] || [])];
}

export function hasPermission(profile, permission) {
  return getPermissionsForProfile(profile).includes(String(permission || '').trim());
}

export function hasAnyPermission(profile, permissions = []) {
  return (Array.isArray(permissions) ? permissions : []).some((permission) => hasPermission(profile, permission));
}

export function getAccessProfileSummary(profile) {
  const normalized = normalizeProfile(profile);
  return {
    codigo: normalized,
    nome: PROFILE_LABELS[normalized] || normalized || 'Sem perfil',
    permissoes: getPermissionsForProfile(normalized)
  };
}
