export type AlertLevel = "urgente" | "hoje" | "proximo" | "ok";

export type DashboardSummary = {
  remindersDueToday: number;
  gestationalBaseManualReview: number;
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
  examInferenceRules: ExamInferenceRule[];
  messageTemplates: MessageTemplate[];
  messageDeliveryLogs: MessageDeliveryLog[];
  messagingConfig: MessagingConfig;
};

export type PatientCleanupResult = {
  success: boolean;
  range: {
    preset: string;
    dateFrom: string | null;
    dateTo: string | null;
    label: string;
  };
  deleted: {
    patients: number;
    exams: number;
    messages: number;
    movements: number;
    messageLogs: number;
  };
};

export type ExamInferenceRule = {
  id: number;
  examModelId: number;
  examName: string;
  examCode: string;
  typicalStartWeek: number;
  typicalEndWeek: number;
  referenceWeek: number;
  uncertaintyMarginWeeks: number;
  allowAutomaticInference: boolean;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
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
  suggestedMessage?: string | null;
  required?: boolean;
  flowType?: string;
  importedFromShosp?: boolean;
  shospExamId?: string | null;
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
  completedOutsideClinic?: boolean;
  status: string;
  deadlineStatus?: string;
  deadlineStatusLabel?: string;
  timelineStatus?: string;
  daysUntilIdealDate?: number;
  shouldHaveBeenDone?: boolean;
  showOperationalAlert?: boolean;
  alertLevel?: AlertLevel;
  alertLabel?: string;
  idealDateLabel?: string;
};

