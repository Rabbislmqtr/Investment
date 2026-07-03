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
  FileText,
  Filter,
  LayoutDashboard,
  LogOut,
  Menu,
  ReceiptText,
  Settings,
  ShieldCheck,
  Upload,
  Users,
  UserRound,
  XCircle,
} from "lucide-react";
import type { Contribution, InvestmentProject, MemberPaymentStatus, MemberRecord, MembershipStatus, Profile, ProfileRole } from "./types";
import {
  calculateTotals,
  getActiveProject,
  getAdminContributions,
  getAdminMembers,
  getCurrentProfile,
  getMemberContributions,
  getMemberPaymentStatus,
  getProjectApprovedContributions,
  getSignedReceiptUrl,
  reviewContribution,
  submitContribution,
  updateMemberRecord,
  updateProjectSettings,
  updateProfile,
} from "./lib/investmentApi";
import { formatBdt, formatDate, fileSizeLabel } from "./lib/format";
import { hasSupabaseConfig, supabase } from "./lib/supabase";

type ViewMode = "member" | "admin";
type AdminSection = "overview" | "review" | "reports" | "members" | "project";
type MemberSection = "overview" | "submit" | "status" | "history" | "profile";

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

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoadingSession(false);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoadingSession(false);
    });

    return () => data.subscription.unsubscribe();
  }, []);

  if (!hasSupabaseConfig) return <SetupNotice />;
  if (loadingSession) return <PageShell><StatusMessage title="Opening your dashboard" body="Checking your login session." /></PageShell>;
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
  const [contributions, setContributions] = useState<Contribution[]>([]);
  const [projectCollections, setProjectCollections] = useState<Contribution[]>([]);
  const [mode, setMode] = useState<ViewMode>("member");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = profile?.role === "admin";

  async function loadData(nextMode?: ViewMode) {
    setLoading(true);
    setError(null);
    try {
      const [profileData, projectData] = await Promise.all([
        getCurrentProfile(session.user.id),
        getActiveProject(),
      ]);

      setProfile(profileData);
      setProject(projectData);

      const effectiveMode = profileData?.role === "admin" ? "admin" : nextMode ?? "member";
      setMode(effectiveMode);

      let contributionData: Contribution[] = [];
      let collectionData: Contribution[] = [];

      if (effectiveMode === "admin") {
        contributionData = await getAdminContributions();
        collectionData = contributionData.filter((contribution) => contribution.status === "approved" && !isContributionFromAdmin(contribution));
      } else {
        const [memberContributionData, projectCollectionData] = await Promise.all([
          getMemberContributions(session.user.id),
          projectData ? getProjectApprovedContributions(projectData.id) : Promise.resolve([]),
        ]);
        contributionData = memberContributionData;
        collectionData = projectCollectionData;
      }

      setContributions(contributionData);
      setProjectCollections(collectionData);
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

  return (
    <PageShell adminShell={Boolean(profile)}>
      <header className="app-header">
        <div className="app-title">
          <p className="eyebrow">Private investment ledger</p>
          <h1>{project?.name ?? "Land & Home Investment"}</h1>
          {project?.description && <p>{project.description}</p>}
        </div>
        <div className="header-actions">
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
          contributions={contributions}
          projectCollections={projectCollections}
          reviewerId={session.user.id}
          currentUserId={session.user.id}
          onProjectSaved={async () => {
            setMessage("Project setup saved.");
            await loadData("admin");
          }}
          onReviewed={async (text) => {
            setMessage(text);
            await loadData("admin");
          }}
          onError={setError}
        />
      ) : (
        <MemberDashboard
          userId={session.user.id}
          profile={profile}
          project={project}
          contributions={contributions}
          projectCollections={projectCollections}
          onSavedProfile={async () => {
            setMessage("Profile saved.");
            await loadData("member");
          }}
          onSubmitted={async () => {
            setMessage("Payment proof submitted for review.");
            await loadData("member");
          }}
          onError={setError}
        />
      )}
    </PageShell>
  );
}

function AuthScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const result = mode === "login"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({
            email,
            password,
            options: { data: { full_name: fullName } },
          });

      if (result.error) throw result.error;
      if (mode === "signup") setMessage("Account created. Check email confirmation settings in Supabase if login is blocked.");
    } catch (err) {
      setMessage(getErrorMessage(err, "Authentication failed."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageShell compact>
      <main className="auth-layout">
        <section className="auth-copy">
          <p className="eyebrow">Home Investment</p>
          <h1>Contribution records for the land and home fund</h1>
          <p>Members can submit payment proof and track approved BDT contributions. Admins can review receipts and keep the ledger clean.</p>
        </section>
        <form className="panel auth-panel" onSubmit={(event) => void submit(event)}>
          <div className="segmented-control full">
            <button type="button" className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>Login</button>
            <button type="button" className={mode === "signup" ? "active" : ""} onClick={() => setMode("signup")}>Create account</button>
          </div>
          {mode === "signup" && (
            <label>
              Full name
              <input value={fullName} onChange={(event) => setFullName(event.target.value)} required />
            </label>
          )}
          <label>
            Email
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </label>
          <label>
            Password
            <input type="password" minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} required />
          </label>
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? "Please wait" : mode === "login" ? "Login" : "Create account"}
          </button>
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
  onSavedProfile: () => Promise<void>;
  onSubmitted: () => Promise<void>;
  onError: (message: string) => void;
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
        </nav>
      </aside>

      <main className="admin-content">
        {activeSection === "overview" && (
          <MemberOverview
            profile={props.profile}
            project={props.project}
            contributions={props.contributions}
            projectCollections={props.projectCollections}
            totals={totals}
            onNavigate={selectSection}
          />
        )}

        {activeSection === "submit" && (
          <PaymentForm
            userId={props.userId}
            project={props.project}
            onSubmitted={props.onSubmitted}
            onError={props.onError}
          />
        )}

        {activeSection === "status" && (
          <MemberPaymentStatusPanel project={props.project} onError={props.onError} />
        )}

        {activeSection === "history" && (
          <ContributionTable title="My contribution history" contributions={props.contributions} />
        )}

        {activeSection === "profile" && (
          <ProfilePanel userId={props.userId} profile={props.profile} onSaved={props.onSavedProfile} onError={props.onError} />
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
    { id: "profile", label: "Profile", icon: <UserRound size={17} />, detail: `${pendingCount} pending` },
  ];
}

function TargetProgressCard({ collected, target }: { collected: number; target: number }) {
  const progress = target > 0 ? Math.min(100, (collected / target) * 100) : 0;
  const remaining = Math.max(0, target - collected);

  return (
    <>
      <div className="panel-title split-title">
        <div>
          <span className="title-icon"><LayoutDashboard size={20} /></span>
          <h2>Target progress</h2>
        </div>
        <span className="count-badge">{target > 0 ? `${Math.round(progress)}% funded` : "No target"}</span>
      </div>
      {target > 0 ? (
        <div className="target-progress-layout" aria-label="Investment target progress">
          <div
            className="target-progress-ring"
            style={{ background: `conic-gradient(#2f8060 0 ${progress}%, #e2ece7 ${progress}% 100%)` }}
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
    </>
  );
}

function MemberOverview({ profile, project, contributions, projectCollections, totals, onNavigate }: {
  profile: Profile | null;
  project: InvestmentProject | null;
  contributions: Contribution[];
  projectCollections: Contribution[];
  totals: ReturnType<typeof calculateTotals>;
  onNavigate: (section: MemberSection) => void;
}) {
  const projectTotals = useMemo(() => calculateTotals(projectCollections), [projectCollections]);
  const target = Number(project?.target_amount_bdt ?? 0);
  const progress = target > 0 ? Math.min(100, (projectTotals.approved / target) * 100) : 0;
  const recent = contributions.slice(0, 5);
  const paidThisMonth = contributions.some((contribution) => contribution.status === "approved" && monthKey(contribution.payment_date) === currentMonthKey());

  return (
    <div className="finance-dashboard-grid">
      <section className="panel finance-balance-card">
        <div className="finance-card-head">
          <div>
            <p className="eyebrow">Total collected</p>
            <h2>{formatBdt(projectTotals.approved)}</h2>
            <span>{project?.name ?? "No active project"}</span>
          </div>
          <span className="title-icon"><Banknote size={20} /></span>
        </div>
        <CollectionChart contributions={projectCollections} />
        <div className="mini-card-row">
          <MiniStat label="My approved" value={formatBdt(totals.approved)} />
          <MiniStat label="Waiting review" value={formatBdt(totals.pending)} />
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

      <section className="panel finance-member-card">
        <div className="panel-title split-title">
          <div>
            <span className="title-icon"><UserRound size={20} /></span>
            <h2>My member profile</h2>
          </div>
          <button className="secondary-button" type="button" onClick={() => onNavigate("profile")}>Edit</button>
        </div>
        <div className="member-identity">
          <span className="member-avatar"><UserRound size={24} /></span>
          <div>
            <strong>{profile?.full_name || profile?.email || "Member"}</strong>
            <small>{profile?.email ?? "Email not set"}</small>
          </div>
        </div>
        <div className="insight-list compact-insights">
          <InsightRow label="Role" value={profile?.role ?? "member"} />
          <InsightRow label="Phone" value={profile?.phone ?? "Not set"} />
          <InsightRow label="Country" value={profile?.resident_country ?? "Not set"} />
        </div>
      </section>

      <section className="panel finance-progress-card">
        <TargetProgressCard collected={projectTotals.approved} target={target} />
      </section>

      <section className="panel finance-score-card">
        <div className="panel-title split-title">
          <div>
            <span className="title-icon"><Users size={20} /></span>
            <h2>Payment status</h2>
          </div>
          <button className="secondary-button" type="button" onClick={() => onNavigate("status")}>Open</button>
        </div>
        <ProgressGauge value={progress} label={paidThisMonth ? "Current" : "Needs payment"} />
      </section>
    </div>
  );
}

function currentMonthKey() {
  return new Date().toISOString().slice(0, 7);
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
        const statusRows = await getMemberPaymentStatus(activeProjectId, month);
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
  }, [month, onError, projectId]);

  const paidCount = rows.filter((row) => row.paid).length;
  const unpaidCount = rows.length - paidCount;

  return (
    <section className="panel">
      <div className="panel-title split-title">
        <div>
          <span className="title-icon"><Users size={20} /></span>
          <h2>Member payment status</h2>
        </div>
        <span className="count-badge">{monthLabel(month)}</span>
      </div>
      <p className="helper-text">Select a month to see which project members have an approved payment.</p>
      <div className="filter-grid">
        <label>
          Month
          <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
        </label>
      </div>
      <div className="admin-metric-grid">
        <MetricCard icon={<CheckCircle2 />} label="Paid members" value={loading ? "Loading" : String(paidCount)} />
        <MetricCard icon={<Clock3 />} label="Not paid" value={loading ? "Loading" : String(unpaidCount)} />
        <MetricCard icon={<Users />} label="Members shown" value={loading ? "Loading" : String(rows.length)} />
      </div>

      {loading ? (
        <StatusMessage title="Loading payment status" body="Checking approved contributions for the selected month." />
      ) : rows.length === 0 ? (
        <EmptyState text="No active members found for this project." />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Member</th>
                <th>Status</th>
                <th>Last paid</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.memberId}>
                  <td data-label="Member">
                    <strong>{row.memberName}</strong>
                  </td>
                  <td data-label="Status">
                    <span className={`status-pill ${row.paid ? "approved" : "pending"}`}>
                      {row.paid ? <CheckCircle2 size={14} /> : <Clock3 size={14} />}
                      {row.paid ? "Paid" : "Not paid"}
                    </span>
                  </td>
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

function ProfilePanel({ userId, profile, onSaved, onError }: {
  userId: string;
  profile: Profile | null;
  onSaved: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const initialPhone = splitPhoneNumber(profile?.phone);
  const [fullName, setFullName] = useState(profile?.full_name ?? "");
  const [phoneCode, setPhoneCode] = useState(initialPhone.code);
  const [phone, setPhone] = useState(initialPhone.number);
  const [country, setCountry] = useState(profile?.resident_country ?? "");
  const [busy, setBusy] = useState(false);

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
    <form className="panel" onSubmit={(event) => void save(event)}>
      <div className="panel-title">
        <UserRound size={20} />
        <h2>Member profile</h2>
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
      <button className="secondary-button" type="submit" disabled={busy}>{busy ? "Saving" : "Save profile"}</button>
    </form>
  );
}

function PaymentForm({ userId, project, onSubmitted, onError }: {
  userId: string;
  project: InvestmentProject | null;
  onSubmitted: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
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
    <form className="panel payment-panel" onSubmit={(event) => void submit(event)}>
      <div className="panel-title">
        <Upload size={20} />
        <h2>Submit payment proof</h2>
      </div>
      <div className="form-grid">
        <label>
          Payment date
          <input type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} required />
        </label>
        <label>
          BDT amount
          <input type="number" min="1" step="0.01" value={bdtAmount} onChange={(event) => setBdtAmount(event.target.value)} required />
        </label>
        <label>
          Source currency
          <input value={sourceCurrency} onChange={(event) => setSourceCurrency(event.target.value.toUpperCase())} placeholder="SAR, AED, QAR" />
        </label>
        <label>
          Source amount
          <input type="number" min="0" step="0.01" value={sourceAmount} onChange={(event) => setSourceAmount(event.target.value)} />
        </label>
        <label>
          Exchange rate
          <input type="number" min="0" step="0.000001" value={exchangeRate} onChange={(event) => setExchangeRate(event.target.value)} />
        </label>
        <label>
          Sent from
          <input value={country} onChange={(event) => setCountry(event.target.value)} placeholder="Saudi Arabia" />
        </label>
      </div>
      <label>
        Payment method
        <input value={method} onChange={(event) => setMethod(event.target.value)} placeholder="Bank transfer, cash deposit..." />
      </label>
      <label>
        Notes
        <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} />
      </label>
      <label className="file-picker">
        <FileText size={18} />
        <span>{receipt ? `${receipt.name} (${fileSizeLabel(receipt.size)})` : "Attach PDF, JPG, or PNG receipt"}</span>
        <input
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/jpg"
          onChange={(event) => setReceipt(event.target.files?.[0] ?? null)}
          required
        />
      </label>
      <button className="primary-button" type="submit" disabled={busy}>{busy ? "Submitting" : "Submit for review"}</button>
    </form>
  );
}

function AdminDashboard({ project, contributions, projectCollections, reviewerId, currentUserId, onProjectSaved, onReviewed, onError }: {
  project: InvestmentProject | null;
  contributions: Contribution[];
  projectCollections: Contribution[];
  reviewerId: string;
  currentUserId: string;
  onProjectSaved: () => Promise<void>;
  onReviewed: (message: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [activeSection, setActiveSection] = useState<AdminSection>("overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [members, setMembers] = useState<MemberRecord[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
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
        reviewerId,
        projectId: contribution.project_id,
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

  function selectSection(section: AdminSection) {
    setActiveSection(section);
    setSidebarOpen(false);
  }

  const activeNavItem = navItemsConfig(pending.length, members.length).find((item) => item.id === activeSection);
  const navItems = navItemsConfig(pending.length, members.length);

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
        </nav>
      </aside>

      <main className="admin-content">
        {activeSection === "overview" && (
          <AdminOverview
            project={project}
            contributions={contributions}
            projectCollections={projectCollections}
            members={members}
            loadingMembers={loadingMembers}
            onNavigate={selectSection}
            onOpenReceipt={openContributionReceipt}
          />
        )}

        {activeSection === "review" && (
          <PendingReviewPanel
            pending={pending}
            onReview={handleReview}
          />
        )}

        {activeSection === "reports" && <AdminReportPanel contributions={contributions} onOpenReceipt={openContributionReceipt} />}

        {activeSection === "members" && project && (
          <MemberManagementPanel
            projectId={project.id}
            currentUserId={currentUserId}
            members={members}
            loading={loadingMembers}
            onReload={loadMembers}
            onError={onError}
          />
        )}

        {activeSection === "project" && project && (
          <ProjectSetupPanel
            project={project}
            onSaved={onProjectSaved}
            onError={onError}
          />
        )}
      </main>
    </div>
  );
}

function navItemsConfig(pendingCount: number, memberCount: number): Array<{ id: AdminSection; label: string; icon: React.ReactNode; detail: string }> {
  return [
    { id: "overview", label: "Overview", icon: <LayoutDashboard size={17} />, detail: "Fund health" },
    { id: "review", label: "Review", icon: <ShieldCheck size={17} />, detail: `${pendingCount} pending` },
    { id: "reports", label: "Reports", icon: <Filter size={17} />, detail: "Approved ledger" },
    { id: "members", label: "Members", icon: <Users size={17} />, detail: `${memberCount} users` },
    { id: "project", label: "Project", icon: <Settings size={17} />, detail: "Setup" },
  ];
}

function AdminOverview({ project, contributions, projectCollections, members, loadingMembers, onNavigate, onOpenReceipt }: {
  project: InvestmentProject | null;
  contributions: Contribution[];
  projectCollections: Contribution[];
  members: MemberRecord[];
  loadingMembers: boolean;
  onNavigate: (section: AdminSection) => void;
  onOpenReceipt: (contribution: Contribution) => Promise<void>;
}) {
  const memberContributions = contributions.filter((contribution) => !isContributionFromAdmin(contribution));
  const approved = memberContributions.filter((contribution) => contribution.status === "approved");
  const pending = memberContributions.filter((contribution) => contribution.status === "pending");
  const rejected = memberContributions.filter((contribution) => contribution.status === "rejected");
  const approvedTotal = projectCollections.reduce((sum, contribution) => sum + Number(contribution.bdt_amount), 0);
  const pendingTotal = pending.reduce((sum, contribution) => sum + Number(contribution.bdt_amount), 0);
  const receiptBackedApproved = approved.filter((contribution) => (contribution.payment_receipts?.length ?? 0) > 0).length;
  const memberAccounts = members.filter(isMemberAccount);
  const activeMembers = memberAccounts.filter((member) => getEffectiveMembershipStatus(member) === "active").length;
  const pausedMembers = memberAccounts.filter((member) => getEffectiveMembershipStatus(member) === "paused").length;
  const needsSetupMembers = memberAccounts.filter((member) => !member.membership).length;
  const adminUsers = members.filter((member) => member.role === "admin").length;
  const target = Number(project?.target_amount_bdt ?? 0);
  const recentApproved = approved
    .slice()
    .sort((a, b) => b.payment_date.localeCompare(a.payment_date))
    .slice(0, 5);

  return (
    <div className="finance-dashboard-grid">
      <section className="panel finance-balance-card">
        <div className="finance-card-head">
          <div>
            <p className="eyebrow">Total collected</p>
            <h2>{formatBdt(approvedTotal)}</h2>
            <span>{project?.name ?? "No active project"}</span>
          </div>
          <span className="title-icon"><ShieldCheck size={20} /></span>
        </div>
        <CollectionChart contributions={projectCollections} />
        <div className="mini-card-row">
          <MiniStat label="Pending" value={`${pending.length} / ${formatBdt(pendingTotal)}`} />
          <MiniStat label="Active members" value={loadingMembers ? "Loading" : String(activeMembers)} />
        </div>
      </section>

      <section className="panel finance-transactions-card">
        <div className="panel-title">
          <div>
            <span className="title-icon"><ReceiptText size={20} /></span>
            <h2>Recent approved contributions</h2>
          </div>
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
        <TargetProgressCard collected={approvedTotal} target={target} />
      </section>

      <section className="panel finance-score-card">
        <div className="panel-title split-title">
          <div>
            <span className="title-icon"><Users size={20} /></span>
            <h2>Membership health</h2>
          </div>
          <button className="secondary-button" type="button" onClick={() => onNavigate("members")}>Manage</button>
        </div>
        <ProgressGauge value={memberAccounts.length ? (activeMembers / memberAccounts.length) * 100 : 0} label={`${activeMembers} active`} />
        <div className="insight-list compact-insights">
          <InsightRow label="Paused" value={loadingMembers ? "Loading" : String(pausedMembers)} />
          <InsightRow label="Needs setup" value={loadingMembers ? "Loading" : String(needsSetupMembers)} />
          <InsightRow label="Admins" value={loadingMembers ? "Loading" : String(adminUsers)} />
          <InsightRow label="Receipt coverage" value={approved.length ? `${Math.round((receiptBackedApproved / approved.length) * 100)}%` : "No records"} />
          <InsightRow label="Rejected records" value={String(rejected.length)} />
        </div>
      </section>
    </div>
  );
}

function PendingReviewPanel({ pending, onReview }: {
  pending: Contribution[];
  onReview: (contribution: Contribution, status: "approved" | "rejected") => Promise<void>;
}) {
  return (
    <section className="panel">
      <div className="panel-title split-title">
        <div>
          <span className="title-icon"><ShieldCheck size={20} /></span>
          <h2>Pending review</h2>
        </div>
        <span className="count-badge">{pending.length} payments</span>
      </div>
      {pending.length === 0 ? (
        <EmptyState text="No pending payments need review." />
      ) : (
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
      )}
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
  return contribution.member?.full_name || contribution.member?.email || contribution.profiles?.full_name || contribution.profiles?.email || "Member";
}

function isContributionFromAdmin(contribution: Contribution) {
  return contribution.member?.role === "admin" || contribution.profiles?.role === "admin";
}

function isMemberAccount(member: MemberRecord) {
  return member.role !== "admin";
}

function getEffectiveMembershipStatus(member: MemberRecord): MembershipStatus {
  if (member.role === "admin") return "left";
  return member.membership?.status ?? "active";
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

function AdminReportPanel({ contributions, onOpenReceipt }: {
  contributions: Contribution[];
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
        <MetricCard icon={<ReceiptText />} label="Receipt-backed entries" value={`${receiptBackedCount}/${filteredContributions.length}`} />
        <MetricCard icon={<Users />} label="Filtered member" value={selectedMemberName} />
      </div>
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

function MemberManagementPanel({ projectId, currentUserId, members, loading, onReload, onError }: {
  projectId: string;
  currentUserId: string;
  members: MemberRecord[];
  loading: boolean;
  onReload: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState<string | null>(null);

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
              projectId={projectId}
              isCurrentUser={member.id === currentUserId}
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

function MemberEditor({ member, projectId, isCurrentUser, onSaved, onError }: {
  member: MemberRecord;
  projectId: string;
  isCurrentUser: boolean;
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
  const [joinedAt, setJoinedAt] = useState(member.membership?.joined_at ?? new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState<MembershipStatus>(getEffectiveMembershipStatus(member));
  const [busy, setBusy] = useState(false);
  const isAdminRole = role === "admin";

  useEffect(() => {
    const nextPhone = splitPhoneNumber(member.phone);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFullName(member.full_name);
    setPhoneCode(nextPhone.code);
    setPhone(nextPhone.number);
    setCountry(member.resident_country ?? "");
    setRole(member.role);
    setMemberCode(member.membership?.member_code ?? "");
    setJoinedAt(member.membership?.joined_at ?? new Date().toISOString().slice(0, 10));
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
    } catch (err) {
      onError(getErrorMessage(err, "Could not save member."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="member-card" onSubmit={(event) => void save(event)}>
      <div className="member-card-head">
        <div>
          <h3>{member.full_name || member.email || "Unnamed member"}</h3>
          <p>{member.email ?? "No email"}{isCurrentUser ? " / current admin" : ""}</p>
        </div>
        <RolePill role={role} status={status} />
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
              <select value={status} onChange={(event) => setStatus(event.target.value as MembershipStatus)}>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="left">Left</option>
              </select>
            </label>
          </>
        )}
      </div>
      <button className="secondary-button" type="submit" disabled={busy}>
        {busy ? "Saving" : "Save member"}
      </button>
    </form>
  );
}

function ProjectSetupPanel({ project, onSaved, onError }: {
  project: InvestmentProject;
  onSaved: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [targetAmount, setTargetAmount] = useState(String(Number(project.target_amount_bdt ?? 0)));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setName(project.name);
    setDescription(project.description ?? "");
    setTargetAmount(String(Number(project.target_amount_bdt ?? 0)));
  }, [project]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      await updateProjectSettings({
        id: project.id,
        name: name.trim(),
        description: description.trim() || null,
        targetAmountBdt: Number(targetAmount),
      });
      await onSaved();
    } catch (err) {
      onError(getErrorMessage(err, "Could not save project setup."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel wide" onSubmit={(event) => void save(event)}>
      <div className="panel-title">
        <Settings size={20} />
        <h2>Project setup</h2>
      </div>
      <div className="form-grid">
        <label>
          Project name
          <input value={name} onChange={(event) => setName(event.target.value)} required />
        </label>
        <label>
          Target amount in BDT
          <input
            type="number"
            min="0"
            step="1"
            value={targetAmount}
            onChange={(event) => setTargetAmount(event.target.value)}
            required
          />
        </label>
      </div>
      <label>
        Description
        <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} />
      </label>
      <button className="secondary-button" type="submit" disabled={busy}>
        {busy ? "Saving" : "Save setup"}
      </button>
    </form>
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
      <div>
        <h3>{contribution.member?.full_name || contribution.member?.email || contribution.profiles?.full_name || contribution.profiles?.email || "Member"}</h3>
        <p>{formatDate(contribution.payment_date)} / {formatBdt(Number(contribution.bdt_amount))}</p>
          <p>{contribution.sent_from_country || "Country not set"} / {contribution.payment_method || "Method not set"}</p>
      </div>
      <div className="review-actions">
        <button className="secondary-button" type="button" onClick={() => void openReceipt()} disabled={!receipt || opening}>
          <ReceiptText size={16} /> {opening ? "Opening" : "Receipt"}
        </button>
        <button className="approve-button" type="button" onClick={onApprove}><CheckCircle2 size={16} /> Approve</button>
        <button className="reject-button" type="button" onClick={onReject}><XCircle size={16} /> Reject</button>
      </div>
    </article>
  );
}

function ContributionTable({ title, contributions, admin = false }: {
  title: string;
  contributions: Contribution[];
  admin?: boolean;
}) {
  return (
    <section className="panel wide">
      <div className="panel-title">
        <ReceiptText size={20} />
        <h2>{title}</h2>
      </div>
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
                  <td data-label="Receipt">{contribution.payment_receipts?.length ? contribution.payment_receipts[0].file_name : "None"}</td>
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
    <button className="receipt-link" type="button" onClick={() => void onOpenReceipt(contribution)}>
      {receipt.file_name}
    </button>
  );
}

function RolePill({ role, status }: { role: ProfileRole; status: MembershipStatus }) {
  if (role === "admin") return <span className="status-pill admin"><ShieldCheck size={14} /> Admin</span>;
  if (role === "viewer") return <span className="status-pill viewer"><UserRound size={14} /> Viewer</span>;
  return <StatusPill status={status === "active" ? "approved" : status === "paused" ? "pending" : "rejected"} />;
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
