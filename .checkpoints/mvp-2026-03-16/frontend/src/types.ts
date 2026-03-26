export type AlertLevel = "urgente" | "hoje" | "proximo" | "ok";

export type DashboardSummary = {
  remindersDueToday: number;
  patientsToContactToday: number;
  overduePatients: number;
  scheduledThisWeek: number;
  conversionRate: number;
  totalMessagesSent: number;
  totalExamsCompleted: number;
};

export type DashboardFilters = {
  period: string;
  dateFrom: string;
  dateTo: string;
  clinicUnit: string;
  physicianName: string;
};

export type DashboardFilterOptions = {
  clinicUnits: string[];
  physicians: string[];
};

export type DashboardActivityPoint = {
  date: string;
  label: string;
  messages?: number;
  scheduled?: number;
  completed?: number;
  total?: number;
};

export type DashboardData = {
  filters: DashboardFilters;
  filterOptions: DashboardFilterOptions;
  summary: DashboardSummary;
  lists: {
    patientsToContactToday: Patient[];
    overduePatients: Patient[];
    scheduledThisWeek: Patient[];
    examsMostPending: Array<{ name: string; total: number }>;
  };
  charts: {
    activityByDay: DashboardActivityPoint[];
    completedExamsByPeriod: DashboardActivityPoint[];
  };
};

export type ExamConfig = {
  id: number;
  code: string;
  name: string;
  startWeek: number;
  endWeek: number;
  targetWeek: number;
  reminderDaysBefore1: number;
  reminderDaysBefore2: number;
  defaultMessage: string;
  required: boolean;
  flowType: string;
  active: boolean;
  sortOrder: number;
};

export type ExamProtocolPreset = {
  id: string;
  name: string;
  description: string;
};

