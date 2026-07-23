import { useEffect, useMemo, useState } from "react";
import type React from "react";
import type { Session } from "@supabase/supabase-js";
import {
  AlertCircle,
  Banknote,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  Eye,
  EyeOff,
  FileText,
  Filter,
  LayoutDashboard,
  LogOut,
  LockKeyhole,
  Mail,
  Menu,
  ReceiptText,
  Settings,
  ShieldCheck,
  TrendingUp,
  Upload,
  Users,
  UserRound,
  XCircle,
} from "lucide-react";
import type { Contribution, GroupMember, InvestmentProject, MemberExitRequest, MemberPaymentStatus, MemberRecord, MembershipStatus, Profile, ProfileRole, ProjectExitSummary, ProjectStatus } from "./types";
import {
  DEFAULT_MONTHLY_MEMBER_CONTRIBUTION_BDT,
  DEFAULT_PLANNED_MEMBER_COUNT,
  DEFAULT_PROJECT_START_MONTH,
  MAX_RECEIPT_BYTES,
  calculateTotals,
  cancelMemberExit,
  createAdminMember,
  createProject,
  getVisibleProjects,
  getAdminContributions,
  getAdminMembers,
  getAdminProjectMemberships,
  getCurrentProfile,
  getMonthlyPaymentCoverage,
  getMemberContributions,
  getMemberExitRequests,
  getMemberPaymentStatus,
  getProjectApprovedContributions,
  getProjectExitSummary,
  getProjectMemberCount,
  getPerMemberTarget,
  getSignedReceiptUrl,
  getExitRequestPaidBdt,
  recordMemberRefund,
  requestMemberExit,
  reviewMemberExit,
  reviewContribution,
  submitAdminApprovedContribution,
  submitContribution,
  setProjectMembershipAssignment,
  updateMemberRecord,
  updateProjectSettings,
  updateProfile,
} from "./lib/investmentApi";
import { formatBdt, formatDate, fileSizeLabel } from "./lib/format";
import { hasSupabaseConfig, supabase } from "./lib/supabase";

type ViewMode = "member" | "admin";
type AdminSection = "overview" | "review" | "submit" | "status" | "reports" | "members" | "exits" | "project";
type MemberSection = "overview" | "submit" | "status" | "history" | "exit" | "profile";

type MemberFilterOption = {
  id: string;
  name: string;
  email: string | null;
};

const allowedReceiptTypes = ["application/pdf", "image/jpeg", "image/png", "image/jpg"];

const phoneCountryCodes = [
  { label: "Bangladesh", code: "+880" },
  { label: "Saudi Arabia", code: "+966" },
  { label: "United Arab Emirates", code: "+971" },
  { label: "Qatar", code: "+974" },
  { label: "Kuwait", code: "+965" },
  { label: "Oman", code: "+968" },
  { label: "Bahrain", code: "+973" },
  { label: "Malaysia", code: "+60" },
  { label: "Singapore", code: "+65" },
  { label: "India", code: "+91" },
];

function splitPhoneNumber(phone: string | null | undefined) {
  const cleanPhone = phone?.trim() ?? "";
  const matchedCode = phoneCountryCodes
    .map((item) => item.code)
    .sort((a, b) => b.length - a.length)
    .find((code) => cleanPhone.startsWith(code));

  return {
    code: matchedCode ?? "+880",
    number: matchedCode ? cleanPhone.slice(matchedCode.length).trim() : cleanPhone,
  };
}

function joinPhoneNumber(code: string, number: string) {
  const cleanNumber = number.replace(/[^\d]/g, "");
  return cleanNumber ? `${code}${cleanNumber}` : null;
}

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dateAfterDays(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return localDateKey(date);
}

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [recoveringPassword, setRecoveringPassword] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoadingSession(false);
    });

    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      if (event === "PASSWORD_RECOVERY") setRecoveringPassword(true);
      setLoadingSession(false);
    });

    return () => data.subscription.unsubscribe();
  }, []);

  if (!hasSupabaseConfig) return <SetupNotice />;
  if (loadingSession) {
    return <AppLoadingScreen title="Opening your investment dashboard" body="Checking your secure session and preparing the latest fund activity." />;
  }
  if (recoveringPassword && session) return <PasswordRecoveryScreen onDone={() => setRecoveringPassword(false)} />;
  if (!session) return <AuthScreen />;

  return <InvestmentApp session={session} />;
}

function getErrorMessage(err: unknown, fallback: string) {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err && "message" in err && typeof err.message === "string") return err.message;
  return fallback;
}

function InvestmentApp({ session }: { session: Session }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [project, setProject] = useState<InvestmentProject | null>(null);
  const [projects, setProjects] = useState<InvestmentProject[]>([]);
  const [contributions, setContributions] = useState<Contribution[]>([]);
  const [projectCollections, setProjectCollections] = useState<Contribution[]>([]);
  const [exitRequests, setExitRequests] = useState<MemberExitRequest[]>([]);
  const [exitSummary, setExitSummary] = useState<ProjectExitSummary>({ refundsPaidBdt: 0, refundsReservedBdt: 0 });
  const [projectMemberCount, setProjectMemberCount] = useState(0);
  const [mode, setMode] = useState<ViewMode>("member");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = profile?.role === "admin";

  async function loadData(nextMode?: ViewMode, requestedProjectId?: string) {
    setLoading(true);
    setError(null);
    try {
      const [profileData, visibleProjects] = await Promise.all([
        getCurrentProfile(session.user.id),
        getVisibleProjects(),
      ]);

      const savedProjectId = requestedProjectId ?? window.localStorage.getItem("investment-project-id");
      const projectData = visibleProjects.find((item) => item.id === savedProjectId)
        ?? visibleProjects.find((item) => item.status === "active")
        ?? visibleProjects[0]
        ?? null;

      setProfile(profileData);
      setProjects(visibleProjects);
      setProject(projectData);
      if (projectData) window.localStorage.setItem("investment-project-id", projectData.id);
      setProjectMemberCount(projectData ? await getProjectMemberCount(projectData.id) : 0);

      const effectiveMode = profileData?.role === "admin" ? "admin" : nextMode ?? "member";
      setMode(effectiveMode);

      let contributionData: Contribution[] = [];
      let collectionData: Contribution[] = [];

      if (effectiveMode === "admin") {
        contributionData = projectData ? await getAdminContributions(projectData.id) : [];
        collectionData = contributionData.filter((contribution) => contribution.status === "approved" && !isContributionFromAdmin(contribution));
      } else {
        const [memberContributionData, projectCollectionData] = await Promise.all([
          projectData ? getMemberContributions(session.user.id, projectData.id) : Promise.resolve([]),
          projectData ? getProjectApprovedContributions(projectData.id) : Promise.resolve([]),
        ]);
        contributionData = memberContributionData;
        collectionData = projectCollectionData;
      }

      setContributions(contributionData);
      setProjectCollections(collectionData);

      if (projectData) {
        try {
          const [exitRequestData, exitSummaryData] = await Promise.all([
            getMemberExitRequests(projectData.id, effectiveMode === "admin" ? undefined : session.user.id),
            getProjectExitSummary(projectData.id),
          ]);
          setExitRequests(exitRequestData);
          setExitSummary(exitSummaryData);
        } catch (exitError) {
          console.warn("Member exit workflow is not available yet.", exitError);
          setExitRequests([]);
          setExitSummary({ refundsPaidBdt: 0, refundsReservedBdt: 0 });
        }
      } else {
        setExitRequests([]);
        setExitSummary({ refundsPaidBdt: 0, refundsReservedBdt: 0 });
      }
    } catch (err) {
      setError(getErrorMessage(err, "Could not load investment data."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.user.id]);

  async function signOut() {
    await supabase.auth.signOut();
  }

  async function selectProject(projectId: string) {
    window.localStorage.setItem("investment-project-id", projectId);
    await loadData(mode, projectId);
  }

  async function refreshAdminContributions() {
    if (!project) return;
    setError(null);
    const contributionData = await getAdminContributions(project.id);
    setContributions(contributionData);
    setProjectCollections(
      contributionData.filter((contribution) => contribution.status === "approved" && !isContributionFromAdmin(contribution)),
    );
  }

  if (loading && !profile) {
    return <AppLoadingScreen title="Preparing your live ledger" body="Loading members, contributions, receipts, and project totals." />;
  }

  return (
    <PageShell adminShell={Boolean(profile)}>
      <header className="app-header">
        <div className="app-title">
          <p className="eyebrow">Private investment ledger</p>
          <h1>{project?.name ?? "Land & Home Investment"}</h1>
          {project?.description && <p>{project.description}</p>}
        </div>
        <div className="header-actions">
          {projects.length > 0 && (
            <label className="project-switcher">
              <span>Project</span>
              <select value={project?.id ?? ""} onChange={(event) => void selectProject(event.target.value)}>
                {projects.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.status}</option>)}
              </select>
            </label>
          )}
          {isAdmin && <span className="count-badge"><ShieldCheck size={14} /> Admin</span>}
          <button className="icon-button" type="button" onClick={() => void signOut()} title="Sign out" aria-label="Sign out">
            <LogOut size={18} />
          </button>
        </div>
      </header>

      {message && <InlineNotice tone="success" text={message} onClose={() => setMessage(null)} />}
      {error && <InlineNotice tone="error" text={error} onClose={() => setError(null)} />}

      {loading ? (
        <StatusMessage title="Loading data" body="Reading member records and payment history." />
      ) : mode === "admin" && isAdmin ? (
        <AdminDashboard
          project={project}
          projects={projects}
          contributions={contributions}
          projectCollections={projectCollections}
          projectMemberCount={projectMemberCount}
          exitRequests={exitRequests}
          exitSummary={exitSummary}
          currentUserId={session.user.id}
          onRefreshContributions={refreshAdminContributions}
          onProjectSaved={async (projectId, text = "Project setup saved.") => {
            setMessage(text);
            await loadData("admin", projectId);
          }}
          onReviewed={async (text) => {
            setMessage(text);
            await loadData("admin");
          }}
          onExitChanged={async (text) => {
            setMessage(text);
            await loadData("admin");
          }}
          onError={setError}
          onSignOut={signOut}
        />
      ) : (
        <MemberDashboard
          userId={session.user.id}
          profile={profile}
          project={project}
          contributions={contributions}
          projectCollections={projectCollections}
          projectMemberCount={projectMemberCount}
          exitRequests={exitRequests}
          exitSummary={exitSummary}
          onSavedProfile={async () => {
            setMessage("Profile saved.");
            await loadData("member");
          }}
          onSubmitted={async () => {
            setMessage("Payment proof submitted for review.");
            await loadData("member");
          }}
          onExitChanged={async (text) => {
            setMessage(text);
            await loadData("member");
          }}
          onError={setError}
          onSignOut={signOut}
        />
      )}
    </PageShell>
  );
}

function AuthScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const result = await supabase.auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
    } catch (err) {
      setMessage(getErrorMessage(err, "Authentication failed."));
    } finally {
      setBusy(false);
    }
  }

  async function sendPasswordReset() {
    if (!email.trim()) {
      setMessage("Enter your email address first.");
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: window.location.origin,
      });
      if (error) throw error;
      setMessage("Password reset email sent. Open the link to choose a new password.");
    } catch (err) {
      setMessage(getErrorMessage(err, "Could not send password reset email."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageShell compact>
      <main className="auth-layout auth-showcase">
        <section className="auth-copy">
          <div className="auth-brand">
            <span><LayoutDashboard size={22} /></span>
            <strong>HomeFund</strong>
          </div>
          <span className="live-badge"><TrendingUp size={14} /> Live investment ledger</span>
          <h1>Your fund, fully in view.</h1>
          <p>Track land and home investment contributions, approvals, member status, and project progress from one secure dashboard.</p>
          <div className="auth-stats">
            <div>
              <strong>BDT</strong>
              <span>Ledger</span>
            </div>
            <div>
              <strong>Invite</strong>
              <span>Only</span>
            </div>
            <div>
              <strong>24/7</strong>
              <span>Access</span>
            </div>
          </div>
          <div className="auth-chart" aria-hidden="true">
            <span style={{ height: "28%" }} />
            <span style={{ height: "42%" }} />
            <span style={{ height: "58%" }} />
            <span style={{ height: "38%" }} />
            <span style={{ height: "68%" }} />
            <span style={{ height: "52%" }} />
            <span style={{ height: "78%" }} />
            <span style={{ height: "45%" }} />
            <span style={{ height: "86%" }} />
          </div>
        </section>
        <form className="auth-panel" onSubmit={(event) => void submit(event)}>
          <div className="auth-panel-head">
            <h1>Welcome back</h1>
            <p>Sign in to your private investment dashboard</p>
          </div>
          <label className="auth-field">
            Email
            <span>
              <Mail size={18} />
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
            </span>
          </label>
          <label className="auth-field">
            Password
            <span>
              <LockKeyhole size={18} />
              <input type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} required />
              <button
                className="password-toggle"
                type="button"
                onClick={() => setShowPassword((current) => !current)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                title={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </span>
          </label>
          <div className="auth-row">
            <span />
            <button type="button" className="text-button" onClick={() => void sendPasswordReset()} disabled={busy}>Forgot password?</button>
          </div>
          <button className="primary-button auth-submit" type="submit" disabled={busy}>
            {busy ? "Please wait" : "Sign in to dashboard"}
          </button>
          {message && <p className="form-message">{message}</p>}
          <div className="auth-security">
            <span><ShieldCheck size={14} /> Private ledger</span>
            <span><CheckCircle2 size={14} /> Protected receipts</span>
          </div>
        </form>
      </main>
    </PageShell>
  );
}

function PasswordRecoveryScreen({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function updatePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirmation) {
      setMessage("Passwords do not match.");
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      onDone();
    } catch (err) {
      setMessage(getErrorMessage(err, "Could not update password."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageShell compact>
      <main className="auth-layout auth-showcase">
        <section className="auth-copy">
          <div className="auth-brand"><span><LockKeyhole size={22} /></span><strong>HomeFund</strong></div>
          <h1>Choose a new password.</h1>
          <p>Use at least eight characters and keep this password private.</p>
        </section>
        <form className="auth-panel" onSubmit={(event) => void updatePassword(event)}>
          <div className="auth-panel-head"><h1>Reset password</h1><p>Enter and confirm your new password.</p></div>
          <label className="auth-field">
            New password
            <span>
              <LockKeyhole size={18} />
              <input type={showPassword ? "text" : "password"} minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required />
              <button className="password-toggle" type="button" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? "Hide password" : "Show password"}>
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </span>
          </label>
          <label className="auth-field">
            Confirm password
            <span><LockKeyhole size={18} /><input type={showPassword ? "text" : "password"} minLength={8} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required /></span>
          </label>
          <button className="primary-button auth-submit" type="submit" disabled={busy}>{busy ? "Updating" : "Update password"}</button>
          {message && <p className="form-message">{message}</p>}
        </form>
      </main>
    </PageShell>
  );
}

function MemberDashboard(props: {
  userId: string;
  profile: Profile | null;
  project: InvestmentProject | null;
  contributions: Contribution[];
  projectCollections: Contribution[];
  projectMemberCount: number;
  exitRequests: MemberExitRequest[];
  exitSummary: ProjectExitSummary;
  onSavedProfile: () => Promise<void>;
  onSubmitted: () => Promise<void>;
  onExitChanged: (message: string) => Promise<void>;
  onError: (message: string) => void;
  onSignOut: () => Promise<void>;
}) {
  const [activeSection, setActiveSection] = useState<MemberSection>("overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const totals = useMemo(() => calculateTotals(props.contributions), [props.contributions]);
  const pendingCount = props.contributions.filter((contribution) => contribution.status === "pending").length;
  const approvedCount = props.contributions.filter((contribution) => contribution.status === "approved").length;
  const navItems = memberNavItemsConfig(pendingCount, approvedCount);
  const activeNavItem = navItems.find((item) => item.id === activeSection);

  function selectSection(section: MemberSection) {
    setActiveSection(section);
    setSidebarOpen(false);
  }

  function handleSignOut() {
    setSidebarOpen(false);
    void props.onSignOut();
  }

  async function openContributionReceipt(contribution: Contribution) {
    const receipt = contribution.payment_receipts?.[0];
    if (!receipt) return;
    try {
      const url = await getSignedReceiptUrl(receipt.storage_path);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      props.onError(getErrorMessage(err, "Could not open receipt."));
    }
  }

  return (
    <div className="admin-layout">
      <button
        className="admin-menu-button"
        type="button"
        onClick={() => setSidebarOpen(true)}
        aria-label="Open member navigation"
      >
        <Menu size={20} />
        <span>{activeNavItem?.label ?? "Menu"}</span>
      </button>
      {sidebarOpen && <button className="admin-sidebar-backdrop" type="button" aria-label="Close member navigation" onClick={() => setSidebarOpen(false)} />}
      <aside className={sidebarOpen ? "admin-sidebar open" : "admin-sidebar"} aria-label="Member navigation">
        <div className="admin-sidebar-head">
          <span className="title-icon"><UserRound size={20} /></span>
          <div>
            <h2>Member</h2>
            <p>Investment portal</p>
          </div>
        </div>
        <nav className="admin-nav">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={activeSection === item.id ? "active" : ""}
              onClick={() => selectSection(item.id)}
            >
              <span>{item.icon}</span>
              <strong>{item.label}</strong>
              <small>{item.detail}</small>
            </button>
          ))}
          <button className="nav-logout" type="button" onClick={handleSignOut}>
            <span><LogOut size={17} /></span>
            <strong>Log out</strong>
            <small>End session</small>
          </button>
        </nav>
      </aside>

      <main className="admin-content">
        {activeSection === "overview" && (
          <MemberOverview
            project={props.project}
            contributions={props.contributions}
            projectCollections={props.projectCollections}
            projectMemberCount={props.projectMemberCount}
            exitSummary={props.exitSummary}
            totals={totals}
            onNavigate={selectSection}
          />
        )}

        {activeSection === "submit" && (
          props.project?.status !== "active" ? (
            <section className="panel"><EmptyState text="Contributions are available only while this project is active." /></section>
          ) : props.exitRequests.some((request) => ["settlement_approved", "refund_pending", "completed"].includes(request.status)) ? (
            <section className="panel"><EmptyState text="New contributions are disabled because your exit settlement has been approved or completed." /></section>
          ) : (
            <PaymentForm
              userId={props.userId}
              project={props.project}
              onSubmitted={props.onSubmitted}
              onError={props.onError}
            />
          )
        )}

        {activeSection === "status" && (
          <MemberPaymentStatusPanel project={props.project} onError={props.onError} />
        )}

        {activeSection === "history" && (
          <ContributionTable
            title="My contribution history"
            contributions={props.contributions}
            onOpenReceipt={openContributionReceipt}
          />
        )}

        {activeSection === "exit" && (
          <MemberExitPanel
            project={props.project}
            requests={props.exitRequests}
            contributions={props.contributions}
            onChanged={props.onExitChanged}
            onError={props.onError}
          />
        )}

        {activeSection === "profile" && (
          <ProfilePanel
            userId={props.userId}
            profile={props.profile}
            project={props.project}
            contributions={props.contributions}
            onSaved={props.onSavedProfile}
            onError={props.onError}
          />
        )}
      </main>
    </div>
  );
}

function memberNavItemsConfig(pendingCount: number, approvedCount: number): Array<{ id: MemberSection; label: string; icon: React.ReactNode; detail: string }> {
  return [
    { id: "overview", label: "Overview", icon: <LayoutDashboard size={17} />, detail: "My fund" },
    { id: "submit", label: "Submit", icon: <Upload size={17} />, detail: "Payment proof" },
    { id: "status", label: "Payment status", icon: <Users size={17} />, detail: "Paid list" },
    { id: "history", label: "History", icon: <ReceiptText size={17} />, detail: `${approvedCount} approved` },
    { id: "exit", label: "Leave project", icon: <LogOut size={17} />, detail: "Exit & refund" },
    { id: "profile", label: "Profile", icon: <UserRound size={17} />, detail: `${pendingCount} pending` },
  ];
}

function TargetProgressCard({ collected, target, monthlyPaceBdt = 0 }: { collected: number; target: number; monthlyPaceBdt?: number }) {
  const progress = target > 0 ? Math.min(100, (collected / target) * 100) : 0;
  const remaining = Math.max(0, target - collected);
  const monthsRemaining = remaining > 0 && monthlyPaceBdt > 0 ? Math.ceil(remaining / monthlyPaceBdt) : 0;
  const projectedFinish = monthsRemaining > 0
    ? new Intl.DateTimeFormat("en", { month: "short", year: "numeric" }).format(addMonths(startOfCurrentMonth(), monthsRemaining))
    : remaining === 0 && target > 0 ? "Funded" : "Not available";

  return (
    <>
      <div className="panel-title split-title">
        <div>
          <span className="title-icon"><LayoutDashboard size={20} /></span>
          <h2>Target progress</h2>
        </div>
        {target <= 0 && <span className="count-badge">No target</span>}
      </div>
      {target > 0 ? (
        <div className="target-progress-layout" aria-label="Investment target progress">
          <div
            className="target-progress-ring"
            style={{ background: `conic-gradient(var(--accent) 0 ${progress}%, var(--line-soft) ${progress}% 100%)` }}
          >
            <div>
              <strong>{Math.round(progress)}%</strong>
              <span>Funded</span>
            </div>
          </div>
          <div className="target-progress-details">
            <MiniStat label="Collected" value={formatBdt(collected)} />
            <MiniStat label="Target" value={formatBdt(target)} />
            <MiniStat label="Remaining" value={formatBdt(remaining)} />
          </div>
        </div>
      ) : (
        <EmptyState text="Set a project target to track progress." />
      )}
      {target > 0 && (
        <div className="funding-outlook">
          <div className="funding-outlook-head">
            <span><TrendingUp size={16} /></span>
            <div>
              <strong>Funding outlook</strong>
              <small>Estimate at the current monthly contribution pace</small>
            </div>
          </div>
          <div className="funding-outlook-grid">
            <MiniStat label="Monthly pace" value={monthlyPaceBdt > 0 ? formatBdt(monthlyPaceBdt) : "Not available"} />
            <MiniStat label="Time remaining" value={monthsRemaining > 0 ? formatFundingDuration(monthsRemaining) : remaining === 0 ? "Complete" : "Not available"} />
            <MiniStat label="Projected finish" value={projectedFinish} />
          </div>
        </div>
      )}
    </>
  );
}

function formatFundingDuration(totalMonths: number) {
  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;
  if (years === 0) return `${months} mo`;
  if (months === 0) return `${years} yr`;
  return `${years} yr ${months} mo`;
}

function MemberOverview({ project, contributions, projectCollections, projectMemberCount, exitSummary, totals, onNavigate }: {
  project: InvestmentProject | null;
  contributions: Contribution[];
  projectCollections: Contribution[];
  projectMemberCount: number;
  exitSummary: ProjectExitSummary;
  totals: ReturnType<typeof calculateTotals>;
  onNavigate: (section: MemberSection) => void;
}) {
  const projectTotals = useMemo(() => calculateTotals(projectCollections), [projectCollections]);
  const netFundBalance = Math.max(0, projectTotals.approved - exitSummary.refundsPaidBdt);
  const target = Number(project?.target_amount_bdt ?? 0);
  const monthlyContribution = Number(project?.monthly_contribution_bdt ?? DEFAULT_MONTHLY_MEMBER_CONTRIBUTION_BDT);
  const projectStartMonth = project?.contribution_start_month?.slice(0, 7) ?? DEFAULT_PROJECT_START_MONTH;
  const ownCoverage = getMonthlyPaymentCoverage(totals.approved, currentMonthKey(), monthlyContribution, projectStartMonth);
  const recent = contributions.slice(0, 5);

  return (
    <div className="dashboard-stack">
      <div className="overview-kpi-grid">
        <MetricCard icon={<Banknote />} label="My approved" value={formatBdt(totals.approved)} />
        <MetricCard icon={<Clock3 />} label="Waiting review" value={formatBdt(totals.pending)} />
        <MetricCard icon={<ReceiptText />} label="Monthly contribution" value={formatBdt(monthlyContribution)} />
        <MetricCard icon={<Users />} label="Active members" value={String(projectMemberCount)} />
      </div>
      <div className="finance-dashboard-grid member-overview-grid">
      <section className="panel finance-balance-card">
        <div className="finance-card-head">
          <div>
            <p className="eyebrow">Net fund balance</p>
            <h2>{formatBdt(netFundBalance)}</h2>
            <span>{project?.name ?? "No active project"}</span>
          </div>
          <span className="title-icon"><Banknote size={20} /></span>
        </div>
        <CollectionChart contributions={projectCollections} />
        <div className="mini-card-row">
          <MiniStat label="Gross collected" value={formatBdt(projectTotals.approved)} />
          <MiniStat label="Refunds paid" value={formatBdt(exitSummary.refundsPaidBdt)} />
        </div>
      </section>

      <section className="panel finance-transactions-card">
        <div className="panel-title split-title">
          <div>
            <span className="title-icon"><ReceiptText size={20} /></span>
            <h2>Recent payments</h2>
          </div>
          <button className="secondary-button" type="button" onClick={() => onNavigate("history")}>See all</button>
        </div>
        <ContributionFeed contributions={recent} />
      </section>

      <section className="panel finance-progress-card">
        <TargetProgressCard
          collected={netFundBalance}
          target={target}
          monthlyPaceBdt={projectMemberCount * monthlyContribution}
        />
      </section>

      <section className="panel finance-score-card">
        <div className="panel-title split-title">
          <div>
            <span className="title-icon"><Users size={20} /></span>
            <h2>Payment status</h2>
          </div>
          <button className="secondary-button" type="button" onClick={() => onNavigate("status")}>Open</button>
        </div>
        <ProgressGauge value={ownCoverage.coveragePercent} label={ownCoverage.paid ? "Current" : "Needs payment"} />
        <div className="insight-list compact-insights">
          <InsightRow label="Monthly due" value={formatBdt(monthlyContribution)} />
          <InsightRow label="Paid through" value={ownCoverage.paidThroughMonth ? monthLabel(ownCoverage.paidThroughMonth) : "No full month"} />
          <InsightRow label="Balance" value={coverageBalanceLabel(ownCoverage)} />
        </div>
      </section>
      </div>
    </div>
  );
}

function currentMonthKey() {
  return localDateKey().slice(0, 7);
}

function coverageBalanceLabel(coverage: ReturnType<typeof getMonthlyPaymentCoverage>) {
  if (coverage.overdueMonths > 0) return `Due ${coverage.overdueMonths} month${coverage.overdueMonths === 1 ? "" : "s"}`;
  if (coverage.advanceMonths > 0) return `Advance ${coverage.advanceMonths} month${coverage.advanceMonths === 1 ? "" : "s"}`;
  if (coverage.creditBdt > 0) return `${formatBdt(coverage.creditBdt)} credit`;
  return "Current";
}

function paymentStatusBalanceLabel(row: MemberPaymentStatus) {
  if (row.overdueMonths > 0) return `Due ${row.overdueMonths} month${row.overdueMonths === 1 ? "" : "s"} / ${formatBdt(row.remainingDueBdt)}`;
  if (row.advanceMonths > 0) return `Advance ${row.advanceMonths} month${row.advanceMonths === 1 ? "" : "s"}`;
  if (row.creditBdt > 0) return `${formatBdt(row.creditBdt)} credit toward next month`;
  return "Current";
}

function MemberPaymentStatusPanel({ project, onError }: {
  project: InvestmentProject | null;
  onError: (message: string) => void;
}) {
  const [month, setMonth] = useState(currentMonthKey());
  const [rows, setRows] = useState<MemberPaymentStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const projectId = project?.id;

  useEffect(() => {
    if (!projectId) return;
    const activeProjectId = projectId;
    let cancelled = false;

    async function loadStatus() {
      setLoading(true);
      try {
        const statusRows = await getMemberPaymentStatus(activeProjectId, month, {
          monthlyContributionBdt: Number(project?.monthly_contribution_bdt ?? DEFAULT_MONTHLY_MEMBER_CONTRIBUTION_BDT),
          projectStartMonth: project?.contribution_start_month?.slice(0, 7) ?? DEFAULT_PROJECT_START_MONTH,
        });
        if (!cancelled) setRows(statusRows);
      } catch (err) {
        if (!cancelled) onError(getErrorMessage(err, "Could not load member payment status."));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadStatus();
    return () => {
      cancelled = true;
    };
  }, [month, onError, project?.contribution_start_month, project?.monthly_contribution_bdt, projectId]);

  const paidCount = rows.filter((row) => row.paid).length;
  const unpaidCount = rows.length - paidCount;
  const advanceCount = rows.filter((row) => row.advanceMonths > 0).length;

  return (
    <section className="panel">
      <div className="panel-title split-title">
        <div>
          <span className="title-icon"><Users size={20} /></span>
          <h2>Member payment status</h2>
        </div>
        <span className="count-badge">{monthLabel(month)}</span>
      </div>
      <p className="helper-text">
        Every member owes {formatBdt(Number(project?.monthly_contribution_bdt ?? DEFAULT_MONTHLY_MEMBER_CONTRIBUTION_BDT))} per month from {monthLabel(project?.contribution_start_month?.slice(0, 7) ?? DEFAULT_PROJECT_START_MONTH)}. Approved bulk payments clear old months first, then count as advance payment.
      </p>
      <div className="filter-grid">
        <label>
          Month
          <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
        </label>
      </div>
      <div className="admin-metric-grid">
        <MetricCard icon={<CheckCircle2 />} label="Paid members" value={loading ? "Loading" : String(paidCount)} />
        <MetricCard icon={<Clock3 />} label="Not paid" value={loading ? "Loading" : String(unpaidCount)} />
        <MetricCard icon={<TrendingUp />} label="Advance paid" value={loading ? "Loading" : String(advanceCount)} />
        <MetricCard icon={<Users />} label="Members shown" value={loading ? "Loading" : String(rows.length)} />
      </div>

      {loading ? (
        <StatusMessage title="Loading payment status" body="Checking approved contributions for the selected month." />
      ) : rows.length === 0 ? (
        <EmptyState text="No active members found for this project." />
      ) : (
        <div className="table-wrap payment-status-table">
          <table>
            <thead>
              <tr>
                <th>Member</th>
                <th>Status</th>
                <th>Required</th>
                <th>Approved</th>
                <th>Balance</th>
                <th>Paid through</th>
                <th>Last paid</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.memberId}>
                  <td data-label="Member">
                    <div className="payment-member-cell">
                      <strong>{row.memberName}</strong>
                      <small>{row.memberCode || row.email || "Member account"}</small>
                      <span className="payment-progress-track" aria-label={`${Math.round(row.coveragePercent)}% contribution coverage`}>
                        <span style={{ width: `${Math.max(0, Math.min(100, row.coveragePercent))}%` }} />
                      </span>
                    </div>
                  </td>
                  <td data-label="Status">
                    <span className={`status-pill ${row.paid ? "approved" : "pending"}`}>
                      {row.paid ? <CheckCircle2 size={14} /> : <Clock3 size={14} />}
                      {row.paid ? "Paid" : "Not paid"}
                    </span>
                  </td>
                  <td data-label="Required">{formatBdt(row.dueMonths * Number(project?.monthly_contribution_bdt ?? DEFAULT_MONTHLY_MEMBER_CONTRIBUTION_BDT))}</td>
                  <td data-label="Approved">{formatBdt(row.approvedTotalBdt)}</td>
                  <td data-label="Balance">{paymentStatusBalanceLabel(row)}</td>
                  <td data-label="Paid through">{row.paidThroughMonth ? monthLabel(row.paidThroughMonth) : "No full month"}</td>
                  <td data-label="Last paid">{row.lastPaymentDate ? formatDate(row.lastPaymentDate) : "None"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ProfilePanel({ userId, profile, project, contributions, onSaved, onError }: {
  userId: string;
  profile: Profile | null;
  project: InvestmentProject | null;
  contributions: Contribution[];
  onSaved: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const initialPhone = splitPhoneNumber(profile?.phone);
  const [fullName, setFullName] = useState(profile?.full_name ?? "");
  const [phoneCode, setPhoneCode] = useState(initialPhone.code);
  const [phone, setPhone] = useState(initialPhone.number);
  const [country, setCountry] = useState(profile?.resident_country ?? "");
  const [busy, setBusy] = useState(false);
  const [membershipDetails, setMembershipDetails] = useState<MemberPaymentStatus | null>(null);
  const totals = useMemo(() => calculateTotals(contributions), [contributions]);
  const coverage = getMonthlyPaymentCoverage(
    totals.approved,
    currentMonthKey(),
    Number(project?.monthly_contribution_bdt ?? DEFAULT_MONTHLY_MEMBER_CONTRIBUTION_BDT),
    project?.contribution_start_month?.slice(0, 7) ?? DEFAULT_PROJECT_START_MONTH,
  );
  const recentContributions = contributions.slice(0, 4);

  useEffect(() => {
    if (!project?.id) return;
    let cancelled = false;
    void getMemberPaymentStatus(project.id, currentMonthKey(), {
      monthlyContributionBdt: Number(project.monthly_contribution_bdt),
      projectStartMonth: project.contribution_start_month.slice(0, 7),
    })
      .then((rows) => {
        if (!cancelled) setMembershipDetails(rows.find((row) => row.memberId === userId) ?? null);
      })
      .catch((err) => {
        if (!cancelled) onError(getErrorMessage(err, "Could not load membership information."));
      });
    return () => {
      cancelled = true;
    };
  }, [onError, project?.contribution_start_month, project?.id, project?.monthly_contribution_bdt, userId]);

  useEffect(() => {
    const parsedPhone = splitPhoneNumber(profile?.phone);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFullName(profile?.full_name ?? "");
    setPhoneCode(parsedPhone.code);
    setPhone(parsedPhone.number);
    setCountry(profile?.resident_country ?? "");
  }, [profile]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      await updateProfile({
        id: userId,
        full_name: fullName,
        phone: joinPhoneNumber(phoneCode, phone),
        resident_country: country || null,
      });
      await onSaved();
    } catch (err) {
      onError(getErrorMessage(err, "Could not save profile."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="profile-page">
      <section className="profile-hero">
        <span className="profile-hero-avatar"><UserRound size={30} /></span>
        <div>
          <p className="eyebrow">Member account</p>
          <h2>{profile?.full_name || profile?.email || "Member"}</h2>
          <p>{profile?.email ?? "Email not available"}</p>
        </div>
        <span className="count-badge"><ShieldCheck size={14} /> {profile?.role ?? "member"}</span>
      </section>

      <div className="profile-metric-grid">
        <MetricCard icon={<Banknote />} label="Approved contribution" value={formatBdt(totals.approved)} />
        <MetricCard icon={<Clock3 />} label="Pending review" value={formatBdt(totals.pending)} />
        <MetricCard icon={<CheckCircle2 />} label="Paid through" value={coverage.paidThroughMonth ? monthLabel(coverage.paidThroughMonth) : "No full month"} />
        <MetricCard icon={<TrendingUp />} label="Contribution balance" value={coverageBalanceLabel(coverage)} />
      </div>

      <section className="profile-membership-strip">
        <MiniStat label="Member code" value={membershipDetails?.memberCode || "Not set"} />
        <MiniStat label="Joined date" value={membershipDetails?.joinedAt ? formatDate(membershipDetails.joinedAt) : "Not available"} />
        <MiniStat label="Membership status" value={membershipDetails?.membershipStatus ?? "Not available"} />
        <MiniStat label="Payment records" value={membershipDetails ? String(membershipDetails.paymentCount) : String(contributions.length)} />
      </section>

      <div className="profile-content-grid">
        <form className="panel profile-information-card" onSubmit={(event) => void save(event)}>
          <div className="panel-title">
            <span className="title-icon"><UserRound size={20} /></span>
            <div><h2>Profile information</h2><p>Keep your contact information current.</p></div>
          </div>
          <label>
            Full name
            <input value={fullName} onChange={(event) => setFullName(event.target.value)} required />
          </label>
          <label>
            Phone
            <div className="phone-input">
              <select value={phoneCode} onChange={(event) => setPhoneCode(event.target.value)} aria-label="Phone country code">
                {phoneCountryCodes.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.code} {item.label}
                  </option>
                ))}
              </select>
              <input
                inputMode="numeric"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="1712345678"
              />
            </div>
          </label>
          <label>
            Current country
            <input value={country} onChange={(event) => setCountry(event.target.value)} placeholder="Saudi Arabia, UAE, Qatar..." />
          </label>
          <button className="primary-button" type="submit" disabled={busy}>{busy ? "Saving" : "Save profile"}</button>
        </form>

        <section className="panel profile-activity-card">
          <div className="panel-title">
            <span className="title-icon"><ReceiptText size={20} /></span>
            <div><h2>Recent contribution activity</h2><p>Your latest submitted payment records.</p></div>
          </div>
          <ContributionFeed contributions={recentContributions} />
        </section>
      </div>
    </div>
  );
}

function PaymentForm({ userId, project, onSubmitted, onError }: {
  userId: string;
  project: InvestmentProject | null;
  onSubmitted: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [paymentDate, setPaymentDate] = useState(localDateKey());
  const [bdtAmount, setBdtAmount] = useState("");
  const [sourceCurrency, setSourceCurrency] = useState("");
  const [sourceAmount, setSourceAmount] = useState("");
  const [exchangeRate, setExchangeRate] = useState("");
  const [country, setCountry] = useState("");
  const [method, setMethod] = useState("");
  const [notes, setNotes] = useState("");
  const [receipt, setReceipt] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!project) {
      onError("No active investment project found.");
      return;
    }
    if (!receipt) {
      onError("Attach a PDF, JPG, or PNG payment proof.");
      return;
    }
    if (!allowedReceiptTypes.includes(receipt.type)) {
      onError("Receipt must be PDF, JPG, or PNG.");
      return;
    }
    if (receipt.size > MAX_RECEIPT_BYTES) {
      onError("Receipt must be 10 MB or smaller.");
      return;
    }

    setBusy(true);
    try {
      await submitContribution({
        projectId: project.id,
        memberId: userId,
        paymentDate,
        bdtAmount: Number(bdtAmount),
        sourceCurrency,
        sourceAmount: sourceAmount ? Number(sourceAmount) : undefined,
        exchangeRate: exchangeRate ? Number(exchangeRate) : undefined,
        sentFromCountry: country,
        paymentMethod: method,
        notes,
        receipt,
      });
      setBdtAmount("");
      setSourceCurrency("");
      setSourceAmount("");
      setExchangeRate("");
      setCountry("");
      setMethod("");
      setNotes("");
      setReceipt(null);
      await onSubmitted();
    } catch (err) {
      onError(getErrorMessage(err, "Could not submit contribution."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel payment-panel payment-workspace" onSubmit={(event) => void submit(event)}>
      <div className="panel-title split-title">
        <div><span className="title-icon"><Upload size={20} /></span><div><h2>Submit payment proof</h2><p>Add the transfer details and receipt for admin review.</p></div></div>
        <span className="count-badge"><ShieldCheck size={14} /> Review required</span>
      </div>
      <div className="payment-workspace-grid">
        <div className="payment-form-sections">
          <section className="payment-form-section">
            <div className="payment-section-heading"><span>01</span><div><h3>Contribution details</h3><p>Record the BDT value and payment date.</p></div></div>
            <div className="form-grid">
              <label>Payment date<input type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} required /></label>
              <label>BDT amount<input type="number" min="1" step="0.01" value={bdtAmount} onChange={(event) => setBdtAmount(event.target.value)} required /></label>
              <label>Payment method<input value={method} onChange={(event) => setMethod(event.target.value)} placeholder="Bank transfer, cash deposit..." /></label>
              <label>Sent from<input value={country} onChange={(event) => setCountry(event.target.value)} placeholder="Saudi Arabia" /></label>
            </div>
          </section>
          <section className="payment-form-section">
            <div className="payment-section-heading"><span>02</span><div><h3>Source currency</h3><p>Optional information for overseas transfers.</p></div></div>
            <div className="form-grid three-column-form-grid">
              <label>Currency<input value={sourceCurrency} onChange={(event) => setSourceCurrency(event.target.value.toUpperCase())} placeholder="SAR, AED, QAR" /></label>
              <label>Source amount<input type="number" min="0" step="0.01" value={sourceAmount} onChange={(event) => setSourceAmount(event.target.value)} /></label>
              <label>Exchange rate<input type="number" min="0" step="0.000001" value={exchangeRate} onChange={(event) => setExchangeRate(event.target.value)} /></label>
            </div>
          </section>
          <section className="payment-form-section">
            <div className="payment-section-heading"><span>03</span><div><h3>Receipt and notes</h3><p>Attach proof before submitting the contribution.</p></div></div>
            <label>Notes<textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} placeholder="Optional payment note" /></label>
            <label className="file-picker"><FileText size={18} /><span>{receipt ? `${receipt.name} (${fileSizeLabel(receipt.size)})` : "Attach PDF, JPG, or PNG receipt"}</span><input type="file" accept="application/pdf,image/jpeg,image/png,image/jpg" onChange={(event) => setReceipt(event.target.files?.[0] ?? null)} required /></label>
          </section>
        </div>
        <aside className="payment-summary-card">
          <p className="eyebrow">Submission summary</p>
          <h3>{bdtAmount ? formatBdt(Number(bdtAmount)) : formatBdt(0)}</h3>
          <div className="insight-list compact-insights">
            <InsightRow label="Monthly rule" value={formatBdt(Number(project?.monthly_contribution_bdt ?? DEFAULT_MONTHLY_MEMBER_CONTRIBUTION_BDT))} />
            <InsightRow label="Payment date" value={formatDate(paymentDate)} />
            <InsightRow label="Method" value={method || "Not set"} />
            <InsightRow label="Receipt" value={receipt ? "Attached" : "Required"} />
            <InsightRow label="Next step" value="Admin review" />
          </div>
          <button className="primary-button" type="submit" disabled={busy}>{busy ? "Submitting" : "Submit for review"}</button>
          <small>Approved bulk payments clear the oldest unpaid months first.</small>
        </aside>
      </div>
    </form>
  );
}

function AdminPaymentForm({ project, members, onSubmitted, onError }: {
  project: InvestmentProject;
  members: MemberRecord[];
  onSubmitted: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const activeMembers = useMemo(
    () => members
      .filter((member) => isMemberAccount(member) && getEffectiveMembershipStatus(member) === "active")
      .sort((a, b) => (a.full_name || a.email || "").localeCompare(b.full_name || b.email || "")),
    [members],
  );
  const [memberId, setMemberId] = useState(activeMembers[0]?.id ?? "");
  const [paymentDate, setPaymentDate] = useState(localDateKey());
  const [bdtAmount, setBdtAmount] = useState("");
  const [sourceCurrency, setSourceCurrency] = useState("");
  const [sourceAmount, setSourceAmount] = useState("");
  const [exchangeRate, setExchangeRate] = useState("");
  const [country, setCountry] = useState("");
  const [method, setMethod] = useState("");
  const [notes, setNotes] = useState("");
  const [receipt, setReceipt] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (activeMembers[0] && !activeMembers.some((member) => member.id === memberId)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMemberId(activeMembers[0].id);
    }
  }, [activeMembers, memberId]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!memberId) {
      onError("Select a member first.");
      return;
    }
    if (!receipt) {
      onError("Attach a PDF, JPG, or PNG payment proof.");
      return;
    }
    if (!allowedReceiptTypes.includes(receipt.type)) {
      onError("Receipt must be PDF, JPG, or PNG.");
      return;
    }
    if (receipt.size > MAX_RECEIPT_BYTES) {
      onError("Receipt must be 10 MB or smaller.");
      return;
    }

    setBusy(true);
    try {
      await submitAdminApprovedContribution({
        projectId: project.id,
        memberId,
        paymentDate,
        bdtAmount: Number(bdtAmount),
        sourceCurrency,
        sourceAmount: sourceAmount ? Number(sourceAmount) : undefined,
        exchangeRate: exchangeRate ? Number(exchangeRate) : undefined,
        sentFromCountry: country,
        paymentMethod: method,
        notes,
        receipt,
      });
      setBdtAmount("");
      setSourceCurrency("");
      setSourceAmount("");
      setExchangeRate("");
      setCountry("");
      setMethod("");
      setNotes("");
      setReceipt(null);
      await onSubmitted();
    } catch (err) {
      onError(getErrorMessage(err, "Could not submit member payment."));
    } finally {
      setBusy(false);
    }
  }

  if (activeMembers.length === 0) {
    return (
      <section className="panel payment-panel">
        <div className="panel-title split-title">
          <Upload size={20} />
          <h2>Submit payment for member</h2>
        </div>
        <EmptyState text="Add an active member before submitting payment proof on their behalf." />
      </section>
    );
  }

  const selectedMember = activeMembers.find((member) => member.id === memberId);

  return (
    <form className="panel payment-panel payment-workspace" onSubmit={(event) => void submit(event)}>
      <div className="panel-title split-title">
        <div>
          <span className="title-icon"><Upload size={20} /></span>
          <div><h2>Submit payment for member</h2><p>Record verified proof directly on a member account.</p></div>
        </div>
        <span className="count-badge">Auto approved</span>
      </div>
      <div className="payment-workspace-grid">
        <div className="payment-form-sections">
          <section className="payment-form-section">
            <div className="payment-section-heading"><span>01</span><div><h3>Member and payment</h3><p>Select the account and record the BDT contribution.</p></div></div>
            <label>Member<select value={memberId} onChange={(event) => setMemberId(event.target.value)} required>{activeMembers.map((member) => <option key={member.id} value={member.id}>{member.full_name || member.email || "Member"}{member.membership?.member_code ? ` / ${member.membership.member_code}` : ""}</option>)}</select></label>
            <div className="form-grid">
              <label>Payment date<input type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} required /></label>
              <label>BDT amount<input type="number" min="1" step="0.01" value={bdtAmount} onChange={(event) => setBdtAmount(event.target.value)} required /></label>
              <label>Payment method<input value={method} onChange={(event) => setMethod(event.target.value)} placeholder="Bank transfer, cash deposit..." /></label>
              <label>Sent from<input value={country} onChange={(event) => setCountry(event.target.value)} placeholder="Saudi Arabia" /></label>
            </div>
          </section>
          <section className="payment-form-section">
            <div className="payment-section-heading"><span>02</span><div><h3>Transfer conversion</h3><p>Optional overseas transfer details.</p></div></div>
            <div className="form-grid three-column-form-grid">
              <label>Currency<input value={sourceCurrency} onChange={(event) => setSourceCurrency(event.target.value.toUpperCase())} placeholder="SAR, AED, QAR" /></label>
              <label>Source amount<input type="number" min="0" step="0.01" value={sourceAmount} onChange={(event) => setSourceAmount(event.target.value)} /></label>
              <label>Exchange rate<input type="number" min="0" step="0.000001" value={exchangeRate} onChange={(event) => setExchangeRate(event.target.value)} /></label>
            </div>
          </section>
          <section className="payment-form-section">
            <div className="payment-section-heading"><span>03</span><div><h3>Verification</h3><p>Add the receipt and optional admin note.</p></div></div>
            <label>Notes<textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} placeholder="Optional admin note" /></label>
            <label className="file-picker"><FileText size={18} /><span>{receipt ? `${receipt.name} (${fileSizeLabel(receipt.size)})` : "Attach PDF, JPG, or PNG receipt"}</span><input type="file" accept="application/pdf,image/jpeg,image/png,image/jpg" onChange={(event) => setReceipt(event.target.files?.[0] ?? null)} required /></label>
          </section>
        </div>
        <aside className="payment-summary-card admin-payment-summary">
          <p className="eyebrow">Approval summary</p>
          <h3>{bdtAmount ? formatBdt(Number(bdtAmount)) : formatBdt(0)}</h3>
          <div className="insight-list compact-insights">
            <InsightRow label="Member" value={selectedMember?.full_name || selectedMember?.email || "Select member"} />
            <InsightRow label="Member code" value={selectedMember?.membership?.member_code || "Not set"} />
            <InsightRow label="Payment date" value={formatDate(paymentDate)} />
            <InsightRow label="Receipt" value={receipt ? "Attached" : "Required"} />
            <InsightRow label="Status" value="Approved immediately" />
          </div>
          <button className="primary-button" type="submit" disabled={busy}>{busy ? "Submitting" : "Submit and approve"}</button>
          <small>This admin entry bypasses the pending-review queue.</small>
        </aside>
      </div>
    </form>
  );
}

function AdminDashboard({ project, projects, contributions, projectCollections, projectMemberCount, exitRequests, exitSummary, currentUserId, onRefreshContributions, onProjectSaved, onReviewed, onExitChanged, onError, onSignOut }: {
  project: InvestmentProject | null;
  projects: InvestmentProject[];
  contributions: Contribution[];
  projectCollections: Contribution[];
  projectMemberCount: number;
  exitRequests: MemberExitRequest[];
  exitSummary: ProjectExitSummary;
  currentUserId: string;
  onRefreshContributions: () => Promise<void>;
  onProjectSaved: (projectId: string, message?: string) => Promise<void>;
  onReviewed: (message: string) => Promise<void>;
  onExitChanged: (message: string) => Promise<void>;
  onError: (message: string) => void;
  onSignOut: () => Promise<void>;
}) {
  const [activeSection, setActiveSection] = useState<AdminSection>("overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [members, setMembers] = useState<MemberRecord[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [refreshingReview, setRefreshingReview] = useState(false);
  const pending = contributions.filter((item) => item.status === "pending");

  async function loadMembers() {
    if (!project) return;
    setLoadingMembers(true);
    try {
      setMembers(await getAdminMembers(project.id));
    } catch (err) {
      onError(getErrorMessage(err, "Could not load members."));
    } finally {
      setLoadingMembers(false);
    }
  }

  useEffect(() => {
    if (!project) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadMembers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  async function handleReview(contribution: Contribution, status: "approved" | "rejected") {
    const reason = status === "rejected" ? window.prompt("Reason for rejection?") ?? "Rejected by admin" : undefined;
    try {
      await reviewContribution({
        contributionId: contribution.id,
        status,
        rejectionReason: reason,
      });
      await onReviewed(status === "approved" ? "Contribution approved." : "Contribution rejected.");
    } catch (err) {
      onError(getErrorMessage(err, "Could not update contribution."));
    }
  }

  async function openContributionReceipt(contribution: Contribution) {
    const receipt = contribution.payment_receipts?.[0];
    if (!receipt) {
      onError("No receipt file is attached to this contribution.");
      return;
    }

    try {
      const url = await getSignedReceiptUrl(receipt.storage_path);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      onError(getErrorMessage(err, "Could not open receipt."));
    }
  }

  async function refreshReviewQueue() {
    if (refreshingReview) return;
    setRefreshingReview(true);
    try {
      await onRefreshContributions();
    } catch (err) {
      onError(getErrorMessage(err, "Could not refresh the review queue."));
    } finally {
      setRefreshingReview(false);
    }
  }

  function selectSection(section: AdminSection) {
    setActiveSection(section);
    setSidebarOpen(false);
    if (section === "review") void refreshReviewQueue();
  }

  function handleSignOut() {
    setSidebarOpen(false);
    void onSignOut();
  }

  const pendingExits = exitRequests.filter((request) => request.status === "requested").length;
  const activeNavItem = navItemsConfig(pending.length, members.length, pendingExits).find((item) => item.id === activeSection);
  const navItems = navItemsConfig(pending.length, members.length, pendingExits);

  return (
    <div className="admin-layout">
      <button
        className="admin-menu-button"
        type="button"
        onClick={() => setSidebarOpen(true)}
        aria-label="Open admin navigation"
      >
        <Menu size={20} />
        <span>{activeNavItem?.label ?? "Menu"}</span>
      </button>
      {sidebarOpen && <button className="admin-sidebar-backdrop" type="button" aria-label="Close admin navigation" onClick={() => setSidebarOpen(false)} />}
      <aside className={sidebarOpen ? "admin-sidebar open" : "admin-sidebar"} aria-label="Admin navigation">
        <div className="admin-sidebar-head">
          <span className="title-icon"><ShieldCheck size={20} /></span>
          <div>
            <h2>Admin</h2>
            <p>Operations dashboard</p>
          </div>
        </div>
        <nav className="admin-nav">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={activeSection === item.id ? "active" : ""}
              onClick={() => selectSection(item.id)}
            >
              <span>{item.icon}</span>
              <strong>{item.label}</strong>
              <small>{item.detail}</small>
            </button>
          ))}
          <button className="nav-logout" type="button" onClick={handleSignOut}>
            <span><LogOut size={17} /></span>
            <strong>Log out</strong>
            <small>End session</small>
          </button>
        </nav>
      </aside>

      <main className="admin-content">
        {activeSection === "overview" && (
          <AdminOverview
            project={project}
            contributions={contributions}
            projectCollections={projectCollections}
            members={members}
            projectMemberCount={projectMemberCount}
            exitSummary={exitSummary}
            loadingMembers={loadingMembers}
            onNavigate={selectSection}
            onOpenReceipt={openContributionReceipt}
          />
        )}

        {activeSection === "review" && (
          <PendingReviewPanel
            pending={pending}
            loading={refreshingReview}
            onRefresh={refreshReviewQueue}
            onReview={handleReview}
          />
        )}

        {activeSection === "submit" && project?.status === "active" && (
          <AdminPaymentForm
            project={project}
            members={members}
            onSubmitted={async () => {
              await onReviewed("Payment proof submitted and approved.");
              await loadMembers();
            }}
            onError={onError}
          />
        )}

        {activeSection === "submit" && project && project.status !== "active" && (
          <section className="panel"><EmptyState text="Activate this project before recording new member contributions." /></section>
        )}

        {activeSection === "status" && (
          <MemberPaymentStatusPanel project={project} onError={onError} />
        )}

        {activeSection === "reports" && <AdminReportPanel contributions={contributions} exitSummary={exitSummary} onOpenReceipt={openContributionReceipt} />}

        {activeSection === "members" && project && (
          <MemberManagementPanel
            project={project}
            projects={projects}
            contributions={contributions}
            currentUserId={currentUserId}
            members={members}
            loading={loadingMembers}
            onReload={loadMembers}
            onAssignmentsChanged={onReviewed}
            onError={onError}
          />
        )}

        {activeSection === "exits" && project && (
          <AdminExitPanel
            requests={exitRequests}
            contributions={contributions}
            onChanged={onExitChanged}
            onError={onError}
          />
        )}

        {activeSection === "project" && (
          <ProjectSetupPanel
            project={project}
            projects={projects}
            onSaved={onProjectSaved}
            onError={onError}
          />
        )}
      </main>
    </div>
  );
}

function navItemsConfig(pendingCount: number, memberCount: number, pendingExitCount: number): Array<{ id: AdminSection; label: string; icon: React.ReactNode; detail: string }> {
  return [
    { id: "overview", label: "Overview", icon: <LayoutDashboard size={17} />, detail: "Fund health" },
    { id: "review", label: "Review", icon: <ShieldCheck size={17} />, detail: `${pendingCount} pending` },
    { id: "submit", label: "Submit", icon: <Upload size={17} />, detail: "For member" },
    { id: "status", label: "Payment status", icon: <Users size={17} />, detail: "Dues ledger" },
    { id: "reports", label: "Reports", icon: <Filter size={17} />, detail: "Approved ledger" },
    { id: "members", label: "Members", icon: <Users size={17} />, detail: `${memberCount} users` },
    { id: "exits", label: "Member exits", icon: <LogOut size={17} />, detail: `${pendingExitCount} pending` },
    { id: "project", label: "Project", icon: <Settings size={17} />, detail: "Setup" },
  ];
}

function AdminOverview({ project, contributions, projectCollections, members, projectMemberCount, exitSummary, loadingMembers, onNavigate, onOpenReceipt }: {
  project: InvestmentProject | null;
  contributions: Contribution[];
  projectCollections: Contribution[];
  members: MemberRecord[];
  projectMemberCount: number;
  exitSummary: ProjectExitSummary;
  loadingMembers: boolean;
  onNavigate: (section: AdminSection) => void;
  onOpenReceipt: (contribution: Contribution) => Promise<void>;
}) {
  const memberContributions = contributions.filter((contribution) => !isContributionFromAdmin(contribution));
  const approved = memberContributions.filter((contribution) => contribution.status === "approved");
  const pending = memberContributions.filter((contribution) => contribution.status === "pending");
  const rejected = memberContributions.filter((contribution) => contribution.status === "rejected");
  const approvedTotal = projectCollections.reduce((sum, contribution) => sum + Number(contribution.bdt_amount), 0);
  const netFundBalance = Math.max(0, approvedTotal - exitSummary.refundsPaidBdt);
  const availableFundBalance = Math.max(0, netFundBalance - exitSummary.refundsReservedBdt);
  const pendingTotal = pending.reduce((sum, contribution) => sum + Number(contribution.bdt_amount), 0);
  const receiptBackedApproved = approved.filter((contribution) => (contribution.payment_receipts?.length ?? 0) > 0).length;
  const memberAccounts = members.filter(isMemberAccount);
  const activeMembers = memberAccounts.filter((member) => getEffectiveMembershipStatus(member) === "active").length;
  const pausedMembers = memberAccounts.filter((member) => getEffectiveMembershipStatus(member) === "paused").length;
  const needsSetupMembers = memberAccounts.filter((member) => !member.membership).length;
  const adminUsers = members.filter((member) => member.role === "admin").length;
  const effectiveActiveMembers = activeMembers || projectMemberCount;
  const baseTarget = Number(project?.target_amount_bdt ?? 0);
  const target = baseTarget;
  const monthlyContribution = Number(project?.monthly_contribution_bdt ?? DEFAULT_MONTHLY_MEMBER_CONTRIBUTION_BDT);
  const projectStartMonth = project?.contribution_start_month?.slice(0, 7) ?? DEFAULT_PROJECT_START_MONTH;
  const approvedByMember = new Map<string, number>();

  approved.forEach((contribution) => {
    approvedByMember.set(
      contribution.member_id,
      (approvedByMember.get(contribution.member_id) ?? 0) + Number(contribution.bdt_amount),
    );
  });

  const currentMemberCoverage = memberAccounts
    .filter((member) => getEffectiveMembershipStatus(member) === "active")
    .map((member) => getMonthlyPaymentCoverage(approvedByMember.get(member.id) ?? 0, currentMonthKey(), monthlyContribution, projectStartMonth));
  const overdueMembers = currentMemberCoverage.filter((coverage) => !coverage.paid).length;
  const advancePaidMembers = currentMemberCoverage.filter((coverage) => coverage.advanceMonths > 0).length;
  const recentApproved = approved
    .slice()
    .sort((a, b) => b.payment_date.localeCompare(a.payment_date))
    .slice(0, 5);

  return (
    <div className="dashboard-stack">
      <div className="overview-kpi-grid">
        <MetricCard icon={<Banknote />} label="Available fund balance" value={formatBdt(availableFundBalance)} />
        <MetricCard icon={<LogOut />} label="Reserved member refunds" value={formatBdt(exitSummary.refundsReservedBdt)} />
        <MetricCard icon={<Clock3 />} label="Pending review" value={`${pending.length} / ${formatBdt(pendingTotal)}`} />
        <MetricCard icon={<Users />} label="Active members" value={loadingMembers ? "Loading" : String(activeMembers)} />
      </div>
      <div className="finance-dashboard-grid admin-overview-grid">
      <section className="panel finance-balance-card">
        <div className="finance-card-head">
          <div>
            <p className="eyebrow">Available fund balance</p>
            <h2>{formatBdt(availableFundBalance)}</h2>
            <span>{project?.name ?? "No active project"}</span>
          </div>
          <span className="title-icon"><ShieldCheck size={20} /></span>
        </div>
        <CollectionChart contributions={projectCollections} />
        <div className="mini-card-row">
          <MiniStat label="Gross collected" value={formatBdt(approvedTotal)} />
          <MiniStat label="Refunds paid" value={formatBdt(exitSummary.refundsPaidBdt)} />
          <MiniStat label="Reserved refunds" value={formatBdt(exitSummary.refundsReservedBdt)} />
          <MiniStat label="Monthly pace" value={formatBdt(effectiveActiveMembers * monthlyContribution)} />
        </div>
      </section>

      <section className="panel finance-transactions-card">
        <div className="panel-title split-title">
          <div>
            <span className="title-icon"><ReceiptText size={20} /></span>
            <h2>Recent approved contributions</h2>
          </div>
          <button className="secondary-button" type="button" onClick={() => onNavigate("reports")}>View all</button>
        </div>
        {recentApproved.length === 0 ? (
          <EmptyState text="No approved member contributions yet." />
        ) : (
          <div className="table-wrap recent-contributions-table">
            <table className="fit-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Member</th>
                  <th>BDT</th>
                  <th>Receipt</th>
                </tr>
              </thead>
              <tbody>
                {recentApproved.map((contribution) => (
                  <tr key={contribution.id}>
                    <td data-label="Date">{formatDate(contribution.payment_date)}</td>
                    <td data-label="Member">{getContributionMemberName(contribution)}</td>
                    <td data-label="BDT">{formatBdt(Number(contribution.bdt_amount))}</td>
                    <td data-label="Receipt"><ReceiptLink contribution={contribution} onOpenReceipt={onOpenReceipt} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel finance-progress-card">
        <TargetProgressCard
          collected={availableFundBalance}
          target={target}
          monthlyPaceBdt={effectiveActiveMembers * monthlyContribution}
        />
      </section>

      <section className="panel finance-score-card">
        <div className="panel-title split-title">
          <div>
            <span className="title-icon"><Users size={20} /></span>
            <h2>Membership health</h2>
          </div>
          <button className="secondary-button" type="button" onClick={() => onNavigate("status")}>Status</button>
        </div>
        <ProgressGauge value={memberAccounts.length ? (activeMembers / memberAccounts.length) * 100 : 0} label={`${activeMembers} active`} />
        <div className="insight-list compact-insights">
          <InsightRow label="Overdue members" value={loadingMembers ? "Loading" : String(overdueMembers)} />
          <InsightRow label="Advance paid" value={loadingMembers ? "Loading" : String(advancePaidMembers)} />
          <InsightRow label="Paused" value={loadingMembers ? "Loading" : String(pausedMembers)} />
          <InsightRow label="Needs setup" value={loadingMembers ? "Loading" : String(needsSetupMembers)} />
        </div>
      </section>

      <section className="panel finance-quality-card">
        <div className="panel-title">
          <div>
            <span className="title-icon"><TrendingUp size={20} /></span>
            <h2>Project overview</h2>
          </div>
        </div>
        <div className="project-overview-stats">
          <MiniStat label="Project target" value={formatBdt(baseTarget)} />
          {target !== baseTarget && <MiniStat label="Scaled target" value={formatBdt(target)} />}
          <MiniStat label="Receipt coverage" value={approved.length ? `${Math.round((receiptBackedApproved / approved.length) * 100)}%` : "No records"} />
          <MiniStat label="Rejected records" value={String(rejected.length)} />
          <MiniStat label="Admin accounts" value={loadingMembers ? "Loading" : String(adminUsers)} />
        </div>
      </section>
      </div>
    </div>
  );
}

function PendingReviewPanel({ pending, loading, onRefresh, onReview }: {
  pending: Contribution[];
  loading: boolean;
  onRefresh: () => Promise<void>;
  onReview: (contribution: Contribution, status: "approved" | "rejected") => Promise<void>;
}) {
  return (
    <section className="panel">
      <div className="panel-title split-title">
        <div>
          <span className="title-icon"><ShieldCheck size={20} /></span>
          <h2>Pending review</h2>
        </div>
        <div className="review-header-actions">
          <span className="count-badge">{pending.length} payments</span>
          <button className="secondary-button review-refresh-button" type="button" onClick={() => void onRefresh()} disabled={loading}>
            <span className={loading ? "refresh-dot spinning" : "refresh-dot"} aria-hidden="true" />
            {loading ? "Refreshing" : "Refresh"}
          </button>
        </div>
      </div>
      {loading && <SectionRefreshLoader />}
      {!loading && pending.length === 0 ? (
        <EmptyState text="No pending payments need review." />
      ) : pending.length > 0 ? (
        <div className="review-list">
          {pending.map((contribution) => (
            <ReviewItem
              key={contribution.id}
              contribution={contribution}
              onApprove={() => void onReview(contribution, "approved")}
              onReject={() => void onReview(contribution, "rejected")}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function InsightRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="insight-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

type CollectionMonthItem = {
  key: string;
  label: string;
  total: number;
  height: number;
};

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="mini-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function CollectionChart({ contributions }: { contributions: Contribution[] }) {
  const [monthOffset, setMonthOffset] = useState(0);
  const months = useMemo(() => getCollectionWindow(contributions, monthOffset), [contributions, monthOffset]);
  const periodLabel = `${months[0]?.label ?? ""} - ${months[months.length - 1]?.label ?? ""}`;

  return (
    <div className="collection-chart">
      <div className="collection-chart-head">
        <div>
          <span>Monthly collection</span>
          <strong>{periodLabel}</strong>
        </div>
        <div className="chart-arrow-group">
          <button className="chart-arrow" type="button" onClick={() => setMonthOffset((current) => current - 6)} aria-label="Show previous 6 months">
            <ChevronLeft size={16} />
          </button>
          <button
            className="chart-arrow"
            type="button"
            onClick={() => setMonthOffset((current) => Math.min(0, current + 6))}
            disabled={monthOffset === 0}
            aria-label="Show next 6 months"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      <div className="monthly-bars" aria-label="Monthly collected money">
        {months.map((item) => (
          <div className="monthly-bar-item" key={item.key}>
            <div className="monthly-bar-track">
              <span className="monthly-bar-approved" style={{ height: `${item.height}%` }} />
            </div>
            <small>{item.label}</small>
            <b>{formatBdt(item.total)}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

function ContributionFeed({ contributions }: { contributions: Contribution[] }) {
  if (contributions.length === 0) return <EmptyState text="No contribution records yet." />;

  return (
    <div className="contribution-feed">
      {contributions.map((contribution) => {
        const hasMemberName = Boolean(contribution.member || contribution.profiles);
        const title = hasMemberName ? getContributionMemberName(contribution) : `${contribution.status[0].toUpperCase()}${contribution.status.slice(1)} payment`;
        return (
          <article className="contribution-feed-item" key={contribution.id}>
            <span className={`feed-icon ${contribution.status}`}>
              {contribution.status === "approved" ? <CheckCircle2 size={18} /> : contribution.status === "rejected" ? <XCircle size={18} /> : <Clock3 size={18} />}
            </span>
            <div>
              <strong>{title}</strong>
              <small>{formatDate(contribution.payment_date)} / {contribution.payment_method || contribution.sent_from_country || "Contribution"}</small>
            </div>
            <b>{formatBdt(Number(contribution.bdt_amount))}</b>
          </article>
        );
      })}
    </div>
  );
}

function ProgressGauge({ value, label }: { value: number; label: string }) {
  const progress = Math.max(0, Math.min(100, value));
  return (
    <div className="progress-gauge-wrap">
      <div
        className="progress-gauge"
        style={{
          background: `conic-gradient(#65c3a1 0 ${progress}%, #efc253 ${progress}% ${Math.min(100, progress + 18)}%, #f06464 ${Math.min(100, progress + 18)}% 100%)`,
        }}
      >
        <div>
          <strong>{Math.round(progress)}%</strong>
          <span>{label}</span>
        </div>
      </div>
    </div>
  );
}

function addMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function startOfCurrentMonth() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function monthKeyFromDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getCollectionWindow(contributions: Contribution[], offsetMonths: number): CollectionMonthItem[] {
  const totalsByMonth = new Map<string, number>();

  contributions.forEach((contribution) => {
    const key = monthKey(contribution.payment_date);
    const current = totalsByMonth.get(key) ?? 0;
    const amount = Number(contribution.bdt_amount);
    if (contribution.status === "approved") totalsByMonth.set(key, current + amount);
  });

  const endMonth = addMonths(startOfCurrentMonth(), offsetMonths);
  const monthDates = Array.from({ length: 6 }, (_unused, index) => addMonths(endMonth, index - 5));
  const maxTotal = Math.max(...monthDates.map((date) => totalsByMonth.get(monthKeyFromDate(date)) ?? 0), 1);

  return monthDates.map((date) => {
    const key = monthKeyFromDate(date);
    const total = totalsByMonth.get(key) ?? 0;
    return {
      key,
      label: new Intl.DateTimeFormat("en", { month: "short", year: "2-digit" }).format(date),
      total,
      height: total > 0 ? Math.max(8, (total / maxTotal) * 100) : 0,
    };
  });
}

function monthKey(value: string) {
  return value.slice(0, 7);
}

function monthLabel(value: string) {
  const [year, month] = value.split("-").map(Number);
  if (!year || !month) return value;
  return new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1));
}

function getContributionMemberName(contribution: Contribution) {
  const name = contribution.member?.full_name || contribution.profiles?.full_name;
  if (name) return formatDisplayName(name);
  return contribution.member?.email || contribution.profiles?.email || "Member";
}

function formatDisplayName(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed !== trimmed.toLocaleUpperCase()) return trimmed;

  return trimmed
    .toLocaleLowerCase()
    .replace(/(^|[\s'-])\p{L}/gu, (letter) => letter.toLocaleUpperCase());
}

function isContributionFromAdmin(contribution: Contribution) {
  return contribution.member?.role === "admin" || contribution.profiles?.role === "admin";
}

function isMemberAccount(member: MemberRecord) {
  return member.role !== "admin";
}

function getEffectiveMembershipStatus(member: MemberRecord): MembershipStatus {
  if (member.role === "admin") return "left";
  return member.membership?.status ?? "left";
}

function escapeCsvCell(value: string | number | null | undefined) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadCsv(filename: string, rows: Array<Array<string | number | null | undefined>>) {
  const csv = rows.map((row) => row.map(escapeCsvCell).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function AdminReportPanel({ contributions, exitSummary, onOpenReceipt }: {
  contributions: Contribution[];
  exitSummary: ProjectExitSummary;
  onOpenReceipt: (contribution: Contribution) => Promise<void>;
}) {
  const [selectedMonth, setSelectedMonth] = useState("all");
  const [selectedMember, setSelectedMember] = useState("all");

  const approvedContributions = useMemo(
    () => contributions.filter((contribution) => contribution.status === "approved" && !isContributionFromAdmin(contribution)),
    [contributions],
  );

  const monthOptions = useMemo(() => {
    return Array.from(new Set(approvedContributions.map((contribution) => monthKey(contribution.payment_date))))
      .sort((a, b) => b.localeCompare(a));
  }, [approvedContributions]);

  const memberOptions = useMemo<MemberFilterOption[]>(() => {
    const members = new Map<string, MemberFilterOption>();
    approvedContributions.forEach((contribution) => {
      if (!members.has(contribution.member_id)) {
        members.set(contribution.member_id, {
          id: contribution.member_id,
          name: getContributionMemberName(contribution),
          email: contribution.member?.email ?? contribution.profiles?.email ?? null,
        });
      }
    });
    return Array.from(members.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [approvedContributions]);

  const filteredContributions = useMemo(() => {
    return approvedContributions.filter((contribution) => {
      const matchesMonth = selectedMonth === "all" || monthKey(contribution.payment_date) === selectedMonth;
      const matchesMember = selectedMember === "all" || contribution.member_id === selectedMember;
      return matchesMonth && matchesMember;
    });
  }, [approvedContributions, selectedMember, selectedMonth]);

  const reportTotal = filteredContributions.reduce((sum, contribution) => sum + Number(contribution.bdt_amount), 0);
  const projectApprovedTotal = approvedContributions.reduce((sum, contribution) => sum + Number(contribution.bdt_amount), 0);
  const availableProjectFund = Math.max(0, projectApprovedTotal - exitSummary.refundsPaidBdt - exitSummary.refundsReservedBdt);
  const receiptBackedCount = filteredContributions.filter((contribution) => (contribution.payment_receipts?.length ?? 0) > 0).length;
  const selectedMemberName = selectedMember === "all"
    ? "All members"
    : memberOptions.find((member) => member.id === selectedMember)?.name ?? "Selected member";

  function exportReport() {
    const rows: Array<Array<string | number | null | undefined>> = [
      ["Home Investment approved contribution ledger"],
      ["Month", selectedMonth === "all" ? "All months" : monthLabel(selectedMonth)],
      ["Member", selectedMemberName],
      ["Approved BDT total", reportTotal.toFixed(2)],
      ["Project refunds paid", exitSummary.refundsPaidBdt.toFixed(2)],
      ["Project refunds reserved", exitSummary.refundsReservedBdt.toFixed(2)],
      ["Available project fund", availableProjectFund.toFixed(2)],
      ["Receipt-backed entries", `${receiptBackedCount} of ${filteredContributions.length}`],
      [],
      [
        "Payment date",
        "Member",
        "Email",
        "BDT amount",
        "Source currency",
        "Source amount",
        "Exchange rate",
        "Sent from",
        "Payment method",
        "Receipt file",
        "Receipt storage path",
        "Reviewed at",
        "Notes",
      ],
      ...filteredContributions.map((contribution) => {
        const receipt = contribution.payment_receipts?.[0];
        return [
          contribution.payment_date,
          getContributionMemberName(contribution),
          contribution.member?.email ?? contribution.profiles?.email ?? "",
          Number(contribution.bdt_amount).toFixed(2),
          contribution.source_currency,
          contribution.source_amount ?? "",
          contribution.exchange_rate ?? "",
          contribution.sent_from_country,
          contribution.payment_method,
          receipt?.file_name ?? "",
          receipt?.storage_path ?? "",
          contribution.reviewed_at ? new Date(contribution.reviewed_at).toISOString() : "",
          contribution.notes,
        ];
      }),
    ];

    const filenameMonth = selectedMonth === "all" ? "all-months" : selectedMonth;
    const filenameMember = selectedMember === "all" ? "all-members" : selectedMemberName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    downloadCsv(`approved-contributions-${filenameMonth}-${filenameMember}.csv`, rows);
  }

  return (
    <section className="panel wide">
      <div className="panel-title split-title">
        <div>
          <span className="title-icon"><Filter size={20} /></span>
          <h2>Approved ledger report</h2>
        </div>
        <button className="secondary-button" type="button" onClick={exportReport} disabled={filteredContributions.length === 0}>
          <Download size={16} /> Export CSV
        </button>
      </div>
      <div className="report-toolbar">
        <label>
          Month
          <select value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)}>
            <option value="all">All months</option>
            {monthOptions.map((month) => (
              <option key={month} value={month}>{monthLabel(month)}</option>
            ))}
          </select>
        </label>
        <label>
          Member
          <select value={selectedMember} onChange={(event) => setSelectedMember(event.target.value)}>
            <option value="all">All members</option>
            {memberOptions.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}{member.email ? ` (${member.email})` : ""}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="report-summary">
        <MetricCard icon={<Banknote />} label="Approved BDT in report" value={formatBdt(reportTotal)} />
        <MetricCard icon={<LogOut />} label="Refunds paid" value={formatBdt(exitSummary.refundsPaidBdt)} />
        <MetricCard icon={<Clock3 />} label="Reserved refunds" value={formatBdt(exitSummary.refundsReservedBdt)} />
        <MetricCard icon={<TrendingUp />} label="Available project fund" value={formatBdt(availableProjectFund)} />
      </div>
      {filteredContributions.length > 0 && (
        <section className="ledger-recent-activity">
          <div className="subsection-heading"><div><h3>Recent transaction activity</h3><p>Latest approved records matching the selected filters.</p></div><span>{Math.min(4, filteredContributions.length)} shown</span></div>
          <ContributionFeed contributions={filteredContributions.slice(0, 4)} />
        </section>
      )}
      {filteredContributions.length === 0 ? (
        <EmptyState text="No approved contributions match these filters." />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Payment date</th>
                <th>Member</th>
                <th>BDT</th>
                <th>Method</th>
                <th>Receipt</th>
                <th>Reviewed</th>
              </tr>
            </thead>
            <tbody>
              {filteredContributions.map((contribution) => (
                <tr key={contribution.id}>
                  <td data-label="Payment date">{formatDate(contribution.payment_date)}</td>
                  <td data-label="Member">{getContributionMemberName(contribution)}</td>
                  <td data-label="BDT">{formatBdt(Number(contribution.bdt_amount))}</td>
                  <td data-label="Method">{contribution.payment_method || contribution.sent_from_country || "Not set"}</td>
                  <td data-label="Receipt"><ReceiptLink contribution={contribution} onOpenReceipt={onOpenReceipt} /></td>
                  <td data-label="Reviewed">{formatDate(contribution.reviewed_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function exitStatusLabel(status: MemberExitRequest["status"]) {
  if (status === "requested") return "Awaiting review";
  if (status === "settlement_approved") return "Settlement approved";
  if (status === "refund_pending") return "Partially refunded";
  if (status === "completed") return "Exit completed";
  if (status === "rejected") return "Request rejected";
  return "Request cancelled";
}

function ExitStatusPill({ status }: { status: MemberExitRequest["status"] }) {
  const tone = status === "completed" ? "approved" : status === "rejected" || status === "cancelled" ? "rejected" : "pending";
  const Icon = status === "completed" ? CheckCircle2 : status === "rejected" || status === "cancelled" ? XCircle : Clock3;
  return <span className={`status-pill ${tone}`}><Icon size={14} /> {exitStatusLabel(status)}</span>;
}

function MemberExitPanel({ project, requests, contributions, onChanged, onError }: {
  project: InvestmentProject | null;
  requests: MemberExitRequest[];
  contributions: Contribution[];
  onChanged: (message: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [preferredExitDate, setPreferredExitDate] = useState(dateAfterDays(30));
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const openRequest = requests.find((request) => ["requested", "settlement_approved", "refund_pending", "completed"].includes(request.status));
  const approvedContributionBdt = contributions
    .filter((contribution) => contribution.status === "approved")
    .reduce((sum, contribution) => sum + Number(contribution.bdt_amount), 0);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!project) return;
    setBusy(true);
    try {
      await requestMemberExit({
        projectId: project.id,
        preferredExitDate,
        reason,
        memberNotes: notes,
      });
      setReason("");
      setNotes("");
      await onChanged("Your exit request was submitted for admin review.");
    } catch (err) {
      onError(getErrorMessage(err, "Could not submit the exit request."));
    } finally {
      setBusy(false);
    }
  }

  async function cancelRequest(requestId: string) {
    if (!window.confirm("Cancel this pending exit request?")) return;
    setBusy(true);
    try {
      await cancelMemberExit(requestId);
      await onChanged("Exit request cancelled.");
    } catch (err) {
      onError(getErrorMessage(err, "Could not cancel the exit request."));
    } finally {
      setBusy(false);
    }
  }

  async function openRefundProof(path: string) {
    try {
      const url = await getSignedReceiptUrl(path);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      onError(getErrorMessage(err, "Could not open the refund proof."));
    }
  }

  if (!project) return <EmptyState text="No active project is available." />;

  return (
    <div className="exit-page-stack">
      <section className="panel exit-policy-card">
        <div className="panel-title split-title">
          <div>
            <span className="title-icon"><LogOut size={20} /></span>
            <div><h2>Leave project</h2><p>Request a formal settlement and refund without deleting your contribution history.</p></div>
          </div>
          <span className="count-badge"><ShieldCheck size={14} /> 30-day notice</span>
        </div>
        <div className="exit-policy-grid">
          <MiniStat label="1. Request" value="Submit notice" />
          <MiniStat label="2. Settlement" value="Admin calculates" />
          <MiniStat label="3. Refund" value="Payment recorded" />
          <MiniStat label="4. Completion" value="Membership closed" />
        </div>
      </section>

      {openRequest ? (
        <section className="panel exit-current-card">
          <div className="review-item-head">
            <div>
              <p className="eyebrow">Current exit request</p>
              <h2>{formatDate(openRequest.created_at)}</h2>
            </div>
            <ExitStatusPill status={openRequest.status} />
          </div>
          <p className="exit-reason">{openRequest.reason}</p>
          <div className="exit-financial-grid">
            <MiniStat label="Approved contributions" value={formatBdt(openRequest.status === "requested" ? approvedContributionBdt : Number(openRequest.approved_contributions_bdt))} />
            <MiniStat label="Settlement" value={formatBdt(Number(openRequest.settlement_amount_bdt))} />
            <MiniStat label="Refunded" value={formatBdt(getExitRequestPaidBdt(openRequest))} />
            <MiniStat label="Remaining" value={formatBdt(Math.max(0, Number(openRequest.settlement_amount_bdt) - getExitRequestPaidBdt(openRequest)))} />
          </div>
          {openRequest.status === "requested" && (
            <div className="review-decision-bar">
              <p><Clock3 size={15} /> Contributions continue until an admin approves the settlement.</p>
              <button className="secondary-button" type="button" disabled={busy} onClick={() => void cancelRequest(openRequest.id)}>Cancel request</button>
            </div>
          )}
          {(openRequest.member_refunds?.length ?? 0) > 0 && (
            <div className="refund-history-list">
              {(openRequest.member_refunds ?? []).map((refund) => (
                <div className="refund-history-row" key={refund.id}>
                  <div><strong>{formatBdt(Number(refund.amount_bdt))}</strong><small>{formatDate(refund.payment_date)} · {refund.payment_method}</small></div>
                  <button className="receipt-link" type="button" onClick={() => void openRefundProof(refund.storage_path)}><Eye size={15} /> Proof</button>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : (
        <form className="panel exit-request-form" onSubmit={(event) => void submit(event)}>
          <div className="panel-title">
            <span className="title-icon"><FileText size={20} /></span>
            <div><h2>Request an exit</h2><p>Your approved contributions will be used as the starting point for the settlement.</p></div>
          </div>
          <div className="form-grid">
            <label>
              Preferred exit date
              <input type="date" min={localDateKey()} value={preferredExitDate} onChange={(event) => setPreferredExitDate(event.target.value)} required />
            </label>
            <label className="wide">
              Reason for leaving
              <textarea rows={4} minLength={10} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explain why you want to leave the project." required />
            </label>
            <label className="wide">
              Additional notes
              <textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Payment preference or other relevant information." />
            </label>
          </div>
          <div className="review-decision-bar">
            <p><AlertCircle size={15} /> Submitting does not immediately end membership or guarantee a specific refund value.</p>
            <button className="primary-button exit-submit-button" type="submit" disabled={busy}>{busy ? "Submitting" : "Submit exit request"}</button>
          </div>
        </form>
      )}

      {requests.filter((request) => request !== openRequest).length > 0 && (
        <section className="panel">
          <div className="panel-title"><span className="title-icon"><ReceiptText size={20} /></span><h2>Previous exit requests</h2></div>
          <div className="exit-request-list">
            {requests.filter((request) => request !== openRequest).map((request) => (
              <div className="exit-history-row" key={request.id}>
                <div><strong>{formatDate(request.created_at)}</strong><small>{request.reason}</small></div>
                <div><ExitStatusPill status={request.status} /><strong>{formatBdt(Number(request.settlement_amount_bdt))}</strong></div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function AdminExitPanel({ requests, contributions, onChanged, onError }: {
  requests: MemberExitRequest[];
  contributions: Contribution[];
  onChanged: (message: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const requestedCount = requests.filter((request) => request.status === "requested").length;
  const reserved = requests
    .filter((request) => ["settlement_approved", "refund_pending"].includes(request.status))
    .reduce((sum, request) => sum + Math.max(0, Number(request.settlement_amount_bdt) - getExitRequestPaidBdt(request)), 0);
  const refunded = requests.reduce((sum, request) => sum + getExitRequestPaidBdt(request), 0);
  const completed = requests.filter((request) => request.status === "completed").length;

  return (
    <div className="exit-page-stack">
      <div className="overview-kpi-grid">
        <MetricCard icon={<Clock3 />} label="Awaiting review" value={String(requestedCount)} />
        <MetricCard icon={<ShieldCheck />} label="Reserved settlements" value={formatBdt(reserved)} />
        <MetricCard icon={<Banknote />} label="Refunds paid" value={formatBdt(refunded)} />
        <MetricCard icon={<CheckCircle2 />} label="Completed exits" value={String(completed)} />
      </div>
      <section className="panel">
        <div className="panel-title split-title">
          <div><span className="title-icon"><LogOut size={20} /></span><div><h2>Member exit settlements</h2><p>Review requests, approve a fixed settlement, and record refund payments.</p></div></div>
          <span className="count-badge">{requests.length} records</span>
        </div>
        {requests.length === 0 ? (
          <EmptyState text="No member exit requests have been submitted." />
        ) : (
          <div className="exit-admin-list">
            {requests.map((request) => (
              <AdminExitRequestCard
                key={request.id}
                request={request}
                approvedContributionBdt={contributions
                  .filter((contribution) => contribution.member_id === request.member_id && contribution.status === "approved")
                  .reduce((sum, contribution) => sum + Number(contribution.bdt_amount), 0)}
                onChanged={onChanged}
                onError={onError}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function AdminExitRequestCard({ request, approvedContributionBdt, onChanged, onError }: {
  request: MemberExitRequest;
  approvedContributionBdt: number;
  onChanged: (message: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [effectiveExitDate, setEffectiveExitDate] = useState(request.preferred_exit_date && request.preferred_exit_date >= localDateKey() ? request.preferred_exit_date : localDateKey());
  const [refundDueDate, setRefundDueDate] = useState(dateAfterDays(30));
  const [profit, setProfit] = useState("0");
  const [loss, setLoss] = useState("0");
  const [deductions, setDeductions] = useState("0");
  const [exitFee, setExitFee] = useState("0");
  const [adminNotes, setAdminNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const settlementPreview = Math.max(0, approvedContributionBdt + Number(profit || 0) - Number(loss || 0) - Number(deductions || 0) - Number(exitFee || 0));
  const memberName = request.member?.full_name || request.member?.email || "Member";

  async function review(decision: "approve" | "reject") {
    if (decision === "reject" && !adminNotes.trim()) {
      onError("Add an admin note explaining why the exit request is rejected.");
      return;
    }
    setBusy(true);
    try {
      const settlement = await reviewMemberExit({
        exitRequestId: request.id,
        decision,
        effectiveExitDate,
        refundDueDate,
        allocatedProfitBdt: Number(profit || 0),
        allocatedLossBdt: Number(loss || 0),
        deductionsBdt: Number(deductions || 0),
        exitFeeBdt: Number(exitFee || 0),
        adminNotes,
      });
      await onChanged(decision === "approve" ? `Exit settlement approved for ${formatBdt(settlement)}.` : "Exit request rejected.");
    } catch (err) {
      onError(getErrorMessage(err, "Could not review the exit request."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="review-item exit-admin-card">
      <div className="review-item-head">
        <div className="review-member-identity">
          <span><UserRound size={20} /></span>
          <div><h3>{memberName}</h3><p>{request.member?.email ?? "Member account"} · Requested {formatDate(request.created_at)}</p></div>
        </div>
        <div className="exit-admin-status"><ExitStatusPill status={request.status} /><strong>{formatBdt(Number(request.settlement_amount_bdt))}</strong></div>
      </div>
      <div className="review-note"><span>Member reason</span><p>{request.reason}</p></div>

      {request.status === "requested" && (
        <div className="exit-settlement-workspace">
          <div className="exit-settlement-grid">
            <MiniStat label="Approved contributions" value={formatBdt(approvedContributionBdt)} />
            <label>Allocated profit<input type="number" min="0" step="0.01" value={profit} onChange={(event) => setProfit(event.target.value)} /></label>
            <label>Allocated loss<input type="number" min="0" step="0.01" value={loss} onChange={(event) => setLoss(event.target.value)} /></label>
            <label>Other deductions<input type="number" min="0" step="0.01" value={deductions} onChange={(event) => setDeductions(event.target.value)} /></label>
            <label>Exit fee<input type="number" min="0" step="0.01" value={exitFee} onChange={(event) => setExitFee(event.target.value)} /></label>
            <label>Effective exit date<input type="date" min={localDateKey()} value={effectiveExitDate} onChange={(event) => setEffectiveExitDate(event.target.value)} /></label>
            <label>Refund due date<input type="date" min={effectiveExitDate} value={refundDueDate} onChange={(event) => setRefundDueDate(event.target.value)} /></label>
            <label className="wide">Admin settlement notes<textarea rows={3} value={adminNotes} onChange={(event) => setAdminNotes(event.target.value)} placeholder="Document valuation, deductions, or rejection reason." /></label>
          </div>
          <aside className="exit-preview-card"><span>Settlement preview</span><strong>{formatBdt(settlementPreview)}</strong><small>Pending contributions must be resolved before approval.</small></aside>
          <div className="review-decision-bar wide">
            <p><ShieldCheck size={15} /> Approval pauses future contributions and reserves this amount.</p>
            <div className="review-actions">
              <button className="reject-button" type="button" disabled={busy} onClick={() => void review("reject")}>Reject</button>
              <button className="approve-button" type="button" disabled={busy} onClick={() => void review("approve")}>Approve settlement</button>
            </div>
          </div>
        </div>
      )}

      {["settlement_approved", "refund_pending"].includes(request.status) && (
        <RefundPaymentForm request={request} onChanged={onChanged} onError={onError} />
      )}

      {(request.member_refunds?.length ?? 0) > 0 && (
        <RefundHistory request={request} onError={onError} />
      )}

      {request.admin_notes && <div className="review-note"><span>Admin notes</span><p>{request.admin_notes}</p></div>}
    </article>
  );
}

function RefundPaymentForm({ request, onChanged, onError }: {
  request: MemberExitRequest;
  onChanged: (message: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const remaining = Math.max(0, Number(request.settlement_amount_bdt) - getExitRequestPaidBdt(request));
  const [amount, setAmount] = useState(String(remaining));
  const [paymentDate, setPaymentDate] = useState(localDateKey());
  const [method, setMethod] = useState("Bank transfer");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [proof, setProof] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!proof) {
      onError("Attach the bank transfer or refund payment proof.");
      return;
    }
    if (!allowedReceiptTypes.includes(proof.type) || proof.size > MAX_RECEIPT_BYTES) {
      onError("Refund proof must be a PDF, JPG, or PNG file no larger than 10 MB.");
      return;
    }
    setBusy(true);
    try {
      await recordMemberRefund({
        exitRequestId: request.id,
        memberId: request.member_id,
        amountBdt: Number(amount),
        paymentDate,
        paymentMethod: method,
        paymentReference: reference,
        notes,
        proof,
      });
      await onChanged(Number(amount) >= remaining ? "Refund completed and member marked left." : "Partial member refund recorded.");
    } catch (err) {
      onError(getErrorMessage(err, "Could not record the member refund."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="refund-payment-form" onSubmit={(event) => void submit(event)}>
      <div className="subsection-heading"><div><h3>Record refund payment</h3><p>{formatBdt(remaining)} remains payable</p></div><span>Due {formatDate(request.refund_due_date)}</span></div>
      <div className="form-grid three-column-form-grid">
        <label>BDT amount<input type="number" min="0.01" max={remaining} step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} required /></label>
        <label>Payment date<input type="date" max={localDateKey()} value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} required /></label>
        <label>Payment method<input value={method} onChange={(event) => setMethod(event.target.value)} required /></label>
        <label>Reference number<input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Bank transaction reference" /></label>
        <label className="wide">Notes<textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
        <label className="wide file-picker"><Upload size={18} /><span>{proof ? proof.name : "Attach refund payment proof"}</span><input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(event) => setProof(event.target.files?.[0] ?? null)} required /></label>
      </div>
      <div className="review-decision-bar"><p><AlertCircle size={15} /> The member becomes Left only after the full settlement is paid.</p><button className="primary-button refund-submit-button" type="submit" disabled={busy}>{busy ? "Recording" : "Record refund"}</button></div>
    </form>
  );
}

function RefundHistory({ request, onError }: { request: MemberExitRequest; onError: (message: string) => void }) {
  async function openProof(path: string) {
    try {
      const url = await getSignedReceiptUrl(path);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      onError(getErrorMessage(err, "Could not open the refund proof."));
    }
  }

  return (
    <div className="refund-history-list">
      {(request.member_refunds ?? []).map((refund) => (
        <div className="refund-history-row" key={refund.id}>
          <div><strong>{formatBdt(Number(refund.amount_bdt))}</strong><small>{formatDate(refund.payment_date)} · {refund.payment_method}{refund.payment_reference ? ` · ${refund.payment_reference}` : ""}</small></div>
          <button className="receipt-link" type="button" onClick={() => void openProof(refund.storage_path)}><Eye size={15} /> Proof</button>
        </div>
      ))}
    </div>
  );
}

function MemberManagementPanel({ project, projects, contributions, currentUserId, members, loading, onReload, onAssignmentsChanged, onError }: {
  project: InvestmentProject;
  projects: InvestmentProject[];
  contributions: Contribution[];
  currentUserId: string;
  members: MemberRecord[];
  loading: boolean;
  onReload: () => Promise<void>;
  onAssignmentsChanged: (message: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const approvedByMember = useMemo(() => {
    const totals = new Map<string, number>();
    contributions
      .filter((contribution) => contribution.status === "approved" && !isContributionFromAdmin(contribution))
      .forEach((contribution) => {
        totals.set(contribution.member_id, (totals.get(contribution.member_id) ?? 0) + Number(contribution.bdt_amount));
      });
    return totals;
  }, [contributions]);
  const pendingByMember = useMemo(() => {
    const totals = new Map<string, number>();
    contributions
      .filter((contribution) => contribution.status === "pending" && !isContributionFromAdmin(contribution))
      .forEach((contribution) => {
        totals.set(contribution.member_id, (totals.get(contribution.member_id) ?? 0) + Number(contribution.bdt_amount));
      });
    return totals;
  }, [contributions]);
  const memberTargetBdt = getPerMemberTarget(Number(project.target_amount_bdt ?? 0), project.planned_member_count);

  const filteredMembers = members.filter((member) => {
    const haystack = `${member.full_name} ${member.email ?? ""} ${member.phone ?? ""} ${member.resident_country ?? ""} ${member.membership?.member_code ?? ""}`.toLowerCase();
    return haystack.includes(search.toLowerCase().trim());
  });

  return (
    <section className="panel wide">
      <div className="panel-title split-title">
        <div>
          <span className="title-icon"><Users size={20} /></span>
          <h2>Member management</h2>
        </div>
        <span className="count-badge">{members.length} users</span>
      </div>
      <p className="helper-text">
        Member accounts can hold project membership details. Admin accounts are access-only and cannot be saved as project members.
      </p>
      <AdminCreateMemberForm
        projectId={project.id}
        onCreated={async () => {
          setMessage("Member account created.");
          await onReload();
        }}
        onError={onError}
      />
      <ProjectAssignmentManager
        projects={projects}
        members={members}
        onChanged={async (text) => {
          setMessage(text);
          await onAssignmentsChanged(text);
          await onReload();
        }}
        onError={onError}
      />
      <div className="member-toolbar">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search name, email, phone, country, or member code"
        />
      </div>
      {message && <InlineNotice tone="success" text={message} onClose={() => setMessage(null)} />}
      {loading ? (
        <StatusMessage title="Loading members" body="Reading account and membership records." />
      ) : filteredMembers.length === 0 ? (
        <EmptyState text="No members match this search." />
      ) : (
        <div className="member-list">
          {filteredMembers.map((member) => (
            <MemberEditor
              key={member.id}
              member={member}
              projectId={project.id}
              isCurrentUser={member.id === currentUserId}
              approvedTotalBdt={approvedByMember.get(member.id) ?? 0}
              pendingTotalBdt={pendingByMember.get(member.id) ?? 0}
              memberTargetBdt={memberTargetBdt}
              onSaved={async () => {
                setMessage("Member saved.");
                await onReload();
              }}
              onError={onError}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ProjectAssignmentManager({ projects, members, onChanged, onError }: {
  projects: InvestmentProject[];
  members: MemberRecord[];
  onChanged: (message: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const eligibleMembers = useMemo(() => members.filter(isMemberAccount), [members]);
  const [selectedMemberId, setSelectedMemberId] = useState(eligibleMembers[0]?.id ?? "");
  const [memberships, setMemberships] = useState<GroupMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyProjectId, setBusyProjectId] = useState<string | null>(null);
  const projectIdsKey = projects.map((item) => item.id).join(",");

  async function loadAssignments() {
    setLoading(true);
    try {
      setMemberships(await getAdminProjectMemberships());
    } catch (err) {
      onError(getErrorMessage(err, "Could not load project assignments."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadAssignments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectIdsKey]);

  useEffect(() => {
    if (eligibleMembers.some((member) => member.id === selectedMemberId)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedMemberId(eligibleMembers[0]?.id ?? "");
  }, [eligibleMembers, selectedMemberId]);

  const selectedMember = eligibleMembers.find((member) => member.id === selectedMemberId) ?? null;
  const membershipByProject = new Map(
    memberships
      .filter((membership) => membership.user_id === selectedMemberId)
      .map((membership) => [membership.project_id, membership]),
  );
  const assignedCount = Array.from(membershipByProject.values()).filter((membership) => membership.status !== "left").length;

  async function changeAssignment(project: InvestmentProject, assigned: boolean, status: "active" | "paused" = "active") {
    if (!selectedMember) return;
    if (!assigned && !window.confirm(`Remove ${selectedMember.full_name || selectedMember.email || "this member"} from ${project.name}?`)) return;
    setBusyProjectId(project.id);
    try {
      await setProjectMembershipAssignment({
        projectId: project.id,
        userId: selectedMember.id,
        assigned,
        status,
      });
      await loadAssignments();
      await onChanged(assigned ? `${selectedMember.full_name || "Member"} assigned to ${project.name}.` : `${selectedMember.full_name || "Member"} removed from ${project.name}.`);
    } catch (err) {
      onError(getErrorMessage(err, "Could not change the project assignment."));
    } finally {
      setBusyProjectId(null);
    }
  }

  return (
    <section className="project-assignment-manager">
      <div className="project-assignment-head">
        <div>
          <h3>Project assignments</h3>
          <p>Choose a member, then assign which investment projects they can access.</p>
        </div>
        <span className="count-badge">{assignedCount} assigned</span>
      </div>
      {eligibleMembers.length === 0 ? (
        <EmptyState text="Create a member account before assigning projects." />
      ) : (
        <>
          <label className="assignment-member-select">
            Member
            <select value={selectedMemberId} onChange={(event) => setSelectedMemberId(event.target.value)}>
              {eligibleMembers.map((member) => (
                <option key={member.id} value={member.id}>{member.full_name || member.email || "Unnamed member"}</option>
              ))}
            </select>
          </label>
          {loading ? (
            <StatusMessage title="Loading assignments" body="Reading member access across all projects." />
          ) : (
            <div className="assignment-project-list">
              {projects.map((item) => {
                const membership = membershipByProject.get(item.id);
                const busy = busyProjectId === item.id;
                const exited = membership?.status === "left";
                return (
                  <article className={`assignment-project-row ${membership && !exited ? "assigned" : ""}`} key={item.id}>
                    <div className="assignment-project-name">
                      <strong>{item.name}</strong>
                      <small>{item.status} project · {formatBdt(Number(item.target_amount_bdt))} target</small>
                    </div>
                    {exited ? (
                      <span className="status-pill rejected">Exited · retained</span>
                    ) : membership ? (
                      <div className="assignment-project-actions">
                        <select
                          aria-label={`${item.name} membership status`}
                          value={membership.status}
                          disabled={busy}
                          onChange={(event) => void changeAssignment(item, true, event.target.value as "active" | "paused")}
                        >
                          <option value="active">Active</option>
                          <option value="paused">Paused</option>
                        </select>
                        <button className="secondary-button" type="button" disabled={busy} onClick={() => void changeAssignment(item, false)}>
                          {busy ? "Saving" : "Remove"}
                        </button>
                      </div>
                    ) : (
                      <button className="primary-button assignment-add-button" type="button" disabled={busy} onClick={() => void changeAssignment(item, true)}>
                        {busy ? "Assigning" : "Assign"}
                      </button>
                    )}
                  </article>
                );
              })}
            </div>
          )}
          <p className="assignment-safety-note"><ShieldCheck size={15} /> Assignments with payment or exit history cannot be removed; pause them to preserve records and access history.</p>
        </>
      )}
    </section>
  );
}

function AdminCreateMemberForm({ projectId, onCreated, onError }: {
  projectId: string;
  onCreated: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [phoneCode, setPhoneCode] = useState("+880");
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState("");
  const [memberCode, setMemberCode] = useState("");
  const [joinedAt, setJoinedAt] = useState(localDateKey());
  const [status, setStatus] = useState<MembershipStatus>("active");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      await createAdminMember({
        projectId,
        fullName: fullName.trim(),
        email: email.trim(),
        password,
        phone: joinPhoneNumber(phoneCode, phone),
        residentCountry: country.trim() || null,
        memberCode: memberCode.trim() || null,
        joinedAt,
        status,
      });
      setFullName("");
      setEmail("");
      setPassword("");
      setPhoneCode("+880");
      setPhone("");
      setCountry("");
      setMemberCode("");
      setJoinedAt(localDateKey());
      setStatus("active");
      await onCreated();
      setOpen(false);
    } catch (err) {
      onError(getErrorMessage(err, "Could not create member."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-create-member">
      <div className="admin-create-member-head">
        <div>
          <h3>Add member</h3>
          <p>Create login access and add the person to this project.</p>
        </div>
        <button className="secondary-button" type="button" onClick={() => setOpen((current) => !current)}>
          {open ? "Close" : "Add member"}
        </button>
      </div>
      {open && (
        <form onSubmit={(event) => void submit(event)}>
          <div className="member-card-grid">
            <label>
              Full name
              <input value={fullName} onChange={(event) => setFullName(event.target.value)} required />
            </label>
            <label>
              Email
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
            </label>
            <label>
              Temporary password
              <span className="field-with-action">
                <input
                  type={showPassword ? "text" : "password"}
                  minLength={8}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
                <button
                  className="password-toggle"
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  title={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </span>
            </label>
            <label>
              Phone
              <div className="phone-input">
                <select value={phoneCode} onChange={(event) => setPhoneCode(event.target.value)} aria-label="Phone country code">
                  {phoneCountryCodes.map((item) => (
                    <option key={item.code} value={item.code}>
                      {item.code} {item.label}
                    </option>
                  ))}
                </select>
                <input inputMode="numeric" value={phone} onChange={(event) => setPhone(event.target.value)} />
              </div>
            </label>
            <label>
              Country
              <input value={country} onChange={(event) => setCountry(event.target.value)} />
            </label>
            <label>
              Member code
              <input value={memberCode} onChange={(event) => setMemberCode(event.target.value)} placeholder="M-001" />
            </label>
            <label>
              Joined date
              <input type="date" value={joinedAt} onChange={(event) => setJoinedAt(event.target.value)} />
            </label>
            <label>
              Status
              <select value={status} onChange={(event) => setStatus(event.target.value as MembershipStatus)}>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
              </select>
              <small>Use Member exits to process a departure and refund.</small>
            </label>
          </div>
          <button className="primary-button add-member-submit" type="submit" disabled={busy}>
            {busy ? "Creating" : "Create member"}
          </button>
        </form>
      )}
    </div>
  );
}

function MemberEditor({ member, projectId, isCurrentUser, approvedTotalBdt, pendingTotalBdt, memberTargetBdt, onSaved, onError }: {
  member: MemberRecord;
  projectId: string;
  isCurrentUser: boolean;
  approvedTotalBdt: number;
  pendingTotalBdt: number;
  memberTargetBdt: number;
  onSaved: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const parsedPhone = splitPhoneNumber(member.phone);
  const [fullName, setFullName] = useState(member.full_name);
  const [phoneCode, setPhoneCode] = useState(parsedPhone.code);
  const [phone, setPhone] = useState(parsedPhone.number);
  const [country, setCountry] = useState(member.resident_country ?? "");
  const [role, setRole] = useState<ProfileRole>(member.role);
  const [memberCode, setMemberCode] = useState(member.membership?.member_code ?? "");
  const [joinedAt, setJoinedAt] = useState(member.membership?.joined_at ?? localDateKey());
  const [status, setStatus] = useState<MembershipStatus>(getEffectiveMembershipStatus(member));
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const isAdminRole = role === "admin";
  const displayName = member.full_name || member.email || "Unnamed member";
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase())
    .join("") || "M";
  const contributionProgress = memberTargetBdt > 0 ? Math.min(100, (approvedTotalBdt / memberTargetBdt) * 100) : 0;

  useEffect(() => {
    const nextPhone = splitPhoneNumber(member.phone);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFullName(member.full_name);
    setPhoneCode(nextPhone.code);
    setPhone(nextPhone.number);
    setCountry(member.resident_country ?? "");
    setRole(member.role);
    setMemberCode(member.membership?.member_code ?? "");
    setJoinedAt(member.membership?.joined_at ?? localDateKey());
    setStatus(getEffectiveMembershipStatus(member));
  }, [member]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      await updateMemberRecord({
        projectId,
        userId: member.id,
        fullName,
        phone: joinPhoneNumber(phoneCode, phone),
        residentCountry: country || null,
        role,
        memberCode: isAdminRole ? null : memberCode.trim() || null,
        joinedAt,
        status: isAdminRole ? "left" : status,
      });
      await onSaved();
      setEditing(false);
    } catch (err) {
      onError(getErrorMessage(err, "Could not save member."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className={editing ? "member-card member-summary-card editing" : "member-card member-summary-card"}>
      <div className="member-summary-head">
        <div className="member-summary-identity">
          <span className="member-summary-avatar">{initials}</span>
          <div>
            <h3>{displayName}</h3>
            <p>{member.email ?? "No email"}{isCurrentUser ? " / current account" : ""}</p>
          </div>
        </div>
        <div className="member-summary-actions">
          <RolePill role={role} status={status} />
          <button className="secondary-button member-edit-toggle" type="button" onClick={() => setEditing((current) => !current)}>
            {editing ? "Close" : "Edit"}
          </button>
        </div>
      </div>

      <div className="member-summary-meta">
        <MiniStat label="Member code" value={member.membership?.member_code || "Not set"} />
        <MiniStat label="Joined" value={member.membership?.joined_at ? formatDate(member.membership.joined_at) : "Access only"} />
        <MiniStat label="Approved" value={isAdminRole ? "Access only" : formatBdt(approvedTotalBdt)} />
        <MiniStat label="Pending" value={isAdminRole ? "—" : formatBdt(pendingTotalBdt)} />
      </div>

      {!isAdminRole && (
        <div className="member-contribution-progress">
          <div>
            <span>Contribution progress</span>
            <strong>{Math.round(contributionProgress)}%</strong>
          </div>
          <span className="member-progress-track">
            <span style={{ width: `${contributionProgress}%` }} />
          </span>
          <small>{formatBdt(approvedTotalBdt)} of {formatBdt(memberTargetBdt)}</small>
        </div>
      )}

      {editing && <form className="member-edit-form" onSubmit={(event) => void save(event)}>
        <div className="member-edit-heading">
          <div><h4>Edit member</h4><p>Update account access and project membership information.</p></div>
        </div>
        <div className="member-card-grid">
        <label>
          Full name
          <input value={fullName} onChange={(event) => setFullName(event.target.value)} required />
        </label>
        <label>
          Phone
          <div className="phone-input">
            <select value={phoneCode} onChange={(event) => setPhoneCode(event.target.value)} aria-label="Phone country code">
              {phoneCountryCodes.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.code} {item.label}
                </option>
              ))}
            </select>
            <input inputMode="numeric" value={phone} onChange={(event) => setPhone(event.target.value)} />
          </div>
        </label>
        <label>
          Country
          <input value={country} onChange={(event) => setCountry(event.target.value)} />
        </label>
        <label>
          Role
          <select value={role} onChange={(event) => setRole(event.target.value as ProfileRole)} disabled={isCurrentUser}>
            <option value="member">Member</option>
            <option value="viewer">Viewer</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        {isAdminRole ? (
          <p className="admin-member-note">Admin access only. Saving removes this account from project membership.</p>
        ) : (
          <>
            <label>
              Member code
              <input value={memberCode} onChange={(event) => setMemberCode(event.target.value)} placeholder="M-001" />
            </label>
            <label>
              Joined date
              <input type="date" value={joinedAt} onChange={(event) => setJoinedAt(event.target.value)} />
            </label>
            <label>
              Status
              <select value={status} onChange={(event) => setStatus(event.target.value as MembershipStatus)} disabled={status === "left"}>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                {status === "left" && <option value="left">Left — settlement completed</option>}
              </select>
              {status !== "left" && <small>Use Member exits to mark a member left after their refund is completed.</small>}
            </label>
          </>
        )}
        </div>
        <div className="member-edit-actions">
          <button className="secondary-button" type="button" onClick={() => setEditing(false)}>Cancel</button>
          <button className="primary-button" type="submit" disabled={busy}>{busy ? "Saving" : "Save changes"}</button>
        </div>
      </form>}
    </article>
  );
}

function ProjectSetupPanel({ project, projects, onSaved, onError }: {
  project: InvestmentProject | null;
  projects: InvestmentProject[];
  onSaved: (projectId: string, message?: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [creating, setCreating] = useState(!project);
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [targetAmount, setTargetAmount] = useState(String(Number(project?.target_amount_bdt ?? 0)));
  const [plannedMembers, setPlannedMembers] = useState(String(project?.planned_member_count ?? DEFAULT_PLANNED_MEMBER_COUNT));
  const [monthlyContribution, setMonthlyContribution] = useState(String(Number(project?.monthly_contribution_bdt ?? DEFAULT_MONTHLY_MEMBER_CONTRIBUTION_BDT)));
  const [startMonth, setStartMonth] = useState(project?.contribution_start_month?.slice(0, 7) ?? DEFAULT_PROJECT_START_MONTH);
  const [currencyCode, setCurrencyCode] = useState(project?.currency_code ?? "BDT");
  const [status, setStatus] = useState<ProjectStatus>(project?.status ?? "draft");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCreating(!project);
    setName(project?.name ?? "");
    setDescription(project?.description ?? "");
    setTargetAmount(String(Number(project?.target_amount_bdt ?? 0)));
    setPlannedMembers(String(project?.planned_member_count ?? DEFAULT_PLANNED_MEMBER_COUNT));
    setMonthlyContribution(String(Number(project?.monthly_contribution_bdt ?? DEFAULT_MONTHLY_MEMBER_CONTRIBUTION_BDT)));
    setStartMonth(project?.contribution_start_month?.slice(0, 7) ?? DEFAULT_PROJECT_START_MONTH);
    setCurrencyCode(project?.currency_code ?? "BDT");
    setStatus(project?.status ?? "draft");
  }, [project]);

  function beginCreate() {
    setCreating(true);
    setName("");
    setDescription("");
    setTargetAmount("0");
    setPlannedMembers(String(DEFAULT_PLANNED_MEMBER_COUNT));
    setMonthlyContribution(String(DEFAULT_MONTHLY_MEMBER_CONTRIBUTION_BDT));
    setStartMonth(currentMonthKey());
    setCurrencyCode("BDT");
    setStatus("draft");
  }

  function cancelCreate() {
    if (!project) return;
    setCreating(false);
    setName(project.name);
    setDescription(project.description ?? "");
    setTargetAmount(String(Number(project.target_amount_bdt)));
    setPlannedMembers(String(project.planned_member_count));
    setMonthlyContribution(String(Number(project.monthly_contribution_bdt)));
    setStartMonth(project.contribution_start_month.slice(0, 7));
    setCurrencyCode(project.currency_code);
    setStatus(project.status);
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const input = {
        name: name.trim(),
        description: description.trim() || null,
        targetAmountBdt: Number(targetAmount),
        plannedMemberCount: Number(plannedMembers),
        monthlyContributionBdt: Number(monthlyContribution),
        contributionStartMonth: startMonth,
        currencyCode: currencyCode.trim().toUpperCase(),
        status,
      };

      if (creating || !project) {
        const created = await createProject(input);
        await onSaved(created.id, "Project created.");
      } else {
        await updateProjectSettings({ id: project.id, ...input });
        await onSaved(project.id);
      }
    } catch (err) {
      onError(getErrorMessage(err, "Could not save project setup."));
    } finally {
      setBusy(false);
    }
  }

  const perMemberTarget = getPerMemberTarget(Number(targetAmount), Number(plannedMembers));
  const durationMonths = perMemberTarget > 0 && Number(monthlyContribution) > 0
    ? Math.ceil(perMemberTarget / Number(monthlyContribution))
    : 0;

  return (
    <div className="project-management-layout">
      <section className="panel project-list-panel">
        <div className="panel-title split-title">
          <div><span className="title-icon"><Settings size={20} /></span><h2>Projects</h2></div>
          <button className="primary-button" type="button" onClick={beginCreate}>New project</button>
        </div>
        <p className="helper-text">Create separate funds and open one to manage its members, payments, and reports.</p>
        <div className="project-list">
          {projects.length === 0 && <EmptyState text="No projects yet. Create the first investment project." />}
          {projects.map((item) => (
            <button
              className={`project-list-item ${!creating && project?.id === item.id ? "active" : ""}`}
              key={item.id}
              type="button"
              onClick={() => void onSaved(item.id, `Opened ${item.name}.`)}
            >
              <span><strong>{item.name}</strong><small>{formatBdt(Number(item.target_amount_bdt))} target</small></span>
              <span className={`status-pill ${item.status === "active" ? "approved" : item.status === "archived" ? "rejected" : "pending"}`}>{item.status}</span>
            </button>
          ))}
        </div>
      </section>

      <form className="panel wide project-settings-form" onSubmit={(event) => void save(event)}>
        <div className="panel-title split-title">
          <div><span className="title-icon"><Settings size={20} /></span><div><h2>{creating ? "Create project" : "Project setup"}</h2><p>Each project has its own target, member plan, and monthly rule.</p></div></div>
          {creating && project && <button className="secondary-button" type="button" onClick={cancelCreate}>Cancel</button>}
        </div>
        <div className="project-settings-summary">
          <MiniStat label="Total project target" value={formatBdt(Number(targetAmount || 0))} />
          <MiniStat label="Suggested share per member" value={formatBdt(perMemberTarget)} />
          <MiniStat label="Estimated contribution time" value={durationMonths ? formatFundingDuration(durationMonths) : "Not available"} />
        </div>
        <div className="form-grid">
          <label>
            Project name
            <input value={name} onChange={(event) => setName(event.target.value)} required />
          </label>
          <label>
            Project status
            <select value={status} onChange={(event) => setStatus(event.target.value as ProjectStatus)}>
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="completed">Completed</option>
              <option value="archived">Archived</option>
            </select>
          </label>
          <label>
            Total target in BDT
            <input type="number" min="0" step="1" value={targetAmount} onChange={(event) => setTargetAmount(event.target.value)} required />
          </label>
          <label>
            Planned members
            <input type="number" min="1" step="1" value={plannedMembers} onChange={(event) => setPlannedMembers(event.target.value)} required />
          </label>
          <label>
            Monthly contribution per member
            <input type="number" min="1" step="1" value={monthlyContribution} onChange={(event) => setMonthlyContribution(event.target.value)} required />
          </label>
          <label>
            Contribution start month
            <input type="month" value={startMonth} onChange={(event) => setStartMonth(event.target.value)} required />
          </label>
          <label>
            Currency code
            <input value={currencyCode} maxLength={3} onChange={(event) => setCurrencyCode(event.target.value)} required />
          </label>
        </div>
        <label>
          Description
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} />
        </label>
        {!creating && <p className="project-rule-warning"><AlertCircle size={16} /> Changing the monthly amount or start month recalculates the displayed payment schedule. Existing payment records and receipt amounts are never changed.</p>}
        <button className="primary-button" type="submit" disabled={busy}>
          {busy ? "Saving" : creating ? "Create project" : "Save project"}
        </button>
      </form>
    </div>
  );
}

function ReviewItem({ contribution, onApprove, onReject }: {
  contribution: Contribution;
  onApprove: () => void;
  onReject: () => void;
}) {
  const [opening, setOpening] = useState(false);
  const receipt = contribution.payment_receipts?.[0];

  async function openReceipt() {
    if (!receipt) return;
    setOpening(true);
    try {
      const url = await getSignedReceiptUrl(receipt.storage_path);
      window.open(url, "_blank", "noopener,noreferrer");
    } finally {
      setOpening(false);
    }
  }

  return (
    <article className="review-item">
      <div className="review-item-head">
        <div className="review-member-identity">
          <span><UserRound size={19} /></span>
          <div><h3>{getContributionMemberName(contribution)}</h3><p>{contribution.member?.email || contribution.profiles?.email || "Member account"}</p></div>
        </div>
        <div className="review-amount"><small>Pending contribution</small><strong>{formatBdt(Number(contribution.bdt_amount))}</strong></div>
      </div>
      <div className="review-detail-grid">
        <MiniStat label="Payment date" value={formatDate(contribution.payment_date)} />
        <MiniStat label="Method" value={contribution.payment_method || "Not set"} />
        <MiniStat label="Sent from" value={contribution.sent_from_country || "Not set"} />
        <MiniStat label="Source amount" value={contribution.source_currency ? `${contribution.source_currency} ${contribution.source_amount ?? ""}` : "BDT transfer"} />
        <MiniStat label="Exchange rate" value={contribution.exchange_rate ? String(contribution.exchange_rate) : "Not set"} />
        <MiniStat label="Receipt" value={receipt ? "Available" : "Missing"} />
      </div>
      {contribution.notes && <div className="review-note"><span>Member note</span><p>{contribution.notes}</p></div>}
      <div className="review-decision-bar">
        <p><ShieldCheck size={15} /> Verify the amount and receipt before making a decision.</p>
        <div className="review-actions">
        <button className="secondary-button" type="button" onClick={() => void openReceipt()} disabled={!receipt || opening}>
          <ReceiptText size={16} /> {opening ? "Opening" : "Receipt"}
        </button>
        <button className="approve-button" type="button" onClick={onApprove}><CheckCircle2 size={16} /> Approve</button>
        <button className="reject-button" type="button" onClick={onReject}><XCircle size={16} /> Reject</button>
        </div>
      </div>
    </article>
  );
}

function ContributionTable({ title, contributions, admin = false, onOpenReceipt }: {
  title: string;
  contributions: Contribution[];
  admin?: boolean;
  onOpenReceipt?: (contribution: Contribution) => Promise<void>;
}) {
  const totals = calculateTotals(contributions);
  const latestContribution = contributions
    .slice()
    .sort((a, b) => b.payment_date.localeCompare(a.payment_date))[0];

  return (
    <section className="panel wide">
      <div className="panel-title split-title">
        <div><span className="title-icon"><ReceiptText size={20} /></span><div><h2>{title}</h2><p>Payment records, statuses, and receipt archive.</p></div></div>
        <span className="count-badge">{contributions.length} records</span>
      </div>
      {!admin && (
        <div className="history-summary-grid">
          <MetricCard icon={<CheckCircle2 />} label="Approved total" value={formatBdt(totals.approved)} />
          <MetricCard icon={<Clock3 />} label="Pending review" value={formatBdt(totals.pending)} />
          <MetricCard icon={<ReceiptText />} label="Latest payment" value={latestContribution ? `${formatDate(latestContribution.payment_date)} / ${formatBdt(Number(latestContribution.bdt_amount))}` : "No payment"} />
        </div>
      )}
      {contributions.length === 0 ? (
        <EmptyState text="No contribution records yet." />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {admin && <th>Member</th>}
                <th>Date</th>
                <th>BDT</th>
                <th>Source</th>
                <th>Status</th>
                <th>Receipt</th>
              </tr>
            </thead>
            <tbody>
              {contributions.map((contribution) => (
                <tr key={contribution.id}>
                  {admin && (
                    <td data-label="Member">
                      {contribution.member?.full_name || contribution.member?.email || contribution.profiles?.full_name || contribution.profiles?.email || "Member"}
                    </td>
                  )}
                  <td data-label="Date">{formatDate(contribution.payment_date)}</td>
                  <td data-label="BDT">{formatBdt(Number(contribution.bdt_amount))}</td>
                  <td data-label="Source">{contribution.source_currency ? `${contribution.source_currency} ${contribution.source_amount ?? ""}` : contribution.sent_from_country || "BDT"}</td>
                  <td data-label="Status"><StatusPill status={contribution.status} /></td>
                  <td data-label="Receipt">
                    {onOpenReceipt
                      ? <ReceiptLink contribution={contribution} onOpenReceipt={onOpenReceipt} />
                      : contribution.payment_receipts?.length ? "Available" : "None"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ReceiptLink({ contribution, onOpenReceipt }: {
  contribution: Contribution;
  onOpenReceipt: (contribution: Contribution) => Promise<void>;
}) {
  const receipt = contribution.payment_receipts?.[0];
  if (!receipt) return <span>Missing</span>;

  return (
    <button
      className="receipt-link"
      type="button"
      title={receipt.file_name}
      aria-label={`View receipt for ${getContributionMemberName(contribution)}`}
      onClick={() => void onOpenReceipt(contribution)}
    >
      <Eye size={15} aria-hidden="true" />
      <span className="receipt-label-full">View receipt</span>
      <span className="receipt-label-compact" aria-hidden="true">Receipt</span>
    </button>
  );
}

function RolePill({ role, status }: { role: ProfileRole; status: MembershipStatus }) {
  if (role === "admin") return <span className="status-pill admin"><ShieldCheck size={14} /> Admin</span>;
  if (role === "viewer") return <span className="status-pill viewer"><UserRound size={14} /> Viewer</span>;
  const tone = status === "active" ? "approved" : status === "paused" ? "pending" : "rejected";
  const Icon = status === "active" ? CheckCircle2 : status === "paused" ? Clock3 : XCircle;
  return <span className={`status-pill ${tone}`}><Icon size={14} /> {status}</span>;
}

function StatusPill({ status }: { status: Contribution["status"] }) {
  const Icon = status === "approved" ? CheckCircle2 : status === "rejected" ? XCircle : Clock3;
  return <span className={`status-pill ${status}`}><Icon size={14} /> {status}</span>;
}

function MetricCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <article className="metric-card">
      <div className="metric-icon">{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function InlineNotice({ tone, text, onClose }: { tone: "success" | "error"; text: string; onClose: () => void }) {
  return (
    <div className={`inline-notice ${tone}`}>
      {tone === "success" ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
      <span>{text}</span>
      <button type="button" onClick={onClose}>Dismiss</button>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="empty-state">{text}</div>;
}

function StatusMessage({ title, body }: { title: string; body: string }) {
  return (
    <div className="status-message">
      <Clock3 size={24} />
      <h2>{title}</h2>
      <p>{body}</p>
    </div>
  );
}

function SectionRefreshLoader() {
  return (
    <div className="section-refresh-loader" role="status" aria-live="polite">
      <span className="section-refresh-spinner" aria-hidden="true" />
      <div>
        <strong>Checking for new submissions</strong>
        <small>Refreshing the latest member payments and receipts.</small>
      </div>
    </div>
  );
}

function AppLoadingScreen({ title, body }: { title: string; body: string }) {
  return (
    <main className="app-loading-screen" role="status" aria-live="polite">
      <div className="app-loading-glow app-loading-glow-one" aria-hidden="true" />
      <div className="app-loading-glow app-loading-glow-two" aria-hidden="true" />
      <section className="app-loading-card">
        <div className="investment-loader" aria-hidden="true">
          <span className="loader-orbit loader-orbit-outer" />
          <span className="loader-orbit loader-orbit-inner" />
          <span className="loader-spark loader-spark-one" />
          <span className="loader-spark loader-spark-two" />
          <span className="loader-core"><ShieldCheck size={30} /></span>
        </div>
        <p className="loading-brand">HomeFund secure ledger</p>
        <h1>{title}</h1>
        <p className="loading-copy">{body}</p>
        <div className="loading-progress" aria-hidden="true"><span /></div>
        <div className="loading-steps" aria-hidden="true">
          <span>Secure session</span>
          <span>Live contributions</span>
          <span>Protected receipts</span>
        </div>
      </section>
    </main>
  );
}

function SetupNotice() {
  return (
    <PageShell compact>
      <div className="panel setup-panel">
        <div className="panel-title">
          <AlertCircle size={20} />
          <h1>Supabase environment is missing</h1>
        </div>
        <p>Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env.local`, then restart the dev server.</p>
      </div>
    </PageShell>
  );
}

function PageShell({ children, compact = false, adminShell = false }: {
  children: React.ReactNode;
  compact?: boolean;
  adminShell?: boolean;
}) {
  const className = ["page-shell", compact ? "compact" : "", adminShell ? "admin-shell" : ""]
    .filter(Boolean)
    .join(" ");
  return <div className={className}>{children}</div>;
}

export default App;
