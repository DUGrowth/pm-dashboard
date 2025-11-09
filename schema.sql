-- D1 schema for pm-dashboard

-- Entries (scheduled content)
CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  platforms TEXT,
  assetType TEXT,
  caption TEXT,
  platformCaptions TEXT,
  firstComment TEXT,
  approvalDeadline TEXT,
  status TEXT,
  approvers TEXT,
  author TEXT,
  campaign TEXT,
  contentPillar TEXT,
  previewUrl TEXT,
  checklist TEXT,
  analytics TEXT,
  workflowStatus TEXT,
  statusDetail TEXT,
  aiFlags TEXT,
  aiScore TEXT,
  testingFrameworkId TEXT,
  testingFrameworkName TEXT,
  createdAt TEXT,
  updatedAt TEXT,
  approvedAt TEXT,
  deletedAt TEXT
);

-- Ideas (content ideas)
CREATE TABLE IF NOT EXISTS ideas (
  id TEXT PRIMARY KEY,
  type TEXT,
  title TEXT NOT NULL,
  notes TEXT,
  links TEXT,
  attachments TEXT,
  inspiration TEXT,
  createdBy TEXT,
  createdAt TEXT,
  targetDate TEXT,
  targetMonth TEXT
);

-- Guidelines (content rules)
CREATE TABLE IF NOT EXISTS guidelines (
  id TEXT PRIMARY KEY,
  charLimits TEXT,
  bannedWords TEXT,
  requiredPhrases TEXT,
  languageGuide TEXT,
  hashtagTips TEXT,
  teamsWebhookUrl TEXT
);

-- Audit log
CREATE TABLE IF NOT EXISTS audit (
  id TEXT PRIMARY KEY,
  ts TEXT,
  user TEXT,
  entryId TEXT,
  action TEXT,
  meta TEXT
);

-- LinkedIn submissions
CREATE TABLE IF NOT EXISTS linkedin_submissions (
  id TEXT PRIMARY KEY,
  submissionType TEXT,
  status TEXT,
  title TEXT,
  postCopy TEXT,
  comments TEXT,
  owner TEXT,
  submitter TEXT,
  links TEXT,
  attachments TEXT,
  targetDate TEXT,
  createdAt TEXT,
  updatedAt TEXT
);

-- Testing frameworks
CREATE TABLE IF NOT EXISTS testing_frameworks (
  id TEXT PRIMARY KEY,
  name TEXT,
  hypothesis TEXT,
  audience TEXT,
  metric TEXT,
  duration TEXT,
  status TEXT,
  notes TEXT,
  createdAt TEXT
);