export type AppUser = {
  id: number;
  name: string;
  email: string;
  role: string;
  active?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type ClinicUnit = {
  id: number;
  name: string;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type ClinicPhysician = {
  id: number;
  name: string;
  clinicUnitId: number | null;
  clinicUnitName: string | null;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type PatientFormCatalogs = {
  units: ClinicUnit[];
  physicians: ClinicPhysician[];
};

export type MessageTemplate = {
  id: number;
  code: string;
  name: string;
  channel: string;
  language: string;
  content: string;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type MessageDeliveryLog = {
  id: number;
  messageId: number | null;
  patientId: number;
  patientName: string | null;
  templateId: number | null;
  templateName: string | null;
  provider: string;
  status: string;
  externalMessageId: string | null;
  errorMessage: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  respondedAt: string | null;
  createdAt: string;
};

export type MessagingConfig = {
  provider: string;
  channel: string;
  externalApiBaseUrl: string;
  externalApiToken: string;
  externalPhoneNumberId: string;
  templatesEnabled: boolean;
  dryRun: boolean;
  isExternalProviderConfigured: boolean;
};

export type AdminPanelData = {
  users: AppUser[];
  units: ClinicUnit[];
  physicians: ClinicPhysician[];
  examConfigs: ExamConfig[];
  messageTemplates: MessageTemplate[];
  messageDeliveryLogs: MessageDeliveryLog[];
  messagingConfig: MessagingConfig;
};

export type MessageRecord = {
  id: number;
  patientId: number;
  examModelId: number | null;
  content: string;
  deliveryStatus: string;
  sentAt: string | null;
  responseStatus: string;
  responseText: string | null;
  responseAt: string | null;
};

export type MovementRecord = {
  id: number;
  patientId: number;
  fromStage: string | null;
  toStage: string | null;
  actionType: string;
  description: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

export type PatientExamRecord = {
  id: number;
  examModelId: number;
  code: string;
  name: string;
  required?: boolean;
  flowType?: string;
  predictedDate: string;
  predictedDateLabel: string;
  reminderDate1: string | null;
  reminderDate2: string | null;
  scheduledDate?: string | null;
  scheduledTime?: string | null;
  scheduledDateLabel?: string | null;
  schedulingNotes?: string | null;
  scheduledByName?: string | null;
  completedDate: string | null;
  completedDateLabel: string | null;
  completedByName?: string | null;
  status: string;
  deadlineStatus?: string;
  deadlineStatusLabel?: string;
  daysUntilIdealDate?: number;
  shouldHaveBeenDone?: boolean;
  alertLevel?: AlertLevel;
  alertLabel?: string;
  idealDateLabel?: string;
};

export type Patient = {
  id: number;
  name: string;
  phone: string;
  birthDate?: string | null;
  dum: string | null;
  dpp?: string | null;
  gestationalWeeks: number | null;
  gestationalDays: number | null;
  gestationalBaseDate?: string | null;
  physicianName?: string | null;
  clinicUnit?: string | null;
  pregnancyType?: string | null;
  highRisk?: boolean;
  status?: string;
  stage: string;
  stageTitle?: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  gestationalAgeLabel: string;
  estimatedDueDate: string;
  priorityScore?: number;
  latestMessage?: MessageRecord | null;
  nextExam: {
    id?: number;
    code?: string | null;
    name: string;
    required?: boolean;
    flowType?: string;
    date: string | null;
    dateLabel: string;
    idealDate?: string | null;
    alertLevel: AlertLevel;
    alertLabel: string;
    deadlineStatus?: string;
    deadlineStatusLabel?: string;
    overdueExam?: {
      id: number;
      code: string;
      name: string;
    } | null;
  };
};

export type MessagingItem = {
  patientId: number;
  patientName: string;
  phone: string;
  physicianName: string | null;
  clinicUnit: string | null;
  stage: string;
  gestationalAgeLabel: string;
  nextExam: Patient["nextExam"];
  suggestedMessage: string;
  reminderLabel: string;
  examModelId: number | null;
  latestMessage: MessageRecord | null;
  messageHistory: MessageRecord[];
  priorityScore?: number;
};

export type ReminderCenterData = {
  filters: {
    clinicUnit: string;
    physicianName: string;
    examCode: string;
  };
  filterOptions: {
    clinicUnits: string[];
    physicians: string[];
    exams: Array<{ code: string; name: string }>;
  };
  items: Array<{
    patientId: number;
    patientName: string;
    phone: string;
    gestationalAgeLabel: string;
    physicianName: string | null;
    clinicUnit: string | null;
    examPatientId: number | null;
    examCode: string | null;
    examName: string;
    idealWindowStartDate: string | null;
    idealWindowStartDateLabel: string | null;
    urgencyStatus: string;
    urgencyLabel: string;
    priorityScore: number;
    suggestedMessage: string;
    whatsappUrl: string;
  }>;
};

export type KanbanColumn = {
  id: string;
  title: string;
  description: string;
  isSystem?: boolean;
  patients: Patient[];
};

export type PatientDetails = {
  patient: Patient;
  exams: PatientExamRecord[];
  messages: MessageRecord[];
  movements: MovementRecord[];
};

export type LoginResponse = {
  token: string;
  user: AppUser;
};

export type ReportsFilters = {
  period: string;
  dateFrom: string;
  dateTo: string;
  clinicUnit: string;
  physicianName: string;
};

export type ReportsFilterOptions = {
  clinicUnits: string[];
  physicians: string[];
};

export type ReportsStageRow = {
  stage: string;
  stageTitle: string;
  total: number;
};

export type ReportsExamRow = {
  patientId: number;
  patientName: string;
  examName: string;
  examCode: string;
  predictedDate: string | null;
  predictedDateLabel: string;
  deadlineStatusLabel: string;
  physicianName: string | null;
  clinicUnit: string | null;
};

export type ReportsContactRow = {
  patientId: number;
  patientName: string;
  contactType: string;
  status: string;
  date: string;
  dateLabel: string;
  userName: string | null;
  physicianName: string | null;
  clinicUnit: string | null;
};

export type ReportsScheduledRow = {
  patientId: number;
  patientName: string;
  examName: string;
  scheduledDate: string;
  scheduledDateLabel: string;
  scheduledTime: string | null;
  userName: string | null;
  physicianName: string | null;
  clinicUnit: string | null;
};

export type ReportsProductivityRow = {
  userId: number;
  userName: string;
  contacts: number;
  scheduled: number;
  completed: number;
  totalActions: number;
};

export type ReportsData = {
  filters: ReportsFilters;
  filterOptions: ReportsFilterOptions;
  summary: {
    pendingExams: number;
    overdueExams: number;
    contactsMade: number;
    scheduledCount: number;
    conversionRate: number;
  };
  reports: {
    patientsByStage: ReportsStageRow[];
    pendingExams: ReportsExamRow[];
    overdueExams: ReportsExamRow[];
    contactsMade: ReportsContactRow[];
    scheduledByPeriod: ReportsScheduledRow[];
    productivityByUser: ReportsProductivityRow[];
  };
};
