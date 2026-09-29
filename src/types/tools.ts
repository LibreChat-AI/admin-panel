import type { TerraVoxGroup, TerraVoxTool } from '@/server/terravox';

export type ToolsTab = 'catalog' | 'groups' | 'usage';

export interface ToolsPageProps {
  activeTab: ToolsTab;
  onTabChange: (tab: string) => void;
}

export interface ToolEditDialogProps {
  open: boolean;
  tool: TerraVoxTool | null;
  /** Gitea 导入预填：以创建模式打开但预填仓库解析出的字段（tool 仍为 null）。 */
  prefill?: TerraVoxTool | null;
  groups: TerraVoxGroup[];
  /** 现有展示分组值聚合（datalist 点选；也可输入新组）。 */
  displayGroupOptions: string[];
  handlers: string[];
  saving: boolean;
  error?: ToolEditError;
  onSubmit: (manifest: Record<string, unknown>) => void;
  onClose: () => void;
}

export interface ToolEditError {
  message?: string;
  errors?: { path?: string; message: string }[];
}

export interface GiteaImportDialogProps {
  open: boolean;
  onClose: () => void;
  /** 面板内「手动创建」：跳过 Gitea，直接打开空白编辑对话框。 */
  onManualCreate: () => void;
  /** 检查通过（无 error 级问题）后携带仓库解析出的预填数据继续编辑。 */
  onContinue: (prefill: TerraVoxTool) => void;
}

export interface ToolGroupEditDialogProps {
  open: boolean;
  /** null = create; an implicit group carries metadata-only edit semantics. */
  group: TerraVoxGroup | null;
  saving: boolean;
  error?: string;
  onSubmit: (input: {
    name?: string;
    display_name: string;
    description: string;
    sort_order: number;
    allowed_groups: string[];
  }) => void;
  onClose: () => void;
}
