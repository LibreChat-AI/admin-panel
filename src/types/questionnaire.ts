export type QuestionnaireStatus = 'draft' | 'active' | 'closed';

export type QuestionnaireQuestionType =
  | 'text'
  | 'scale'
  | 'numeric'
  | 'single_choice'
  | 'multiple_choice';

export interface QuestionnaireQuestion {
  id: string;
  type: QuestionnaireQuestionType;
  title: string;
  description?: string;
  required?: boolean;
  section?: string;
  min?: number;
  max?: number;
  minLabel?: string;
  maxLabel?: string;
  options?: string[];
  maxSelections?: number;
}

export interface Questionnaire {
  questionnaireId: string;
  label?: string;
  status: QuestionnaireStatus;
  year?: number;
  quarter?: number;
  title: string;
  questionCount: number;
  displayFrom: string;
  displayTo?: string | null;
  dismissible: boolean;
  repromptIntervalHours: number | null;
  showConfetti: boolean;
  responseCount: number;
  dismissalCount: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface QuestionnaireDetail {
  questionnaireId: string;
  label?: string;
  status: QuestionnaireStatus;
  year?: number;
  quarter?: number;
  title: string;
  intro?: string;
  thankYouMessage?: string;
  questions: QuestionnaireQuestion[];
  displayFrom: string;
  displayTo?: string | null;
  dismissible: boolean;
  repromptIntervalHours: number | null;
  showConfetti: boolean;
}
