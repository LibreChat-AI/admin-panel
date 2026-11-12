import type { AdminGroup, AdminMember } from '@librechat/data-schemas';
import type { Role, RolePermissions } from './role';

export interface AccessPageProps {
  activeTab: 'groups' | 'roles';
  onTabChange: (tab: string) => void;
  canReadRoles: boolean;
  canReadGroups: boolean;
}

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  confirmType?: 'danger' | 'primary';
  saving: boolean;
  error?: string;
  onConfirm: () => void;
  onCancel: () => void;
  /**
   * Where focus goes once Confirm closes the dialog, since the action removes
   * the control that opened it (the deleted row's Delete), and on any close
   * when that control is already gone.
   */
  returnFocusTo?: () => HTMLElement | null;
}

export type CreateGroupTab = 'details' | 'members';

export interface CreateGroupDialogProps {
  open: boolean;
  onClose: () => void;
}

export type CreateRoleTab = 'details' | 'permissions' | 'members';

export interface CreateRoleDialogProps {
  open: boolean;
  onClose: () => void;
}

export interface EditGroupDialogProps {
  group: AdminGroup | null;
  canManage: boolean;
  onClose: () => void;
}

export interface EditRoleDialogProps {
  role: Role | null;
  canManage: boolean;
  onClose: () => void;
}

export interface GroupsTabProps {
  onCreateGroup: () => void;
}

export interface RolePermissionsPanelProps {
  permissions: RolePermissions;
  onChange: (permissions: RolePermissions) => void;
  disabled?: boolean;
}

export interface RolesTabProps {
  onCreateRole: () => void;
}

/** The note under a role's name while it is renamed and the role has a configuration profile. */
export interface RenameProfileNoteProps {
  id: string;
  /** The role's current name, which its profile is stored under. */
  name: string;
  /** LibreChat moves the profile with the role (`roleRenameMovesProfile`). */
  moves: boolean;
}

/** The current members of a role or group in its Edit dialog, with removals staged until Save. */
export interface MemberListProps {
  members: AdminMember[];
  loading: boolean;
  error: boolean;
  fetching: boolean;
  /** The user ids staged for removal. */
  removalIds: ReadonlySet<string>;
  onRemove: (member: AdminMember) => void;
  onUndoRemove: (userId: string) => void;
  canManage: boolean;
  total: number;
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}