export type Patient = {
  id: number;
  name: string;
  phone: string;
  birthDate?: string | null;
  dum?: string | null;
  dpp?: string | null;
  gestationalWeeks: number | null;
  gestationalDays: number | null;
  gestationalBaseDate?: string | null;
  gestationalBaseSource?: string | null;
  gestationalBaseSourceLabel?: string;
  gestationalBaseConfidence?: string | null;
  gestationalBaseConfidenceLabel?: string;
  gestationalBaseIsEstimated?: boolean;
  gestationalReviewRequired?: boolean;
  gestationalBaseHasConflict?: boolean;
  gestationalBaseExplanation?: string | null;
  gestationalBaseConflictNote?: string | null;
  physicianName?: string | null;
  clinicUnit?: string | null;
  pregnancyType?: string | null;
  highRisk?: boolean;
  shospPatientId?: string | null;
  importedFromShosp?: boolean;
  syncStatus?: string | null;
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
    suggestedMessage?: string | null;
    required?: boolean;
    flowType?: string;
    status?: string;
    date: string | null;
    dateLabel: string;
    idealDate?: string | null;
    scheduledDate?: string | null;
    scheduledDateLabel?: string | null;
    importedFromShosp?: boolean;
    detectedInShosp?: boolean;
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
  priorityLevel?: "alta" | "media" | "baixa";
  priorityLabel?: string;
  messageType?: string;
  messageTypeLabel?: string;
  messageOrigin?: string;
  messageOriginLabel?: string;
  gestationalBaseSourceLabel: string;
  gestationalBaseConfidenceLabel: string;
  gestationalBaseIsEstimated: boolean;
  gestationalReviewRequired: boolean;
  gestationalBaseExplanation?: string | null;
  gestationalMessagingAlertLevel: "ok" | "warning" | "blocked";
  gestationalMessagingAlertMessage?: string | null;
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
    priorityLevel?: "alta" | "media" | "baixa";
    priorityLabel?: string;
    messageType?: string;
    messageTypeLabel?: string;
    messageOrigin?: string;
    messageOriginLabel?: string;
    suggestedMessage: string;
    gestationalBaseSourceLabel: string;
    gestationalBaseConfidenceLabel: string;
    gestationalBaseIsEstimated: boolean;
    gestationalReviewRequired: boolean;
    gestationalBaseExplanation?: string | null;
    gestationalMessagingAlertLevel: "ok" | "warning" | "blocked";
    gestationalMessagingAlertMessage?: string | null;
    whatsappUrl: string;
  }>;
  autoScheduledItems: Array<{
    patientId: number;
    patientName: string;
    phone: string;
    examName: string;
    scheduledDate: string | null;
    scheduledDateLabel: string;
    scheduledTime: string | null;
    sourceLabel: string;
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

export type GestationalBaseReviewItem = {
  patientId: number;
  patientName: string;
  phone: string;
  lastExamName: string;
  lastExamDate: string | null;
  lastExamDateLabel: string;
  suggestedEstimate: string;
  confidence: string;
  confidenceLabel: string;
  sourceLabel: string;
  explanation: string;
  hasConflict: boolean;
  canConfirm: boolean;
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

export type ShospSyncCursor = {
  syncKey: string;
  lastCursor: string | null;
  lastSuccessAt: string | null;
  updatedAt: string;
};

export type ShospSyncLog = {
  id: number;
  scope: string;
  mode: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  recordsReceived: number;
  recordsProcessed: number;
  recordsCreated: number;
  recordsUpdated: number;
  errorMessage: string | null;
  durationMs?: number | null;
  details?: Record<string, unknown> | null;
};

export type ShospRecentError = {
  id: number;
  scope: string;
  status: string;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs?: number | null;
};

export type ShospExamMapping = {
  id: number;
  shospExamCode: string | null;
  shospExamName: string;
  examModelId: number;
  examModelName: string;
  examModelCode: string;
  active: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ShospIntegrationStatus = {
  mode: string;
  configured: boolean;
  connection: {
    connected: boolean;
    label: string;
    detail: string;
  };
  summary: {
    lastSyncAt: string | null;
    patientsSynced: number;
    examsImported: number;
    detectedSchedules: number;
    recentErrorsCount: number;
    recentErrors: ShospRecentError[];
  };
  apiMetrics: {
    totalRequests: number;
    successfulRequests: number;
    totalResponseMs: number;
    averageResponseMs: number | null;
    lastResponseMs: number | null;
    lastSuccessAt: string | null;
    lastFailureAt: string | null;
    lastErrorMessage: string | null;
  };
  worker: {
    enabled: boolean;
    running: boolean;
    intervalMs: number;
    lastRunAt: string | null;
    lastResult: {
      trigger: string;
      ok: boolean;
      patients: number;
      attendances: number;
    } | null;
    lastError: string | null;
  };
  settings: {
    baseUrl: string;
    patientsPath: string;
    attendancesPath: string;
    examsPath: string;
    timeoutMs: number;
  };
  cursors: ShospSyncCursor[];
  logs: ShospSyncLog[];
  persistedConfig?: {
    useMock: boolean;
    apiBaseUrl: string | null;
    apiToken: string;
    apiKey: string;
    username: string | null;
    password: string;
    companyId: string | null;
    lastPatientsCursor: string | null;
    lastAttendancesCursor: string | null;
    lastSuccessAt: string | null;
    settings: Record<string, unknown>;
  } | null;
};

export type ShospSyncResult = {
  scope?: string;
  mode: string;
  ok: boolean;
  nextCursor?: string | null;
  recordsReceived?: number;
  recordsProcessed?: number;
  recordsCreated?: number;
  recordsUpdated?: number;
  skipped?: Array<Record<string, unknown>>;
  errorMessage?: string | null;
  patients?: ShospSyncResult;
  attendances?: ShospSyncResult;
};

export type ShospConnectionTestResult = {
  ok: boolean;
  mode: string;
  simulated: boolean;
  message: string;
  checkedAt: string;
  details?: Record<string, unknown> | null;
};

export type ShospCacheClearResult = {
  ok: boolean;
  clearedReminderEntries: number;
  clearedAt: string;
};

export type OperationalTestResult = {
  ok: boolean;
  patientId: number;
  patientName: string;
  finalStage: string;
  totalExams: number;
  realizedCount: number;
  timeline: Array<{
    examName: string;
    predictedDate: string;
    afterMessageStage: string;
    afterScheduleStage: string;
    afterCompletionStage: string;
  }>;
};
