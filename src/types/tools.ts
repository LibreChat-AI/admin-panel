import type { TerraVoxGroup, TerraVoxTool } from '@/server/terravox';

export type ToolsTab = 'catalog' | 'groups';

export interface ToolsPageProps {
  activeTab: ToolsTab;
  onTabChange: (tab: string) => void;
}

export interface ToolEditDialogProps {
  open: boolean;
  tool: TerraVoxTool | null;
  groups: TerraVoxGroup[];
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
  }) => void;
  onClose: () => void;
}
